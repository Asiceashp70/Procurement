import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makePng, nextLineId, ORIGIN, resetDatabase, TEST_DB_URL, useTestConfig } from './helpers';

useTestConfig();
// eslint-disable-next-line import/first
import { createApp } from '../src/app.factory';
import { DB, type Db } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { JobsService } from '../src/jobs/jobs.service';

export type Agent = ReturnType<typeof request.agent>;

export interface Harness {
  app: INestApplication;
  db: Db;
  jobs: JobsService;
  login(lineUserId?: string, name?: string): Promise<Agent>;
  registeredUser(first?: string, lineUserId?: string): Promise<{ agent: Agent; id: string; phone: string }>;
  post(a: Agent, url: string): request.Test;
  patch(a: Agent, url: string): request.Test;
  put(a: Agent, url: string): request.Test;
  close(): Promise<void>;
}

let phone = 891000000;

export async function startHarness(configOverrides?: Record<string, string>): Promise<Harness> {
  if (configOverrides) useTestConfig(configOverrides);
  await resetDatabase();
  await migrate(TEST_DB_URL, () => undefined);
  const app = await createApp();
  await app.init();
  const db = app.get<Db>(DB);
  const jobs = app.get(JobsService);
  const post = (a: Agent, url: string) => a.post(url).set('origin', ORIGIN);
  const login = async (lineUserId = nextLineId(), name = 'Tester') => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/dev/login').set('origin', ORIGIN).send({ lineUserId, displayName: name }).expect(200);
    return agent;
  };
  return {
    app,
    db,
    jobs,
    login,
    post,
    patch: (a, url) => a.patch(url).set('origin', ORIGIN),
    put: (a, url) => a.put(url).set('origin', ORIGIN),
    async registeredUser(first = 'สมชาย', lineUserId = nextLineId()) {
      const agent = await login(lineUserId, first);
      await post(agent, '/api/me/signatures').field('method', 'draw').attach('file', makePng(300, 120), 'sig.png').expect(201);
      const p = '0' + phone++;
      const me = await post(agent, '/api/me/register')
        .send({ firstName: first, lastName: 'ทดสอบ', phone: p, email: `u${phone}@example.com`, consentVersion: '2026-11-v1', consentAccepted: true })
        .expect(201);
      return { agent, id: me.body.id as string, phone: p };
    },
    close: () => app.close(),
  };
}
