import Link from 'next/link';
import { getSession } from '@/lib/session';
import { signOut } from '@/lib/auth';

export async function TopNav() {
  const session = await getSession();
  const role = session?.user?.role;
  const isAdmin = role === 'admin';
  const canReview = isAdmin || role === 'final_reviewer';
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="flex items-center justify-between px-6 py-3">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="font-semibold">
            FRC Annotation
          </Link>
          <Link href="/" className="text-neutral-600 hover:text-neutral-900">
            Dashboard
          </Link>
          {canReview && (
            <Link
              href="/projects"
              className="text-neutral-600 hover:text-neutral-900"
            >
              Projects
            </Link>
          )}
          {canReview && (
            <Link
              href="/review"
              className="text-neutral-600 hover:text-neutral-900"
            >
              Review
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className="text-neutral-600 hover:text-neutral-900"
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-4 text-sm">
          {session?.user && (
            <span className="text-neutral-500">
              {session.user.name ?? session.user.email}
            </span>
          )}
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button
              type="submit"
              className="rounded border border-neutral-300 px-3 py-1 text-neutral-700 hover:bg-neutral-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
