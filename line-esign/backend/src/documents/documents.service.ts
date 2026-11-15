import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { sha256Hex } from '../common/crypto';
import type { RequestMeta } from '../common/request-meta';
import { StorageService } from '../common/storage.service';
import { CompanyAccessService } from '../companies/company-access.service';
import { InjectDb, type Db } from '../db/database';
import type { Database, Document, FieldSettings, FieldType, User } from '../db/types';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeThai } from '../search/thai-normalize';
import { DocumentAccessService, type DocAccess } from './document-access.service';
import { DocumentEventsService } from './document-events';
import { prepareSource, UploadRejected } from './pdf/inspect';

export interface DraftPatch {
  title?: string;
  description?: string | null;
  docType?: string | null;
  tags?: string[];
  dueAt?: string | null;
  signingMode?: 'parallel' | 'sequential';
  notifyCreatorOnSign?: boolean;
}

export interface LayoutInput {
  signers: { userId: string; order: number }[];
  fields: { id: string; signerUserId: string; pageNo: number; type: FieldType; x: number; y: number; w: number; h: number; settings?: FieldSettings }[];
}

export type Box = 'todo' | 'waiting' | 'done' | 'drafts' | 'company';

const MAX_FIELDS = 1000;
const REMIND_EVERY_MS = 60 * 60 * 1000;
const fullName = (u: { first_name: string | null; last_name: string | null; line_display_name?: string | null }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.line_display_name || '-';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly companies: CompanyAccessService,
    private readonly access: DocumentAccessService,
    private readonly events: DocumentEventsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  // ------------------------------------------------------------------ create (DOC-01, DOC-02, DOC-08)

  async create(user: User, companyId: string, file: { originalname: string; buffer: Buffer; mimetype: string }, meta: RequestMeta, info: { title?: string; description?: string; docType?: string; tags?: string[] }) {
    const { membership } = await this.companies.requireMember(user, companyId);
    if (!membership?.can_create_documents || membership.status !== 'approved') throw new ForbiddenException('คุณยังไม่มีสิทธิ์สร้างเอกสาร');

    let prepared;
    try {
      prepared = await prepareSource(file.buffer);
    } catch (err) {
      if (err instanceof UploadRejected) throw new BadRequestException(err.message);
      throw err;
    }
    const id = randomUUID();
    const ext = prepared.kind;
    const base = `companies/${companyId}/documents/${id}`;
    const originalKey = `${base}/original.${ext}.enc`;
    const sourceKey = prepared.kind === 'pdf' ? originalKey : `${base}/source.pdf.enc`;
    await this.storage.put(originalKey, file.buffer);
    if (sourceKey !== originalKey) await this.storage.put(sourceKey, prepared.pdf);

    const name = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer gives latin1-decoded names
    const title = info.title?.trim() || name.replace(/\.[^.]+$/, '').slice(0, 200) || 'เอกสาร';
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('documents')
        .values({
          id,
          company_id: companyId,
          created_by: user.id,
          title,
          description: info.description?.trim() || null,
          doc_type: info.docType?.trim() || null,
          tags: info.tags ?? [],
          title_normalized: normalizeThai(title),
          original_name: name.slice(0, 255),
          original_mime: prepared.kind === 'pdf' ? 'application/pdf' : prepared.kind === 'png' ? 'image/png' : 'image/jpeg',
          original_key: originalKey,
          source_key: sourceKey,
          original_sha256: sha256Hex(file.buffer),
          source_sha256: sha256Hex(prepared.pdf),
          page_count: prepared.pages.length,
          byte_size: file.buffer.length,
        })
        .execute();
      await trx
        .insertInto('document_pages')
        .values(prepared.pages.map((p, i) => ({ document_id: id, page_no: i + 1, width: p.x1 - p.x0, height: p.y1 - p.y0, rotation: p.rotation })))
        .execute();
      await this.events.log({ documentId: id, type: 'created', actor: user, details: { fileName: name, pages: prepared.pages.length }, meta }, trx);
      // DOC-08 / SRC-06: read the text of every page (and OCR scans) in the background
      await this.jobs.enqueue('document.extract_text', { documentId: id }, new Date(), trx);
    });
    return { id };
  }

  // ------------------------------------------------------------------ draft editing (DOC-02..07)

  private async requireDraftOwner(user: User, id: string) {
    const a = await this.access.load(user, id);
    if (!a.roles.has('creator')) throw new ForbiddenException('เฉพาะผู้สร้างเอกสาร');
    if (a.doc.status !== 'draft') throw new ConflictException('ส่งเอกสารแล้ว แก้ไฟล์หรือกรอบไม่ได้ ต้องยกเลิกแล้วสร้างใหม่');
    return a;
  }

  async updateDraft(user: User, id: string, patch: DraftPatch) {
    await this.requireDraftOwner(user, id);
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.title !== undefined) {
      set.title = patch.title.trim();
      set.title_normalized = normalizeThai(patch.title);
    }
    if (patch.description !== undefined) set.description = patch.description?.trim() || null;
    if (patch.docType !== undefined) set.doc_type = patch.docType?.trim() || null;
    if (patch.tags !== undefined) set.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
    if (patch.dueAt !== undefined) set.due_at = patch.dueAt ? new Date(patch.dueAt) : null;
    if (patch.signingMode !== undefined) set.signing_mode = patch.signingMode;
    if (patch.notifyCreatorOnSign !== undefined) set.notify_creator_on_sign = patch.notifyCreatorOnSign;
    await this.db.updateTable('documents').set(set).where('id', '=', id).execute();
    return { ok: true };
  }

  /** Saves signers and fields together (the editor autosaves the whole layout). */
  async saveLayout(user: User, id: string, input: LayoutInput) {
    const { doc } = await this.requireDraftOwner(user, id);
    if (input.fields.length > MAX_FIELDS) throw new BadRequestException(`วางกรอบได้ไม่เกิน ${MAX_FIELDS} กรอบ`);
    const userIds = input.signers.map((s) => s.userId);
    if (new Set(userIds).size !== userIds.length) throw new BadRequestException('มีผู้เซ็นซ้ำ');
    if (userIds.length) {
      const ok = await this.db
        .selectFrom('memberships')
        .select('user_id')
        .where('company_id', '=', doc.company_id)
        .where('status', '=', 'approved')
        .where('user_id', 'in', userIds)
        .execute();
      if (ok.length !== userIds.length) throw new BadRequestException('ผู้เซ็นต้องเป็นพนักงานที่อนุมัติแล้วของบริษัท');
    }
    for (const f of input.fields) {
      if (!userIds.includes(f.signerUserId)) throw new BadRequestException('ทุกกรอบต้องมีผู้กรอกที่อยู่ในรายชื่อผู้เซ็น');
      if (f.pageNo < 1 || f.pageNo > doc.page_count) throw new BadRequestException('หน้าของกรอบไม่ถูกต้อง');
      if (f.x + f.w > 1.0001 || f.y + f.h > 1.0001) throw new BadRequestException('กรอบล้นขอบหน้า');
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('fields').where('document_id', '=', id).execute();
      await trx.deleteFrom('document_signers').where('document_id', '=', id).execute();
      const signerIds = new Map<string, string>();
      for (const s of input.signers) {
        const row = await trx
          .insertInto('document_signers')
          .values({ document_id: id, user_id: s.userId, order_index: doc.signing_mode === 'parallel' ? 1 : s.order })
          .returning('id')
          .executeTakeFirstOrThrow();
        signerIds.set(s.userId, row.id);
      }
      if (input.fields.length) {
        await trx
          .insertInto('fields')
          .values(
            input.fields.map((f, i) => ({
              id: f.id,
              document_id: id,
              signer_id: signerIds.get(f.signerUserId)!,
              page_no: f.pageNo,
              type: f.type,
              x: clamp01(f.x),
              y: clamp01(f.y),
              w: Math.min(f.w, 1 - clamp01(f.x)),
              h: Math.min(f.h, 1 - clamp01(f.y)),
              settings: JSON.stringify(sanitizeSettings(f.type, f.settings ?? {})),
              sort_order: i,
            })),
          )
          .execute();
      }
      await trx.updateTable('documents').set({ updated_at: new Date() }).where('id', '=', id).execute();
    });
    return { ok: true };
  }

  async deleteDraft(user: User, id: string) {
    await this.requireDraftOwner(user, id);
    // drafts have no events other than "created"; keep the row and file for the audit trail, just hide it
    await this.db.updateTable('documents').set({ status: 'voided', voided_at: new Date(), void_reason: 'ลบฉบับร่าง', updated_at: new Date() }).where('id', '=', id).execute();
    return { ok: true };
  }

  // ------------------------------------------------------------------ send (DOC-07)

  async send(user: User, id: string, meta: RequestMeta) {
    const { doc } = await this.requireDraftOwner(user, id);
    const problems: string[] = [];
    if (!doc.title.trim()) problems.push('ยังไม่มีชื่อเรื่อง');
    if (!doc.due_at) problems.push('ยังไม่ได้กำหนดวันครบกำหนด');
    else if (doc.due_at.getTime() <= Date.now()) problems.push('วันครบกำหนดต้องเป็นอนาคต');

    const signers = await this.db
      .selectFrom('document_signers as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .innerJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 's.user_id').on('m.company_id', '=', doc.company_id))
      .leftJoin('departments as d', 'd.id', 'm.department_id')
      .leftJoin('positions as p', 'p.id', 'm.position_id')
      .select(['s.id', 's.user_id', 's.order_index', 'u.first_name', 'u.last_name', 'u.line_display_name', 'm.status as memberStatus', 'd.name as dept', 'p.name as pos'])
      .where('s.document_id', '=', id)
      .execute();
    const fields = await this.db.selectFrom('fields').selectAll().where('document_id', '=', id).execute();
    if (!signers.length) problems.push('ยังไม่ได้เลือกผู้เซ็น');
    for (const s of signers) {
      if (s.memberStatus !== 'approved') problems.push(`${fullName(s)} ไม่ได้เป็นพนักงานที่อนุมัติแล้ว`);
      if (!fields.some((f) => f.signer_id === s.id)) problems.push(`${fullName(s)} ยังไม่มีกรอบให้กรอก`);
    }
    for (const f of fields.filter((f) => f.type === 'stamp')) {
      const signer = signers.find((s) => s.id === f.signer_id);
      const allowed = f.settings.stampId
        ? await this.db
            .selectFrom('company_stamps as st')
            .innerJoin('company_stamp_users as su', 'su.stamp_id', 'st.id')
            .select('st.id')
            .where('st.id', '=', f.settings.stampId)
            .where('st.company_id', '=', doc.company_id)
            .where('st.is_active', '=', true)
            .where('su.user_id', '=', signer?.user_id ?? '')
            .executeTakeFirst()
        : undefined;
      if (!allowed) problems.push(`กรอบตราประทับหน้า ${f.page_no}: ผู้กรอกไม่มีสิทธิ์ใช้ตราที่เลือก`);
    }
    if (problems.length) throw new BadRequestException({ message: 'ยังส่งเอกสารไม่ได้', problems });

    await this.db.transaction().execute(async (trx) => {
      for (const s of signers) {
        await trx
          .updateTable('document_signers')
          .set({ display_name: fullName(s), department_name: s.dept, position_name: s.pos, status: 'waiting', ...(doc.signing_mode === 'parallel' ? { order_index: 1 } : {}) })
          .where('id', '=', s.id)
          .execute();
      }
      const sent = await trx
        .updateTable('documents')
        .set({ status: 'pending', sent_at: new Date(), updated_at: new Date() })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .returningAll()
        .executeTakeFirst();
      if (!sent) throw new ConflictException('เอกสารถูกส่งไปแล้ว');
      await this.events.log({ documentId: id, type: 'sent', actor: user, details: { signers: signers.length, fields: fields.length, mode: doc.signing_mode }, meta }, trx);
      await this.activateNextSigners(trx, sent, user);
    });
    return { ok: true };
  }

  /**
   * DOC-06: sequential mode wakes the next order group once everyone before has
   * signed; signers sharing an order sign in parallel. Returns true when all signed.
   */
  async activateNextSigners(trx: Transaction<Database>, doc: Document, sender: Pick<User, 'first_name' | 'last_name' | 'line_display_name'> | null): Promise<boolean> {
    const rows = await trx
      .selectFrom('document_signers')
      .select(['id', 'user_id', 'order_index', 'status'])
      .where('document_id', '=', doc.id)
      .where('status', '<>', 'replaced')
      .execute();
    if (rows.some((r) => r.status === 'pending')) return false;
    const waiting = rows.filter((r) => r.status === 'waiting');
    if (!waiting.length) return rows.every((r) => r.status === 'signed');
    const next = Math.min(...waiting.map((r) => r.order_index));
    const group = waiting.filter((r) => r.order_index === next);
    const ctx = await this.notifyContext(trx, doc, sender);
    for (const s of group) {
      await trx.updateTable('document_signers').set({ status: 'pending', notified_at: new Date() }).where('id', '=', s.id).execute();
      await this.notifications.enqueue({ userId: s.user_id, companyId: doc.company_id, type: 'doc.sign_request', payload: ctx }, trx);
    }
    return false;
  }

  async notifyContext(trx: Transaction<Database> | Db, doc: Document, sender?: Pick<User, 'first_name' | 'last_name' | 'line_display_name'> | null) {
    const creator =
      sender ?? (await trx.selectFrom('users').select(['first_name', 'last_name', 'line_display_name']).where('id', '=', doc.created_by).executeTakeFirstOrThrow());
    const company = await trx.selectFrom('companies').select('name').where('id', '=', doc.company_id).executeTakeFirstOrThrow();
    return { documentId: doc.id, title: doc.title, senderName: fullName(creator), dueAt: doc.due_at, companyName: company.name };
  }

  // ------------------------------------------------------------------ lists

  async list(user: User, filter: { companyId: string; box: Box; q?: string; status?: string; overdue?: boolean; page?: number }) {
    const { membership } = await this.companies.requireMember(user, filter.companyId);
    const isAdmin = user.is_super_admin || membership?.role === 'admin';
    const pageSize = 30;
    let q = this.db
      .selectFrom('documents as d')
      .innerJoin('users as c', 'c.id', 'd.created_by')
      .leftJoin('document_signers as me', (j) => j.onRef('me.document_id', '=', 'd.id').on('me.user_id', '=', user.id).on('me.status', '<>', 'replaced'))
      .select([
        'd.id',
        'd.title',
        'd.status',
        'd.doc_type as docType',
        'd.tags',
        'd.due_at as dueAt',
        'd.created_at as createdAt',
        'd.sent_at as sentAt',
        'd.completed_at as completedAt',
        'd.final_key',
        'd.page_count as pageCount',
        sql<string>`coalesce(c.first_name || ' ' || c.last_name, c.line_display_name)`.as('creatorName'),
        'me.status as myStatus',
        sql<number>`(SELECT count(*) FROM document_signers s WHERE s.document_id = d.id AND s.status = 'signed')::int`.as('signedCount'),
        sql<number>`(SELECT count(*) FROM document_signers s WHERE s.document_id = d.id AND s.status <> 'replaced')::int`.as('signerCount'),
      ])
      .where('d.company_id', '=', filter.companyId);

    switch (filter.box) {
      case 'todo':
        q = q.where('d.status', '=', 'pending').where('me.status', '=', 'pending');
        break;
      case 'waiting':
        q = q.where('d.status', '=', 'pending').where((eb) => eb.or([eb('d.created_by', '=', user.id), eb('me.status', 'in', ['signed', 'waiting'])]));
        break;
      case 'done':
        q = q.where('d.status', 'in', ['completed', 'declined', 'voided']).where((eb) => eb.or([eb('d.created_by', '=', user.id), eb('me.id', 'is not', null)])).where('d.sent_at', 'is not', null);
        break;
      case 'drafts':
        q = q.where('d.status', '=', 'draft').where('d.created_by', '=', user.id);
        break;
      case 'company':
        if (!isAdmin) throw new ForbiddenException('เฉพาะผู้ดูแลบริษัท');
        q = q.where('d.sent_at', 'is not', null);
        break;
    }
    if (filter.status) q = q.where('d.status', '=', filter.status as Document['status']);
    if (filter.overdue) q = q.where('d.status', '=', 'pending').where('d.due_at', '<', new Date());
    if (filter.q?.trim()) q = q.where('d.title', 'ilike', `%${filter.q.trim()}%`);
    const page = Math.max(1, filter.page ?? 1);
    const rows = await q.orderBy('d.updated_at', 'desc').limit(pageSize + 1).offset((page - 1) * pageSize).execute();
    return {
      page,
      hasMore: rows.length > pageSize,
      items: rows.slice(0, pageSize).map(({ final_key, ...r }) => ({
        ...r,
        overdue: r.status === 'pending' && !!r.dueAt && r.dueAt.getTime() < Date.now(),
        finalReady: Boolean(final_key),
      })),
    };
  }

  /** Approved members a creator can pick as signers (DOC-05). */
  async signerCandidates(user: User, companyId: string, q?: string) {
    await this.companies.requireMember(user, companyId);
    let query = this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .leftJoin('departments as d', 'd.id', 'm.department_id')
      .leftJoin('positions as p', 'p.id', 'm.position_id')
      .select(['u.id as userId', 'u.first_name as firstName', 'u.last_name as lastName', 'u.nickname', 'u.line_picture_url as linePictureUrl', 'u.is_oa_friend as isOaFriend', 'm.employee_code as employeeCode', 'd.name as departmentName', 'p.name as positionName'])
      .where('m.company_id', '=', companyId)
      .where('m.status', '=', 'approved');
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      query = query.where((eb) => eb.or([eb('u.first_name', 'ilike', like), eb('u.last_name', 'ilike', like), eb('u.nickname', 'ilike', like), eb('m.employee_code', 'ilike', like), eb('d.name', 'ilike', like)]));
    }
    return query.orderBy('u.first_name').limit(50).execute();
  }

  // ------------------------------------------------------------------ detail (DOC-09)

  async detail(user: User, id: string, meta: RequestMeta) {
    const a = await this.access.load(user, id);
    await this.access.logAdminView(user, a, 'detail', meta);
    const { doc } = a;
    const signers = await this.db
      .selectFrom('document_signers as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.user_id as userId',
        's.order_index as order',
        's.status',
        's.display_name as displayName',
        's.position_name as positionName',
        's.department_name as departmentName',
        'u.first_name as firstName',
        'u.last_name as lastName',
        'u.line_picture_url as linePictureUrl',
        'u.is_oa_friend as isOaFriend',
        's.notified_at as notifiedAt',
        's.opened_at as openedAt',
        's.signed_at as signedAt',
        's.declined_at as declinedAt',
        's.decline_reason as declineReason',
        's.reminder_count as reminderCount',
        's.last_reminded_at as lastRemindedAt',
        's.replaced_reason as replacedReason',
      ])
      .where('s.document_id', '=', id)
      .orderBy('s.order_index')
      .orderBy('s.created_at')
      .execute();
    const pages = await this.db.selectFrom('document_pages').select(['page_no as pageNo', 'width', 'height', 'rotation', 'text_source as textSource', 'ocr_status as ocrStatus']).where('document_id', '=', id).orderBy('page_no').execute();
    const canSeeFields = a.roles.has('creator') || a.isAdmin;
    const fields = canSeeFields
      ? await this.db
          .selectFrom('fields as f')
          .innerJoin('document_signers as s', 's.id', 'f.signer_id')
          .select(['f.id', 's.user_id as signerUserId', 'f.page_no as pageNo', 'f.type', 'f.x', 'f.y', 'f.w', 'f.h', 'f.settings', 'f.filled_at as filledAt'])
          .where('f.document_id', '=', id)
          .orderBy('f.sort_order')
          .execute()
      : [];
    const events = await this.db
      .selectFrom('document_events as e')
      .leftJoin('users as u', 'u.id', 'e.actor_user_id')
      .select(['e.id', 'e.type', 'e.created_at as createdAt', 'e.details', 'e.ip', sql<string>`coalesce(u.first_name || ' ' || u.last_name, u.line_display_name, 'ระบบ')`.as('actorName')])
      .where('e.document_id', '=', id)
      .orderBy('e.id', 'desc')
      .limit(200)
      .execute();
    const creator = await this.db.selectFrom('users').select(['first_name', 'last_name', 'line_display_name']).where('id', '=', doc.created_by).executeTakeFirstOrThrow();
    const company = await this.db.selectFrom('companies').select(['name']).where('id', '=', doc.company_id).executeTakeFirstOrThrow();
    const manage = (a.roles.has('creator') || a.isAdmin) && doc.status === 'pending';
    return {
      id: doc.id,
      companyId: doc.company_id,
      companyName: company.name,
      title: doc.title,
      description: doc.description,
      docType: doc.doc_type,
      tags: doc.tags,
      status: doc.status,
      overdue: doc.status === 'pending' && !!doc.due_at && doc.due_at.getTime() < Date.now(),
      signingMode: doc.signing_mode,
      dueAt: doc.due_at,
      notifyCreatorOnSign: doc.notify_creator_on_sign,
      originalName: doc.original_name,
      pageCount: doc.page_count,
      originalSha256: doc.original_sha256,
      sourceSha256: doc.source_sha256,
      finalSha256: doc.final_sha256,
      finalReady: Boolean(doc.final_key),
      sealStatus: doc.seal_status,
      timestamped: doc.timestamped,
      textStatus: doc.text_status,
      ocrPages: pages.filter((p) => p.textSource === 'ocr').length,
      ocrFailedPages: pages.filter((p) => p.ocrStatus === 'failed').length,
      createdAt: doc.created_at,
      sentAt: doc.sent_at,
      completedAt: doc.completed_at,
      declinedAt: doc.declined_at,
      voidedAt: doc.voided_at,
      voidReason: doc.void_reason,
      creatorId: doc.created_by,
      creatorName: fullName(creator),
      pages,
      signers,
      fields,
      events,
      me: {
        roles: [...a.roles],
        signerStatus: a.signer?.status ?? null,
        canEdit: doc.status === 'draft' && a.roles.has('creator'),
        canSign: doc.status === 'pending' && a.signer?.status === 'pending',
        canRemind: manage,
        canVoid: manage,
        canReplaceSigner: a.isAdmin && doc.status === 'pending',
      },
    };
  }

  async file(user: User, id: string, version: 'source' | 'final' | 'original', download: boolean, meta: RequestMeta) {
    const a = await this.access.load(user, id);
    const { doc } = a;
    let key: string | null;
    let name: string;
    let type = 'application/pdf';
    if (version === 'final') {
      key = doc.final_key;
      name = `${doc.title} (ฉบับสมบูรณ์).pdf`;
    } else if (version === 'original') {
      key = doc.original_key;
      name = doc.original_name;
      type = doc.original_mime;
    } else {
      key = doc.source_key;
      name = `${doc.title}.pdf`;
    }
    if (!key) throw new NotFoundException('ไฟล์ฉบับสมบูรณ์ยังไม่พร้อม');
    if (download) {
      await this.events.log({ documentId: id, type: 'downloaded', actor: user, signerId: a.signer?.id, details: { version }, meta });
      await this.access.logAdminView(user, a, `download:${version}`, meta);
    }
    return { data: await this.storage.get(key), name, type };
  }

  // ------------------------------------------------------------------ remind, void, replace (DOC-09, DOC-10)

  private async requireManager(user: User, id: string): Promise<DocAccess> {
    const a = await this.access.load(user, id);
    if (!a.roles.has('creator') && !a.isAdmin) throw new ForbiddenException('เฉพาะผู้สร้างเอกสารหรือผู้ดูแล');
    if (a.doc.status !== 'pending') throw new ConflictException('เอกสารนี้ไม่ได้อยู่ในสถานะรอเซ็น');
    return a;
  }

  /** Manual reminder: only signers whose turn it is, at most once an hour per person. */
  async remind(user: User, id: string, signerIds: string[] | undefined, meta: RequestMeta) {
    const { doc } = await this.requireManager(user, id);
    let q = this.db.selectFrom('document_signers').selectAll().where('document_id', '=', id).where('status', '=', 'pending');
    if (signerIds?.length) q = q.where('id', 'in', signerIds);
    const targets = await q.execute();
    const now = Date.now();
    const sent: string[] = [];
    const skipped: { signerId: string; nextAt: Date }[] = [];
    await this.db.transaction().execute(async (trx) => {
      const ctx = await this.notifyContext(trx, doc);
      for (const s of targets) {
        if (s.last_reminded_at && now - s.last_reminded_at.getTime() < REMIND_EVERY_MS) {
          skipped.push({ signerId: s.id, nextAt: new Date(s.last_reminded_at.getTime() + REMIND_EVERY_MS) });
          continue;
        }
        await trx.updateTable('document_signers').set({ last_reminded_at: new Date(), reminder_count: sql`reminder_count + 1` }).where('id', '=', s.id).execute();
        await this.notifications.enqueue({ userId: s.user_id, companyId: doc.company_id, type: 'doc.reminder', payload: ctx }, trx);
        await this.events.log({ documentId: id, type: 'reminded', actor: user, signerId: s.id, meta }, trx);
        sent.push(s.id);
      }
    });
    return { sent, skipped };
  }

  async void(user: User, id: string, reason: string, meta: RequestMeta) {
    const { doc, isAdmin, roles } = await this.requireManager(user, id);
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('documents')
        .set({ status: 'voided', voided_at: new Date(), void_reason: reason, updated_at: new Date() })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!updated.numUpdatedRows) throw new ConflictException('เอกสารนี้ไม่ได้อยู่ในสถานะรอเซ็น');
      const ctx = { ...(await this.notifyContext(trx, doc)), reason, actorName: fullName(user) };
      const unsigned = await trx.selectFrom('document_signers').select(['user_id']).where('document_id', '=', id).where('status', 'in', ['waiting', 'pending']).execute();
      for (const s of unsigned) await this.notifications.enqueue({ userId: s.user_id, companyId: doc.company_id, type: 'doc.voided', payload: ctx }, trx);
      await this.events.log({ documentId: id, type: 'voided', actor: user, details: { reason }, meta }, trx);
      if (isAdmin && !roles.has('creator')) {
        await this.audit.log({ companyId: doc.company_id, actor: user, action: 'document.voided_by_admin', targetType: 'document', targetId: id, details: { reason, title: doc.title }, meta }, trx);
      }
    });
    return { ok: true };
  }

  /**
   * DOC-10: an admin moves all of a signer's fields to another approved member,
   * keeping the same order. If it is that order's turn, the new person is told at once.
   */
  async replaceSigner(user: User, id: string, signerId: string, newUserId: string, reason: string, meta: RequestMeta) {
    const a = await this.access.load(user, id);
    if (!a.isAdmin) throw new ForbiddenException('เฉพาะผู้ดูแลบริษัท');
    const { doc } = a;
    if (doc.status !== 'pending') throw new ConflictException('เอกสารนี้ไม่ได้อยู่ในสถานะรอเซ็น');

    return this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('documents').select('id').where('id', '=', id).forUpdate().execute();
      const old = await trx.selectFrom('document_signers').selectAll().where('id', '=', signerId).where('document_id', '=', id).executeTakeFirst();
      if (!old) throw new NotFoundException('ไม่พบผู้เซ็น');
      if (old.status !== 'waiting' && old.status !== 'pending') throw new ConflictException('เปลี่ยนได้เฉพาะผู้เซ็นที่ยังไม่ได้เซ็น');
      const member = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .leftJoin('departments as d', 'd.id', 'm.department_id')
        .leftJoin('positions as p', 'p.id', 'm.position_id')
        .select(['u.id', 'u.first_name', 'u.last_name', 'u.line_display_name', 'd.name as dept', 'p.name as pos'])
        .where('m.company_id', '=', doc.company_id)
        .where('m.user_id', '=', newUserId)
        .where('m.status', '=', 'approved')
        .executeTakeFirst();
      if (!member) throw new BadRequestException('ผู้เซ็นคนใหม่ต้องเป็นพนักงานที่อนุมัติแล้ว');
      const dup = await trx.selectFrom('document_signers').select('id').where('document_id', '=', id).where('user_id', '=', newUserId).where('status', '<>', 'replaced').executeTakeFirst();
      if (dup) throw new ConflictException('คนนี้เป็นผู้เซ็นในเอกสารนี้อยู่แล้ว');

      const fresh = await trx
        .insertInto('document_signers')
        .values({
          document_id: id,
          user_id: newUserId,
          order_index: old.order_index,
          status: old.status,
          display_name: fullName(member),
          department_name: member.dept,
          position_name: member.pos,
          notified_at: old.status === 'pending' ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.updateTable('fields').set({ signer_id: fresh.id }).where('signer_id', '=', old.id).execute();
      await trx.updateTable('document_signers').set({ status: 'replaced', replaced_by: fresh.id, replaced_reason: reason }).where('id', '=', old.id).execute();

      const ctx = await this.notifyContext(trx, doc);
      const names = { oldSignerName: old.display_name, newSignerName: fullName(member), reason };
      await this.notifications.enqueue({ userId: newUserId, companyId: doc.company_id, type: old.status === 'pending' ? 'doc.sign_request' : 'doc.signer_assigned', payload: { ...ctx, reason } }, trx);
      await this.notifications.enqueue({ userId: old.user_id, companyId: doc.company_id, type: 'doc.signer_removed', payload: { ...ctx, ...names } }, trx);
      if (doc.created_by !== user.id) {
        await this.notifications.enqueue({ userId: doc.created_by, companyId: doc.company_id, type: 'doc.signer_replaced', payload: { ...ctx, ...names } }, trx);
      }
      await this.events.log({ documentId: id, type: 'signer_replaced', actor: user, signerId: fresh.id, details: { fromSignerId: old.id, fromUserId: old.user_id, toUserId: newUserId, ...names }, meta }, trx);
      await this.audit.log({ companyId: doc.company_id, actor: user, action: 'document.signer_replaced', targetType: 'document', targetId: id, details: { title: doc.title, ...names }, meta }, trx);
      return { signerId: fresh.id };
    });
  }

  // ------------------------------------------------------------------ verify (SGN-08)

  async verify(user: User, file: Buffer) {
    const hash = sha256Hex(file);
    const finalMatch = await this.db.selectFrom('documents').selectAll().where('final_sha256', '=', hash).executeTakeFirst();
    const sourceMatch = finalMatch ? null : await this.db.selectFrom('documents').selectAll().where((eb) => eb.or([eb('source_sha256', '=', hash), eb('original_sha256', '=', hash)])).where('status', '<>', 'draft').executeTakeFirst();
    const doc = finalMatch ?? sourceMatch;
    if (!doc) return { sha256: hash, match: 'none' as const };
    const company = await this.db.selectFrom('companies').select('name').where('id', '=', doc.company_id).executeTakeFirstOrThrow();
    let canOpen = false;
    try {
      await this.access.load(user, doc.id);
      canOpen = true;
    } catch {
      canOpen = false;
    }
    return {
      sha256: hash,
      match: finalMatch ? ('final' as const) : ('original' as const),
      companyName: company.name,
      completedAt: doc.completed_at,
      sealStatus: doc.seal_status,
      document: canOpen ? { id: doc.id, title: doc.title } : null,
    };
  }
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function sanitizeSettings(type: FieldType, s: FieldSettings): FieldSettings {
  const out: FieldSettings = {};
  if (type === 'text') {
    if (s.label) out.label = String(s.label).slice(0, 100);
    out.required = s.required !== false;
    if (s.maxLength) out.maxLength = Math.min(1000, Math.max(1, Math.round(s.maxLength)));
    if (s.fontSize) out.fontSize = Math.min(36, Math.max(6, s.fontSize));
  }
  if (type === 'checkbox') {
    if (s.label) out.label = String(s.label).slice(0, 100);
    out.required = s.required === true;
  }
  if (type === 'date' || type === 'certified_copy') {
    if (s.dateFormat && ['short', 'long', 'numeric'].includes(s.dateFormat)) out.dateFormat = s.dateFormat;
    if (s.fontSize) out.fontSize = Math.min(36, Math.max(6, s.fontSize));
  }
  if (type === 'certified_copy') out.text = (s.text || 'สำเนาถูกต้อง').slice(0, 60);
  if (type === 'stamp' && s.stampId) out.stampId = s.stampId;
  return out;
}
