import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { zbody, ZodPipe } from '../common/validation';
import type { User } from '../db/types';
import { DocumentsService } from './documents.service';
import { MAX_UPLOAD_BYTES } from './pdf/inspect';
import { SigningService } from './signing.service';

const FIELD_TYPES = ['signature', 'date', 'text', 'checkbox', 'stamp', 'certified_copy'] as const;
const frac = z.number().min(0).max(1);

const draftSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อเรื่อง').max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  docType: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  signingMode: z.enum(['parallel', 'sequential']).optional(),
  notifyCreatorOnSign: z.boolean().optional(),
});

const layoutSchema = z.object({
  signers: z.array(z.object({ userId: z.string().uuid(), order: z.number().int().min(1).max(100) })).max(50),
  fields: z
    .array(
      z.object({
        id: z.string().uuid(),
        signerUserId: z.string().uuid(),
        pageNo: z.number().int().min(1),
        type: z.enum(FIELD_TYPES),
        x: frac,
        y: frac,
        w: frac.refine((v) => v > 0),
        h: frac.refine((v) => v > 0),
        settings: z
          .object({
            label: z.string().max(100).optional(),
            required: z.boolean().optional(),
            maxLength: z.number().int().optional(),
            fontSize: z.number().optional(),
            dateFormat: z.enum(['short', 'long', 'numeric']).optional(),
            stampId: z.string().uuid().optional(),
            text: z.string().max(60).optional(),
          })
          .optional(),
      }),
    )
    .max(1000),
});

const signPayloadSchema = z.object({
  values: z.record(z.string().uuid(), z.union([z.string().max(1000), z.boolean()])).default({}),
  useSavedSignature: z.boolean(),
  consent: z.boolean(),
});

const reasonSchema = z.object({ reason: z.string().trim().min(1, 'กรุณาใส่เหตุผล').max(500) });
const listSchema = z.object({
  companyId: z.string().uuid(),
  box: z.enum(['todo', 'waiting', 'done', 'drafts', 'company']).default('todo'),
  q: z.string().max(100).optional(),
  status: z.enum(['draft', 'pending', 'completed', 'declined', 'voided']).optional(),
  overdue: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).optional(),
});

function sendFile(res: Response, f: { data: Buffer; name: string; type: string }, download: boolean) {
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.set({
    'content-type': f.type,
    'cache-control': 'private, no-store',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  res.send(f.data);
}

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly signing: SigningService,
  ) {}

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  create(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { companyId?: string; title?: string; description?: string; docType?: string; tags?: string },
    @Meta() meta: RequestMeta,
  ) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์');
    if (!body.companyId || !z.string().uuid().safeParse(body.companyId).success) throw new BadRequestException('companyId ไม่ถูกต้อง');
    const tags = body.tags ? body.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : [];
    return this.documents.create(user, body.companyId, file, meta, { title: body.title?.slice(0, 200), description: body.description?.slice(0, 2000), docType: body.docType?.slice(0, 100), tags });
  }

  @Get('documents')
  list(@CurrentUser() user: User, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.documents.list(user, q);
  }

  @Get('companies/:companyId/signer-candidates')
  candidates(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Query('q') q?: string) {
    return this.documents.signerCandidates(user, companyId, q?.slice(0, 100));
  }

  @Get('documents/:id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.documents.detail(user, id, meta);
  }

  @Patch('documents/:id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(draftSchema)) body: z.infer<typeof draftSchema>) {
    return this.documents.updateDraft(user, id, body);
  }

  @Put('documents/:id/layout')
  layout(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(layoutSchema)) body: z.infer<typeof layoutSchema>) {
    return this.documents.saveLayout(user, id, body);
  }

  @Post('documents/:id/send')
  send(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.documents.send(user, id, meta);
  }

  @Delete('documents/:id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.deleteDraft(user, id);
  }

  @Get('documents/:id/file')
  async file(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('v') v: string | undefined,
    @Query('download') download: string | undefined,
    @Meta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const version = v === 'final' ? 'final' : v === 'original' ? 'original' : 'source';
    const dl = download === '1' || download === 'true';
    sendFile(res, await this.documents.file(user, id, version, dl, meta), dl);
  }

  @Get('documents/:id/signing')
  signingContext(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.signing.context(user, id, meta);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('documents/:id/sign')
  @UseInterceptors(FileInterceptor('signature', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  sign(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('payload') payload: string | undefined,
    @UploadedFile() signature: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload ?? '');
    } catch {
      throw new BadRequestException('payload ไม่ถูกต้อง');
    }
    const input = new ZodPipe(signPayloadSchema).transform(parsed);
    return this.signing.sign(user, id, input, signature?.buffer, meta);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('documents/:id/decline')
  decline(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(reasonSchema)) body: { reason: string }, @Meta() meta: RequestMeta) {
    return this.signing.decline(user, id, body.reason, meta);
  }

  @Post('documents/:id/remind')
  remind(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(z.object({ signerIds: z.array(z.string().uuid()).optional() }))) body: { signerIds?: string[] }, @Meta() meta: RequestMeta) {
    return this.documents.remind(user, id, body.signerIds, meta);
  }

  @Post('documents/:id/void')
  void(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(reasonSchema)) body: { reason: string }, @Meta() meta: RequestMeta) {
    return this.documents.void(user, id, body.reason, meta);
  }

  @Post('documents/:id/signers/:signerId/replace')
  replace(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Body(zbody(reasonSchema.extend({ userId: z.string().uuid() }))) body: { reason: string; userId: string },
    @Meta() meta: RequestMeta,
  ) {
    return this.documents.replaceSigner(user, id, signerId, body.userId, body.reason, meta);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('verify')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 60 * 1024 * 1024, files: 1 } }))
  verify(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์');
    return this.documents.verify(user, file.buffer);
  }
}
