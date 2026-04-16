import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const publicPaths = ['/login', '/api/auth'];
  if (publicPaths.some((p) => pathname.startsWith(p))) return;

  if (!req.auth) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Onboarding gate: user signed in but hasn't set a display name yet.
  // Edge runtime — can't use Prisma, so we rely on the displayNameSetAt
  // claim baked into the JWT by the jwt() callback in lib/auth.ts.
  const onOnboardingPage = pathname.startsWith('/onboarding/name');
  const onApiRoute = pathname.startsWith('/api');
  if (
    !onOnboardingPage &&
    !onApiRoute &&
    req.auth.user.displayNameSetAt == null
  ) {
    return NextResponse.redirect(new URL('/onboarding/name', req.url));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
