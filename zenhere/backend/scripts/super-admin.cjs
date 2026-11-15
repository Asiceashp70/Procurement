// Lists people who have logged in, and makes one of them Super Admin.
//
//   node scripts/super-admin.cjs              list the latest logins
//   node scripts/super-admin.cjs --add <n|U…> add by list number or LINE userId
//
// Super Admin comes only from SUPER_ADMIN_LINE_USER_IDS in .env (never "first login wins").
// Restart the API afterwards so it reads the new value.
'use strict';
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
require('dotenv').config({ path: join(__dirname, '..', '.env') });
const { Client } = require('pg');

function withAdmin(envText, lineUserId) {
  const lines = envText.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    const m = /^SUPER_ADMIN_LINE_USER_IDS=(.*)$/.exec(line);
    if (!m) return line;
    found = true;
    const ids = new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean));
    ids.add(lineUserId);
    return `SUPER_ADMIN_LINE_USER_IDS=${[...ids].join(',')}`;
  });
  if (!found) out.splice(out.length && out[out.length - 1] === '' ? out.length - 1 : out.length, 0, `SUPER_ADMIN_LINE_USER_IDS=${lineUserId}`);
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `SELECT line_user_id, coalesce(first_name || ' ' || last_name, line_display_name, '-') AS name, is_super_admin, last_login_at
       FROM users ORDER BY last_login_at DESC NULLS LAST LIMIT 20`,
  );
  await db.end();
  if (args[0] !== '--add') {
    if (!rows.length) console.log('nobody has logged in yet: log in once with LINE, then run this again');
    rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.name}  ${r.line_user_id}${r.is_super_admin ? '  [Super Admin]' : ''}`));
    return;
  }
  const pick = args[1] || '';
  const id = /^\d+$/.test(pick) ? rows[Number(pick) - 1]?.line_user_id : pick;
  if (!id || !/^U[0-9a-f]{32}$/.test(id)) throw new Error('give a list number or a LINE userId (U + 32 hex characters)');
  const file = join(__dirname, '..', '.env');
  writeFileSync(file, withAdmin(readFileSync(file, 'utf8'), id));
  console.log(`${id} added to SUPER_ADMIN_LINE_USER_IDS. Restart the API (zenhere-api service), then log in again.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`super-admin: ${err.message}`);
    process.exit(1);
  });
}
module.exports = { withAdmin };
