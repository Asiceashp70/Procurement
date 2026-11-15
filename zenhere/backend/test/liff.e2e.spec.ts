import request from 'supertest';
import { buildMessages } from '../src/notifications/templates';
import { appLink, pathOfLink } from '../src/notifications/links';
import { startHarness, type Harness } from './harness';
import { ORIGIN } from './helpers';

const CHANNEL = '1234567890';
const LIFF_ID = '1234567890-AbCdEfGh';
const realFetch = global.fetch;
let h: Harness;
let verifyCalls: URLSearchParams[] = [];

/** Stands in for api.line.me: tokens "good-*" are valid for our channel, "other-channel" is for someone else's. */
function fakeLine(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://api.line.me/oauth2/v2.1/verify') {
    const body = new URLSearchParams(String(init?.body));
    verifyCalls.push(body);
    const token = body.get('id_token')!;
    if (token.startsWith('good-')) {
      return Promise.resolve(new Response(JSON.stringify({ sub: 'U' + 'c'.repeat(32), aud: body.get('client_id'), name: 'คนใน LINE', picture: 'https://profile.line-scdn.net/x' }), { status: 200 }));
    }
    if (token === 'other-channel-token-xxxxxxx') return Promise.resolve(new Response(JSON.stringify({ sub: 'U' + 'd'.repeat(32), aud: '999' }), { status: 200 }));
    return Promise.resolve(new Response('{"error":"invalid_request","error_description":"IdToken expired."}', { status: 400 }));
  }
  if (url === 'https://api.line.me/friendship/v1/status') return Promise.resolve(new Response('{"friendFlag":true}', { status: 200 }));
  return realFetch(input, init);
}

beforeAll(async () => {
  global.fetch = jest.fn(fakeLine) as typeof fetch;
  h = await startHarness({ LINE_LOGIN_CHANNEL_ID: CHANNEL, LINE_LOGIN_CHANNEL_SECRET: 'test-secret', LIFF_ID });
});
afterAll(async () => {
  global.fetch = realFetch;
  await h?.close();
});

describe('LIFF', () => {
  it('tells the web app its LIFF ID', async () => {
    const cfg = (await request(h.app.getHttpServer()).get('/api/auth/config').expect(200)).body;
    expect(cfg.liffId).toBe(LIFF_ID);
  });

  it('logs in with the LIFF ID token, verified by LINE for our channel', async () => {
    const agent = request.agent(h.app.getHttpServer());
    const r = await agent.post('/api/auth/liff').set('origin', ORIGIN).send({ idToken: 'good-token-1234567890', accessToken: 'access-1' }).expect(200);
    expect(r.body).toEqual({ ok: true, registered: false });
    expect(verifyCalls.at(-1)!.get('client_id')).toBe(CHANNEL);
    const me = (await agent.get('/api/me').expect(200)).body;
    expect(me).toMatchObject({ lineDisplayName: 'คนใน LINE', isOaFriend: true, registered: false });
  });

  it('refuses expired tokens and tokens issued to another channel', async () => {
    await request(h.app.getHttpServer()).post('/api/auth/liff').set('origin', ORIGIN).send({ idToken: 'expired-token-123456789' }).expect(401);
    await request(h.app.getHttpServer()).post('/api/auth/liff').set('origin', ORIGIN).send({ idToken: 'other-channel-token-xxxxxxx' }).expect(401);
    await request(h.app.getHttpServer()).post('/api/auth/liff').set('origin', 'https://evil.example').send({ idToken: 'good-token-1234567890' }).expect(403);
  });

  it('LINE message buttons open inside LINE through the LIFF URL', () => {
    expect(appLink('/documents/abc/sign')).toBe(`https://liff.line.me/${LIFF_ID}/documents/abc/sign`);
    expect(appLink('/')).toBe(`https://liff.line.me/${LIFF_ID}`);
    const [msg] = buildMessages('doc.sign_request', { documentId: 'abc', title: 'สัญญา', senderName: 'มาลี', dueAt: null }) as {
      contents: { footer: { contents: { action: { uri: string } }[] } };
    }[];
    expect(msg.contents.footer.contents[0].action.uri).toBe(`https://liff.line.me/${LIFF_ID}/documents/abc/sign`);
    expect(pathOfLink(`https://liff.line.me/${LIFF_ID}/documents/abc/sign`)).toBe('/documents/abc/sign');
    expect(pathOfLink(`https://liff.line.me/${LIFF_ID}`)).toBe('/');
  });
});
