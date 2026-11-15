import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { zbody } from '../common/validation';
import type { User } from '../db/types';
import { StampsService } from './stamps.service';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  userIds: z.array(z.string().uuid()).max(500).optional(),
});

@Controller('companies/:companyId/stamps')
export class StampsController {
  constructor(private readonly stamps: StampsService) {}

  @Get()
  list(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Query('forUserId') forUserId?: string) {
    if (forUserId) {
      if (!/^[0-9a-f-]{36}$/i.test(forUserId)) throw new BadRequestException('forUserId ไม่ถูกต้อง');
      return this.stamps.permittedFor(user, companyId, forUserId);
    }
    return this.stamps.list(user, companyId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  create(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { name?: string; userIds?: string },
    @Meta() meta: RequestMeta,
  ) {
    if (!file) throw new BadRequestException('ไม่พบรูปตรา');
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('กรุณาตั้งชื่อตรา');
    let userIds: string[] = [];
    try {
      userIds = z.array(z.string().uuid()).parse(JSON.parse(body.userIds || '[]'));
    } catch {
      throw new BadRequestException('รายชื่อผู้มีสิทธิ์ไม่ถูกต้อง');
    }
    return this.stamps.create(user, companyId, name.slice(0, 100), file.buffer, userIds, meta);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(patchSchema)) body: z.infer<typeof patchSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.stamps.update(user, companyId, id, body, meta);
  }

  @Get(':id/image')
  async image(@CurrentUser() user: User, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const png = await this.stamps.image(user, companyId, id);
    res.set({ 'content-type': 'image/png', 'cache-control': 'private, no-store' }).send(png);
  }
}
