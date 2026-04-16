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

  it('rejects cookie with tampered exp (MAC path)', () => {
    const cookie = signStepUpCookie({ userId: USER_ID, scope: 'reviewer' });
    const parts = cookie.split('.');
    parts[2] = String(Number(parts[2]) + 1000); // tamper exp, don't re-sign
    const tampered = parts.join('.');
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
