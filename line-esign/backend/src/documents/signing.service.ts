import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { StorageService } from '../common/storage.service';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { readPngInfo } from '../users/png';
import { DocumentAccessService } from './document-access.service';
import { DocumentEventsService } from './document-events';
import { DocumentsService } from './documents.service';

export interface SignInput {
  values: Record<string, string | boolean>;
  useSavedSignature: boolean;
  consent: boolean;
}

const fullName = (u: { first_name: string | null; last_name: string | null; line_display_name?: string | null }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.line_display_name || '-';

@Injectable()
export class SigningService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly access: DocumentAccessService,
    private readonly events: DocumentEventsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly jobs: JobsService,
  ) {}

  /** What the signing page needs (SGN-01). Records that the signer opened the document. */
  async context(user: User, id: string, meta: RequestMeta) {
    const a = await this.access.load(user, id);
    const { doc, signer } = a;
    if (!signer) {
      await this.access.logAdminView(user, a, 'signing_page', meta);
    } else {
      if (!signer.opened_at) await this.db.updateTable('document_signers').set({ opened_at: new Date() }).where('id', '=', signer.id).execute();
      // one "opened" entry per visit, not per page refresh
      const recent = await this.db
        .selectFrom('document_events')
        .select('id')
        .where('document_id', '=', id)
        .where('signer_id', '=', signer.id)
        .where('type', '=', 'opened')
        .where('created_at', '>', new Date(Date.now() - 5 * 60_000))
        .executeTakeFirst();
      if (!recent) await this.events.log({ documentId: id, type: 'opened', actor: user, signerId: signer.id, meta });
    }
    const fields = await this.db
      .selectFrom('fields')
      .select(['id', 'signer_id', 'page_no as pageNo', 'type', 'x', 'y', 'w', 'h', 'settings', 'value', 'filled_at as filledAt'])
      .where('document_id', '=', id)
      .orderBy('page_no')
      .orderBy('y')
      .orderBy('x')
      .execute();
    const pages = await this.db.selectFrom('document_pages').select(['page_no as pageNo', 'width', 'height', 'rotation']).where('document_id', '=', id).orderBy('page_no').execute();
    const saved = await this.db.selectFrom('signatures').select(['id']).where('user_id', '=', user.id).where('is_active', '=', true).executeTakeFirst();
    const stamps = await this.db
      .selectFrom('company_stamps as st')
      .innerJoin('company_stamp_users as su', 'su.stamp_id', 'st.id')
      .select(['st.id', 'st.name'])
      .where('st.company_id', '=', doc.company_id)
      .where('su.user_id', '=', user.id)
      .where('st.is_active', '=', true)
      .execute();
    const waitingFor =
      signer?.status === 'waiting'
        ? await this.db.selectFrom('document_signers').select(['display_name as name']).where('document_id', '=', id).where('status', '=', 'pending').execute()
        : [];
    const creator = await this.db.selectFrom('users').select(['first_name', 'last_name', 'line_display_name']).where('id', '=', doc.created_by).executeTakeFirstOrThrow();
    return {
      id: doc.id,
      companyId: doc.company_id,
      title: doc.title,
      status: doc.status,
      dueAt: doc.due_at,
      overdue: doc.status === 'pending' && !!doc.due_at && doc.due_at.getTime() < Date.now(),
      senderName: fullName(creator),
      pages,
      mySigner: signer ? { id: signer.id, status: signer.status, signedAt: signer.signed_at } : null,
      canSign: doc.status === 'pending' && signer?.status === 'pending',
      waitingFor: waitingFor.map((w) => w.name),
      savedSignatureId: saved?.id ?? null,
      stamps,
      // other people's fields show as outlines only; their values are never sent
      fields: fields.map((f) => {
        const mine = signer && f.signer_id === signer.id;
        return { id: f.id, pageNo: f.pageNo, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, mine: Boolean(mine), settings: mine ? f.settings : {}, value: mine ? f.value : null, filled: Boolean(f.filledAt) };
      }),
    };
  }

  /** SGN-02..05, SGN-10: one confirmation fills all of this signer's fields. */
  async sign(user: User, id: string, input: SignInput, oneTimeSignature: Buffer | undefined, meta: RequestMeta) {
    if (!input.consent) throw new BadRequestException('กรุณาติ๊กยินยอมลงนามอิเล็กทรอนิกส์ก่อนยืนยัน');
    const a = await this.access.load(user, id).catch(async (err) => {
      await this.denied(user, id, 'no_access', meta);
      throw err;
    });

    // validate everything before touching storage or rows
    const myFields = a.signer
      ? await this.db.selectFrom('fields').selectAll().where('document_id', '=', id).where('signer_id', '=', a.signer.id).execute()
      : [];
    const needsSignature = myFields.some((f) => f.type === 'signature' || f.type === 'certified_copy');
    let signaturePng: Buffer | null = null;
    if (needsSignature) {
      if (input.useSavedSignature) {
        const saved = await this.db.selectFrom('signatures').select(['storage_key']).where('user_id', '=', user.id).where('is_active', '=', true).executeTakeFirst();
        if (!saved) throw new BadRequestException('คุณยังไม่มีลายเซ็นที่บันทึกไว้ กรุณาเซ็นสด');
        signaturePng = await this.storage.get(saved.storage_key);
      } else {
        const info = oneTimeSignature ? readPngInfo(oneTimeSignature) : null;
        if (!oneTimeSignature || !info || oneTimeSignature.length > 2 * 1024 * 1024) throw new BadRequestException('ไม่พบลายเซ็นที่เซ็นสด');
        signaturePng = oneTimeSignature;
      }
    }

    const missing: string[] = [];
    const values = new Map<string, unknown>();
    const stampIds: string[] = [];
    for (const f of myFields) {
      const v = input.values[f.id];
      switch (f.type) {
        case 'signature':
        case 'certified_copy':
        case 'date':
          values.set(f.id, true);
          break;
        case 'text': {
          const text = typeof v === 'string' ? v.trim() : '';
          if (f.settings.required !== false && !text) missing.push(f.id);
          if (f.settings.maxLength && text.length > f.settings.maxLength) throw new BadRequestException(`ข้อความยาวเกิน ${f.settings.maxLength} ตัวอักษร`);
          values.set(f.id, text.slice(0, 1000));
          break;
        }
        case 'checkbox':
          if (f.settings.required && v !== true) missing.push(f.id);
          values.set(f.id, v === true);
          break;
        case 'stamp':
          if (v !== true) missing.push(f.id);
          if (f.settings.stampId) stampIds.push(f.settings.stampId);
          values.set(f.id, v === true);
          break;
      }
    }
    if (missing.length) throw new BadRequestException({ message: 'ยังกรอกไม่ครบ', code: 'FIELDS_MISSING', missing });

    const signatureKey = signaturePng ? `companies/${a.doc.company_id}/documents/${id}/signatures/${a.signer?.id}-${Date.now()}.png.enc` : null;

    const result = await this.db.transaction().execute(async (trx) => {
      // lock the document: parallel signers finishing at the same moment must not both "complete" it
      const doc = await trx.selectFrom('documents').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      const signer = await trx
        .selectFrom('document_signers')
        .selectAll()
        .where('document_id', '=', id)
        .where('user_id', '=', user.id)
        .where('status', '<>', 'replaced')
        .forUpdate()
        .executeTakeFirst();
      if (doc.status !== 'pending' || !signer || signer.status !== 'pending' || signer.id !== a.signer?.id) return { denied: true as const };

      for (const id of stampIds) {
        const ok = await trx.selectFrom('company_stamp_users as su').innerJoin('company_stamps as st', 'st.id', 'su.stamp_id').select('st.id').where('su.stamp_id', '=', id).where('su.user_id', '=', user.id).where('st.is_active', '=', true).executeTakeFirst();
        if (!ok) throw new ForbiddenException('คุณไม่มีสิทธิ์ใช้ตราประทับนี้');
      }
      if (signaturePng && signatureKey) await this.storage.put(signatureKey, signaturePng); // SIG-07: frozen copy for this document
      const now = new Date();
      for (const [fieldId, value] of values) {
        await trx.updateTable('fields').set({ value: JSON.stringify(value), filled_at: now }).where('id', '=', fieldId).execute();
      }
      await trx
        .updateTable('document_signers')
        .set({ status: 'signed', signed_at: now, sign_ip: meta.ip, sign_user_agent: meta.userAgent, signature_key: signatureKey })
        .where('id', '=', signer.id)
        .execute();
      await this.events.log(
        { documentId: id, type: 'signed', actor: user, signerId: signer.id, details: { fields: myFields.length, signature: needsSignature ? (input.useSavedSignature ? 'saved' : 'one_time') : 'none', consent: true }, meta },
        trx,
      );
      for (const stampId of stampIds) {
        await this.audit.log({ companyId: doc.company_id, actor: user, action: 'stamp.used', targetType: 'stamp', targetId: stampId, details: { documentId: id, title: doc.title }, meta }, trx);
      }

      const counts = await trx
        .selectFrom('document_signers')
        .select([sql<number>`count(*) FILTER (WHERE status = 'signed')::int`.as('signed'), sql<number>`count(*)::int`.as('total')])
        .where('document_id', '=', id)
        .where('status', '<>', 'replaced')
        .executeTakeFirstOrThrow();
      if (doc.notify_creator_on_sign && doc.created_by !== user.id) {
        await this.notifications.enqueue(
          { userId: doc.created_by, companyId: doc.company_id, type: 'doc.signed', payload: { documentId: id, title: doc.title, signerName: signer.display_name, signed: counts.signed, total: counts.total } },
          trx,
        );
      }
      const allSigned = await this.documents.activateNextSigners(trx, doc, null);
      if (allSigned) {
        await trx.updateTable('documents').set({ status: 'completed', completed_at: now, updated_at: now }).where('id', '=', id).execute();
        await this.events.log({ documentId: id, type: 'completed', details: { signers: counts.total } }, trx);
        await this.jobs.enqueue('document.finalize', { documentId: id }, new Date(), trx);
      }
      return { denied: false as const, completed: allSigned };
    });
    if (result.denied) {
      await this.denied(user, id, 'not_your_turn', meta);
      throw new ForbiddenException('ยังไม่ถึงลำดับของคุณ หรือเอกสารนี้ไม่ได้รอให้คุณเซ็น');
    }
    return { ok: true, completed: result.completed };
  }

  /** SGN-04 */
  async decline(user: User, id: string, reason: string, meta: RequestMeta) {
    const a = await this.access.load(user, id);
    await this.db.transaction().execute(async (trx) => {
      const doc = await trx.selectFrom('documents').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      const signer = a.signer && (await trx.selectFrom('document_signers').selectAll().where('id', '=', a.signer.id).forUpdate().executeTakeFirst());
      if (doc.status !== 'pending' || !signer || signer.status !== 'pending') {
        await this.denied(user, id, 'decline_not_allowed', meta);
        throw new ForbiddenException('เอกสารนี้ไม่ได้รอให้คุณเซ็น');
      }
      const now = new Date();
      await trx.updateTable('document_signers').set({ status: 'declined', declined_at: now, decline_reason: reason, sign_ip: meta.ip, sign_user_agent: meta.userAgent }).where('id', '=', signer.id).execute();
      await trx.updateTable('documents').set({ status: 'declined', declined_at: now, updated_at: now }).where('id', '=', id).execute();
      await this.events.log({ documentId: id, type: 'declined', actor: user, signerId: signer.id, details: { reason }, meta }, trx);
      await this.notifications.enqueue(
        { userId: doc.created_by, companyId: doc.company_id, type: 'doc.declined', payload: { documentId: id, title: doc.title, signerName: signer.display_name, reason } },
        trx,
      );
    });
    return { ok: true };
  }

  /** SGN-05: a refused attempt is answered 403 and recorded. */
  private async denied(user: User, id: string, why: string, meta: RequestMeta) {
    const exists = await this.db.selectFrom('documents').select(['id', 'company_id']).where('id', '=', id).executeTakeFirst();
    if (!exists) return;
    await this.events.log({ documentId: id, type: 'sign_denied', actor: user, details: { why }, meta });
    await this.audit.log({ companyId: exists.company_id, actor: user, action: 'document.sign_denied', targetType: 'document', targetId: id, details: { why }, meta });
  }
}

