# Three Interfaces + Step-up Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 M0–M7 平台上加三層改動：(1) 首次 Gmail 登入後強制填真實姓名；(2) 進 `/review` 與 `/admin/*` 時彈 step-up 密碼 modal（`frc6998` / `980415`）；(3) 升級 `/admin/users` 為整合 `EmailWhitelist + User` 的成員表，並把 YOLO zip 匯出下放給 `final_reviewer`。

**Architecture:** Step-up 密碼用 `argon2id` 離線雜湊成 env var（`REVIEWER_PASSWORD_HASH` / `ADMIN_PASSWORD_HASH`），通過後由 server 簽一張獨立 HMAC-signed httpOnly cookie（`stepup_reviewer` / `stepup_admin`，`Max-Age=3600`），與 Auth.js JWT 解耦、綁 userId 防 session fixation。姓名 onboarding 走新頁 `/onboarding/name`，由 Next.js 16 middleware 判斷 `User.displayNameSetAt` 是否為 null 決定重導。

**Tech Stack:** Next.js 16 App Router + React 19、Prisma 7 + Neon、Auth.js v5 (Google)、`argon2` (node-argon2)、`@upstash/ratelimit` + `@upstash/redis`（透過 Vercel Marketplace 的 Upstash Redis）、Vitest 4、Playwright 1.59、shadcn/ui + Tailwind v4。

**Spec:** `docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md`（commit `5f166bf`）

---

## 前置檢查

- 在 `D:\FRC\frc-train-review\` 根目錄。
- `web/` 工作目錄下執行 `pnpm` 指令。
- 所有 Prisma CLI 執行需 `pnpm dlx dotenv-cli -e .env -- ...`（Prisma 7 不自動載入 `.env`）。
- 每個 task 結束前 `pnpm test` + `pnpm build` 至少綠燈。

---

## P0 — 依賴安裝

### Task 0: 安裝新套件

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: 安裝 argon2 與 rate-limit 套件**

```bash
cd web
pnpm add argon2 @upstash/ratelimit @upstash/redis
```

- [ ] **Step 2: 確認 `pnpm install` 乾淨通過**

Run: `pnpm install`
Expected: No errors. `argon2` 會觸發 native build（已在 `pnpm.onlyBuiltDependencies` 白名單外，若跳警告補上：在 `package.json` 的 `pnpm.onlyBuiltDependencies` 加入 `"argon2"`）。

- [ ] **Step 3: 建置煙霧測試**

Run: `pnpm build`
Expected: build 完成無 TypeScript 錯誤。

- [ ] **Step 4: Commit**

```bash
cd D:/FRC/frc-train-review
git add web/package.json web/pnpm-lock.yaml
git commit -m "chore(web): add argon2 + upstash ratelimit deps for step-up auth"
```

---

## P1 — Schema + Auth 骨架

### Task 1.1: Prisma schema — User.displayNameSetAt

**Files:**
- Modify: `web/prisma/schema.prisma`
- Create: `web/prisma/migrations/<timestamp>_add_display_name_set_at/migration.sql`（由 prisma migrate 產生）

- [ ] **Step 1: 加欄位**

Edit `web/prisma/schema.prisma`，找 `model User` 區塊，在 `createdAt` 下方加：

```prisma
  displayNameSetAt DateTime?
```

- [ ] **Step 2: 產生 migration**

```bash
cd web
pnpm dlx dotenv-cli -e .env -- pnpm prisma migrate dev --name add_display_name_set_at
```

Expected: 產生 `migrations/<ts>_add_display_name_set_at/migration.sql` 且自動 apply。

- [ ] **Step 3: 檢查 prisma client 重新生成**

Run: `pnpm prisma generate`
Expected: 無錯誤。

- [ ] **Step 4: TypeScript 煙霧測試**

Run: `pnpm build`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/
git commit -m "feat(web): add User.displayNameSetAt for onboarding gate"
```

---

### Task 1.2: `scripts/hash-passwords.ts` — 一次性 hash 工具

**Files:**
- Create: `web/scripts/hash-passwords.ts`

- [ ] **Step 1: 實作 script**

Create `web/scripts/hash-passwords.ts`：

```typescript
import argon2 from 'argon2';

async function main() {
  const [, , ...passwords] = process.argv;
  if (passwords.length === 0) {
    console.error('Usage: tsx scripts/hash-passwords.ts <password1> [password2...]');
    process.exit(1);
  }
  for (const pw of passwords) {
    const hash = await argon2.hash(pw, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 4,
    });
    console.log(`${pw} → ${hash}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 本地跑一次產生 hash**

```bash
cd web
pnpm dlx tsx scripts/hash-passwords.ts frc6998 980415
```

Expected: 印出兩行 `$argon2id$...` 格式的 hash。**把這兩個 hash 貼進 Vercel env** 作為 `REVIEWER_PASSWORD_HASH` 與 `ADMIN_PASSWORD_HASH`（production + preview + development）。本地 `web/.env.local` 也要加一份 for local dev。

```bash
vercel env add REVIEWER_PASSWORD_HASH production
# 貼 frc6998 的 hash
vercel env add REVIEWER_PASSWORD_HASH preview
vercel env add REVIEWER_PASSWORD_HASH development
vercel env add ADMIN_PASSWORD_HASH production
# 貼 980415 的 hash
vercel env add ADMIN_PASSWORD_HASH preview
vercel env add ADMIN_PASSWORD_HASH development
vercel env pull .env.local
cp .env.local .env
```

- [ ] **Step 3: Commit script（hash 不進 repo）**

```bash
git add web/scripts/hash-passwords.ts
git commit -m "chore(web): one-shot argon2 hash generator for step-up passwords"
```

**阻塞項**：下一個 task 開始前，確定 `web/.env` 有 `REVIEWER_PASSWORD_HASH` 與 `ADMIN_PASSWORD_HASH` 兩個 env var。

---

### Task 1.3: `lib/stepup.ts` — argon2 verify + HMAC cookie helpers (TDD)

**Files:**
- Create: `web/lib/stepup.ts`
- Create: `web/tests/unit/stepup.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `web/tests/unit/stepup.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import argon2 from 'argon2';
import {
  verifyStepUpPassword,
  signStepUpCookie,
  verifyStepUpCookie,
} from '@/lib/stepup';

