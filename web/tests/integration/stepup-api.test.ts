import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import argon2 from 'argon2';
import { prisma } from '@/lib/db';
import { POST, GET } from '@/app/api/auth/step-up/route';
import { __setFakeSession } from '@/lib/auth-test';
import { _resetInMemoryRateLimit, stepUpCookieName, signStepUpCookie } from '@/lib/stepup';

const REVIEWER_PW = 'test-reviewer-pw';
let userId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  process.env.REVIEWER_PASSWORD_HASH = await argon2.hash(REVIEWER_PW, {
    type: argon2.argon2id,
  });
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  await prisma.auditLog.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.create({
    data: { email: 'r@test.com', role: 'final_reviewer' },
  });
  const u = await prisma.user.create({
    data: { email: 'r@test.com', name: 'R', role: 'final_reviewer' },
  });
  userId = u.id;
  __setFakeSession({ user: { id: userId, email: 'r@test.com', role: 'final_reviewer' } });
});

beforeEach(() => {
  _resetInMemoryRateLimit();
  __setFakeSession({ user: { id: userId, email: 'r@test.com', role: 'final_reviewer' } });
});

afterAll(async () => {
  __setFakeSession(null);
  await prisma.auditLog.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
});

function makeReq(body: object | null, method = 'POST', search = ''): Request {
  return new Request(`http://localhost/api/auth/step-up${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' && body !== null ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/auth/step-up', () => {
  it('401 on wrong password', async () => {
    const res = await POST(makeReq({ password: 'wrong', scope: 'reviewer' }));
    expect(res.status).toBe(401);
  });

  it('200 on correct password + sets cookie', async () => {
    const res = await POST(makeReq({ password: REVIEWER_PW, scope: 'reviewer' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/stepup_reviewer=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // Note: `Secure` is only set when NODE_ENV === 'production'. Tests run with
    // NODE_ENV=test so the attribute is intentionally absent. Production E2E
    // (Playwright against Vercel preview in Task 7.1) exercises the Secure path.
  });

  it('401 when unauthenticated', async () => {
    __setFakeSession(null);
    const res = await POST(makeReq({ password: REVIEWER_PW, scope: 'reviewer' }));
    expect(res.status).toBe(401);
  });

  it('400 on bad body', async () => {
    const res = await POST(makeReq({ scope: 'reviewer' })); // missing password
    expect(res.status).toBe(400);
  });

  it('429 on 6th failed attempt', async () => {
    for (let i = 0; i < 5; i++) {
      await POST(makeReq({ password: 'wrong', scope: 'reviewer' }));
    }
    const res = await POST(makeReq({ password: 'wrong', scope: 'reviewer' }));
    expect(res.status).toBe(429);
  });

  it('writes audit log on failure and success', async () => {
    await prisma.auditLog.deleteMany({});
    await POST(makeReq({ password: 'wrong', scope: 'reviewer' }));
    const failLog = await prisma.auditLog.findFirst({ where: { action: 'auth.stepup_failed' } });
    expect(failLog).not.toBeNull();

    await POST(makeReq({ password: REVIEWER_PW, scope: 'reviewer' }));
    const grantLog = await prisma.auditLog.findFirst({ where: { action: 'auth.stepup_granted' } });
    expect(grantLog).not.toBeNull();
  });
});

describe('GET /api/auth/step-up', () => {
  it('401 when unauthenticated', async () => {
    __setFakeSession(null);
    const req = makeReq(null, 'GET', '?scope=reviewer');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns { granted: false } when no cookie', async () => {
    const req = makeReq(null, 'GET', '?scope=reviewer');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.granted).toBe(false);
  });

  it('returns { granted: true } when cookie is valid', async () => {
    const cookie = signStepUpCookie({ userId, scope: 'reviewer' });
    const req = new Request('http://localhost/api/auth/step-up?scope=reviewer', {
      method: 'GET',
      headers: { cookie: `${stepUpCookieName('reviewer')}=${cookie}` },
    });
    const res = await GET(req);
    const data = await res.json();
    expect(data.granted).toBe(true);
  });

  it('returns { granted: false } when scope param missing', async () => {
    const req = makeReq(null, 'GET');
    const res = await GET(req);
    const data = await res.json();
    expect(data.granted).toBe(false);
  });
});
