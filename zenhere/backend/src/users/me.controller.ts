import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AllowUnregistered, CurrentUser, Public } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { zbody } from '../common/validation';
import type { User } from '../db/types';
import { currentConsent } from './consent';
import { MAX_SIGNATURE_BYTES, SignaturesService } from './signatures.service';
import { UsersService } from './users.service';

const phone = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลักขึ้นต้นด้วย 0'));

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  lastName: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(100),
  nickname: z.string().trim().max(50).optional().nullable(),
  phone,
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').max(200),
});
const registerSchema = profileSchema.extend({
  consentVersion: z.string(),
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'กรุณากดยินยอมก่อนลงทะเบียน' }) }),
});

@Controller()
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly signatures: SignaturesService,
  ) {}

  @Public()
  @Get('consent')
  consent() {
    const c = currentConsent();
    return { version: c.version, text: c.text };
  }

  @AllowUnregistered()
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.users.me(user);
  }

  @AllowUnregistered()
  @Post('me/register')
  register(@CurrentUser() user: User, @Body(zbody(registerSchema)) body: z.infer<typeof registerSchema>, @Meta() meta: RequestMeta) {
    return this.users.register(user, body, meta);
  }

  @Put('me/profile')
  updateProfile(@CurrentUser() user: User, @Body(zbody(profileSchema)) body: z.infer<typeof profileSchema>) {
    return this.users.updateProfile(user, body);
  }

  @AllowUnregistered()
  @Post('me/consent')
  acceptConsent(@CurrentUser() user: User, @Body(zbody(z.object({ version: z.string() }))) body: { version: string }, @Meta() meta: RequestMeta) {
    return this.users.acceptConsent(user, body.version, meta);
  }

  @AllowUnregistered()
  @Get('me/signatures')
  listSignatures(@CurrentUser() user: User) {
    return this.signatures.list(user);
  }

  @AllowUnregistered()
  @Post('me/signatures')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES, files: 1 } }))
  createSignature(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Body('method') method: string) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์ลายเซ็น');
    if (method !== 'draw' && method !== 'upload') throw new BadRequestException('method ต้องเป็น draw หรือ upload');
    return this.signatures.create(user, method, file.buffer);
  }

  @AllowUnregistered()
  @Get('me/signatures/:id/image')
  async signatureImage(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const png = await this.signatures.image(user, id);
    res.set({ 'content-type': 'image/png', 'cache-control': 'private, no-store' }).send(png);
  }
}
