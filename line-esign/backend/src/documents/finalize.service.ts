import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sha256Hex, decrypt } from '../common/crypto';
import { StorageService } from '../common/storage.service';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderFinalPdf, type CertificateData } from './pdf/render';
import { readP12, sealPdf, type SealMaterial } from './pdf/seal';
import { DocumentEventsService } from './document-events';

const fullName = (u: { first_name: string | null; last_name: string | null; line_display_name?: string | null }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.line_display_name || '-';

/**
 * SGN-07, SGN-09, SGN-11: after the last signature, builds the completed PDF
 * (fields + certificate page), seals it with the company certificate (PAdES,
 * TSA timestamp when configured), stores it and sends everyone the link.
 * Runs as a background job so signing returns immediately.
 */
@Injectable()
export class FinalizeService implements OnModuleInit {
  private readonly log = new Logger(FinalizeService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly events: DocumentEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.register('document.finalize', (p) => this.finalize(String(p.documentId)));
  }

  async finalize(documentId: string) {
    const doc = await this.db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
    if (doc.status !== 'completed' || doc.final_key) return;
    const company = await this.db.selectFrom('companies').select(['name']).where('id', '=', doc.company_id).executeTakeFirstOrThrow();
    const creator = await this.db.selectFrom('users').select(['first_name', 'last_name', 'line_display_name']).where('id', '=', doc.created_by).executeTakeFirstOrThrow();
    const signers = await this.db
      .selectFrom('document_signers as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.id', 's.user_id', 's.order_index', 's.status', 's.display_name', 's.position_name', 's.department_name', 's.signed_at', 's.sign_ip', 's.signature_key', 'u.line_user_id'])
      .where('s.document_id', '=', documentId)
      .orderBy('s.order_index')
      .orderBy('s.signed_at')
      .execute();
    const signed = signers.filter((s) => s.status === 'signed');
    const fields = await this.db.selectFrom('fields').selectAll().where('document_id', '=', documentId).execute();

    const signatures = new Map<string, Buffer>();
    for (const s of signed) if (s.signature_key) signatures.set(s.id, await this.storage.get(s.signature_key));
    const stamps = new Map<string, Buffer>();
    for (const stampId of new Set(fields.filter((f) => f.type === 'stamp' && f.value === true).map((f) => f.settings.stampId!).filter(Boolean))) {
      const st = await this.db.selectFrom('company_stamps').select('storage_key').where('id', '=', stampId).executeTakeFirst();
      if (st) stamps.set(stampId, await this.storage.get(st.storage_key));
    }

    // pick the certificate first: the certificate page says whether the file is sealed
    const { material, certId, problem } = await this.loadCertificate(doc.company_id);

    const replacements = await this.db
      .selectFrom('document_events as e')
      .leftJoin('users as u', 'u.id', 'e.actor_user_id')
      .select(['e.created_at', 'e.details', 'u.first_name', 'u.last_name', 'u.line_display_name'])
      .where('e.document_id', '=', documentId)
      .where('e.type', '=', 'signer_replaced')
      .orderBy('e.id')
      .execute();

    const completedAt = doc.completed_at ?? new Date();
    const certificate: CertificateData = {
      documentId: doc.id,
      title: doc.title,
      companyName: company.name,
      creatorName: fullName(creator),
      sentAt: doc.sent_at,
      completedAt,
      pageCount: doc.page_count,
      signingMode: doc.signing_mode,
      originalSha256: doc.original_sha256,
      signers: signed.map((s) => ({
        order: s.order_index,
        name: s.display_name ?? '-',
        position: s.position_name,
        department: s.department_name,
        signedAt: s.signed_at,
        ip: s.sign_ip,
        lineUserId: s.line_user_id,
      })),
      replacements: replacements.map((r) => {
        const d = r.details as Record<string, string>;
        return { at: r.created_at, from: d.oldSignerName ?? '-', to: d.newSignerName ?? '-', by: fullName(r), reason: d.reason ?? '-' };
      }),
      verifyUrl: `${config().APP_ORIGIN}/verify`,
      sealedBy: material ? material.subject.match(/CN=([^,]+)/)?.[1] ?? company.name : null,
    };

    const pdfDoc = await renderFinalPdf({
      source: await this.storage.get(doc.source_key),
      fields: fields.map((f) => ({ pageNo: f.page_no, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, settings: f.settings, value: f.value, signerId: f.signer_id })),
      signatures,
      stamps,
      signedAt: new Map(signed.map((s) => [s.id, s.signed_at ?? completedAt])),
      certificate,
    });

    let finalPdf: Buffer;
    let sealStatus: 'sealed' | 'no_certificate' | 'failed' = 'no_certificate';
    let timestamped = false;
    let sealProblem = problem;
    if (material) {
      const opts = { name: company.name, reason: `ลงนามครบ: ${doc.title}`.slice(0, 200), location: 'Thailand', signingTime: completedAt };
      try {
        const r = await sealPdf(pdfDoc, material, { ...opts, tsaUrl: config().TSA_URL });
        finalPdf = r.pdf;
        timestamped = r.timestamped;
        sealStatus = 'sealed';
      } catch (err) {
        this.log.warn(`seal of ${documentId} failed${config().TSA_URL ? ' (will retry without TSA)' : ''}: ${String(err)}`);
        try {
          // the TSA is the usual culprit; a seal without timestamp is better than none
          const again = await renderFinalPdf({
            source: await this.storage.get(doc.source_key),
            fields: fields.map((f) => ({ pageNo: f.page_no, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, settings: f.settings, value: f.value, signerId: f.signer_id })),
            signatures,
            stamps,
            signedAt: new Map(signed.map((s) => [s.id, s.signed_at ?? completedAt])),
            certificate,
          });
          finalPdf = (await sealPdf(again, material, opts)).pdf;
          sealStatus = 'sealed';
        } catch (err2) {
          this.log.error(`seal of ${documentId} failed: ${String(err2)}`);
          finalPdf = Buffer.from(await pdfDoc.save());
          sealStatus = 'failed';
          sealProblem = 'ซีลไฟล์ไม่สำเร็จ';
        }
      }
    } else {
      finalPdf = Buffer.from(await pdfDoc.save());
    }

    const finalKey = `companies/${doc.company_id}/documents/${doc.id}/final-${Date.now()}.pdf.enc`;
    await this.storage.put(finalKey, finalPdf);
    const finalSha = sha256Hex(finalPdf);
    await this.db.transaction().execute(async (trx) => {
      const done = await trx
        .updateTable('documents')
        .set({ final_key: finalKey, final_sha256: finalSha, seal_status: sealStatus, sealed_certificate_id: sealStatus === 'sealed' ? certId : null, timestamped, finalized_at: new Date(), updated_at: new Date() })
        .where('id', '=', documentId)
        .where('final_key', 'is', null)
        .executeTakeFirst();
      if (!done.numUpdatedRows) return;
      await this.events.log({ documentId, type: 'finalized', details: { sha256: finalSha, sealStatus, timestamped, pages: pdfDoc.getPageCount() } }, trx);

      const payload = { documentId, title: doc.title, companyName: company.name };
      const recipients = new Set([doc.created_by, ...signed.map((s) => s.user_id)]);
      for (const userId of recipients) await this.notifications.enqueue({ userId, companyId: doc.company_id, type: 'doc.completed', payload }, trx);
      if (sealStatus !== 'sealed') {
        for (const userId of await this.adminIds(doc.company_id)) {
          await this.notifications.enqueue({ userId, companyId: doc.company_id, type: 'cert.missing', payload: { ...payload, reason: sealProblem } }, trx);
        }
      }
    });
  }

  private async loadCertificate(companyId: string): Promise<{ material: SealMaterial | null; certId: string | null; problem: string }> {
    const cert = await this.db.selectFrom('company_certificates').selectAll().where('company_id', '=', companyId).where('is_active', '=', true).executeTakeFirst();
    if (!cert) return { material: null, certId: null, problem: 'บริษัทยังไม่มีใบรับรองดิจิทัล' };
    if (cert.not_after.getTime() <= Date.now()) return { material: null, certId: null, problem: 'ใบรับรองดิจิทัลหมดอายุแล้ว' };
    try {
      const password = decrypt(Buffer.from(cert.password_enc, 'base64'), Buffer.from(config().FILE_ENCRYPTION_KEY, 'base64')).toString('utf8');
      return { material: readP12(await this.storage.get(cert.storage_key), password), certId: cert.id, problem: '' };
    } catch (err) {
      this.log.error(`certificate ${cert.id} unusable: ${String(err)}`);
      return { material: null, certId: null, problem: 'เปิดใบรับรองดิจิทัลไม่ได้' };
    }
  }

  /** Company Admins of the company plus all Super Admins. */
  async adminIds(companyId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('users as u')
      .leftJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 'u.id').on('m.company_id', '=', companyId))
      .select('u.id')
      .where((eb) => eb.or([eb('u.is_super_admin', '=', true), eb.and([eb('m.role', '=', 'admin'), eb('m.status', '=', 'approved')])]))
      .execute();
    return [...new Set(rows.map((r) => r.id))];
  }
}

