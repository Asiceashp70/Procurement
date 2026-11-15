import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, SuperAdminOnly } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { zbody, ZodPipe } from '../common/validation';
import type { User } from '../db/types';
import { AdminService } from './admin.service';
import { CertificatesService } from './certificates.service';
import { lookupTaxId } from './tax-lookup';

const companySchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อบริษัท').max(200),
  taxId: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .nullable()
    .optional(),
  address: z.string().max(1000).nullable().optional(),
});
const companyPatchSchema = companySchema.partial().extend({ status: z.enum(['active', 'suspended']).optional() });
const auditQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

@SuperAdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly certificates: CertificatesService,
  ) {}

  // ADM-11
  @Get('companies/:id/certificates')
  listCertificates(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificates.list(id);
  }

  @Post('companies/:id/certificates')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  uploadCertificate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('password') password: string | undefined,
    @Meta() meta: RequestMeta,
  ) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์ใบรับรอง');
    return this.certificates.upload(user, id, file.buffer, password ?? '', meta);
  }

  @Post('certificates/:certId/deactivate')
  deactivateCertificate(@CurrentUser() user: User, @Param('certId', ParseUUIDPipe) certId: string, @Meta() meta: RequestMeta) {
    return this.certificates.deactivate(user, certId, meta);
  }

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  /** Fill the company form from the Revenue Department's VAT registry */
  @Get('tax-lookup/:taxId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  taxLookup(@Param('taxId') taxId: string) {
    return lookupTaxId(taxId.replace(/\D/g, ''));
  }

  @Get('companies')
  companies(@Query('q') q?: string, @Query('status') status?: string) {
    return this.admin.listCompanies({ q: q?.slice(0, 100), status });
  }

  @Post('companies')
  createCompany(@CurrentUser() user: User, @Body(zbody(companySchema)) body: z.infer<typeof companySchema>, @Meta() meta: RequestMeta) {
    return this.admin.createCompany(user, body, meta);
  }

  @Patch('companies/:id')
  updateCompany(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(companyPatchSchema)) body: z.infer<typeof companyPatchSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.admin.updateCompany(user, id, body, meta);
  }

  @Post('companies/:id/admins')
  appointAdmin(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(z.object({ userId: z.string().uuid() }))) body: { userId: string },
    @Meta() meta: RequestMeta,
  ) {
    return this.admin.appointAdmin(user, id, body.userId, meta);
  }

  @Delete('companies/:id/admins/:userId')
  removeAdmin(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Meta() meta: RequestMeta) {
    return this.admin.removeAdmin(user, id, userId, meta);
  }

  @Get('users')
  users(@Query('q') q = '') {
    return this.admin.searchUsers(q.slice(0, 100));
  }

  @Get('audit')
  audit(@Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    return this.admin.auditLog(q);
  }
}
