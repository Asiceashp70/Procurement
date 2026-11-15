import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { CompanyAccessService } from '../companies/company-access.service';
import { InjectDb, type Db } from '../db/database';
import type { Document, DocumentSigner, User } from '../db/types';
import { DocumentEventsService } from './document-events';

export type DocRole = 'creator' | 'signer' | 'admin';

export interface DocAccess {
  doc: Document;
  roles: Set<DocRole>;
  /** my current (not replaced) signer row, if I am a signer */
  signer: DocumentSigner | null;
  isAdmin: boolean;
}

/**
 * Who may open a document: its creator, its signers (not drafts, not after being
 * replaced), the Company Admins of the owning company, and Super Admins.
 * An admin opening someone else's document is logged.
 */
@Injectable()
export class DocumentAccessService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly companies: CompanyAccessService,
    private readonly events: DocumentEventsService,
    private readonly audit: AuditService,
  ) {}

  async load(user: User, documentId: string): Promise<DocAccess> {
    const doc = await this.db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    const roles = new Set<DocRole>();
    let isAdmin = false;

    const membership = await this.db
      .selectFrom('memberships')
      .select(['role', 'status'])
      .where('company_id', '=', doc.company_id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    const company = await this.companies.company(doc.company_id);
    const activeMember = membership?.status === 'approved' && company.status === 'active';
    if (user.is_super_admin || (activeMember && membership?.role === 'admin')) {
      roles.add('admin');
      isAdmin = true;
    }
    if (activeMember && doc.created_by === user.id) roles.add('creator');

    let signer: DocumentSigner | null = null;
    if (activeMember && doc.status !== 'draft') {
      signer =
        (await this.db
          .selectFrom('document_signers')
          .selectAll()
          .where('document_id', '=', doc.id)
          .where('user_id', '=', user.id)
          .where('status', '<>', 'replaced')
          .executeTakeFirst()) ?? null;
      if (signer) roles.add('signer');
    }
    // drafts are visible to their creator (and admins)
    if (doc.status === 'draft' && !roles.has('creator') && !isAdmin) throw new NotFoundException('ไม่พบเอกสาร');
    if (roles.size === 0) throw new ForbiddenException('คุณไม่มีสิทธิ์เปิดเอกสารนี้');
    return { doc, roles, signer, isAdmin };
  }

  /** SRC-02 / PRD "users and roles": opening another person's document as an admin is recorded. */
  async logAdminView(user: User, a: DocAccess, what: string, meta: RequestMeta) {
    if (a.roles.has('creator') || a.roles.has('signer')) return;
    await this.events.log({ documentId: a.doc.id, type: 'viewed_by_admin', actor: user, details: { what }, meta });
    await this.audit.log({ companyId: a.doc.company_id, actor: user, action: 'document.viewed_by_admin', targetType: 'document', targetId: a.doc.id, details: { what, title: a.doc.title }, meta });
  }
}
