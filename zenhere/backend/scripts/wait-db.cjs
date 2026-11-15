// Waits until PostgreSQL from DATABASE_URL (backend/.env) accepts connections (up to 60 s).
require('dotenv/config');
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
(async () => {
  for (let i = 0; i < 60; i++) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      console.log('database is ready');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error(`cannot connect to ${url.replace(/:[^:@/]+@/, ':***@')}`);
  process.exit(1);
})();
