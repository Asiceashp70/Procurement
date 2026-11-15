import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { config } from '../config/config';
import type { Database } from './types';

// bigint (int8) as string is safe; keep counts readable by casting in SQL where needed.
types.setTypeParser(20, (v) => v);

export const DB = Symbol('DB');
export type Db = Kysely<Database>;

export function createDb(url: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 20 }) }),
  });
}

@Injectable()
class DbCloser implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onModuleDestroy() {
    await this.db.destroy();
  }
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb(config().DATABASE_URL) }, DbCloser],
  exports: [DB],
})
export class DatabaseModule {}

export const InjectDb = () => Inject(DB);