const TEST_PASSWORD = 'testpass123';
const USER_ID = 'user_abc';
const AUTH_SECRET = 'test-secret-min-32-chars-please';
let HASH: string;

beforeAll(async () => {
  HASH = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.REVIEWER_PASSWORD_HASH = HASH;
});

describe('verifyStepUpPassword', () => {
  it('returns true on correct password', async () => {
    await expect(verifyStepUpPassword('reviewer', TEST_PASSWORD)).resolves.toBe(
      true,
    );
  });

  it('returns false on wrong password', async () => {
    await expect(verifyStepUpPassword('reviewer', 'wrong')).resolves.toBe(false);
  });

  it('takes at least 500ms (timing attack defense)', async () => {
    const start = Date.now();
    await verifyStepUpPassword('reviewer', 'wrong');
    expect(Date.now() - start).toBeGreaterThanOrEqual(500);
  });
});

describe('signStepUpCookie / verifyStepUpCookie', () => {
  it('round-trips a valid token', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer' });
    const result = verifyStepUpCookie(cookie, { userId: USER_ID, scope: 'reviewer' });
    expect(result).toBe(true);
  });

  it('rejects tampered payload', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer' });
    const tampered = cookie.replace(USER_ID, 'user_xyz');
    expect(verifyStepUpCookie(tampered, { userId: USER_ID, scope: 'reviewer' })).toBe(false);
  });

  it('rejects mismatched userId', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer' });
    expect(verifyStepUpCookie(cookie, { userId: 'user_different', scope: 'reviewer' })).toBe(false);
  });

  it('rejects mismatched scope', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer' });
    expect(verifyStepUpCookie(cookie, { userId: USER_ID, scope: 'admin' })).toBe(false);
  });

  it('rejects expired cookie', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer', ttlSec: -1 });
    expect(verifyStepUpCookie(cookie, { userId: USER_ID, scope: 'reviewer' })).toBe(false);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/unit/stepup.test.ts`
Expected: FAIL — `lib/stepup.ts` not found。

- [ ] **Step 3: 實作 `lib/stepup.ts`**

Create `web/lib/stepup.ts`：

```typescript
import argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type StepUpScope = 'reviewer' | 'admin';

const HASH_ENV: Record<StepUpScope, string> = {
  reviewer: 'REVIEWER_PASSWORD_HASH',
  admin: 'ADMIN_PASSWORD_HASH',
};

const DEFAULT_TTL_SEC = 3600;
const MIN_VERIFY_MS = 500;

export async function verifyStepUpPassword(
  scope: StepUpScope,
  password: string,
): Promise<boolean> {
  const start = Date.now();
  const hash = process.env[HASH_ENV[scope]];
  let ok = false;
  if (hash) {
    try {
      ok = await argon2.verify(hash, password);
    } catch {
      ok = false;
    }
  } else {
    // Still run a dummy verify to keep constant time
    try {
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        password,
      );
    } catch {
      /* ignore */
    }
  }
  const elapsed = Date.now() - start;
  if (elapsed < MIN_VERIFY_MS) {
    await new Promise((r) => setTimeout(r, MIN_VERIFY_MS - elapsed));
  }
  return ok;
}

function getSecret(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not set');
  return Buffer.from(secret, 'utf8');
}

