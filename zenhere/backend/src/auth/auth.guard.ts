import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { InjectDb, type Db } from '../db/database';
import { ALLOW_UNREGISTERED, IS_PUBLIC, SUPER_ADMIN_ONLY } from './decorators';
import { issueSession, readSession, SESSION_COOKIE } from './session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = (key: string) => this.reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]);
    if (flag(IS_PUBLIC)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { authUser?: unknown }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const session = readSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException('กรุณาเข้าสู่ระบบด้วย LINE');

    const user = await this.db.selectFrom('users').selectAll().where('id', '=', session.userId).executeTakeFirst();
    if (!user) throw new UnauthorizedException('กรุณาเข้าสู่ระบบด้วย LINE');
    if (session.shouldRenew) issueSession(res, user.id);
    req.authUser = user;

    if (!user.registered_at && !flag(ALLOW_UNREGISTERED)) {
      throw new ForbiddenException({ message: 'กรุณาลงทะเบียนให้ครบก่อน', code: 'REGISTRATION_REQUIRED' });
    }
    if (flag(SUPER_ADMIN_ONLY) && !user.is_super_admin) throw new ForbiddenException('เฉพาะ Super Admin');
    return true;
  }
}
