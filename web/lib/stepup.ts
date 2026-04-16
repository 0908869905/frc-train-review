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
