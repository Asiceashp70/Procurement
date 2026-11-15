import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { config } from './config/config';
import { migrate } from './db/migrate';

async function bootstrap() {
  const cfg = config();
  await migrate(cfg.DATABASE_URL, (m) => Logger.log(m, 'Migrate'));
  const app = await createApp();
  await app.listen(cfg.PORT, '127.0.0.1');
  Logger.log(`LINE e-Sign API listening on http://127.0.0.1:${cfg.PORT} (${cfg.NODE_ENV})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
