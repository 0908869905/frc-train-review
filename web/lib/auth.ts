import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { prisma } from '@/lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt', maxAge: 60 * 60 },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const wl = await prisma.emailWhitelist.findUnique({ where: { email: user.email } });
      if (!wl) return false;

      await prisma.user.upsert({
        where: { email: user.email },
        update: { name: user.name ?? undefined, isActive: true },
        create: { email: user.email, name: user.name ?? null, role: wl.role },
      });
      return true;
    },
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
  },
});
