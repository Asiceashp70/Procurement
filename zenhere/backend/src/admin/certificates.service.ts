import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { encrypt } from '../common/crypto';
import type { RequestMeta } from '../common/request-meta';
import { StorageService } from '../common/storage.service';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { CertificateError, readP12 } from '../documents/pdf/seal';

/**
 * ADM-11: one company certificate (.p12/.pfx) per company, uploaded by a Super Admin.
 * The file and its password are stored encrypted and can never be downloaded again.
 */
@Injectable()
export class CertificatesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.db
      .selectFrom('company_certificates as cc')
      .leftJoin('users as u', 'u.id', 'cc.uploaded_by')
      .select(['cc.id', 'cc.subject', 'cc.issuer', 'cc.serial_number as serialNumber', 'cc.not_before as notBefore', 'cc.not_after as notAfter', 'cc.is_active as isActive', 'cc.created_at as createdAt', 'u.first_name as uploadedBy'])
      .where('cc.company_id', '=', companyId)
      .orderBy('cc.created_at', 'desc')
      .execute();
  }

  /** Summary shown to Company Admins (no secrets). */
  async active(companyId: string) {
    return (
      (await this.db
        .selectFrom('company_certificates')
        .select(['subject', 'issuer', 'not_after as notAfter'])
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst()) ?? null
    );
  }

  async upload(user: User, companyId: string, p12: Buffer, password: string, meta: RequestMeta) {
    const company = await this.db.selectFrom('companies').select('id').where('id', '=', companyId).executeTakeFirst();
    if (!company) throw new NotFoundException('ไม่พบบริษัท');
    let m;
    try {
      m = readP12(p12, password);
    } catch (err) {
      if (err instanceof CertificateError) throw new BadRequestException(err.message);
      throw err;
    }
    if (m.notAfter.getTime() <= Date.now()) throw new BadRequestException('ใบรับรองนี้หมดอายุแล้ว');
    if (m.notBefore.getTime() > Date.now()) throw new BadRequestException('ใบรับรองนี้ยังไม่เริ่มใช้งาน');

    const id = randomUUID();
    const key = `companies/${companyId}/certificates/${id}.p12.enc`;
    await this.storage.put(key, p12);
    const passwordEnc = encrypt(Buffer.from(password, 'utf8'), Buffer.from(config().FILE_ENCRYPTION_KEY, 'base64')).toString('base64');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('company_certificates').set({ is_active: false }).where('company_id', '=', companyId).where('is_active', '=', true).execute();
      await trx
        .insertInto('company_certificates')
        .values({ id, company_id: companyId, storage_key: key, password_enc: passwordEnc, subject: m.subject, issuer: m.issuer, serial_number: m.serialNumber, not_before: m.notBefore, not_after: m.notAfter, uploaded_by: user.id })
        .execute();
      await this.audit.log({ companyId, actor: user, action: 'certificate.uploaded', targetType: 'certificate', targetId: id, details: { subject: m.subject, issuer: m.issuer, notAfter: m.notAfter }, meta }, trx);
    });
    return { id, subject: m.subject, issuer: m.issuer, notAfter: m.notAfter };
  }

  async deactivate(user: User, certId: string, meta: RequestMeta) {
    const cert = await this.db.updateTable('company_certificates').set({ is_active: false }).where('id', '=', certId).returning(['company_id', 'subject']).executeTakeFirst();
    if (!cert) throw new NotFoundException();
    await this.audit.log({ companyId: cert.company_id, actor: user, action: 'certificate.deactivated', targetType: 'certificate', targetId: certId, details: { subject: cert.subject }, meta });
    return { ok: true };
  }
}