export function signStepUpCookie(opts: {
  userId: string;
  scope: StepUpScope;
  ttlSec?: number;
}): string {
  const ttl = opts.ttlSec ?? DEFAULT_TTL_SEC;
  const exp = Date.now() + ttl * 1000;
  const payload = `${opts.userId}.${opts.scope}.${exp}`;
  const mac = createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyStepUpCookie(
  cookie: string | undefined,
  expected: { userId: string; scope: StepUpScope },
): boolean {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 4) return false;
  const [userId, scope, expStr, mac] = parts;
  if (userId !== expected.userId) return false;
  if (scope !== expected.scope) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedMac = createHmac('sha256', getSecret())
    .update(`${userId}.${scope}.${expStr}`)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function stepUpCookieName(scope: StepUpScope): string {
  return `stepup_${scope}`;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/unit/stepup.test.ts`
Expected: PASS（6 個測試全綠，其中 timing 測試會跑 ~500ms）。

- [ ] **Step 5: Commit**

```bash
git add web/lib/stepup.ts web/tests/unit/stepup.test.ts
git commit -m "feat(web): stepup auth helpers — argon2 verify + HMAC cookie"
```

---

### Task 1.4: `lib/stepup.ts` — rate limit (TDD)

**Files:**
- Modify: `web/lib/stepup.ts`
- Modify: `web/tests/unit/stepup.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/tests/unit/stepup.test.ts` 末尾加：

```typescript
import { checkStepUpRateLimit, _resetInMemoryRateLimit } from '@/lib/stepup';

describe('checkStepUpRateLimit (in-memory fallback)', () => {
  const USER = 'user_rate_test';
  beforeAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });
  it('allows first 5 attempts in 60s window', async () => {
    _resetInMemoryRateLimit();
    for (let i = 0; i < 5; i++) {
      const res = await checkStepUpRateLimit(USER);
      expect(res.allowed).toBe(true);
    }
  });

  it('blocks 6th attempt', async () => {
    _resetInMemoryRateLimit();
    for (let i = 0; i < 5; i++) await checkStepUpRateLimit(USER);
    const res = await checkStepUpRateLimit(USER);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 確認新增測試失敗**

Run: `pnpm test tests/unit/stepup.test.ts`
Expected: FAIL — `checkStepUpRateLimit` not exported。

- [ ] **Step 3: 實作 rate limit**

在 `web/lib/stepup.ts` 末尾加：

```typescript
type RateState = { count: number; windowStart: number; lockedUntil?: number };
const inMemory = new Map<string, RateState>();
const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 5;
const LOCK_MS = 10 * 60_000;

export function _resetInMemoryRateLimit() {
  inMemory.clear();
}

export async function checkStepUpRateLimit(
  userId: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) {
    const { Ratelimit } = await import('@upstash/ratelimit');
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: upstashUrl, token: upstashToken });
    const lockKey = `stepup:lock:${userId}`;
    const lockTtl = await redis.ttl(lockKey);
    if (typeof lockTtl === 'number' && lockTtl > 0) {
      return { allowed: false, retryAfterSec: lockTtl };
    }
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(MAX_IN_WINDOW, '60 s'),
      prefix: 'stepup',
    });
    const res = await ratelimit.limit(userId);
    if (!res.success) {
      await redis.set(lockKey, '1', { ex: LOCK_MS / 1000, nx: true });
      return { allowed: false, retryAfterSec: LOCK_MS / 1000 };
    }
    return { allowed: true };
  }

  const now = Date.now();
  const s = inMemory.get(userId);
  if (s?.lockedUntil && now < s.lockedUntil) {
    return { allowed: false, retryAfterSec: Math.ceil((s.lockedUntil - now) / 1000) };
  }
  if (!s || now - s.windowStart > WINDOW_MS) {
    inMemory.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (s.count >= MAX_IN_WINDOW) {
    s.lockedUntil = now + LOCK_MS;
    return { allowed: false, retryAfterSec: LOCK_MS / 1000 };
  }
  s.count += 1;
  return { allowed: true };
}
```

> **Spec alignment (amended 2026-04-16):** Earlier plan draft prescribed Upstash `fixedWindow(5, '60 s')` without a separate lock key, which diverged from design spec §2.2 ("鎖 10 分鐘"). The corrected code above enforces the 10-minute lock via a second Upstash key (`stepup:lock:{userId}`, `EX 600 NX`) so production parity matches dev. Unit tests still cover only the in-memory path because mocking Upstash is out of scope; end-to-end verification happens in P7 security audit.

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/unit/stepup.test.ts`
Expected: PASS（8 個測試全綠）。

- [ ] **Step 5: Commit**

```bash
git add web/lib/stepup.ts web/tests/unit/stepup.test.ts
git commit -m "feat(web): stepup rate limit (upstash + in-memory fallback)"
```

---

### Task 1.5: `/api/auth/step-up` API route (TDD integration)

**Files:**
- Create: `web/app/api/auth/step-up/route.ts`
- Create: `web/tests/integration/stepup-api.test.ts`

- [ ] **Step 1: 寫失敗整合測試**

Create `web/tests/integration/stepup-api.test.ts`：

```typescript
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
    expect(setCookie).toContain('stepup_reviewer=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toMatch(/SameSite=Lax/i);
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
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/integration/stepup-api.test.ts`
Expected: FAIL — route not found。

- [ ] **Step 3: 實作 route handler**

Create `web/app/api/auth/step-up/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import {
  verifyStepUpPassword,
  checkStepUpRateLimit,
  signStepUpCookie,
  verifyStepUpCookie,
  stepUpCookieName,
  type StepUpScope,
} from '@/lib/stepup';
import { writeAudit } from '@/lib/audit';

const postBody = z.object({
  password: z.string().min(1).max(256),
  scope: z.enum(['reviewer', 'admin']),
});

export async function POST(req: NextRequest | Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = postBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { password, scope } = parsed.data;

  const rate = await checkStepUpRateLimit(session.user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: rate.retryAfterSec },
      { status: 429 },
    );
  }

  const ok = await verifyStepUpPassword(scope as StepUpScope, password);
  if (!ok) {
    await writeAudit(session.user.id, 'auth.stepup_failed', 'stepup', scope, {});
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 });
  }

  const cookie = signStepUpCookie({
    userId: session.user.id,
    scope: scope as StepUpScope,
  });
  await writeAudit(session.user.id, 'auth.stepup_granted', 'stepup', scope, {});
  const res = NextResponse.json({ granted: true });
  res.cookies.set(stepUpCookieName(scope as StepUpScope), cookie, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  });
  return res;
}

export async function GET(req: NextRequest | Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ granted: false });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope');
  if (scope !== 'reviewer' && scope !== 'admin') {
    return NextResponse.json({ granted: false });
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${stepUpCookieName(scope)}=`));
  const value = match?.slice(match.indexOf('=') + 1);
  const granted = verifyStepUpCookie(value, {
    userId: session.user.id,
    scope,
  });
  return NextResponse.json({ granted });
}
```

> **Plan amendments (2026-04-16):**
> - `writeAudit` uses positional args per existing `lib/audit.ts` signature (object-arg form in earlier draft would not compile).
> - Tests use `__setFakeSession` directly per repo convention (`withTestSession` helper does not exist and creating it would diverge from existing integration tests in `tests/integration/`). Added 4 branch-coverage tests (401 unauth, 400 bad body, audit log check, GET happy/sad) to match the rigor applied to `lib/stepup.ts` tests.

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/integration/stepup-api.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/app/api/auth/step-up/ web/tests/integration/stepup-api.test.ts docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md
git commit -m "feat(web): /api/auth/step-up POST+GET with audit + rate limit"
```

---

### Task 1.6: `lib/rbac.ts` — `requireStepUp` helper (TDD)

**Files:**
- Modify: `web/lib/rbac.ts`
- Modify: `web/tests/unit/rbac.test.ts`（若存在）或 Create 新檔 `web/tests/unit/rbac-stepup.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `web/tests/unit/rbac-stepup.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { requireStepUp } from '@/lib/rbac';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
});

function makeReq(cookie?: string): Request {
  return new Request('http://localhost/x', {
    headers: cookie ? { cookie } : {},
  });
}

describe('requireStepUp', () => {
  it('throws when no session', () => {
    expect(() =>
      requireStepUp(null, 'reviewer', makeReq()),
    ).toThrow(/unauthorized/i);
  });

  it('throws when cookie missing', () => {
    const session = { user: { id: 'u1', role: 'final_reviewer' as const } };
    expect(() =>
      requireStepUp(session as any, 'reviewer', makeReq()),
    ).toThrow(/step.up/i);
  });

  it('throws when cookie for wrong scope', () => {
    const c = signStepUpCookie({ userId: 'u1', scope: 'admin' });
    const session = { user: { id: 'u1', role: 'admin' as const } };
    expect(() =>
      requireStepUp(
        session as any,
        'reviewer',
        makeReq(`${stepUpCookieName('admin')}=${c}`),
      ),
    ).toThrow(/step.up/i);
  });

  it('passes when cookie valid for scope', () => {
    const c = signStepUpCookie({ userId: 'u1', scope: 'reviewer' });
    const session = { user: { id: 'u1', role: 'final_reviewer' as const } };
    expect(() =>
      requireStepUp(
        session as any,
        'reviewer',
        makeReq(`${stepUpCookieName('reviewer')}=${c}`),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/unit/rbac-stepup.test.ts`
Expected: FAIL — `requireStepUp` not exported。

- [ ] **Step 3: 實作 helper**

在 `web/lib/rbac.ts` 末尾加：

```typescript
import { verifyStepUpCookie, stepUpCookieName, type StepUpScope } from '@/lib/stepup';
import type { Session } from 'next-auth';

export class StepUpRequiredError extends Error {
  constructor(public scope: StepUpScope) {
    super(`step-up required for scope=${scope}`);
  }
}

export function requireStepUp(
  session: Session | null,
  scope: StepUpScope,
  request: Request,
): void {
  if (!session?.user?.id) {
    throw new Error('unauthorized');
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${stepUpCookieName(scope)}=`));
  const value = match?.slice(match.indexOf('=') + 1);
  const ok = verifyStepUpCookie(value, {
    userId: session.user.id,
    scope,
  });
  if (!ok) throw new StepUpRequiredError(scope);
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/unit/rbac-stepup.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/lib/rbac.ts web/tests/unit/rbac-stepup.test.ts
git commit -m "feat(web): rbac requireStepUp(session, scope, request)"
```

---

## P2 — Name Onboarding

### Task 2.1: `/api/me/display-name` PATCH (TDD integration)

**Files:**
- Create: `web/app/api/me/display-name/route.ts`
- Create: `web/tests/integration/display-name-api.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/me/display-name/route';
import { withTestSession } from '@/lib/auth-test';

