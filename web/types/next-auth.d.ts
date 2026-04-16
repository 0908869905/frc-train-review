import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: 'admin' | 'annotator' | 'final_reviewer';
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    role?: 'admin' | 'annotator' | 'final_reviewer';
  }
}
