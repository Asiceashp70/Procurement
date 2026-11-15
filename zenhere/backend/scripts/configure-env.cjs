// Creates or updates backend/.env for a server install, keeping existing secrets.
//
//   node scripts/configure-env.cjs --mode test|production --origin <url> [--db-url <url>] [--line-login-id <id>]
//                                  [--liff-id <id>] [--storage-dir <path>] [--out <path>]
//
// --liff-id none clears a LIFF ID set before.
//
// The LINE Login channel secret is read from the ZENHERE_LINE_LOGIN_SECRET environment
// variable, never from the command line (which ends up in logs and process lists).
// FILE_ENCRYPTION_KEY and JWT_SECRET are generated once and then always kept:
// changing FILE_ENCRYPTION_KEY would make every stored file unreadable.
'use strict';
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');

const DEMO_SUPER_ADMIN = 'U00000000000000000000000000000001';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function configure({ mode, origin, dbUrl, lineLoginId, lineLoginSecret, liffId, storageDir, existing }) {
  if (mode !== 'test' && mode !== 'production') throw new Error('--mode must be test or production');
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('--origin must be a URL such as http://192.168.1.10 or https://zenhere.example.co.th');
  }
  const o = url.origin;
  const e = { ...existing };
  const keep = (k, v) => (e[k] ? e[k] : v);

  const env = {
    NODE_ENV: mode === 'production' ? 'production' : 'development',
    PORT: keep('PORT', '3100'),
    APP_ORIGIN: o,
    API_BASE_URL: `${o}/api`,
    DATABASE_URL: dbUrl || e.DATABASE_URL || '',
    JWT_SECRET: keep('JWT_SECRET', randomBytes(48).toString('base64')),
    FILE_ENCRYPTION_KEY: keep('FILE_ENCRYPTION_KEY', randomBytes(32).toString('base64')),
    STORAGE_DIR: storageDir || keep('STORAGE_DIR', './storage'),
    LINE_LOGIN_CHANNEL_ID: lineLoginId || e.LINE_LOGIN_CHANNEL_ID || '',
    LINE_LOGIN_CHANNEL_SECRET: lineLoginSecret || e.LINE_LOGIN_CHANNEL_SECRET || '',
    LINE_MESSAGING_CHANNEL_SECRET: e.LINE_MESSAGING_CHANNEL_SECRET || '',
    LINE_MESSAGING_ACCESS_TOKEN: e.LINE_MESSAGING_ACCESS_TOKEN || '',
    LINE_OA_BASIC_ID: e.LINE_OA_BASIC_ID || '',
    LIFF_ID: liffId === 'none' ? '' : liffId || e.LIFF_ID || '',
    SUPER_ADMIN_LINE_USER_IDS: e.SUPER_ADMIN_LINE_USER_IDS || '',
    DEV_LOGIN_ENABLED: mode === 'test' ? 'true' : 'false',
    JOB_WORKER_ENABLED: 'true',
    PDPA_CONSENT_VERSION: keep('PDPA_CONSENT_VERSION', '2026-11-v1'),
    OCR_WORKER_URL: e.OCR_WORKER_URL || '',
    OCR_WORKER_TOKEN: e.OCR_WORKER_TOKEN || '',
    TSA_URL: e.TSA_URL || '',
  };
  env.LINE_PUSH_ENABLED = env.LINE_MESSAGING_ACCESS_TOKEN ? 'true' : 'false';

  const admins = new Set(env.SUPER_ADMIN_LINE_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean));
  if (mode === 'test') admins.add(DEMO_SUPER_ADMIN);
  else admins.delete(DEMO_SUPER_ADMIN); // the demo account must never be an admin on a real server
  env.SUPER_ADMIN_LINE_USER_IDS = [...admins].join(',');

  if (!env.DATABASE_URL) throw new Error('--db-url is required the first time');
  if (env.LIFF_ID && !/^\d+-[A-Za-z0-9]+$/.test(env.LIFF_ID)) throw new Error('--liff-id looks like 1234567890-AbCdEfGh (LINE Developers > LIFF tab)');
  if (env.LIFF_ID && !env.LINE_LOGIN_CHANNEL_ID) throw new Error('LIFF needs the LINE Login channel that owns the LIFF app');
  if (mode === 'production') {
    if (url.protocol !== 'https:') throw new Error('production needs an https:// origin (LINE Login requires HTTPS)');
    if (!env.LINE_LOGIN_CHANNEL_ID || !env.LINE_LOGIN_CHANNEL_SECRET) throw new Error('production needs the LINE Login channel ID and secret');
  }
  return env;
}

function render(env, mode) {
  const lines = [
    `# ZenHere server settings (${mode} mode), written by scripts/configure-env.cjs`,
    '# Keep this file private. Back up FILE_ENCRYPTION_KEY separately: without it stored files cannot be read.',
    '',
  ];
  for (const [k, v] of Object.entries(env)) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.out || join(__dirname, '..', '.env');
  const existing = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const env = configure({
    mode: args.mode,
    origin: args.origin,
    dbUrl: args['db-url'],
    lineLoginId: args['line-login-id'],
    lineLoginSecret: process.env.ZENHERE_LINE_LOGIN_SECRET,
    liffId: args['liff-id'],
    storageDir: args['storage-dir'],
    existing,
  });
  if (existsSync(file)) copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  writeFileSync(file, render(env, args.mode));
  console.log(`wrote ${file} (${args.mode} mode, ${env.APP_ORIGIN})`);
  console.log(`LINE Login: ${env.LINE_LOGIN_CHANNEL_ID ? `channel ${env.LINE_LOGIN_CHANNEL_ID}, callback ${env.API_BASE_URL}/auth/line/callback` : 'not configured'}`);
  console.log(`LIFF: ${env.LIFF_ID ? `https://liff.line.me/${env.LIFF_ID} -> endpoint ${env.APP_ORIGIN}` : 'not configured'}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`configure-env: ${err.message}`);
    process.exit(1);
  }
}
module.exports = { configure, parseEnv, render };
