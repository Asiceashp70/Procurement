import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function metaOf(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 500) ?? null };
}

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  metaOf(ctx.switchToHttp().getRequest<Request>()),
);