let userId: string;

beforeAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.create({
    data: { email: 'a@test.com', role: 'annotator' },
  });
  const u = await prisma.user.create({
    data: { email: 'a@test.com', name: null, role: 'annotator' },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
});

function req(body: object) {
  return new Request('http://localhost/api/me/display-name', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/me/display-name', () => {
  it('rejects empty name', async () => {
    const res = await withTestSession(
      { userId, role: 'annotator', email: 'a@test.com' },
      async () => PATCH(req({ name: '' })),
    );
    expect(res.status).toBe(400);
  });

  it('rejects overly long name', async () => {
    const res = await withTestSession(
      { userId, role: 'annotator', email: 'a@test.com' },
      async () => PATCH(req({ name: 'x'.repeat(200) })),
    );
    expect(res.status).toBe(400);
  });

  it('updates name and stamps displayNameSetAt', async () => {
    const res = await withTestSession(
      { userId, role: 'annotator', email: 'a@test.com' },
      async () => PATCH(req({ name: '張小明' })),
    );
    expect(res.status).toBe(200);
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.name).toBe('張小明');
    expect(u?.displayNameSetAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.display_name_set', actorId: userId },
    });
    expect(audit).not.toBeNull();
  });
});
```

- [ ] **Step 2: 確認失敗**

Run: `pnpm test tests/integration/display-name-api.test.ts`
Expected: FAIL — route not found。

- [ ] **Step 3: 實作**

Create `web/app/api/me/display-name/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const body = z.object({
  name: z.string().trim().min(1).max(64),
});

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name, displayNameSetAt: new Date() },
  });
  await writeAudit({
    actorId: session.user.id,
    action: 'user.display_name_set',
    targetType: 'user',
    targetId: session.user.id,
    payload: { name: parsed.data.name },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 確認通過**

Run: `pnpm test tests/integration/display-name-api.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/app/api/me/display-name/ web/tests/integration/display-name-api.test.ts
git commit -m "feat(web): PATCH /api/me/display-name with audit"
```

---

### Task 2.2: `/onboarding/name` page + form

**Files:**
- Create: `web/app/(protected)/onboarding/name/page.tsx`
- Create: `web/app/(protected)/onboarding/name/name-form.tsx`

注：此 task 的視覺實作先走「預留版面」（純表單），Gemini 出的視覺稿會在 P6 套上；但先讓功能跑起來。

- [ ] **Step 1: Server component page**

Create `web/app/(protected)/onboarding/name/page.tsx`：

```typescript
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { NameForm } from './name-form';

export default async function OnboardingNamePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect('/login');
  const { edit } = await searchParams;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, displayNameSetAt: true },
  });
  if (!edit && u?.displayNameSetAt) redirect('/');
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold mb-2">請輸入您的姓名</h1>
      <p className="text-sm text-neutral-500 mb-6">
        這個姓名會出現在 audit log、指派列表、審核紀錄中。
      </p>
      <NameForm initial={u?.name ?? ''} isEdit={!!edit} />
    </main>
  );
}
```

- [ ] **Step 2: Client form**

Create `web/app/(protected)/onboarding/name/name-form.tsx`：

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NameForm({ initial, isEdit }: { initial: string; isEdit: boolean }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const res = await fetch('/api/me/display-name', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr('儲存失敗，請稍後再試');
      return;
    }
    router.push(isEdit ? '/' : '/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={64}
        required
        autoFocus
        placeholder="例：張小明"
      />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={saving || name.trim().length === 0}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: 手動驗證**

Run: `pnpm dev`
開 `http://localhost:3000/onboarding/name` 確認頁面渲染、提交後導回 `/`，`User.displayNameSetAt` 被寫入。

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/onboarding/
git commit -m "feat(web): onboarding name form (functional placeholder pre-visual)"
```

---

### Task 2.3: `proxy.ts` — 未填姓名者自動重導 onboarding

> ⚠️ **依賴**：本 task 邏輯需要 session 已有 `displayNameSetAt` 欄位，該欄位由 Task 2.4 的 JWT claim 加入。**建議執行順序：先 2.4 再 2.3**（或兩 task 同一個 session 一起做、合併成一個 commit）。

**Files:**
- Modify: `web/proxy.ts`

- [ ] **Step 1: 在 proxy.ts 加判斷**

查 `web/proxy.ts`，找 auth check 之後的區塊。加上：

```typescript
// 已登入但未完成 onboarding → 導去 /onboarding/name
if (
  session?.user?.id &&
  !['/onboarding/name', '/api'].some((p) => req.nextUrl.pathname.startsWith(p))
) {
  // 需查 DB：displayNameSetAt 是否為 null
  // 由於 middleware 跑在 edge，不能用 Prisma → 改走 JWT claim
  if (session.user.displayNameSetAt == null) {
    return NextResponse.redirect(new URL('/onboarding/name', req.url));
  }
}
```

注意：middleware 在 edge runtime，**不能直接 import prisma**。需要在 `auth.ts` 的 jwt callback 把 `displayNameSetAt` 讀進 token（見 Task 2.4）。

- [ ] **Step 2: 確認 proxy.ts 邏輯（暫先 skip test，等 2.4 整併）**

- [ ] **Step 3: Commit（本 task 僅 scaffolding，真正生效要 2.4 完成）**

```bash
git add web/proxy.ts
git commit -m "chore(web): proxy onboarding redirect scaffolding (needs JWT claim)"
```

---

### Task 2.4: `lib/auth.ts` — jwt claim 帶 displayNameSetAt

**Files:**
- Modify: `web/lib/auth.ts`
- Modify: `web/types/next-auth.d.ts`（若無則建立）

- [ ] **Step 1: 擴充 type**

Check if `web/types/next-auth.d.ts` exists. If not, create:

```typescript
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role: 'admin' | 'annotator' | 'final_reviewer';
      displayNameSetAt: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    role?: 'admin' | 'annotator' | 'final_reviewer';
    displayNameSetAt?: string | null;
  }
}
```

- [ ] **Step 2: 修 auth.ts jwt + session callback**

Edit `web/lib/auth.ts`：

```typescript
async jwt({ token }) {
  if (token.email) {
    const u = await prisma.user.findUnique({ where: { email: token.email } });
    if (u && u.isActive) {
      token.role = u.role;
      token.userId = u.id;
      token.displayNameSetAt = u.displayNameSetAt?.toISOString() ?? null;
    } else {
      return {};
    }
  }
  return token;
},
async session({ session, token }) {
  if (token.userId && token.role) {
    session.user.id = token.userId as string;
    session.user.role = token.role as 'admin' | 'annotator' | 'final_reviewer';
    session.user.displayNameSetAt = (token.displayNameSetAt as string | null) ?? null;
  }
  return session;
},
```

- [ ] **Step 3: 手動驗證 onboarding redirect**

Run: `pnpm dev`
清資料庫 `User.displayNameSetAt`（Prisma studio 或 SQL），登入 → 應自動被導到 `/onboarding/name`。填名後應導回 `/`。

- [ ] **Step 4: TypeScript build 驗證**

Run: `pnpm build`
Expected: no type errors。

- [ ] **Step 5: Commit**

```bash
git add web/lib/auth.ts web/types/next-auth.d.ts
git commit -m "feat(web): jwt claim displayNameSetAt drives onboarding redirect"
```

---

## P3 — Step-up UI

### Task 3.1: `StepUpDialog` component

**Files:**
- Create: `web/components/step-up-dialog.tsx`

- [ ] **Step 1: 建立 dialog（shadcn Dialog）**

Create `web/components/step-up-dialog.tsx`：

```typescript
'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function StepUpDialog({
  open,
  scope,
  onGranted,
}: {
  open: boolean;
  scope: 'reviewer' | 'admin';
  onGranted: () => void;
}) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const res = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw, scope }),
    });
    setLoading(false);
    if (res.status === 200) {
      setPw('');
      onGranted();
      return;
    }
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      setLockedUntil(Date.now() + (j.retryAfter ?? 600) * 1000);
      setErr('嘗試次數過多，請稍後再試。');
      return;
    }
    setErr('密碼錯誤');
  }

  const locked = lockedUntil !== null && Date.now() < lockedUntil;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>需要進一步驗證</DialogTitle>
          <DialogDescription>
            {scope === 'reviewer' ? '請輸入覆核者密碼' : '請輸入管理員密碼'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={locked}
            autoFocus
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={loading || locked || pw.length === 0}
            className="w-full rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? '驗證中…' : '確認'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/step-up-dialog.tsx
git commit -m "feat(web): step-up password dialog component"
```

---

### Task 3.2: `StepUpGuard` wrapper

**Files:**
- Create: `web/components/step-up-guard.tsx`

- [ ] **Step 1: 實作 wrapper**

Create `web/components/step-up-guard.tsx`：

```typescript
'use client';
import { useEffect, useState } from 'react';
import { StepUpDialog } from './step-up-dialog';

export function StepUpGuard({
  scope,
  children,
}: {
  scope: 'reviewer' | 'admin';
  children: React.ReactNode;
}) {
  const [state, setState] = useState<'checking' | 'granted' | 'required'>('checking');

  async function check() {
    const res = await fetch(`/api/auth/step-up?scope=${scope}`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({ granted: false }));
    setState(j.granted ? 'granted' : 'required');
  }

  useEffect(() => {
    check();
  }, [scope]);

  if (state === 'checking') {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }
  if (state === 'granted') {
    return <>{children}</>;
  }
  return (
    <>
      <div className="p-8 text-sm text-neutral-500">Verifying access…</div>
      <StepUpDialog open scope={scope} onGranted={() => setState('granted')} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/step-up-guard.tsx
git commit -m "feat(web): StepUpGuard client wrapper"
```

---

### Task 3.3: 把 guard 裝上 `/review` layout

**Files:**
- Create / Modify: `web/app/(protected)/review/layout.tsx`

- [ ] **Step 1: 確認 layout 是否存在**

```bash
ls web/app/\(protected\)/review/
```

若沒有 `layout.tsx` 就建立；若已有就改。

- [ ] **Step 2: 實作**

Create / edit `web/app/(protected)/review/layout.tsx`：

```typescript
import { StepUpGuard } from '@/components/step-up-guard';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <StepUpGuard scope="reviewer">{children}</StepUpGuard>;
}
```

- [ ] **Step 3: 手動驗證**

Run: `pnpm dev`
登入為 `final_reviewer` → 訪 `/review` → 應彈密碼 modal → 輸入錯的 → 失敗訊息 → 輸入 `frc6998` → 看到 review 頁面。

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/review/layout.tsx
git commit -m "feat(web): mount StepUpGuard on /review"
```

---

### Task 3.4: 把 guard 裝上 `/admin` layout

**Files:**
- Create: `web/app/(protected)/admin/layout.tsx`

- [ ] **Step 1: 實作**

```typescript
import { StepUpGuard } from '@/components/step-up-guard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StepUpGuard scope="admin">{children}</StepUpGuard>;
}
```

- [ ] **Step 2: 手動驗證（admin role 進 `/admin/users` 應彈 modal）**

- [ ] **Step 3: Commit**

```bash
git add web/app/\(protected\)/admin/layout.tsx
git commit -m "feat(web): mount StepUpGuard on /admin/*"
```

---

## P4 — Admin 成員表

### Task 4.1: `/admin/members` 頁面

**Files:**
- Create: `web/app/(protected)/admin/members/page.tsx`
- Create: `web/app/(protected)/admin/members/members-actions.tsx`

- [ ] **Step 1: Server component page**

```typescript
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { MembersActions } from './members-actions';

export default async function MembersPage() {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');

  const whitelist = await prisma.emailWhitelist.findMany({
    orderBy: { addedAt: 'asc' },
  });
  const users = await prisma.user.findMany();
  const usersByEmail = new Map(users.map((u) => [u.email, u]));

  const rows = whitelist.map((w) => {
    const u = usersByEmail.get(w.email);
    return {
      email: w.email,
      role: w.role,
      addedAt: w.addedAt,
      name: u?.name ?? null,
      isActive: u?.isActive ?? null,
      hasLoggedIn: Boolean(u),
    };
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">成員</h1>
      <MembersActions />
      <table className="w-full mt-6 text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2 font-medium">Email</th>
            <th className="font-medium">姓名</th>
            <th className="font-medium">Role</th>
            <th className="font-medium">加入日</th>
            <th className="font-medium">狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email} className="border-t">
              <td className="py-2">{r.email}</td>
              <td>{r.name ?? <span className="text-neutral-400">（未登入）</span>}</td>
              <td>{r.role}</td>
              <td>{r.addedAt.toISOString().slice(0, 10)}</td>
              <td>
                {!r.hasLoggedIn
                  ? '未登入'
                  : r.isActive
                  ? '啟用'
                  : '停用'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: 客戶端 actions（新增成員 dialog，複用 add-user-form 邏輯）**

Create `web/app/(protected)/admin/members/members-actions.tsx`：

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MembersActions() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'annotator' | 'final_reviewer' | 'admin'>('annotator');
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setOpen(false);
      setEmail('');
      router.refresh();
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
      >
        新增成員
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="mt-4 flex items-center gap-2 rounded border border-neutral-200 p-3"
        >
          <input
            type="email"
            required
            placeholder="gmail@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as 'annotator' | 'final_reviewer' | 'admin')
            }
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="annotator">annotator</option>
            <option value="final_reviewer">final_reviewer</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            加入
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-neutral-500"
          >
            取消
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 手動驗證**

`pnpm dev` → `/admin/members` 能看到所有白名單 + 登入過的人姓名/狀態。新增成員能寫入 whitelist。

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/admin/members/
git commit -m "feat(web): unified /admin/members table (whitelist + user join)"
```

---

### Task 4.2: `/admin/users` → redirect `/admin/members`

**Files:**
- Modify: `web/app/(protected)/admin/users/page.tsx`

- [ ] **Step 1: 改 page 為 redirect**

```typescript
import { redirect } from 'next/navigation';
export default function OldUsersPage(): never {
  redirect('/admin/members');
}
```

- [ ] **Step 2: 刪除舊 add-user-form.tsx（若已併入 members-actions）**

```bash
rm web/app/\(protected\)/admin/users/add-user-form.tsx
```

若 `/api/admin/whitelist` 有被舊頁面專屬呼叫的路徑，保留 API 不動。

- [ ] **Step 3: 手動驗證**

`/admin/users` 自動導向 `/admin/members`。

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/admin/users/
git commit -m "refactor(web): redirect /admin/users → /admin/members"
```

---

### Task 4.3: API step-up 保護：whitelist + assign (TDD integration)

**Files:**
- Modify: `web/app/api/admin/whitelist/route.ts`（或對應 admin API 路徑，用 grep 確認）
- Modify: `web/app/api/batches/[id]/assign/route.ts`
- Create: `web/tests/integration/admin-api-stepup.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `web/tests/integration/admin-api-stepup.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as whitelistPost } from '@/app/api/admin/whitelist/route';
import { withTestSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

let adminId: string;
beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  await prisma.auditLog.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.create({ data: { email: 'a@t.com', role: 'admin' } });
  const u = await prisma.user.create({
    data: { email: 'a@t.com', name: 'A', role: 'admin' },
  });
  adminId = u.id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
});

function withCookie(body: object, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request('http://localhost/api/admin/whitelist', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('whitelist POST requires admin step-up', () => {
  it('403 without cookie', async () => {
    const res = await withTestSession(
      { userId: adminId, role: 'admin', email: 'a@t.com' },
      async () => whitelistPost(withCookie({ email: 'b@t.com', role: 'annotator' })),
    );
    expect(res.status).toBe(403);
  });

  it('200 with valid cookie', async () => {
    const c = signStepUpCookie({ userId: adminId, scope: 'admin' });
    const res = await withTestSession(
      { userId: adminId, role: 'admin', email: 'a@t.com' },
      async () =>
        whitelistPost(
          withCookie(
            { email: 'b@t.com', role: 'annotator' },
            `${stepUpCookieName('admin')}=${c}`,
          ),
        ),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/integration/admin-api-stepup.test.ts`
Expected: FAIL — 目前 whitelist POST 不檢查 step-up。

- [ ] **Step 3: 在 API 加 `requireStepUp`**

改 `web/app/api/admin/whitelist/route.ts` 的 POST：

```typescript
import { requireStepUp, StepUpRequiredError } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  try {
    requireStepUp(session, 'admin', req);
  } catch (e) {
    if (e instanceof StepUpRequiredError) {
      return NextResponse.json({ error: 'step_up_required', scope: e.scope }, { status: 403 });
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // ... existing logic
}
```

同樣處理 `PATCH`、`DELETE` 與 `web/app/api/batches/[id]/assign/route.ts`。

- [ ] **Step 4: 確認測試通過 + 其他測試不爆**

Run: `pnpm test`
Expected: 所有測試通過。**如果既有的 assign integration test 失敗**，把它的 fixture 加上 step-up cookie。

- [ ] **Step 5: Commit**

```bash
git add web/app/api/admin/ web/app/api/batches/ web/tests/integration/admin-api-stepup.test.ts
git commit -m "feat(web): admin APIs require step-up cookie"
```

---

## P5 — Reviewer 匯出

### Task 5.1: Export API 放寬 role + requireStepUp(reviewer) (TDD integration)

**Files:**
- Modify: `web/app/api/batches/[id]/export/route.ts`
- Create: `web/tests/integration/export-stepup.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `web/tests/integration/export-stepup.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/batches/[id]/export/route';
import { withTestSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

let reviewerId: string;
let batchId: string;
let projectId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  await prisma.auditLog.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.create({ data: { email: 'r@t.com', role: 'final_reviewer' } });
  const u = await prisma.user.create({
    data: { email: 'r@t.com', name: 'R', role: 'final_reviewer' },
  });
  reviewerId = u.id;
  const p = await prisma.project.create({
    data: { name: 'P', classes: [{ idx: 0, name: 'c', color: '#000' }] },
  });
  projectId = p.id;
  const b = await prisma.batch.create({
    data: {
      projectId,
      uploaderId: reviewerId,
      name: 'B',
      state: 'completed',
    },
  });
  batchId = b.id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
});

function withCookie(cookie?: string): Request {
  return new Request(`http://localhost/api/batches/${batchId}/export`, {
    headers: cookie ? { cookie } : {},
  });
}

describe('export requires reviewer step-up', () => {
  it('403 without cookie even as final_reviewer', async () => {
    const res = await withTestSession(
      { userId: reviewerId, role: 'final_reviewer', email: 'r@t.com' },
      async () => GET(withCookie(), { params: Promise.resolve({ id: batchId }) }),
    );
    expect(res.status).toBe(403);
  });

  it('200 with cookie as final_reviewer', async () => {
    const c = signStepUpCookie({ userId: reviewerId, scope: 'reviewer' });
    const res = await withTestSession(
      { userId: reviewerId, role: 'final_reviewer', email: 'r@t.com' },
      async () =>
        GET(withCookie(`${stepUpCookieName('reviewer')}=${c}`), {
          params: Promise.resolve({ id: batchId }),
        }),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 確認失敗**

Run: `pnpm test tests/integration/export-stepup.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改 export route — 放寬 role + requireStepUp**

Edit `web/app/api/batches/[id]/export/route.ts`：

找原本的 role check，改為：

```typescript
import { requireStepUp, StepUpRequiredError } from '@/lib/rbac';

// ... GET handler
const session = await getSession();
const role = session?.user.role;
if (role !== 'admin' && role !== 'final_reviewer') {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
try {
  requireStepUp(session, 'reviewer', req);
} catch (e) {
  if (e instanceof StepUpRequiredError) {
    return NextResponse.json({ error: 'step_up_required', scope: 'reviewer' }, { status: 403 });
  }
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
// ... rest
```

- [ ] **Step 4: 確認所有測試通過**

Run: `pnpm test`
Expected: PASS（包括既有 export 測試 — 若原測試沒帶 cookie，補一個 valid cookie）。

- [ ] **Step 5: Commit**

```bash
git add web/app/api/batches/ web/tests/integration/export-stepup.test.ts
git commit -m "feat(web): export allows final_reviewer + requires reviewer step-up"
```

---

### Task 5.2: `/review` 新增「已完成 batch — 可匯出」區塊

**Files:**
- Modify: `web/app/(protected)/review/page.tsx`（或對應頁面）
- Create: `web/app/(protected)/review/completed-batches.tsx`

- [ ] **Step 1: server component 抓資料**

在 `web/app/(protected)/review/page.tsx` 的 server component 加：

```typescript
const completed = await prisma.batch.findMany({
  where: { state: 'completed' },
  include: {
    project: { select: { id: true, name: true } },
    _count: { select: { images: { where: { state: 'approved' } } } },
  },
  orderBy: { createdAt: 'desc' },
  take: 20,
});
```

- [ ] **Step 2: 渲染 card list**

Create `web/app/(protected)/review/completed-batches.tsx`：

```typescript
'use client';

export function CompletedBatches({
  items,
}: {
  items: { id: string; name: string; projectName: string; approvedCount: number }[];
}) {
  async function download(id: string) {
    window.location.href = `/api/batches/${id}/export`;
  }
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">目前無已完成 batch。</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {items.map((b) => (
        <li key={b.id} className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">{b.name}</div>
            <div className="text-xs text-neutral-500">
              {b.projectName} · {b.approvedCount} approved
            </div>
          </div>
          <button
            onClick={() => download(b.id)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            下載 zip
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: 在 review page 末尾掛上**

```tsx
<section className="mt-10">
  <h2 className="text-lg font-semibold mb-4">已完成 batch — 可匯出</h2>
  <CompletedBatches
    items={completed.map((b) => ({
      id: b.id,
      name: b.name,
      projectName: b.project.name,
      approvedCount: b._count.images,
    }))}
  />
</section>
```

- [ ] **Step 4: 手動驗證（需 step-up 通過才能下載）**

`pnpm dev` → 以 reviewer 登入 → 輸入 step-up 密碼 → 看到 completed batch → 按下載 → zip 下載成功。

- [ ] **Step 5: Commit**

```bash
git add web/app/\(protected\)/review/
git commit -m "feat(web): reviewer can export completed batches from /review"
```

---

## P6 — Gemini 視覺套版

### Task 6.1: 產生 Gemini 視覺 brief + 呼叫 4 個設計稿

**Files:**
- Create: `docs/design/2026-04-16-three-interfaces/brief.md`
- Create: `docs/design/2026-04-16-three-interfaces/N1-onboarding-name.md`
- Create: `docs/design/2026-04-16-three-interfaces/N2-stepup-dialog.md`
- Create: `docs/design/2026-04-16-three-interfaces/N3-admin-members.md`
- Create: `docs/design/2026-04-16-three-interfaces/N4-review-export.md`

- [ ] **Step 1: 寫 brief**

Create `docs/design/2026-04-16-three-interfaces/brief.md`：

```markdown
# Three Interfaces — Visual Brief（給 Gemini）

## 風格約束（硬性）
- 極簡密度風（Linear / Vercel / Basecamp 參考）
- 中性灰階 palette：背景 white / neutral-50；文字 neutral-900 / neutral-500；邊 neutral-200 / neutral-300
- **禁止**：紫藍漸層、sparkle icon、emoji、rounded-xl 大卡片、浮誇陰影、AI-powered 字眼
- Radius：`rounded` or `rounded-md` 為主，不超過 `rounded-lg`
- Primary CTA 用純黑 `bg-neutral-900 text-white`，不放顏色重點

## 需要設計的畫面
1. N1 — `/onboarding/name`：首次填姓名
2. N2 — Step-up 密碼 modal
3. N3 — `/admin/members`：整合表
4. N4 — `/review` 新增的「已完成 batch」區塊

## 對每個畫面請輸出
- ASCII wireframe（含尺寸比例）
- Tailwind class 草案（複用 shadcn/ui: Dialog / Button / Table / Input）
- 三態：default / loading / error
- 一句話：為什麼這個設計最符合上面風格約束
```

- [ ] **Step 2: 對每個畫面呼叫 `/gemini`**

Run（對每個畫面分別執行）：

```bash
# 在 Claude Code session 內輸入以下 slash command：
/gemini 請根據 docs/design/2026-04-16-three-interfaces/brief.md 的風格約束，為 N1 onboarding/name 畫面輸出 ASCII wireframe + Tailwind 草案 + default/loading/error 三態
```

Gemini 回來後把結果分別存到 `N1-...md`、`N2-...md`、`N3-...md`、`N4-...md`。

- [ ] **Step 3: Commit brief + 4 份設計稿**

```bash
git add docs/design/
git commit -m "docs: gemini visual specs for three interfaces (N1-N4)"
```

---

### Task 6.2–6.5: 套版（每個畫面一個 commit）

對 N1–N4 四個畫面，依據 Gemini 產出的視覺稿替換 P2/P3/P4/P5 寫的 placeholder markup。

**Step pattern per screen:**
1. 讀 `docs/design/2026-04-16-three-interfaces/N*.md`
2. 對應的 `.tsx` 檔改 markup（保留 form logic、event handler、data shape）
3. `pnpm dev` 手動對比視覺稿
4. Commit `style(web): apply gemini visual to <screen>`

每個 task 的 files：
- **Task 6.2 (N1)**：`web/app/(protected)/onboarding/name/name-form.tsx` + `page.tsx`
- **Task 6.3 (N2)**：`web/components/step-up-dialog.tsx`
- **Task 6.4 (N3)**：`web/app/(protected)/admin/members/page.tsx` + `members-actions.tsx`
- **Task 6.5 (N4)**：`web/app/(protected)/review/completed-batches.tsx`

每個 task 分別 commit。

---

## P7 — E2E + 安全審查

### Task 7.1: Playwright — step-up reviewer flow

**Files:**
- Create: `web/tests/e2e/step-up-reviewer.spec.ts`

- [ ] **Step 1: 寫 spec**

```typescript
import { test, expect } from '@playwright/test';

test('reviewer can enter /review after step-up', async ({ page, context }) => {
  // 使用 test-only auth bypass cookie（看現有 login-renders.spec 怎麼做）
  await page.goto('/');
  // ... test-only sign-in

  await page.goto('/review');
  await expect(page.getByText('需要進一步驗證')).toBeVisible();
  await page.getByLabel(/密碼|password/i).fill('frc6998');
  await page.getByRole('button', { name: /確認/i }).click();
  await expect(page.getByRole('heading', { name: /review/i })).toBeVisible();
});
```

（實際 selector 依 Gemini N2 稿調整）

- [ ] **Step 2: 跑 E2E**

```bash
pnpm dlx playwright test tests/e2e/step-up-reviewer.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add web/tests/e2e/step-up-reviewer.spec.ts
git commit -m "test(web): e2e step-up flow for reviewer"
```

---

### Task 7.2: Playwright — onboarding flow

**Files:**
- Create: `web/tests/e2e/onboarding-name.spec.ts`

- [ ] **Step 1: 寫 spec（模擬新使用者 displayNameSetAt=null）**

```typescript
import { test, expect } from '@playwright/test';

test('new user redirected to /onboarding/name', async ({ page }) => {
  // test-only sign-in with user whose displayNameSetAt is null
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding\/name$/);
  await page.getByPlaceholder('例：張小明').fill('測試員');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page).toHaveURL('/');
});
```

- [ ] **Step 2: 跑 E2E**

- [ ] **Step 3: Commit**

```bash
git add web/tests/e2e/onboarding-name.spec.ts
git commit -m "test(web): e2e onboarding name flow"
```

---

### Task 7.3: Security audit

**Files:**
- None — 只是檢查

- [ ] **Step 1: Grep 密碼明文是否外洩**

```bash
cd web
grep -r "frc6998\|980415" app/ lib/ components/ --exclude-dir=node_modules
```

Expected: **零匹配**。

- [ ] **Step 2: Grep 確認不回傳 hash**

```bash
grep -r "REVIEWER_PASSWORD_HASH\|ADMIN_PASSWORD_HASH" app/ lib/ --exclude-dir=node_modules
```

Expected: 只出現在 `lib/stepup.ts`（讀 env）與 `scripts/hash-passwords.ts`，**沒有在 API response 層**。

- [ ] **Step 3: 派遣 superpowers:code-reviewer agent**

用 Agent 工具呼叫 `superpowers:code-reviewer`，提供 diff 範圍：

```
prompt: "Review the three-interfaces step-up auth implementation. Spec: docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md. Plan: docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md. Focus on: (1) HMAC cookie — is the signing format binding userId+scope+exp correctly and is verification time-constant? (2) argon2 verify — constant time 500ms holds on success path too? (3) rate-limit in-memory fallback — does it leak between users? (4) audit log — does it accidentally store the attempted password? (5) any route missing requireStepUp? Report findings."
```

- [ ] **Step 4: 修復 reviewer 提出的 P0/P1 問題、合併**

每個 finding 一個 commit：`fix(web): address <finding> from step-up review`

- [ ] **Step 5: 全測試最後一次通過**

```bash
cd web
pnpm test && pnpm build && pnpm dlx playwright test
```

Expected: 全綠。

- [ ] **Step 6: Final commit（若有的話）**

---

## Wrap-up

- [ ] 更新 `PROGRESS.md` 記錄本次 session。
- [ ] 檢查 Vercel production env 有三個新 env var（`REVIEWER_PASSWORD_HASH`、`ADMIN_PASSWORD_HASH`、選配 `UPSTASH_REDIS_REST_*`）。
- [ ] 如果 production 未配置 Upstash Redis：在 Vercel marketplace 連一個 Upstash Redis instance，把兩個 env var 加到 Production。
- [ ] Push：`git push origin master`（Vercel 會自動部署）。
- [ ] 用正式帳號登入一次 production，實測 3 個介面、3 種 role 的 happy path。
