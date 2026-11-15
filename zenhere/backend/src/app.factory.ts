import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: false });
  // The reverse proxy (Caddy/IIS) runs on the same machine; trust it for the client IP in audit logs.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
