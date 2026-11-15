import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { zbody, ZodPipe } from '../common/validation';
import type { MembershipStatus, User } from '../db/types';
import { CompaniesService } from './companies.service';
import { ImportsService } from './imports.service';

const uuidOrNull = z.string().uuid().nullable().optional();

const joinSchema = z
  .object({
    code: z.string().regex(/^\d{8}$/, 'รหัสเข้าร่วมต้องเป็นตัวเลข 8 หลัก').optional(),
    token: z.string().min(10).max(100).optional(),
    employeeCode: z.string().trim().min(1, 'กรุณากรอกรหัสพนักงาน').max(50),
    departmentId: uuidOrNull,
    positionId: uuidOrNull,
  })
  .refine((v) => v.code || v.token, { message: 'กรุณากรอกรหัสเข้าร่วม', path: ['code'] });

const membershipPatchSchema = z.object({
  status: z.enum(['approved', 'rejected', 'suspended']).optional(),
  rejectReason: z.string().trim().max(500).optional(),
  employeeCode: z.string().trim().min(1).max(50).optional(),
  departmentId: uuidOrNull,
  positionId: uuidOrNull,
  canCreateDocuments: z.boolean().optional(),
});

const listItemSchema = z.object({ name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100), sortOrder: z.number().int().optional() });
const listItemPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const auditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

type ListItem = z.infer<typeof listItemSchema>;
type ListItemPatch = z.infer<typeof listItemPatchSchema>;

@Controller()
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly imports: ImportsService,
  ) {}

  /** Rate-limited: the 8-digit code must not be guessable by brute force. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('companies/lookup')
  lookup(@Query('code') code?: string, @Query('token') token?: string) {
    if (code && !/^\d{8}$/.test(code)) throw new BadRequestException('รหัสเข้าร่วมต้องเป็นตัวเลข 8 หลัก');
    return this.companies.lookup({ code, token });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('companies/join')
  join(@CurrentUser() user: User, @Body(zbody(joinSchema)) body: z.infer<typeof joinSchema>, @Meta() meta: RequestMeta) {
    return this.companies.join(user, body, meta);
  }

  @Get('companies/:companyId/dashboard')
  dashboard(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.dashboard(user, companyId);
  }

  @Get('companies/:companyId/members')
  members(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('notFriend') notFriend?: string,
  ) {
    const s = status && ['pending', 'approved', 'rejected', 'suspended'].includes(status) ? (status as MembershipStatus) : undefined;
    return this.companies.members(user, companyId, { status: s, q: q?.slice(0, 100), notFriend: notFriend === 'true' });
  }

  @Patch('memberships/:id')
  updateMembership(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(membershipPatchSchema)) body: z.infer<typeof membershipPatchSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.companies.updateMembership(user, id, body, meta);
  }

  @Get('companies/:companyId/invite')
  invite(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.invite(user, companyId);
  }

  @Post('companies/:companyId/invite/rotate')
  rotateInvite(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Meta() meta: RequestMeta) {
    return this.companies.rotateInvite(user, companyId, meta);
  }

  @Get('companies/:companyId/audit')
  audit(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    return this.companies.auditLog(user, companyId, q);
  }

  @Get('companies/:companyId/employee-imports')
  importedEmployees(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.imports.list(user, companyId);
  }

  @Post('companies/:companyId/employee-imports')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importEmployees(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์');
    const rows = await this.imports.parseFile(file);
    return this.imports.import(user, companyId, rows, meta);
  }

  // ADM-05: departments and positions share one implementation
  @Get('companies/:companyId/departments')
  departments(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.list(user, companyId, 'departments');
  }

  @Get('companies/:companyId/positions')
  positions(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.list(user, companyId, 'positions');
  }

  @Post('companies/:companyId/departments')
  createDepartment(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Body(zbody(listItemSchema)) body: ListItem, @Meta() meta: RequestMeta) {
    return this.companies.createListItem(user, companyId, 'departments', body, meta);
  }

  @Post('companies/:companyId/positions')
  createPosition(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Body(zbody(listItemSchema)) body: ListItem, @Meta() meta: RequestMeta) {
    return this.companies.createListItem(user, companyId, 'positions', body, meta);
  }

  @Patch('companies/:companyId/departments/:id')
  updateDepartment(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(listItemPatchSchema)) body: ListItemPatch,
    @Meta() meta: RequestMeta,
  ) {
    return this.companies.updateListItem(user, companyId, 'departments', id, body, meta);
  }

  @Patch('companies/:companyId/positions/:id')
  updatePosition(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(listItemPatchSchema)) body: ListItemPatch,
    @Meta() meta: RequestMeta,
  ) {
    return this.companies.updateListItem(user, companyId, 'positions', id, body, meta);
  }
}
