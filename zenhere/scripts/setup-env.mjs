// Creates backend/.env for local testing if it does not exist yet (random secrets, test mode, no LINE).
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', '.env');
if (existsSync(file)) {
  console.log('backend/.env already exists, keeping it');
  process.exit(0);
}
const dbUrl = process.argv[2] ?? 'postgres://zenhere:zenhere_dev@localhost:5436/zenhere';
writeFileSync(
  file,
  `# Local testing (created by scripts/setup-env.mjs). Not for production.
NODE_ENV=development
PORT=3100
APP_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:5173/api
DATABASE_URL=${dbUrl}
JWT_SECRET=${randomBytes(48).toString('base64')}
FILE_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
STORAGE_DIR=./storage

# Test mode: log in with demo accounts, LINE messages go to the "LINE ทดสอบ" page
DEV_LOGIN_ENABLED=true
LINE_PUSH_ENABLED=false
SUPER_ADMIN_LINE_USER_IDS=U00000000000000000000000000000001
JOB_WORKER_ENABLED=true
PDPA_CONSENT_VERSION=2026-11-v1

# Fill these later to connect LINE
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
LINE_MESSAGING_CHANNEL_SECRET=
LINE_MESSAGING_ACCESS_TOKEN=
LINE_OA_BASIC_ID=

# Optional: OCR worker (see ocr-worker/README.md) and TSA
OCR_WORKER_URL=
OCR_WORKER_TOKEN=
TSA_URL=
`,
);
console.log('created backend/.env');
