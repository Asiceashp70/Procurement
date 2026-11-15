type Env = Record<string, string>;
interface ConfigureInput {
  mode: string;
  origin: string;
  dbUrl?: string;
  lineLoginId?: string;
  lineLoginSecret?: string;
  existing: Env;
}
// plain Node scripts (they run on the server without a build step)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configure, parseEnv, render } = require('../scripts/configure-env.cjs') as {
  configure(i: ConfigureInput): Env;
  parseEnv(text: string): Env;
  render(env: Env, mode: string): string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAdmin } = require('../scripts/super-admin.cjs') as { withAdmin(text: string, id: string): string };

describe('configure-env (server install)', () => {
  const base = { dbUrl: 'postgres://zenhere:x@127.0.0.1:5432/zenhere', existing: {} as Record<string, string> };

  it('test mode: LAN origin, demo login on, demo Super Admin, LINE Login kept for later', () => {
    const env = configure({ ...base, mode: 'test', origin: 'http://192.168.1.10', lineLoginId: '1234567890', lineLoginSecret: 's3cret' });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://192.168.1.10',
      API_BASE_URL: 'http://192.168.1.10/api',
      DEV_LOGIN_ENABLED: 'true',
      LINE_LOGIN_CHANNEL_ID: '1234567890',
      LINE_LOGIN_CHANNEL_SECRET: 's3cret',
      LINE_PUSH_ENABLED: 'false',
      SUPER_ADMIN_LINE_USER_IDS: 'U00000000000000000000000000000001',
    });
    expect(Buffer.from(env.FILE_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
  });

  it('keeps secrets on re-run and never changes the file encryption key', () => {
    const first = configure({ ...base, mode: 'test', origin: 'http://192.168.1.10' });
    const again = configure({ mode: 'test', origin: 'http://10.0.0.5', existing: parseEnv(render(first, 'test')) });
    expect(again.FILE_ENCRYPTION_KEY).toBe(first.FILE_ENCRYPTION_KEY);
    expect(again.JWT_SECRET).toBe(first.JWT_SECRET);
    expect(again.DATABASE_URL).toBe(base.dbUrl);
    expect(again.APP_ORIGIN).toBe('http://10.0.0.5');
  });

  it('production: needs https and LINE Login, turns demo login off and drops the demo admin', () => {
    const test = configure({ ...base, mode: 'test', origin: 'http://192.168.1.10', lineLoginId: '1234567890', lineLoginSecret: 's3cret' });
    const existing = parseEnv(render({ ...test, SUPER_ADMIN_LINE_USER_IDS: 'U00000000000000000000000000000001,Uaaaabbbbccccddddeeeeffff00001111' }, 'test'));
    expect(() => configure({ mode: 'production', origin: 'http://zenhere.example.co.th', existing })).toThrow(/https/);
    expect(() => configure({ ...base, mode: 'production', origin: 'https://zenhere.example.co.th' })).toThrow(/LINE Login/);
    const prod = configure({ mode: 'production', origin: 'https://zenhere.example.co.th/', existing });
    expect(prod).toMatchObject({ NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'false', APP_ORIGIN: 'https://zenhere.example.co.th', SUPER_ADMIN_LINE_USER_IDS: 'Uaaaabbbbccccddddeeeeffff00001111' });
    expect(prod.FILE_ENCRYPTION_KEY).toBe(test.FILE_ENCRYPTION_KEY);
  });

  it('rejects a bad mode or origin', () => {
    expect(() => configure({ ...base, mode: 'prod', origin: 'http://x' })).toThrow(/mode/);
    expect(() => configure({ ...base, mode: 'test', origin: '192.168.1.10' })).toThrow(/URL/);
  });
});

describe('super-admin helper', () => {
  it('adds a LINE userId once, keeping the rest of .env', () => {
    const text = 'A=1\nSUPER_ADMIN_LINE_USER_IDS=U1\nB=2\n';
    const out = withAdmin(withAdmin(text, 'U2'), 'U2');
    expect(out).toBe('A=1\nSUPER_ADMIN_LINE_USER_IDS=U1,U2\nB=2\n');
    expect(withAdmin('A=1\n', 'U9')).toBe('A=1\nSUPER_ADMIN_LINE_USER_IDS=U9\n');
  });
});
