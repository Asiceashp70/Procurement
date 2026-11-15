import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { User } from '../db/types';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_UNREGISTERED = 'allowUnregistered';
export const SUPER_ADMIN_ONLY = 'superAdminOnly';

/** No login needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Logged in, but the first-time registration form may still be unfinished. */
export const AllowUnregistered = () => SetMetadata(ALLOW_UNREGISTERED, true);
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().authUser,
);
