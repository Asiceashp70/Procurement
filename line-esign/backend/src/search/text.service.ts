import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { sql, type Transaction } from 'kysely';
import { StorageService } from '../common/storage.service';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import type { Database, PageLine } from '../db/types';
import { JobsService, PermanentJobError } from '../jobs/jobs.service';
import { normalizeThai } from './thai-normalize';

const EXTRACTOR = join(__dirname, '..', '..', 'scripts', 'extract-text.mjs');
/** SRC-06: a page with less text than this is treated as a scan and sent to OCR */
export const MIN_TEXT_CHARS = 20;
const OCR_BATCH = 10;

interface ExtractedPage {
  page: number;
  text: string;
  lines: PageLine[];
}

interface OcrPage {
  page: number;
  text: string;
  confidence: number | null;
  lines: { text: string; confidence: number; x: number; y: number; w: number; h: number }[];
}

/** Runs scripts/extract-text.mjs (pdf.js) in a child process. */
export function extractPdfText(pdf: Buffer, timeoutMs = 120_000): Promise<ExtractedPage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [EXTRACTOR], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`text extraction failed (${code}): ${Buffer.concat(err).toString().slice(0, 500)}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(pdf);
  });
}

/**
 * DOC-08, SRC-06, SRC-07: after upload, pull the text of every page; pages with
 * almost no text (scans, photos) go to the OCR worker in batches. Each page keeps
 * its text, normalized text (indexed with pg_trgm), source and line boxes.
 */
@Injectable()
export class TextService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger(TextService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('document.extract_text', (p) => this.extract(String(p.documentId)));
    this.jobs.register('document.extract_text:failed', async (p) => {
      await this.db.updateTable('documents').set({ text_status: 'failed' }).where('id', '=', String(p.documentId)).execute();
    });
    this.jobs.register('document.ocr', (p) => this.ocr(String(p.documentId), p.pages as number[]));
    this.jobs.register('document.ocr:failed', (p) => this.ocrFailed(String(p.documentId), p.pages as number[]));
  }

  /** Documents uploaded before search existed (or whose job was lost) are queued once at start. */
  async onApplicationBootstrap() {
    if (!config().JOB_WORKER_ENABLED || config().NODE_ENV === 'test') return;
    await this.backfill();
  }

  async backfill() {
    const docs = await this.db
      .selectFrom('documents as d')
      .select('d.id')
      .where('d.text_status', '=', 'pending')
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('jobs as j').select('j.id').where('j.type', '=', 'document.extract_text').where('j.status', 'in', ['queued', 'running']).where(sql<boolean>`j.payload->>'documentId' = d.id::text`))),
      )
      .execute();
    for (const d of docs) await this.jobs.enqueue('document.extract_text', { documentId: d.id });
    if (docs.length) this.log.log(`queued text extraction for ${docs.length} documents`);
    return docs.length;
  }

  async extract(documentId: string) {
    const doc = await this.db.selectFrom('documents').select(['id', 'title', 'source_key']).where('id', '=', documentId).executeTakeFirst();
    if (!doc) throw new PermanentJobError(`document ${documentId} not found`);
    await this.db.updateTable('documents').set({ text_status: 'extracting', title_normalized: normalizeThai(doc.title) }).where('id', '=', documentId).execute();

    const pages = await extractPdfText(await this.storage.get(doc.source_key));
    const ocrEnabled = Boolean(config().OCR_WORKER_URL);
    const forOcr: number[] = [];
    await this.db.transaction().execute(async (trx) => {
      for (const p of pages) {
        const normalized = normalizeThai(p.text);
        const enough = normalized.length >= MIN_TEXT_CHARS;
        if (!enough && ocrEnabled) forOcr.push(p.page);
        await trx
          .updateTable('document_pages')
          .set({
            text: p.text,
            text_normalized: normalized,
            text_source: p.text ? 'pdf' : null,
            lines: JSON.stringify(p.lines),
            ocr_status: enough ? 'none' : ocrEnabled ? 'queued' : 'skipped',
            extracted_at: new Date(),
          })
          .where('document_id', '=', documentId)
          .where('page_no', '=', p.page)
          .execute();
      }
      await trx.updateTable('documents').set({ text_status: forOcr.length ? 'ocr' : 'ready' }).where('id', '=', documentId).execute();
      for (let i = 0; i < forOcr.length; i += OCR_BATCH) {
        // the worker may be restarting; give it time (backoff 30s, 1m, 2m, 4m, 8m)
        await this.jobs.enqueue('document.ocr', { documentId, pages: forOcr.slice(i, i + OCR_BATCH) }, new Date(), trx, 6);
      }
    });
  }

  async ocr(documentId: string, pageNos: number[]) {
    const url = config().OCR_WORKER_URL;
    if (!url) throw new PermanentJobError('OCR worker is not configured');
    const doc = await this.db.selectFrom('documents').select(['source_key']).where('id', '=', documentId).executeTakeFirst();
    if (!doc) throw new PermanentJobError(`document ${documentId} not found`);

    const form = new FormData();
    form.append('file', new Blob([await this.storage.get(doc.source_key)], { type: 'application/pdf' }), 'document.pdf');
    form.append('pages', pageNos.join(','));
    const res = await fetch(`${url.replace(/\/$/, '')}/ocr`, {
      method: 'POST',
      body: form,
      headers: config().OCR_WORKER_TOKEN ? { 'x-ocr-token': config().OCR_WORKER_TOKEN } : {},
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) throw new PermanentJobError(`OCR worker ${res.status}: ${body}`);
      throw new Error(`OCR worker ${res.status}: ${body}`);
    }
    const result = (await res.json()) as { pages: OcrPage[] };

    await this.db.transaction().execute(async (trx) => {
      for (const p of result.pages) {
        if (!pageNos.includes(p.page)) continue;
        await trx
          .updateTable('document_pages')
          .set({
            text: p.text,
            text_normalized: normalizeThai(p.text),
            text_source: 'ocr',
            ocr_confidence: p.confidence,
            lines: JSON.stringify(p.lines.map((l) => ({ t: l.text, x: l.x, y: l.y, w: l.w, h: l.h, c: l.confidence }))),
            ocr_status: 'done',
          })
          .where('document_id', '=', documentId)
          .where('page_no', '=', p.page)
          .execute();
      }
      await this.settle(trx, documentId);
    });
  }

  private async ocrFailed(documentId: string, pageNos: number[]) {
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('document_pages').set({ ocr_status: 'failed' }).where('document_id', '=', documentId).where('page_no', 'in', pageNos).execute();
      await this.settle(trx, documentId);
    });
  }

  /** When no page is waiting for OCR any more, the document is searchable. */
  private async settle(trx: Transaction<Database>, documentId: string) {
    const left = await trx
      .selectFrom('document_pages')
      .select([sql<number>`count(*) FILTER (WHERE ocr_status = 'queued')::int`.as('queued'), sql<number>`count(*) FILTER (WHERE ocr_status = 'failed')::int`.as('failed')])
      .where('document_id', '=', documentId)
      .executeTakeFirstOrThrow();
    if (left.queued === 0) {
      await trx.updateTable('documents').set({ text_status: left.failed ? 'failed' : 'ready' }).where('id', '=', documentId).execute();
    }
  }
}
