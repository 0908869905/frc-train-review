import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import {
  GET as adminUsersGet,
  POST as adminUsersPost,
} from '@/app/api/admin/users/route';
import { POST as assignPost } from '@/app/api/batches/[id]/assign/route';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

let adminId: string;
let batchId: string;
let annotatorId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  // FK-safe cleanup
  await prisma.auditLog.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});

  await prisma.emailWhitelist.create({ data: { email: 'a@t.com', role: 'admin' } });
  const admin = await prisma.user.create({
    data: { email: 'a@t.com', name: 'A', role: 'admin' },
  });
  adminId = admin.id;

  const annotator = await prisma.user.create({
    data: { email: 'n@t.com', name: 'N', role: 'annotator' },
  });
  annotatorId = annotator.id;

  const project = await prisma.project.create({
    data: {
      name: 'Test',
      classes: [
        { idx: 0, name: 'red', color: '#f00' },
        { idx: 1, name: 'blue', color: '#00f' },
      ],
    },
  });
  const batch = await prisma.batch.create({
    data: {
      projectId: project.id,
      name: 'Batch 1',
      state: 'ready',
      uploaderId: adminId,
    },
  });
  batchId = batch.id;
  // Create one unassigned image so the assign call has a target
  await prisma.image.create({
    data: {
      batchId,
      blobPath: 'test.jpg',
      width: 640,
      height: 480,
      state: 'unassigned',
    },
  });
});

beforeEach(() => {
  __setFakeSession({ user: { id: adminId, email: 'a@t.com', role: 'admin' } });
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

function adminUsersReq(body: object, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function adminUsersGetReq(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new Request('http://localhost/api/admin/users', { headers });
}

function assignReq(body: object, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(`http://localhost/api/batches/${batchId}/assign`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/users (whitelist) requires admin step-up', () => {
  it('401 without step-up cookie', async () => {
    const res = await adminUsersPost(
      adminUsersReq({ email: 'b@t.com', role: 'annotator' }),
    );
    expect(res.status).toBe(401);
  });

  it('200 with valid admin cookie', async () => {
    const c = signStepUpCookie({ userId: adminId, scope: 'admin' });
    const res = await adminUsersPost(
      adminUsersReq(
        { email: 'b@t.com', role: 'annotator' },
        `${stepUpCookieName('admin')}=${c}`,
      ),
    );
    expect(res.status).toBe(200);
  });

  it('401 with reviewer cookie (wrong scope)', async () => {
    const c = signStepUpCookie({ userId: adminId, scope: 'reviewer' });
    const res = await adminUsersPost(
      adminUsersReq(
        { email: 'b@t.com', role: 'annotator' },
        `${stepUpCookieName('reviewer')}=${c}`,
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/users (whitelist) requires admin step-up', () => {
  it('401 without step-up cookie', async () => {
    const res = await adminUsersGet(adminUsersGetReq());
    expect(res.status).toBe(401);
  });

  it('200 with valid admin cookie', async () => {
    const c = signStepUpCookie({ userId: adminId, scope: 'admin' });
    const res = await adminUsersGet(
      adminUsersGetReq(`${stepUpCookieName('admin')}=${c}`),
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/batches/[id]/assign requires admin step-up', () => {
  it('401 without step-up cookie', async () => {
    const res = await assignPost(
      assignReq({ assignments: [{ annotatorId, count: 1 }] }),
      { params: Promise.resolve({ id: batchId }) },
    );
    expect(res.status).toBe(401);
  });

  it('200 with valid admin cookie', async () => {
    const c = signStepUpCookie({ userId: adminId, scope: 'admin' });
    const res = await assignPost(
      assignReq(
        { assignments: [{ annotatorId, count: 1 }] },
        `${stepUpCookieName('admin')}=${c}`,
      ),
      { params: Promise.resolve({ id: batchId }) },
    );
    expect(res.status).toBe(200);
  });
});
