import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Expression, type SqlBool } from 'kysely';
import { CompanyAccessService } from '../companies/company-access.service';
import type { RequestMeta } from '../common/request-meta';
import { InjectDb, type Db } from '../db/database';
import type { PageLine, User } from '../db/types';
import { DocumentAccessService } from '../documents/document-access.service';
import { likeEscape, normalizeThai, normalizeWithMap, snippetFor } from './thai-normalize';

export interface SearchFilter {
  q?: string;
  scope: 'mine' | 'company' | 'all';
  companyId?: string;
  status?: 'draft' | 'pending' | 'completed' | 'declined' | 'voided';
  from?: string;
  to?: string;
  creatorId?: string;
  signerId?: string;
  departmentId?: string;
  docType?: string;
  tag?: string;
  overdue?: boolean;
  page?: number;
}

const PAGE_SIZE = 20;
const MATCHES_PER_DOC = 3;

/**
 * SRC-01..05, SRC-08: searches titles and the text of every page (PDF text and
 * OCR) with the same Thai normalization as the index. Results show the page and
 * the words around the match; OCR matches carry their confidence.
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly companies: CompanyAccessService,
    private readonly access: DocumentAccessService,
  ) {}

  /** The documents this scope may see (SRC-01, SRC-02). */
  private async scopeCondition(user: User, f: SearchFilter): Promise<Expression<SqlBool>> {
    if (f.scope === 'all') {
      if (!user.is_super_admin) throw new ForbiddenException('เฉพาะ Super Admin');
      return sql<SqlBool>`d.sent_at IS NOT NULL`;
    }
    if (f.scope === 'company') {
      if (!f.companyId) throw new BadRequestException('ต้องระบุบริษัท');
      await this.companies.requireAdmin(user, f.companyId);
      return sql<SqlBool>`d.company_id = ${f.companyId} AND d.sent_at IS NOT NULL`;
    }
    // mine: created by me, or I am (still) a signer; only in companies I am an active member of
    return sql<SqlBool>`
      EXISTS (SELECT 1 FROM memberships m JOIN companies c2 ON c2.id = m.company_id
              WHERE m.company_id = d.company_id AND m.user_id = ${user.id} AND m.status = 'approved' AND c2.status = 'active')
      AND NOT (d.status = 'voided' AND d.sent_at IS NULL)
      AND (d.created_by = ${user.id}
           OR (d.status <> 'draft' AND EXISTS (SELECT 1 FROM document_signers s WHERE s.document_id = d.id AND s.user_id = ${user.id} AND s.status <> 'replaced')))
      ${f.companyId ? sql`AND d.company_id = ${f.companyId}` : sql``}`;
  }

  async search(user: User, f: SearchFilter) {
    const qn = normalizeThai(f.q ?? '');
    if (qn && qn.length < 2) throw new BadRequestException('พิมพ์คำค้นอย่างน้อย 2 ตัวอักษร');
    const scope = await this.scopeCondition(user, f);
    const pattern = `%${likeEscape(qn)}%`;
    const page = Math.max(1, f.page ?? 1);

    let q = this.db
      .selectFrom('documents as d')
      .innerJoin('companies as c', 'c.id', 'd.company_id')
      .innerJoin('users as u', 'u.id', 'd.created_by')
      .select([
        'd.id',
        'd.title',
        'd.status',
        'd.company_id as companyId',
        'c.name as companyName',
        'd.doc_type as docType',
        'd.tags',
        'd.page_count as pageCount',
        'd.due_at as dueAt',
        'd.created_at as createdAt',
        'd.sent_at as sentAt',
        'd.completed_at as completedAt',
        'd.text_status as textStatus',
        sql<string>`coalesce(u.first_name || ' ' || u.last_name, u.line_display_name)`.as('creatorName'),
        sql<boolean>`${qn ? sql`d.title_normalized LIKE ${pattern}` : sql`false`}`.as('titleHit'),
      ])
      .where(scope);

    if (qn) {
      // the trigram index answers the page sub-query; documents are filtered after
      q = q.where(sql<SqlBool>`(d.title_normalized LIKE ${pattern} OR d.id IN (SELECT p.document_id FROM document_pages p WHERE p.text_normalized LIKE ${pattern}))`);
    }
    if (f.status) q = q.where('d.status', '=', f.status);
    if (f.overdue) q = q.where('d.status', '=', 'pending').where('d.due_at', '<', new Date());
    if (f.from) q = q.where('d.created_at', '>=', new Date(f.from));
    if (f.to) q = q.where('d.created_at', '<', new Date(f.to));
    if (f.creatorId) q = q.where('d.created_by', '=', f.creatorId);
    if (f.docType) q = q.where('d.doc_type', '=', f.docType);
    if (f.tag) q = q.where(sql<SqlBool>`${f.tag} = ANY(d.tags)`);
    if (f.signerId) q = q.where(sql<SqlBool>`EXISTS (SELECT 1 FROM document_signers s WHERE s.document_id = d.id AND s.user_id = ${f.signerId} AND s.status <> 'replaced')`);
    if (f.departmentId) {
      q = q.where(sql<SqlBool>`EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = d.created_by AND m.company_id = d.company_id AND m.department_id = ${f.departmentId})`);
    }

    const rows = await q.orderBy('d.updated_at', 'desc').limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE).execute();
    const docs = rows.slice(0, PAGE_SIZE);

    const matches = new Map<string, { pageNo: number; source: string | null; confidence: number | null; snippet: ReturnType<typeof snippetFor> }[]>();
    const counts = new Map<string, number>();
    if (qn && docs.length) {
      const ids = docs.map((d) => d.id);
      // per document through the primary key: the trigram index would re-read every
      // matching page in the database just to keep the 20 documents on this page
      const pages = await sql<{ document_id: string; page_no: number; text: string; text_source: string | null; ocr_confidence: number | null; total: number }>`
        SELECT i.id AS document_id, x.page_no, x.text, x.text_source, x.ocr_confidence, c.total
        FROM unnest(${ids}::uuid[]) AS i(id)
        CROSS JOIN LATERAL (
          SELECT p.page_no, p.text, p.text_source, p.ocr_confidence FROM document_pages p
          WHERE p.document_id = i.id AND p.text_normalized LIKE ${pattern}
          ORDER BY p.page_no LIMIT ${MATCHES_PER_DOC}
        ) x
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS total FROM document_pages p WHERE p.document_id = i.id AND p.text_normalized LIKE ${pattern}
        ) c
        ORDER BY i.id, x.page_no`.execute(this.db);
      for (const p of pages.rows) {
        counts.set(p.document_id, p.total);
        const list = matches.get(p.document_id) ?? [];
        list.push({ pageNo: p.page_no, source: p.text_source, confidence: p.ocr_confidence, snippet: snippetFor(p.text ?? '', qn) });
        matches.set(p.document_id, list);
      }
    }

    return {
      page,
      hasMore: rows.length > PAGE_SIZE,
      query: f.q ?? '',
      items: docs.map((d) => ({
        ...d,
        overdue: d.status === 'pending' && !!d.dueAt && d.dueAt.getTime() < Date.now(),
        matchCount: counts.get(d.id) ?? 0,
        matches: matches.get(d.id) ?? [],
      })),
    };
  }

  /** Values for the type and tag filters, from the documents the scope can see. */
  async facets(user: User, f: Pick<SearchFilter, 'scope' | 'companyId'>) {
    const scope = await this.scopeCondition(user, { ...f });
    const r = await sql<{ types: string[] | null; tags: string[] | null }>`
      SELECT array_agg(DISTINCT d.doc_type) FILTER (WHERE d.doc_type IS NOT NULL) AS types,
             (SELECT array_agg(DISTINCT t) FROM documents d2, unnest(d2.tags) t WHERE d2.id IN (SELECT d.id FROM documents d WHERE ${scope})) AS tags
      FROM documents d WHERE ${scope}`.execute(this.db);
    const rows = { types: r.rows[0]?.types ?? [], tags: r.rows[0]?.tags ?? [] };
    return { docTypes: (rows?.types ?? []).sort(), tags: (rows?.tags ?? []).sort() };
  }

  /** SRC-04: boxes (fractions of the displayed page) of the lines that contain the query. */
  async highlights(user: User, documentId: string, pageNo: number, query: string, meta: RequestMeta) {
    const a = await this.access.load(user, documentId);
    await this.access.logAdminView(user, a, `search_page:${pageNo}`, meta);
    const page = await this.db
      .selectFrom('document_pages')
      .select(['lines', 'text_source', 'ocr_confidence'])
      .where('document_id', '=', documentId)
      .where('page_no', '=', pageNo)
      .executeTakeFirst();
    if (!page) throw new NotFoundException();
    const qn = normalizeThai(query);
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    if (qn) {
      for (const line of (page.lines ?? []) as PageLine[]) {
        const n = normalizeWithMap(line.t);
        let at = n.text.indexOf(qn);
        while (at >= 0) {
          // approximate the word's place inside the line by its character position
          // characters differ in width, so pad by half an average character on each side
          const pad = 0.5 / line.t.length;
          const start = Math.max(0, n.map[at] / line.t.length - pad);
          const end = Math.min(1, (n.map[at + qn.length - 1] + 1) / line.t.length + pad);
          boxes.push({ x: line.x + line.w * start, y: line.y, w: Math.max(line.w * (end - start), 0.01), h: line.h });
          at = n.text.indexOf(qn, at + qn.length);
        }
      }
    }
    return { pageNo, source: page.text_source, confidence: page.ocr_confidence, boxes };
  }
}
