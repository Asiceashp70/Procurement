import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3100),
  /** Public origin of the web app, e.g. https://esign.example.co.th. Used for the Origin check and LINE links. */
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Public base URL of the API as LINE sees it (callback URL is built from this). */
  API_BASE_URL: z.string().url().default('http://localhost:5173/api'),
  DATABASE_URL: z.string().default('postgres://esign:esign_dev@localhost:5432/esign'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** 32 random bytes, base64. Encrypts signatures and other files at rest (AES-256-GCM). */
  FILE_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'FILE_ENCRYPTION_KEY must be 32 bytes encoded as base64',
  }),
  STORAGE_DIR: z.string().default('./storage'),

  LINE_LOGIN_CHANNEL_ID: z.string().default(''),
  LINE_LOGIN_CHANNEL_SECRET: z.string().default(''),
  LINE_MESSAGING_CHANNEL_SECRET: z.string().default(''),
  LINE_MESSAGING_ACCESS_TOKEN: z.string().default(''),
  /** Basic ID of the OA, e.g. @123abcde, used for the "add friend" link. */
  LINE_OA_BASIC_ID: z.string().default(''),
  /** Comma-separated LINE userIds that are Super Admins. The first login never grants this by itself. */
  SUPER_ADMIN_LINE_USER_IDS: z.string().default(''),

  /** Local testing only: log in with a typed LINE userId. Refused when NODE_ENV=production. */
  DEV_LOGIN_ENABLED: bool,
  /** Send LINE messages for real. When false, messages are written to the server log only. */
  LINE_PUSH_ENABLED: bool,
  JOB_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  PDPA_CONSENT_VERSION: z.string().default('2026-11-v1'),
  /** RFC 3161 Time Stamping Authority used when sealing (optional). */
  TSA_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
});

export type AppConfig = z.infer<typeof schema> & { superAdminLineUserIds: Set<string> };

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.DEV_LOGIN_ENABLED) {
    throw new Error('DEV_LOGIN_ENABLED must not be set in production');
  }
  return {
    ...cfg,
    superAdminLineUserIds: new Set(
      cfg.SUPER_ADMIN_LINE_USER_IDS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Tests replace the configuration before the app module is created. */
export function setConfigForTests(cfg: AppConfig) {
  cached = cfg;
}
