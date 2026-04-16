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
