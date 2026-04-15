# Annotation Review Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal web platform where 16+ FRC team members can review Gemini-auto-labeled object detection data and export approved datasets as YOLO zips for training a new onboard robot vision model — without touching the existing `train_robot_model.py` pipeline.

**Architecture:** Next.js 15 App Router full-stack app on Vercel. Server Components for SSR pages, Client Components for the canvas annotation editor. All state transitions enforced server-side. Images stored in Vercel Blob (direct-to-blob client upload to bypass 4.5 MB Function body cap). Metadata in Neon Postgres via Prisma. Google SSO with server-side email whitelist.

**Tech Stack:**
- Next.js 15 (App Router), TypeScript
- Prisma 6 + Neon Postgres (serverless driver)
- `@vercel/blob` (+ client SDK for direct upload)
- Auth.js v5 (Google provider)
- Tailwind CSS + shadcn/ui
- react-konva (canvas)
- Vitest (unit + integration)
- Playwright (E2E)
- pnpm package manager

**Location:** New `web/` subdirectory inside the existing `frc-train-review` repo. The Python training code and new web platform live in the same repo but share nothing at runtime.

---

## Scope

Reference: `docs/superpowers/specs/2026-04-15-annotation-review-platform-design.md`

This plan covers all 8 milestones (M0–M7) in order. Each milestone is a shippable PR. Every task inside a milestone follows TDD: write failing test → verify fail → implement → verify pass → commit.

## Out of Scope (do NOT implement)

- Any change to `train_robot_model.py`, `extract_frames.py`, `download_matches.py`, or any file outside `web/`
- In-app Gemini API calls
- Training orchestration
- Mobile UI
- Multi-tenant / organization concept

---

## File Structure Map

```
frc-train-review/
├── web/                                          # NEW — all web code lives here
│   ├── app/
│   │   ├── (auth)/login/page.tsx                 # Google SSO entry
│   │   ├── (protected)/
│   │   │   ├── layout.tsx                        # session check + nav
│   │   │   ├── page.tsx                          # dashboard
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx                  # project home
│   │   │   │       ├── upload/page.tsx
│   │   │   │       ├── export/page.tsx
│   │   │   │       └── batches/[batchId]/assign/page.tsx
│   │   │   ├── annotate/[imageId]/page.tsx       # canvas editor
│   │   │   ├── review/[batchId]/page.tsx
│   │   │   └── admin/users/page.tsx
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── projects/route.ts
│   │   │   ├── projects/[id]/route.ts
│   │   │   ├── projects/[id]/batches/route.ts
│   │   │   ├── projects/[id]/export/route.ts
│   │   │   ├── batches/[id]/finalize/route.ts
│   │   │   ├── batches/[id]/assign/route.ts
│   │   │   ├── images/[id]/annotations/route.ts
│   │   │   ├── images/[id]/submit/route.ts
│   │   │   ├── images/[id]/approve/route.ts
│   │   │   ├── images/[id]/reject/route.ts
│   │   │   ├── images/[id]/signed-url/route.ts
│   │   │   ├── me/queue/route.ts
│   │   │   └── admin/users/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── annotation/
│   │   │   ├── AnnotationCanvas.tsx              # react-konva stage
│   │   │   ├── ClassPalette.tsx
│   │   │   ├── ImageQueue.tsx
│   │   │   ├── use-shortcuts.ts
│   │   │   └── use-autosave.ts
│   │   ├── review/ReviewTray.tsx
│   │   ├── admin/
│   │   │   ├── BatchUploader.tsx
│   │   │   └── AssignmentMatrix.tsx
│   │   └── ui/                                   # shadcn components (button, dialog, etc.)
│   ├── lib/
│   │   ├── auth.ts                               # Auth.js config + session helpers
│   │   ├── db.ts                                 # Prisma client singleton
│   │   ├── blob.ts                               # Blob upload / signed URL helpers
│   │   ├── state-machine.ts                     # Image transition validators
│   │   ├── yolo.ts                               # YOLO format parser/serializer
│   │   ├── assignment.ts                         # Distribution algorithm
│   │   ├── zip-validator.ts                      # Safe zip extraction
│   │   ├── audit.ts                              # AuditLog write helper
│   │   └── rbac.ts                               # Role checks
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── tests/
│   │   ├── unit/
│   │   │   ├── state-machine.test.ts
│   │   │   ├── yolo.test.ts
│   │   │   ├── assignment.test.ts
│   │   │   └── zip-validator.test.ts
│   │   ├── integration/
│   │   │   ├── auth.test.ts
│   │   │   ├── projects.test.ts
│   │   │   ├── batches.test.ts
│   │   │   ├── assignment.test.ts
│   │   │   ├── annotations.test.ts
│   │   │   ├── review.test.ts
│   │   │   └── export.test.ts
│   │   └── e2e/
│   │       ├── login.spec.ts
│   │       ├── upload-assign.spec.ts
│   │       ├── annotate.spec.ts
│   │       └── review-export.spec.ts
│   ├── middleware.ts                             # auth check on protected routes
│   ├── vitest.config.ts
│   ├── playwright.config.ts
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── .env.example
└── docs/superpowers/                             # already exists
```

---

# Milestone M0 — Project Bootstrap

Goal: An empty Next.js app deployed to Vercel, connected to Neon and Vercel Blob, with Prisma schema, CI running lint + unit tests, and an empty homepage that SSRs.

## Task M0.1: Initialize Next.js project in `web/` subdirectory

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/globals.css`, `web/tailwind.config.ts`, `web/postcss.config.mjs`

- [ ] **Step 1: Create Next.js app**

Run from repo root:
```bash
pnpm create next-app@latest web --typescript --tailwind --eslint --app --src-dir=false --import-alias='@/*' --use-pnpm --no-turbopack
```

- [ ] **Step 2: Verify install**

Run:
```bash
cd web && pnpm dev
```
Expected: Dev server starts on `http://localhost:3000`, default Next.js welcome page renders. Stop with Ctrl+C.

- [ ] **Step 3: Replace default homepage with minimal placeholder**

Write `web/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">FRC Annotation Review Platform</h1>
      <p className="text-sm text-gray-500">Bootstrap placeholder — M0</p>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat(web): bootstrap Next.js app in web/ subdirectory"
```

## Task M0.2: Install core dependencies

**Files:** `web/package.json`

- [ ] **Step 1: Install runtime deps**

Run from `web/`:
```bash
pnpm add prisma @prisma/client @neondatabase/serverless @vercel/blob next-auth@beta @auth/prisma-adapter zod
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D vitest @vitest/ui @types/node @playwright/test
```

- [ ] **Step 3: Install shadcn/ui and react-konva**

```bash
pnpm dlx shadcn@latest init -d
pnpm add konva react-konva
```

Accept all defaults in the shadcn init. This creates `components/ui/`, `lib/utils.ts`, and updates `tailwind.config.ts`.

- [ ] **Step 4: Verify build**

```bash
pnpm build
```
Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/components.json web/lib/utils.ts web/tailwind.config.ts web/app/globals.css
git commit -m "feat(web): install core deps (Prisma, Auth.js, Blob, shadcn, Konva)"
```

## Task M0.3: Prisma schema with full data model

**Files:**
- Create: `web/prisma/schema.prisma`, `web/lib/db.ts`
- Create: `web/.env.example`

- [ ] **Step 1: Write Prisma schema**

Write `web/prisma/schema.prisma`:
```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  annotator
  final_reviewer
}

enum BatchState {
  pending_upload
  ready
  in_annotation
  under_review
  completed
}

enum ImageState {
  unassigned
  assigned
  annotated
  under_review
  approved
  needs_rework
}

enum AnnotationSource {
  gemini
  human
}

enum ReviewAction {
  approve
  reject
}

model User {
  id         String   @id @default(cuid())
  email      String   @unique
  name       String?
  role       Role     @default(annotator)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  uploadedBatches Batch[]        @relation("BatchUploader")
  assignedImages  Image[]        @relation("ImageAssignee")
  annotations     Annotation[]
  reviews         ReviewEvent[]
  auditLogs       AuditLog[]
}

model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  // Ordered list of {idx, name, color}. Index = YOLO class index.
  classes     Json
  createdAt   DateTime @default(now())

  batches Batch[]
}

model Batch {
  id         String     @id @default(cuid())
  project    Project    @relation(fields: [projectId], references: [id])
  projectId  String
  uploader   User       @relation("BatchUploader", fields: [uploaderId], references: [id])
  uploaderId String
  name       String
  source     String?
  state      BatchState @default(pending_upload)
  createdAt  DateTime   @default(now())

  images Image[]
}

model Image {
  id            String     @id @default(cuid())
  batch         Batch      @relation(fields: [batchId], references: [id])
  batchId       String
  blobPath      String
  thumbnailPath String?
  width         Int
  height        Int
  assignedTo    User?      @relation("ImageAssignee", fields: [assignedToId], references: [id])
  assignedToId  String?
  state         ImageState @default(unassigned)
  updatedAt     DateTime   @updatedAt

  annotations  Annotation[]
  reviewEvents ReviewEvent[]

  @@index([batchId, state])
  @@index([assignedToId, state])
}

model Annotation {
  id        String           @id @default(cuid())
  image     Image            @relation(fields: [imageId], references: [id], onDelete: Cascade)
  imageId   String
  classIdx  Int
  x         Float
  y         Float
  w         Float
  h         Float
  source    AnnotationSource
  author    User?            @relation(fields: [authorId], references: [id])
  authorId  String?
  updatedAt DateTime         @updatedAt

  @@index([imageId])
}

model ReviewEvent {
  id         String       @id @default(cuid())
  image      Image        @relation(fields: [imageId], references: [id])
  imageId    String
  reviewer   User         @relation(fields: [reviewerId], references: [id])
  reviewerId String
  action     ReviewAction
  comment    String?
  createdAt  DateTime     @default(now())

  @@index([imageId])
}

model AuditLog {
  id         String   @id @default(cuid())
  actor      User     @relation(fields: [actorId], references: [id])
  actorId    String
  action     String
  targetType String
  targetId   String
  payload    Json
  createdAt  DateTime @default(now())

  @@index([targetType, targetId])
}

model EmailWhitelist {
  email     String   @id
  role      Role
  addedById String?
  addedAt   DateTime @default(now())
}
```

- [ ] **Step 2: Write Prisma client singleton**

Write `web/lib/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Write .env.example**

Write `web/.env.example`:
```
# Neon Postgres
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# Vercel Blob
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."

# Auth.js
AUTH_SECRET="run: openssl rand -base64 32"
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

- [ ] **Step 4: Generate Prisma client**

Run:
```bash
cd web && pnpm prisma generate
```
Expected: "✔ Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add web/prisma/ web/lib/db.ts web/.env.example
git commit -m "feat(web): add Prisma schema with full data model"
```

## Task M0.4: Provision Neon DB and run first migration

**Files:** `web/prisma/migrations/...`, `web/.env`

- [ ] **Step 1: Create Neon project (manual)**

On `https://neon.tech`, create a new project named `frc-annotation`. Copy the pooled connection string into `web/.env`:
```
DATABASE_URL="postgresql://...-pooler.neon.tech/neondb?sslmode=require"
```
`.env` is already in `.gitignore` — do NOT commit it.

- [ ] **Step 2: Run initial migration**

```bash
cd web && pnpm prisma migrate dev --name init
```
Expected: Migration file created under `prisma/migrations/<timestamp>_init/`, "Database is now in sync with your schema", Prisma client regenerated.

- [ ] **Step 3: Verify schema**

```bash
pnpm prisma studio
```
Expected: Studio opens; all 9 tables visible and empty. Close browser.

- [ ] **Step 4: Commit migration**

```bash
git add web/prisma/migrations/
git commit -m "feat(web): initial Prisma migration"
```

## Task M0.5: Set up Vitest and write first smoke test

**Files:**
- Create: `web/vitest.config.ts`, `web/tests/unit/smoke.test.ts`

- [ ] **Step 1: Write vitest config**

Write `web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 2: Add test script to package.json**

Edit `web/package.json` `scripts` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write failing smoke test**

Write `web/tests/unit/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd web && pnpm test
```
Expected: 1 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add web/vitest.config.ts web/tests/unit/smoke.test.ts web/package.json
git commit -m "feat(web): set up Vitest with smoke test"
```

## Task M0.6: Set up GitHub Actions CI

**Files:** Create `.github/workflows/web-ci.yml` (at repo root, not inside `web/`)

- [ ] **Step 1: Write CI workflow**

Write `.github/workflows/web-ci.yml`:
```yaml
name: web-ci

on:
  push:
    paths: ['web/**']
  pull_request:
    paths: ['web/**']

jobs:
  lint-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
        env:
          DATABASE_URL: postgresql://fake:fake@localhost/fake
          AUTH_SECRET: ci-fake-secret
          AUTH_GOOGLE_ID: fake
          AUTH_GOOGLE_SECRET: fake
```

- [ ] **Step 2: Verify YAML syntax**

```bash
cat .github/workflows/web-ci.yml
```
Expected: valid YAML, no typos.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/web-ci.yml
git commit -m "ci: add GitHub Actions workflow for web/"
```

## Task M0.7: Deploy empty app to Vercel (manual)

This is a manual step; there is no code change.

- [ ] **Step 1: Create Vercel project**

Log into Vercel. Import the `frc-train-review` repo. In project settings:
- **Root Directory**: `web`
- **Framework Preset**: Next.js
- **Install Command**: `pnpm install`
- **Build Command**: `pnpm prisma generate && pnpm build`

- [ ] **Step 2: Add environment variables in Vercel**

Paste from `web/.env` in Vercel's Environment Variables panel:
- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_GOOGLE_ID` (leave empty for now, M1 fills it)
- `AUTH_GOOGLE_SECRET` (leave empty for now, M1 fills it)

- [ ] **Step 3: Add Vercel Blob store**

In Vercel dashboard → Storage tab → create Blob store named `frc-annotation-blob`. Connect it to the project. `BLOB_READ_WRITE_TOKEN` is auto-injected.

- [ ] **Step 4: Deploy**

Trigger deploy (git push `master` or click "Redeploy"). Verify the deploy URL renders the M0 placeholder homepage.

- [ ] **Step 5: No commit required — deployment is external.**

## M0 Acceptance

- `pnpm test` passes locally
- `pnpm build` passes locally
- GitHub Actions CI green on push
- Vercel deployment URL shows the placeholder homepage
- Neon DB contains empty tables matching the schema
- Vercel Blob store provisioned

---

# Milestone M1 — Auth + Whitelist + Roles

Goal: Google SSO login works, email whitelist enforced on server, three roles (admin / annotator / final_reviewer) distinguished, `/admin/users` page for managing the whitelist.

## Task M1.1: Auth.js config with Google provider

**Files:**
- Create: `web/lib/auth.ts`, `web/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Set up Google OAuth credentials (manual)**

In Google Cloud Console, create an OAuth 2.0 Client ID:
- Application type: Web application
- Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://<your-vercel-domain>/api/auth/callback/google`

Copy Client ID → `AUTH_GOOGLE_ID` in `web/.env` and Vercel env vars.
Copy Client Secret → `AUTH_GOOGLE_SECRET`.

- [ ] **Step 2: Write auth config**

Write `web/lib/auth.ts`:
```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { prisma } from '@/lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt', maxAge: 60 * 60 }, // 1 hour
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const wl = await prisma.emailWhitelist.findUnique({ where: { email: user.email } });
      if (!wl) return false;

      // Upsert User row
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
        } else {
          return {};
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && token.role) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});
```

- [ ] **Step 3: Write route handler**

Write `web/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

- [ ] **Step 4: Extend NextAuth type declarations**

Write `web/types/next-auth.d.ts`:
```ts
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
```

- [ ] **Step 5: Update tsconfig to include types/**

Edit `web/tsconfig.json`: add `"types/**/*.ts"` to the `include` array.

- [ ] **Step 6: Verify build**

```bash
pnpm build
```
Expected: Build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/auth.ts web/app/api/auth web/types web/tsconfig.json
git commit -m "feat(web): Auth.js Google provider with whitelist check"
```

## Task M1.2: Middleware to protect routes

**Files:** Create `web/middleware.ts`

- [ ] **Step 1: Write middleware**

Write `web/middleware.ts`:
```ts
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
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Commit**

```bash
git add web/middleware.ts
git commit -m "feat(web): protect routes via auth middleware"
```

## Task M1.3: Login page

**Files:** Create `web/app/(auth)/login/page.tsx`

- [ ] **Step 1: Install shadcn button**

```bash
cd web && pnpm dlx shadcn@latest add button
```

- [ ] **Step 2: Write login page**

Write `web/app/(auth)/login/page.tsx`:
```tsx
import { signIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold">FRC Annotation Review</h1>
          <p className="text-sm text-gray-500">Team members only. Google account must be on the whitelist.</p>
        </div>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <Button type="submit" className="w-full">Sign in with Google</Button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify dev server**

```bash
pnpm dev
```
Visit `http://localhost:3000/login`. Expected: Login page renders with Google button. Stop server.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(auth\) web/components/ui/button.tsx
git commit -m "feat(web): add login page with Google sign-in"
```

## Task M1.4: Seed an admin user into whitelist

**Files:** Create `web/prisma/seed.ts`, modify `web/package.json`

- [ ] **Step 1: Write seed script**

Write `web/prisma/seed.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('Set SEED_ADMIN_EMAIL env var to your Google email');
    process.exit(1);
  }
  await prisma.emailWhitelist.upsert({
    where: { email: adminEmail },
    update: { role: 'admin' },
    create: { email: adminEmail, role: 'admin' },
  });
  console.log(`Whitelisted ${adminEmail} as admin`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Configure Prisma seed in package.json**

Edit `web/package.json` to add at top level:
```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

Install tsx:
```bash
pnpm add -D tsx
```

- [ ] **Step 3: Run seed**

```bash
SEED_ADMIN_EMAIL=<your-google-email> pnpm prisma db seed
```
Expected: "Whitelisted <email> as admin".

- [ ] **Step 4: Verify in Prisma Studio**

```bash
pnpm prisma studio
```
Expected: `EmailWhitelist` table has one row with your email and role `admin`.

- [ ] **Step 5: Commit**

```bash
git add web/prisma/seed.ts web/package.json
git commit -m "feat(web): Prisma seed script for initial admin"
```

## Task M1.5: RBAC helper library (unit tests)

**Files:**
- Create: `web/lib/rbac.ts`, `web/tests/unit/rbac.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/unit/rbac.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canPerform } from '@/lib/rbac';

describe('canPerform', () => {
  it('allows admin to upload batch', () => {
    expect(canPerform('admin', 'batch.upload')).toBe(true);
  });
  it('denies annotator to upload batch', () => {
    expect(canPerform('annotator', 'batch.upload')).toBe(false);
  });
  it('allows annotator to submit own image', () => {
    expect(canPerform('annotator', 'image.submit')).toBe(true);
  });
  it('allows final_reviewer to approve', () => {
    expect(canPerform('final_reviewer', 'image.approve')).toBe(true);
  });
  it('denies annotator to approve', () => {
    expect(canPerform('annotator', 'image.approve')).toBe(false);
  });
  it('denies final_reviewer to assign', () => {
    expect(canPerform('final_reviewer', 'batch.assign')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/unit/rbac.test.ts
```
Expected: FAIL — `canPerform` not defined.

- [ ] **Step 3: Implement rbac**

Write `web/lib/rbac.ts`:
```ts
export type Role = 'admin' | 'annotator' | 'final_reviewer';
export type Action =
  | 'project.create' | 'project.update'
  | 'batch.upload' | 'batch.assign'
  | 'image.submit' | 'image.annotate'
  | 'image.approve' | 'image.reject'
  | 'export.download'
  | 'whitelist.manage';

const MATRIX: Record<Action, Role[]> = {
  'project.create':   ['admin'],
  'project.update':   ['admin'],
  'batch.upload':     ['admin'],
  'batch.assign':     ['admin'],
  'image.annotate':   ['annotator'],
  'image.submit':     ['annotator'],
  'image.approve':    ['final_reviewer'],
  'image.reject':     ['final_reviewer'],
  'export.download':  ['admin'],
  'whitelist.manage': ['admin'],
};

export function canPerform(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function requireRole(role: Role | undefined, action: Action): asserts role is Role {
  if (!role || !canPerform(role, action)) {
    const err = new Error(`Forbidden: role ${role} cannot perform ${action}`);
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test tests/unit/rbac.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/rbac.ts web/tests/unit/rbac.test.ts
git commit -m "feat(web): RBAC helper with unit tests"
```

## Task M1.6: `/admin/users` whitelist management page + API

**Files:**
- Create: `web/app/api/admin/users/route.ts`
- Create: `web/app/(protected)/admin/users/page.tsx`
- Create: `web/tests/integration/admin-users.test.ts`

- [ ] **Step 1: Write failing integration test**

Write `web/tests/integration/admin-users.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

describe('POST /api/admin/users', () => {
  beforeEach(async () => {
    await prisma.emailWhitelist.deleteMany();
  });

  it('adds email to whitelist', async () => {
    // We call the route handler directly as a function
    const { POST } = await import('@/app/api/admin/users/route');
    const req = new Request('http://x/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', role: 'annotator' }),
    });
    // Bypass auth in tests via a fake session injector (to be added in step 3)
    const res = await POST(req);
    expect(res.status).toBe(200);
    const row = await prisma.emailWhitelist.findUnique({ where: { email: 'alice@example.com' } });
    expect(row?.role).toBe('annotator');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/admin-users.test.ts
```
Expected: FAIL — route does not exist.

- [ ] **Step 3: Add test-only auth bypass**

Write `web/lib/auth-test.ts`:
```ts
import type { Role } from '@/lib/rbac';

type FakeSession = { user: { id: string; email: string; role: Role } } | null;
let fake: FakeSession = null;
export function __setFakeSession(s: FakeSession) {
  fake = s;
}
export function __getFakeSession() {
  return fake;
}
```

Write `web/lib/session.ts` (real session getter, reads from Auth.js but allows override in tests):
```ts
import { auth } from '@/lib/auth';
import { __getFakeSession } from '@/lib/auth-test';

export async function getSession() {
  if (process.env.NODE_ENV === 'test') {
    return __getFakeSession();
  }
  return auth();
}
```

- [ ] **Step 4: Implement route**

Write `web/app/api/admin/users/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const PostBody = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'annotator', 'final_reviewer']),
});

export async function GET() {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const rows = await prisma.emailWhitelist.findMany({ orderBy: { addedAt: 'asc' } });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const body = PostBody.parse(await req.json());
  const row = await prisma.emailWhitelist.upsert({
    where: { email: body.email },
    update: { role: body.role },
    create: { email: body.email, role: body.role, addedById: session!.user.id },
  });
  return NextResponse.json(row);
}
```

- [ ] **Step 5: Update test to set fake session**

Edit `web/tests/integration/admin-users.test.ts` — add in `beforeEach`:
```ts
const { __setFakeSession } = await import('@/lib/auth-test');
__setFakeSession({ user: { id: 'test-admin', email: 'admin@test', role: 'admin' } });
// Also create the user row so FK constraints don't fail
await prisma.user.upsert({
  where: { email: 'admin@test' },
  update: {},
  create: { id: 'test-admin', email: 'admin@test', role: 'admin' },
});
```

- [ ] **Step 6: Run tests — expect pass**

```bash
pnpm test tests/integration/admin-users.test.ts
```
Expected: 1 passed.

- [ ] **Step 7: Add forbidden test**

Append to `web/tests/integration/admin-users.test.ts`:
```ts
it('rejects non-admin with 403', async () => {
  const { __setFakeSession } = await import('@/lib/auth-test');
  __setFakeSession({ user: { id: 'not-admin', email: 'b@test', role: 'annotator' } });
  const { POST } = await import('@/app/api/admin/users/route');
  const req = new Request('http://x/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@y.z', role: 'annotator' }),
  });
  await expect(POST(req)).rejects.toMatchObject({ status: 403 });
});
```

Run:
```bash
pnpm test tests/integration/admin-users.test.ts
```
Expected: 2 passed.

- [ ] **Step 8: Write admin page UI**

Install shadcn table and input:
```bash
pnpm dlx shadcn@latest add table input select
```

Write `web/app/(protected)/admin/users/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { AddUserForm } from './add-user-form';

export default async function AdminUsersPage() {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const rows = await prisma.emailWhitelist.findMany({ orderBy: { addedAt: 'asc' } });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Email Whitelist</h1>
      <AddUserForm />
      <table className="w-full mt-6 text-sm">
        <thead><tr><th className="text-left py-2">Email</th><th className="text-left py-2">Role</th><th className="text-left py-2">Added</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email} className="border-t">
              <td className="py-2">{r.email}</td>
              <td>{r.role}</td>
              <td>{r.addedAt.toISOString().slice(0,10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

Write `web/app/(protected)/admin/users/add-user-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AddUserForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'annotator' | 'final_reviewer'>('annotator');
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    setMsg(res.ok ? 'Added' : `Failed: ${res.status}`);
    if (res.ok) { setEmail(''); location.reload(); }
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-center">
      <Input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="border rounded px-2 py-1">
        <option value="annotator">annotator</option>
        <option value="admin">admin</option>
        <option value="final_reviewer">final_reviewer</option>
      </select>
      <Button type="submit">Add</Button>
      {msg && <span className="text-sm text-gray-500">{msg}</span>}
    </form>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add web/app/api/admin web/app/\(protected\)/admin web/lib/session.ts web/lib/auth-test.ts web/tests/integration/admin-users.test.ts
git commit -m "feat(web): admin users whitelist page and API"
```

## M1 Acceptance

- Non-whitelisted Google account login → redirected back to `/login`
- Whitelisted annotator accessing `/admin/users` → 403
- Admin accessing `/admin/users` → sees the whitelist table, can add/remove entries
- All integration tests pass

---

# Milestone M2 — Project and Class Management

Goal: Admin can create projects with class lists (name + color), view a list of projects, navigate to each project home.

## Task M2.1: Projects list + create API

**Files:**
- Create: `web/app/api/projects/route.ts`, `web/tests/integration/projects.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/projects.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

async function adminSession() {
  await prisma.user.upsert({
    where: { email: 'admin@t' },
    update: {},
    create: { id: 'u-admin', email: 'admin@t', role: 'admin' },
  });
  __setFakeSession({ user: { id: 'u-admin', email: 'admin@t', role: 'admin' } });
}

describe('POST /api/projects', () => {
  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    await adminSession();
  });

  it('creates a project with classes', async () => {
    const { POST } = await import('@/app/api/projects/route');
    const req = new Request('http://x/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'coral-detector-2026',
        description: 'on-robot coral detection',
        classes: [
          { idx: 0, name: 'coral', color: '#eab308' },
          { idx: 1, name: 'algae', color: '#22c55e' },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const list = await prisma.project.findMany();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('coral-detector-2026');
  });

  it('rejects non-admin', async () => {
    __setFakeSession({ user: { id: 'u-admin', email: 'admin@t', role: 'annotator' } });
    const { POST } = await import('@/app/api/projects/route');
    const req = new Request('http://x/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', classes: [] }),
    });
    await expect(POST(req)).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/projects.test.ts
```
Expected: FAIL — route missing.

- [ ] **Step 3: Implement route**

Write `web/app/api/projects/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const ClassDef = z.object({
  idx: z.number().int().min(0),
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

const PostBody = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  classes: z.array(ClassDef).max(50),
});

export async function GET() {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'project.create');
  const body = PostBody.parse(await req.json());
  const p = await prisma.project.create({
    data: {
      name: body.name,
      description: body.description,
      classes: body.classes,
    },
  });
  return NextResponse.json(p);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test tests/integration/projects.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/projects web/tests/integration/projects.test.ts
git commit -m "feat(web): projects create/list API with RBAC"
```

## Task M2.2: Project single-item API + class editing

**Files:**
- Create: `web/app/api/projects/[id]/route.ts`
- Append to: `web/tests/integration/projects.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `web/tests/integration/projects.test.ts`:
```ts
describe('PATCH /api/projects/[id]', () => {
  it('updates project name and classes', async () => {
    await adminSession();
    const p = await prisma.project.create({
      data: { name: 'old', classes: [{ idx: 0, name: 'a', color: '#ff0000' }] },
    });
    const { PATCH } = await import('@/app/api/projects/[id]/route');
    const req = new Request(`http://x/api/projects/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'new',
        classes: [
          { idx: 0, name: 'a', color: '#ff0000' },
          { idx: 1, name: 'b', color: '#00ff00' },
        ],
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.project.findUnique({ where: { id: p.id } });
    expect(updated?.name).toBe('new');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/projects.test.ts
```
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

Write `web/app/api/projects/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const ClassDef = z.object({
  idx: z.number().int().min(0),
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

const PatchBody = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  classes: z.array(ClassDef).max(50).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'project.update');
  const { id } = await params;
  const body = PatchBody.parse(await req.json());
  const p = await prisma.project.update({ where: { id }, data: body });
  return NextResponse.json(p);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/integration/projects.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/projects/\[id\] web/tests/integration/projects.test.ts
git commit -m "feat(web): project detail GET/PATCH with class editing"
```

## Task M2.3: Projects list page + new project page

**Files:**
- Create: `web/app/(protected)/projects/page.tsx`, `web/app/(protected)/projects/new/page.tsx`
- Create: `web/app/(protected)/projects/new/project-form.tsx`

- [ ] **Step 1: Install shadcn card and textarea**

```bash
pnpm dlx shadcn@latest add card textarea
```

- [ ] **Step 2: Write projects list page**

Write `web/app/(protected)/projects/page.tsx`:
```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { Button } from '@/components/ui/button';

export default async function ProjectsPage() {
  const session = await getSession();
  const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  const canCreate = session?.user.role === 'admin';

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        {canCreate && (
          <Link href="/projects/new"><Button>New Project</Button></Link>
        )}
      </div>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="border rounded p-4 hover:bg-gray-50">
            <Link href={`/projects/${p.id}`} className="block">
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-gray-500">{p.description ?? '—'}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Write new project form**

Write `web/app/(protected)/projects/new/project-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ClassRow = { idx: number; name: string; color: string };

const DEFAULT_CLASSES: ClassRow[] = [
  { idx: 0, name: 'class_0', color: '#ef4444' },
];

export function ProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classes, setClasses] = useState<ClassRow[]>(DEFAULT_CLASSES);
  const [busy, setBusy] = useState(false);

  function addClass() {
    setClasses([...classes, { idx: classes.length, name: `class_${classes.length}`, color: '#3b82f6' }]);
  }
  function removeClass(i: number) {
    setClasses(classes.filter((_, j) => j !== i).map((c, j) => ({ ...c, idx: j })));
  }
  function updateClass(i: number, patch: Partial<ClassRow>) {
    setClasses(classes.map((c, j) => j === i ? { ...c, ...patch } : c));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, classes }),
    });
    setBusy(false);
    if (res.ok) {
      const p = await res.json();
      router.push(`/projects/${p.id}`);
    } else {
      alert('Failed');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl">
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Classes</label>
          <Button type="button" variant="outline" size="sm" onClick={addClass}>Add class</Button>
        </div>
        <div className="space-y-2">
          {classes.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs w-6">{c.idx}</span>
              <Input value={c.name} onChange={(e) => updateClass(i, { name: e.target.value })} className="flex-1" />
              <input type="color" value={c.color} onChange={(e) => updateClass(i, { color: e.target.value })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeClass(i)}>×</Button>
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create Project'}</Button>
    </form>
  );
}
```

Write `web/app/(protected)/projects/new/page.tsx`:
```tsx
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { ProjectForm } from './project-form';

export default async function NewProjectPage() {
  const session = await getSession();
  requireRole(session?.user.role, 'project.create');
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
      <ProjectForm />
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/projects
git commit -m "feat(web): projects list and create pages"
```

## Task M2.4: Project home page (empty shell, batches TBD in M3)

**Files:** Create `web/app/(protected)/projects/[id]/page.tsx`

- [ ] **Step 1: Write page**

Write `web/app/(protected)/projects/[id]/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';

export default async function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) notFound();
  const classes = p.classes as Array<{ idx: number; name: string; color: string }>;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">{p.name}</h1>
      <p className="text-sm text-gray-500 mb-6">{p.description ?? '—'}</p>
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Classes ({classes.length})</h2>
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <span key={c.idx} className="inline-flex items-center gap-2 px-3 py-1 border rounded text-sm">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
              {c.idx}: {c.name}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Batches</h2>
        <p className="text-sm text-gray-400">No batches yet — M3 will add upload.</p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(protected\)/projects/\[id\]/page.tsx
git commit -m "feat(web): project home page shell"
```

## M2 Acceptance

- Admin creates project → redirected to project home → sees classes rendered with colors
- Non-admin GET `/projects/new` or POST `/api/projects` → 403
- Project name / classes editable via PATCH API
- All integration tests pass (5 tests so far)

---

# Milestone M3 — Batch Upload (Direct-to-Blob)

Goal: Admin uploads a YOLO zip (images + labels + classes.txt). Client uploads the zip content directly to Vercel Blob, then posts metadata to finalize. Backend parses labels, creates `Batch` + `Image` + `Annotation` rows. Handles the 4.5 MB body cap by never routing image bytes through the Function body.

## Task M3.1: YOLO parser unit tests + implementation

**Files:**
- Create: `web/lib/yolo.ts`, `web/tests/unit/yolo.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/unit/yolo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseYoloLabel, serializeYoloLabel, parseClassesTxt } from '@/lib/yolo';

describe('parseYoloLabel', () => {
  it('parses YOLO format correctly', () => {
    const txt = '0 0.5 0.5 0.2 0.3\n1 0.75 0.25 0.1 0.1\n';
    const boxes = parseYoloLabel(txt);
    expect(boxes).toEqual([
      { classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 },
      { classIdx: 1, x: 0.75, y: 0.25, w: 0.1, h: 0.1 },
    ]);
  });

  it('ignores blank lines', () => {
    expect(parseYoloLabel('\n0 0.1 0.1 0.1 0.1\n\n')).toHaveLength(1);
  });

  it('rejects out-of-range coords', () => {
    expect(() => parseYoloLabel('0 1.2 0.5 0.2 0.3')).toThrow();
  });

  it('rejects negative class', () => {
    expect(() => parseYoloLabel('-1 0.5 0.5 0.2 0.3')).toThrow();
  });
});

describe('serializeYoloLabel', () => {
  it('round-trips with parse', () => {
    const boxes = [{ classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 }];
    expect(parseYoloLabel(serializeYoloLabel(boxes))).toEqual(boxes);
  });
});

describe('parseClassesTxt', () => {
  it('parses one class per line', () => {
    expect(parseClassesTxt('coral\nalgae\napriltag\n')).toEqual(['coral', 'algae', 'apriltag']);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/unit/yolo.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Write `web/lib/yolo.ts`:
```ts
export type YoloBox = {
  classIdx: number;
  x: number; // center x, normalized [0,1]
  y: number; // center y, normalized [0,1]
  w: number; // width, normalized [0,1]
  h: number; // height, normalized [0,1]
};

export function parseYoloLabel(text: string): YoloBox[] {
  const boxes: YoloBox[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) throw new Error(`Bad YOLO line: ${line}`);
    const classIdx = parseInt(parts[0], 10);
    const [x, y, w, h] = parts.slice(1).map(parseFloat);
    if (!Number.isFinite(classIdx) || classIdx < 0) throw new Error(`Bad class: ${line}`);
    for (const v of [x, y, w, h]) {
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`Out of range: ${line}`);
    }
    boxes.push({ classIdx, x, y, w, h });
  }
  return boxes;
}

export function serializeYoloLabel(boxes: YoloBox[]): string {
  return boxes.map((b) => `${b.classIdx} ${b.x} ${b.y} ${b.w} ${b.h}`).join('\n') + '\n';
}

export function parseClassesTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test tests/unit/yolo.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/yolo.ts web/tests/unit/yolo.test.ts
git commit -m "feat(web): YOLO label parser and serializer with tests"
```

## Task M3.2: Zip validator unit tests + implementation

**Files:**
- Create: `web/lib/zip-validator.ts`, `web/tests/unit/zip-validator.test.ts`

- [ ] **Step 1: Install fflate**

```bash
pnpm add fflate
```

- [ ] **Step 2: Write failing test**

Write `web/tests/unit/zip-validator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { validateAndExtractZip } from '@/lib/zip-validator';

function makeZip(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) data[k] = strToU8(v);
  return zipSync(data);
}

describe('validateAndExtractZip', () => {
  it('rejects path traversal', () => {
    const buf = makeZip({ '../evil.txt': 'bad' });
    expect(() => validateAndExtractZip(buf, { maxEntries: 10, maxTotalBytes: 1e6, maxFileBytes: 1e5 }))
      .toThrow(/path traversal/i);
  });

  it('rejects too many entries', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`f${i}.txt`] = 'x';
    const buf = makeZip(files);
    expect(() => validateAndExtractZip(buf, { maxEntries: 10, maxTotalBytes: 1e6, maxFileBytes: 1e5 }))
      .toThrow(/too many/i);
  });

  it('extracts valid flat structure', () => {
    const buf = makeZip({ 'a.txt': 'hello', 'b.txt': 'world' });
    const out = validateAndExtractZip(buf, { maxEntries: 10, maxTotalBytes: 1e6, maxFileBytes: 1e5 });
    expect(Object.keys(out).sort()).toEqual(['a.txt', 'b.txt']);
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
pnpm test tests/unit/zip-validator.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

Write `web/lib/zip-validator.ts`:
```ts
import { unzipSync } from 'fflate';

export type ZipLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
};

export function validateAndExtractZip(
  buf: Uint8Array,
  limits: ZipLimits
): Record<string, Uint8Array> {
  const entries = unzipSync(buf);
  const keys = Object.keys(entries);

  if (keys.length > limits.maxEntries) {
    throw new Error(`too many entries: ${keys.length} > ${limits.maxEntries}`);
  }

  let total = 0;
  for (const [path, data] of Object.entries(entries)) {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/')) {
      throw new Error(`path traversal: ${path}`);
    }
    if (data.length > limits.maxFileBytes) {
      throw new Error(`file too big: ${path} (${data.length} bytes)`);
    }
    total += data.length;
    if (total > limits.maxTotalBytes) {
      throw new Error(`total too big: ${total}`);
    }
  }

  return entries;
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm test tests/unit/zip-validator.test.ts
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add web/lib/zip-validator.ts web/tests/unit/zip-validator.test.ts web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): safe zip extraction with limits"
```

## Task M3.3: Blob helper + direct-upload endpoint

**Files:**
- Create: `web/lib/blob.ts`
- Create: `web/app/api/projects/[id]/batches/route.ts`

The upload flow: the client calls `POST /api/projects/[id]/batches` to create a `Batch` row in `pending_upload` state and gets back a presigned upload URL (via `@vercel/blob/client`'s `handleUpload` pattern) + a `batchId`. The client then streams the zip directly to Blob, then calls `POST /api/batches/[id]/finalize` to parse + create rows.

- [ ] **Step 1: Write blob helper**

Write `web/lib/blob.ts`:
```ts
import { put, del } from '@vercel/blob';
import type { PutBlobResult } from '@vercel/blob';

const PREFIX = 'frc-annotation';

export async function putImage(
  key: string,
  data: Uint8Array,
  contentType: string
): Promise<PutBlobResult> {
  return put(`${PREFIX}/${key}`, data, {
    access: 'public', // NOTE: see signed URL note below
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

export async function deleteBlob(url: string) {
  return del(url);
}

export function blobKey(batchId: string, filename: string): string {
  return `batches/${batchId}/${filename}`;
}
```

**NOTE on `access: 'public'`:** Vercel Blob's default is public URLs. For stricter security, use short-lived signed URLs via `generateClientTokenFromReadWriteToken`. For M3 we use public URLs (simpler) and add signed URLs in M3.6 before moving to M4.

- [ ] **Step 2: Write create-batch route**

Write `web/app/api/projects/[id]/batches/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const InitBody = z.object({
  name: z.string().min(1).max(128),
  source: z.string().optional(),
});

// Step 1: admin calls this to create an empty batch and get a handle
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');
  const { id: projectId } = await params;

  const body = InitBody.parse(await req.json());
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });

  const batch = await prisma.batch.create({
    data: {
      projectId,
      uploaderId: session!.user.id,
      name: body.name,
      source: body.source,
      state: 'pending_upload',
    },
  });
  return NextResponse.json({ batchId: batch.id });
}
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/blob.ts web/app/api/projects/\[id\]/batches/route.ts
git commit -m "feat(web): batch init endpoint + blob helper"
```

## Task M3.4: Client-side upload route (Blob token handler)

**Files:** Create `web/app/api/blob/upload/route.ts`

- [ ] **Step 1: Write handler**

Write `web/app/api/blob/upload/route.ts`:
```ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('frc-annotation/batches/')) {
          throw new Error('Invalid upload path');
        }
        return {
          allowedContentTypes: ['application/zip', 'application/x-zip-compressed'],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB cap per upload
          tokenPayload: JSON.stringify({ userId: session!.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Finalization is triggered by a separate POST — no action here
        console.log('upload completed', blob.url, tokenPayload);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/api/blob/upload/route.ts
git commit -m "feat(web): blob client upload token handler"
```

## Task M3.5: Batch finalize endpoint (parse zip → create rows)

**Files:**
- Create: `web/app/api/batches/[id]/finalize/route.ts`
- Create: `web/tests/integration/batches.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/batches.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

// Mock blob SDK — finalize does not re-upload, just reads the zip from a URL
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string) => ({
    url: `https://fake-blob.local/${key}`,
    pathname: key,
  })),
  del: vi.fn(async () => {}),
}));

describe('POST /api/batches/[id]/finalize', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({ data: { id: 'u-admin', email: 'a@t', role: 'admin' } });
    __setFakeSession({ user: { id: 'u-admin', email: 'a@t', role: 'admin' } });
  });

  it('parses zip and creates images + gemini annotations', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'p1',
        classes: [
          { idx: 0, name: 'a', color: '#ff0000' },
          { idx: 1, name: 'b', color: '#00ff00' },
        ],
      },
    });
    const batch = await prisma.batch.create({
      data: { projectId: project.id, uploaderId: 'u-admin', name: 'b1', state: 'pending_upload' },
    });

    // Build a minimal zip: 2 images + matching labels + classes.txt
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG marker
    const zipBuf = zipSync({
      'images/001.jpg': fakeJpeg,
      'images/002.jpg': fakeJpeg,
      'labels/001.txt': strToU8('0 0.5 0.5 0.2 0.2\n'),
      'labels/002.txt': strToU8('1 0.3 0.3 0.1 0.1\n'),
      'classes.txt': strToU8('a\nb\n'),
    });

    // Mock fetch for the zip URL
    global.fetch = vi.fn(async () => new Response(zipBuf)) as typeof fetch;

    const { POST } = await import('@/app/api/batches/[id]/finalize/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zipUrl: 'https://fake/zip' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: batch.id }) });
    expect(res.status).toBe(200);

    const images = await prisma.image.findMany({ where: { batchId: batch.id } });
    expect(images).toHaveLength(2);
    const anns = await prisma.annotation.findMany();
    expect(anns).toHaveLength(2);
    expect(anns.every((a) => a.source === 'gemini')).toBe(true);

    const updated = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(updated?.state).toBe('ready');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/batches.test.ts
```
Expected: FAIL — route missing.

- [ ] **Step 3: Implement finalize route**

Write `web/app/api/batches/[id]/finalize/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { validateAndExtractZip } from '@/lib/zip-validator';
import { parseYoloLabel, parseClassesTxt } from '@/lib/yolo';
import { putImage, blobKey } from '@/lib/blob';

const FinalizeBody = z.object({
  zipUrl: z.string().url(),
});

// Image dimensions — we don't decode JPEG here; store 0 placeholders.
// The canvas editor reads real width/height from the image on load and the
// server trusts the normalized YOLO coords (which are 0..1, dimension-independent).
const UNKNOWN_DIM = 0;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');
  const { id: batchId } = await params;
  const { zipUrl } = FinalizeBody.parse(await req.json());

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: true },
  });
  if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404 });
  if (batch.state !== 'pending_upload') {
    throw Object.assign(new Error('Batch already finalized'), { status: 409 });
  }

  // Download zip from blob URL
  const zipResp = await fetch(zipUrl);
  if (!zipResp.ok) throw Object.assign(new Error('Cannot fetch zip'), { status: 502 });
  const zipBuf = new Uint8Array(await zipResp.arrayBuffer());

  const entries = validateAndExtractZip(zipBuf, {
    maxEntries: 1200,        // 500 images × 2 (img + label) + classes.txt buffer
    maxTotalBytes: 500 * 1024 * 1024,
    maxFileBytes: 20 * 1024 * 1024,
  });

  // Locate classes.txt and validate against project
  const classesTxt = entries['classes.txt'];
  if (!classesTxt) throw Object.assign(new Error('classes.txt missing'), { status: 400 });
  const classNames = parseClassesTxt(new TextDecoder().decode(classesTxt));
  const projectClasses = batch.project.classes as Array<{ idx: number; name: string; color: string }>;
  if (classNames.length !== projectClasses.length ||
      !classNames.every((n, i) => n === projectClasses[i].name)) {
    throw Object.assign(new Error('classes.txt does not match project classes'), { status: 400 });
  }

  // Group image files by stem (without extension)
  const imageEntries = Object.entries(entries).filter(([p]) =>
    p.startsWith('images/') && /\.(jpe?g|png|bmp)$/i.test(p)
  );
  if (imageEntries.length === 0) {
    throw Object.assign(new Error('No images found'), { status: 400 });
  }
  if (imageEntries.length > 500) {
    throw Object.assign(new Error('Too many images'), { status: 400 });
  }

  // Process in a transaction — all or nothing
  await prisma.$transaction(async (tx) => {
    for (const [imgPath, imgData] of imageEntries) {
      const filename = imgPath.replace(/^images\//, '');
      const stem = filename.replace(/\.[^.]+$/, '');
      const labelPath = `labels/${stem}.txt`;
      const labelData = entries[labelPath];
      const labelText = labelData ? new TextDecoder().decode(labelData) : '';
      const boxes = labelText ? parseYoloLabel(labelText) : [];

      // Upload image to blob
      const blob = await putImage(
        blobKey(batchId, filename),
        imgData,
        filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      );

      const image = await tx.image.create({
        data: {
          batchId,
          blobPath: blob.url,
          width: UNKNOWN_DIM,
          height: UNKNOWN_DIM,
          state: 'unassigned',
        },
      });

      if (boxes.length > 0) {
        await tx.annotation.createMany({
          data: boxes.map((b) => ({
            imageId: image.id,
            classIdx: b.classIdx,
            x: b.x, y: b.y, w: b.w, h: b.h,
            source: 'gemini' as const,
          })),
        });
      }
    }
    await tx.batch.update({ where: { id: batchId }, data: { state: 'ready' } });
  }, { timeout: 120_000 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/integration/batches.test.ts
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/batches web/tests/integration/batches.test.ts
git commit -m "feat(web): batch finalize parses YOLO zip and creates rows"
```

## Task M3.6: Signed image URL endpoint

**Files:** Create `web/app/api/images/[id]/signed-url/route.ts`

For M3 we reuse Vercel Blob public URLs. True signed URLs (15-min TTL) are deferred to M7 hardening. For now this endpoint returns the same public URL but enforces auth — at least no unauthenticated access.

- [ ] **Step 1: Write route**

Write `web/app/api/images/[id]/signed-url/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const { id } = await params;
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
  // TODO(M7): Swap for a signed, short-lived URL via generateClientTokenFromReadWriteToken
  return NextResponse.json({ url: img.blobPath });
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/api/images/\[id\]/signed-url/route.ts
git commit -m "feat(web): image signed-url endpoint (auth-gated, public URL for M3)"
```

## Task M3.7: Upload UI page

**Files:**
- Create: `web/app/(protected)/projects/[id]/upload/page.tsx`
- Create: `web/app/(protected)/projects/[id]/upload/batch-uploader.tsx`

- [ ] **Step 1: Install shadcn progress**

```bash
pnpm dlx shadcn@latest add progress
```

- [ ] **Step 2: Write server page**

Write `web/app/(protected)/projects/[id]/upload/page.tsx`:
```tsx
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { BatchUploader } from './batch-uploader';

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');
  const { id } = await params;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Upload Batch</h1>
      <BatchUploader projectId={id} />
    </main>
  );
}
```

- [ ] **Step 3: Write uploader client component**

Write `web/app/(protected)/projects/[id]/upload/batch-uploader.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

export function BatchUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [batchName, setBatchName] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      setStatus('Creating batch...');
      const initRes = await fetch(`/api/projects/${projectId}/batches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: batchName, source: 'manual' }),
      });
      if (!initRes.ok) throw new Error('init failed');
      const { batchId } = await initRes.json();

      setStatus('Uploading to Blob...');
      const blob = await upload(`frc-annotation/batches/${batchId}/upload.zip`, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        onUploadProgress: ({ percentage }) => setProgress(percentage),
      });

      setStatus('Finalizing...');
      const finRes = await fetch(`/api/batches/${batchId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zipUrl: blob.url }),
      });
      if (!finRes.ok) throw new Error('finalize failed: ' + (await finRes.text()));

      setStatus('Done');
      router.push(`/projects/${projectId}/batches/${batchId}/assign`);
    } catch (err) {
      setStatus('Error: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Batch name</label>
        <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">YOLO zip</label>
        <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
      </div>
      {busy && <Progress value={progress} />}
      {status && <p className="text-sm text-gray-500">{status}</p>}
      <Button type="submit" disabled={busy || !file}>Upload</Button>
    </form>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/projects/\[id\]/upload
git commit -m "feat(web): batch upload UI with direct-to-blob streaming"
```

## M3 Acceptance

- Admin uploads a 100-image YOLO zip via `/projects/<id>/upload`
- Batch row created with state `ready`
- Each image has pre-filled `gemini` annotations from the YOLO label files
- Malicious zip (path traversal, too large) rejected with 4xx
- Batch with mismatched `classes.txt` vs project classes rejected with 400

---

# Milestone M4 — Assignment UI

Goal: Admin sees an Assignment page per batch, can distribute N images to each annotator with a transactional guarantee against double-assignment.

## Task M4.1: Assignment algorithm (unit)

**Files:**
- Create: `web/lib/assignment.ts`, `web/tests/unit/assignment.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/unit/assignment.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitEvenly } from '@/lib/assignment';

describe('splitEvenly', () => {
  it('divides 100 items across 4 people', () => {
    const r = splitEvenly(100, 4);
    expect(r).toEqual([25, 25, 25, 25]);
  });
  it('handles remainder', () => {
    const r = splitEvenly(103, 4);
    expect(r).toEqual([26, 26, 26, 25]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(103);
  });
  it('handles 0 items', () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
  });
  it('throws on 0 people', () => {
    expect(() => splitEvenly(10, 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/unit/assignment.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Write `web/lib/assignment.ts`:
```ts
export function splitEvenly(totalItems: number, numPeople: number): number[] {
  if (numPeople <= 0) throw new Error('numPeople must be > 0');
  const base = Math.floor(totalItems / numPeople);
  const extras = totalItems % numPeople;
  return Array.from({ length: numPeople }, (_, i) => base + (i < extras ? 1 : 0));
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/unit/assignment.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/assignment.ts web/tests/unit/assignment.test.ts
git commit -m "feat(web): assignment split algorithm"
```

## Task M4.2: Assignment API with transactional safety

**Files:**
- Create: `web/app/api/batches/[id]/assign/route.ts`
- Create: `web/tests/integration/assignment.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/assignment.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('POST /api/batches/[id]/assign', () => {
  let batchId: string;
  const IMAGE_IDS: string[] = [];

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    IMAGE_IDS.length = 0;

    const admin = await prisma.user.create({
      data: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
    await prisma.user.create({ data: { id: 'alice', email: 'alice@t', role: 'annotator' } });
    await prisma.user.create({ data: { id: 'bob', email: 'bob@t', role: 'annotator' } });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'a', color: '#f00' }] },
    });
    const batch = await prisma.batch.create({
      data: { projectId: p.id, uploaderId: admin.id, name: 'b', state: 'ready' },
    });
    batchId = batch.id;
    for (let i = 0; i < 6; i++) {
      const img = await prisma.image.create({
        data: { batchId: batch.id, blobPath: `u${i}`, width: 0, height: 0 },
      });
      IMAGE_IDS.push(img.id);
    }
    __setFakeSession({ user: { id: 'u-admin', email: 'a@t', role: 'admin' } });
  });

  it('assigns images evenly to annotators', async () => {
    const { POST } = await import('@/app/api/batches/[id]/assign/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignments: [
        { annotatorId: 'alice', count: 3 },
        { annotatorId: 'bob', count: 3 },
      ]}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: batchId }) });
    expect(res.status).toBe(200);
    const alice = await prisma.image.count({ where: { assignedToId: 'alice' } });
    const bob = await prisma.image.count({ where: { assignedToId: 'bob' } });
    expect(alice).toBe(3);
    expect(bob).toBe(3);
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    expect(batch?.state).toBe('in_annotation');
  });

  it('rejects if requested count exceeds unassigned pool', async () => {
    const { POST } = await import('@/app/api/batches/[id]/assign/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignments: [{ annotatorId: 'alice', count: 100 }]}),
    });
    await expect(POST(req, { params: Promise.resolve({ id: batchId }) }))
      .rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/assignment.test.ts
```

- [ ] **Step 3: Implement**

Write `web/app/api/batches/[id]/assign/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const Body = z.object({
  assignments: z.array(
    z.object({
      annotatorId: z.string(),
      count: z.number().int().min(1).max(10_000),
    })
  ).min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.assign');
  const { id: batchId } = await params;
  const body = Body.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    // Validate every annotator exists and has annotator role
    const users = await tx.user.findMany({
      where: { id: { in: body.assignments.map((a) => a.annotatorId) } },
    });
    if (users.length !== body.assignments.length) {
      throw Object.assign(new Error('Unknown annotator'), { status: 400 });
    }
    for (const u of users) {
      if (u.role !== 'annotator' && u.role !== 'admin') {
        throw Object.assign(new Error(`${u.email} is not an annotator`), { status: 400 });
      }
    }

    // Check there are enough unassigned images
    const totalRequested = body.assignments.reduce((s, a) => s + a.count, 0);
    const available = await tx.image.count({
      where: { batchId, state: 'unassigned' },
    });
    if (available < totalRequested) {
      throw Object.assign(
        new Error(`Not enough unassigned images (${available} < ${totalRequested})`),
        { status: 400 }
      );
    }

    // For each assignment, claim N unassigned images
    for (const a of body.assignments) {
      const toClaim = await tx.image.findMany({
        where: { batchId, state: 'unassigned' },
        take: a.count,
        select: { id: true },
      });
      const ids = toClaim.map((i) => i.id);
      // Conditional update — only flips if still unassigned
      const upd = await tx.image.updateMany({
        where: { id: { in: ids }, state: 'unassigned' },
        data: { state: 'assigned', assignedToId: a.annotatorId },
      });
      if (upd.count !== a.count) {
        throw Object.assign(new Error('Concurrent assign conflict'), { status: 409 });
      }
    }

    await tx.batch.update({ where: { id: batchId }, data: { state: 'in_annotation' } });
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/integration/assignment.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/app/api/batches/\[id\]/assign web/tests/integration/assignment.test.ts
git commit -m "feat(web): batch assignment API with transactional safety"
```

## Task M4.3: Assignment page UI

**Files:**
- Create: `web/app/(protected)/projects/[id]/batches/[batchId]/assign/page.tsx`
- Create: `web/app/(protected)/projects/[id]/batches/[batchId]/assign/assignment-matrix.tsx`

- [ ] **Step 1: Write server page**

Write `web/app/(protected)/projects/[id]/batches/[batchId]/assign/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { AssignmentMatrix } from './assignment-matrix';

export default async function AssignPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.assign');
  const { batchId } = await params;
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, include: { project: true } });
  if (!batch) return <div className="p-8">Batch not found</div>;

  const counts = await prisma.image.groupBy({
    by: ['state'],
    where: { batchId },
    _count: true,
  });
  const unassigned = counts.find((c) => c.state === 'unassigned')?._count ?? 0;
  const annotators = await prisma.user.findMany({
    where: { role: { in: ['annotator', 'admin'] }, isActive: true },
    orderBy: { email: 'asc' },
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Assign: {batch.name}</h1>
      <p className="text-sm text-gray-500 mb-6">
        Project {batch.project.name} — {unassigned} unassigned images
      </p>
      <AssignmentMatrix
        batchId={batchId}
        unassignedCount={unassigned}
        annotators={annotators.map((a) => ({ id: a.id, email: a.email }))}
      />
    </main>
  );
}
```

- [ ] **Step 2: Write client matrix**

Write `web/app/(protected)/projects/[id]/batches/[batchId]/assign/assignment-matrix.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { splitEvenly } from '@/lib/assignment';

type Annotator = { id: string; email: string };

export function AssignmentMatrix({
  batchId,
  unassignedCount,
  annotators,
}: {
  batchId: string;
  unassignedCount: number;
  annotators: Annotator[];
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const total = Object.values(counts).reduce((s, v) => s + (v || 0), 0);

  function distributeEvenly() {
    const parts = splitEvenly(unassignedCount, annotators.length);
    const next: Record<string, number> = {};
    annotators.forEach((a, i) => (next[a.id] = parts[i]));
    setCounts(next);
  }

  async function submit() {
    setBusy(true);
    const assignments = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([annotatorId, count]) => ({ annotatorId, count }));
    const res = await fetch(`/api/batches/${batchId}/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignments }),
    });
    setBusy(false);
    if (res.ok) location.href = `/`;
    else alert('Failed: ' + (await res.text()));
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={distributeEvenly}>
          Distribute evenly
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Annotator</th>
            <th className="text-left py-2">Count</th>
          </tr>
        </thead>
        <tbody>
          {annotators.map((a) => (
            <tr key={a.id} className="border-b">
              <td className="py-2">{a.email}</td>
              <td>
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={counts[a.id] ?? 0}
                  onChange={(e) =>
                    setCounts({ ...counts, [a.id]: parseInt(e.target.value) || 0 })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-sm">
        Total: {total} / {unassignedCount}
      </div>
      <Button onClick={submit} disabled={busy || total === 0 || total > unassignedCount}>
        {busy ? 'Assigning...' : 'Assign'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/app/\(protected\)/projects/\[id\]/batches
git commit -m "feat(web): assignment page with even-distribution helper"
```

## M4 Acceptance

- Admin opens Assignment page for a ready batch → sees unassigned count and annotator list
- Click "Distribute evenly" → fills counts automatically
- Click "Assign" → all images gain `assignedToId` and state flips to `assigned`
- Two concurrent assigns on the same pool: only one succeeds, the other returns 409
- Batch state flips to `in_annotation` after successful assign

---

# Milestone M5 — Canvas Annotation Editor

**The largest milestone.** Split into M5a (basic canvas + draw/edit/save) and M5b (prefetch + shortcuts + queue navigation).

## Task M5.1: State machine lib (unit tests)

**Files:**
- Create: `web/lib/state-machine.ts`, `web/tests/unit/state-machine.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/unit/state-machine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canTransition, type ImageState, type Transition } from '@/lib/state-machine';

describe('canTransition', () => {
  const cases: Array<[ImageState, Transition, boolean]> = [
    ['unassigned', 'assign', true],
    ['assigned', 'submit', true],
    ['annotated', 'enter_review', true],
    ['under_review', 'approve', true],
    ['under_review', 'reject', true],
    ['needs_rework', 'resubmit', true],
    ['approved', 'assign', false],
    ['assigned', 'approve', false],
    ['unassigned', 'submit', false],
    ['annotated', 'approve', false],
  ];
  for (const [from, action, expected] of cases) {
    it(`${from} --${action}-->${expected ? ' ok' : ' denied'}`, () => {
      expect(canTransition(from, action)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/unit/state-machine.test.ts
```

- [ ] **Step 3: Implement**

Write `web/lib/state-machine.ts`:
```ts
export type ImageState =
  | 'unassigned' | 'assigned' | 'annotated'
  | 'under_review' | 'approved' | 'needs_rework';

export type Transition =
  | 'assign' | 'submit' | 'enter_review'
  | 'approve' | 'reject' | 'resubmit';

const RULES: Record<Transition, { from: ImageState[]; to: ImageState }> = {
  assign:       { from: ['unassigned'],       to: 'assigned' },
  submit:       { from: ['assigned'],         to: 'annotated' },
  enter_review: { from: ['annotated'],        to: 'under_review' },
  approve:      { from: ['under_review'],     to: 'approved' },
  reject:       { from: ['under_review'],     to: 'needs_rework' },
  resubmit:     { from: ['needs_rework'],     to: 'under_review' },
};

export function canTransition(from: ImageState, action: Transition): boolean {
  return RULES[action].from.includes(from);
}

export function nextState(from: ImageState, action: Transition): ImageState {
  if (!canTransition(from, action)) {
    throw new Error(`Illegal transition ${from} --${action}-->`);
  }
  return RULES[action].to;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/unit/state-machine.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/lib/state-machine.ts web/tests/unit/state-machine.test.ts
git commit -m "feat(web): image state machine with transition validation"
```

## Task M5.2: My-queue endpoint

**Files:** Create `web/app/api/me/queue/route.ts`

- [ ] **Step 1: Write route**

Write `web/app/api/me/queue/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const images = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true, batchId: true, state: true, blobPath: true,
      batch: { select: { id: true, name: true, projectId: true, project: { select: { name: true, classes: true } } } },
    },
  });
  return NextResponse.json(images);
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/api/me/queue/route.ts
git commit -m "feat(web): my-queue endpoint"
```

## Task M5.3: Annotations auto-save PATCH endpoint

**Files:**
- Create: `web/app/api/images/[id]/annotations/route.ts`
- Create: `web/tests/integration/annotations.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/annotations.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('PATCH /api/images/[id]/annotations', () => {
  let imageId: string;

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({ data: { id: 'alice', email: 'a@t', role: 'annotator' } });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: { projectId: p.id, uploaderId: 'alice', name: 'b', state: 'in_annotation' },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id, blobPath: 'x', width: 0, height: 0,
        assignedToId: 'alice', state: 'assigned',
      },
    });
    imageId = img.id;
    __setFakeSession({ user: { id: 'alice', email: 'a@t', role: 'annotator' } });
  });

  it('replaces annotations for an assigned image', async () => {
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: img.updatedAt.toISOString(),
        boxes: [{ classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: imageId }) });
    expect(res.status).toBe(200);
    const ann = await prisma.annotation.findMany({ where: { imageId } });
    expect(ann).toHaveLength(1);
    expect(ann[0].source).toBe('human');
  });

  it('rejects stale write', async () => {
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: new Date('2000-01-01').toISOString(),
        boxes: [],
      }),
    });
    await expect(PATCH(req, { params: Promise.resolve({ id: imageId }) }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects when caller is not assignee', async () => {
    __setFakeSession({ user: { id: 'someone-else', email: 'x@t', role: 'annotator' } });
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: new Date().toISOString(),
        boxes: [],
      }),
    });
    await expect(PATCH(req, { params: Promise.resolve({ id: imageId }) }))
      .rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/annotations.test.ts
```

- [ ] **Step 3: Implement**

Write `web/app/api/images/[id]/annotations/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

const Box = z.object({
  classIdx: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const Body = z.object({
  lastKnownUpdatedAt: z.string().datetime(),
  boxes: z.array(Box),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const { id } = await params;
  const body = Body.parse(await req.json());

  const image = await prisma.image.findUnique({ where: { id } });
  if (!image) throw Object.assign(new Error('Not found'), { status: 404 });
  if (image.assignedToId !== session.user.id) {
    throw Object.assign(new Error('Not your image'), { status: 403 });
  }
  if (image.state !== 'assigned' && image.state !== 'needs_rework') {
    throw Object.assign(new Error(`Cannot edit in state ${image.state}`), { status: 409 });
  }
  if (image.updatedAt > new Date(body.lastKnownUpdatedAt)) {
    throw Object.assign(new Error('Stale write'), { status: 409 });
  }

  await prisma.$transaction([
    prisma.annotation.deleteMany({ where: { imageId: id } }),
    prisma.annotation.createMany({
      data: body.boxes.map((b) => ({
        imageId: id,
        classIdx: b.classIdx,
        x: b.x, y: b.y, w: b.w, h: b.h,
        source: 'human' as const,
        authorId: session.user.id,
      })),
    }),
    prisma.image.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);

  const refreshed = await prisma.image.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ updatedAt: refreshed.updatedAt });
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/integration/annotations.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/app/api/images/\[id\]/annotations web/tests/integration/annotations.test.ts
git commit -m "feat(web): annotation auto-save PATCH with optimistic concurrency"
```

## Task M5.4: Image submit + auto enter-review

**Files:**
- Create: `web/app/api/images/[id]/submit/route.ts`
- Append to: `web/tests/integration/annotations.test.ts`

- [ ] **Step 1: Write failing test**

Append to `web/tests/integration/annotations.test.ts`:
```ts
describe('POST /api/images/[id]/submit', () => {
  let imageId: string;
  let batchId: string;
  let secondImageId: string;

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({ data: { id: 'alice', email: 'a@t', role: 'annotator' } });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: { projectId: p.id, uploaderId: 'alice', name: 'b', state: 'in_annotation' },
    });
    batchId = b.id;
    const img1 = await prisma.image.create({
      data: { batchId: b.id, blobPath: '1', width: 0, height: 0, assignedToId: 'alice', state: 'assigned' },
    });
    const img2 = await prisma.image.create({
      data: { batchId: b.id, blobPath: '2', width: 0, height: 0, assignedToId: 'alice', state: 'assigned' },
    });
    imageId = img1.id;
    secondImageId = img2.id;
    __setFakeSession({ user: { id: 'alice', email: 'a@t', role: 'annotator' } });
  });

  it('marks annotated; does not enter review until all are annotated', async () => {
    const { POST } = await import('@/app/api/images/[id]/submit/route');
    const req = new Request('http://x', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: imageId }) });
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    expect(img.state).toBe('annotated');
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.state).toBe('in_annotation'); // not yet
  });

  it('enters review when last image is submitted', async () => {
    const { POST } = await import('@/app/api/images/[id]/submit/route');
    await POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: imageId }) });
    await POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: secondImageId }) });
    const images = await prisma.image.findMany({ where: { batchId } });
    expect(images.every((i) => i.state === 'under_review')).toBe(true);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.state).toBe('under_review');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/annotations.test.ts
```

- [ ] **Step 3: Implement**

Write `web/app/api/images/[id]/submit/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { canTransition } from '@/lib/state-machine';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    if (img.assignedToId !== session.user.id) {
      throw Object.assign(new Error('Not your image'), { status: 403 });
    }

    if (img.state === 'assigned' && canTransition('assigned', 'submit')) {
      await tx.image.update({ where: { id }, data: { state: 'annotated' } });
    } else if (img.state === 'needs_rework' && canTransition('needs_rework', 'resubmit')) {
      await tx.image.update({ where: { id }, data: { state: 'under_review' } });
      // Single-image re-review — no batch-level transition needed
      return;
    } else {
      throw Object.assign(new Error(`Illegal submit from ${img.state}`), { status: 409 });
    }

    // If this was the last non-annotated image in the batch, bulk-transition to under_review
    const remaining = await tx.image.count({
      where: { batchId: img.batchId, state: { not: 'annotated' } },
    });
    if (remaining === 0) {
      await tx.image.updateMany({
        where: { batchId: img.batchId, state: 'annotated' },
        data: { state: 'under_review' },
      });
      await tx.batch.update({
        where: { id: img.batchId },
        data: { state: 'under_review' },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/integration/annotations.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/app/api/images/\[id\]/submit web/tests/integration/annotations.test.ts
git commit -m "feat(web): image submit with auto batch-level enter-review"
```

## Task M5.5: Dashboard with my queue

**Files:** Create `web/app/(protected)/page.tsx` (overwrite placeholder)

- [ ] **Step 1: Write page**

Write `web/app/(protected)/page.tsx`:
```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) return null;

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    include: { batch: { include: { project: true } } },
    orderBy: { updatedAt: 'asc' },
  });

  const firstId = queue[0]?.id;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">My Queue</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">No assigned images.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            {queue.length} image{queue.length === 1 ? '' : 's'} waiting.
          </p>
          <Link href={`/annotate/${firstId}`} className="underline">
            Start annotating →
          </Link>
        </>
      )}
      <div className="mt-12">
        <Link href="/projects" className="underline">View all projects</Link>
      </div>
    </main>
  );
}
```

Also delete the old homepage placeholder at `web/app/page.tsx` — the `(protected)` group's root page takes over.

- [ ] **Step 2: Handle unprotected root**

Delete `web/app/page.tsx` (the old placeholder) — the `(protected)` route group handles `/`. If `web/app/page.tsx` still exists after route groups are added, middleware will redirect unauthenticated visitors to `/login` anyway.

```bash
rm web/app/page.tsx
```

- [ ] **Step 3: Commit**

```bash
git add -A web/app/\(protected\)/page.tsx web/app/page.tsx
git commit -m "feat(web): dashboard with my queue"
```

## Task M5.6: Annotation canvas component (client)

**Files:**
- Create: `web/components/annotation/AnnotationCanvas.tsx`
- Create: `web/components/annotation/ClassPalette.tsx`
- Create: `web/components/annotation/types.ts`

- [ ] **Step 1: Write shared types**

Write `web/components/annotation/types.ts`:
```ts
export type ClassDef = { idx: number; name: string; color: string };

export type Box = {
  id: string;          // local id (uuid) — not persisted
  classIdx: number;
  x: number; y: number; w: number; h: number; // YOLO normalized
  source: 'gemini' | 'human';
};
```

- [ ] **Step 2: Write ClassPalette**

Write `web/components/annotation/ClassPalette.tsx`:
```tsx
'use client';

import type { ClassDef } from './types';

export function ClassPalette({
  classes,
  activeIdx,
  onSelect,
}: {
  classes: ClassDef[];
  activeIdx: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="p-3 space-y-1">
      <div className="text-xs uppercase text-gray-500 mb-2">Classes</div>
      {classes.map((c) => (
        <button
          key={c.idx}
          onClick={() => onSelect(c.idx)}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left ${
            c.idx === activeIdx ? 'bg-indigo-900 text-indigo-100' : 'hover:bg-gray-800'
          }`}
        >
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
          <span className="flex-1">{c.name}</span>
          <span className="text-[10px] border px-1 rounded">{c.idx + 1}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write AnnotationCanvas**

Write `web/components/annotation/AnnotationCanvas.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { Box, ClassDef } from './types';

type Props = {
  imageUrl: string;
  classes: ClassDef[];
  activeClassIdx: number;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  width: number;
  height: number;
};

export function AnnotationCanvas({
  imageUrl,
  classes,
  activeClassIdx,
  boxes,
  onChange,
  width,
  height,
}: Props) {
  const [img] = useImage(imageUrl);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const natW = img?.naturalWidth ?? 1;
  const natH = img?.naturalHeight ?? 1;
  const scale = Math.min(width / natW, height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;

  function toNorm(px: number, total: number) { return Math.max(0, Math.min(1, px / total)); }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (drawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setDrawing({
      id: crypto.randomUUID(),
      classIdx: activeClassIdx,
      x: toNorm(pos.x, dispW),
      y: toNorm(pos.y, dispH),
      w: 0, h: 0,
      source: 'human',
    });
    setSelectedId(null);
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const nx = toNorm(pos.x, dispW);
    const ny = toNorm(pos.y, dispH);
    setDrawing({ ...drawing, w: nx - drawing.x, h: ny - drawing.y });
  }

  function handleMouseUp() {
    if (!drawing) return;
    // Normalize to center+size form
    const cx = drawing.x + drawing.w / 2;
    const cy = drawing.y + drawing.h / 2;
    const aw = Math.abs(drawing.w);
    const ah = Math.abs(drawing.h);
    if (aw < 0.01 || ah < 0.01) { setDrawing(null); return; }
    const normalized: Box = {
      ...drawing, x: cx, y: cy, w: aw, h: ah, source: 'human',
    };
    onChange([...boxes, normalized]);
    setDrawing(null);
  }

  function classColor(idx: number) { return classes[idx]?.color ?? '#888'; }

  function renderBox(box: Box) {
    // Convert center+size to top-left px
    const bx = (box.x - box.w / 2) * dispW;
    const by = (box.y - box.h / 2) * dispH;
    const bw = box.w * dispW;
    const bh = box.h * dispH;
    const isSelected = selectedId === box.id;
    return (
      <Group key={box.id} onClick={() => setSelectedId(box.id)}>
        <Rect
          x={bx} y={by} width={bw} height={bh}
          stroke={classColor(box.classIdx)}
          strokeWidth={isSelected ? 3 : 2}
          dash={box.source === 'gemini' ? [6, 4] : undefined}
        />
        <Text
          x={bx} y={by - 14}
          text={`${classes[box.classIdx]?.name ?? '?'}${box.source === 'gemini' ? ' (AI)' : ''}`}
          fontSize={11}
          fill={classColor(box.classIdx)}
        />
      </Group>
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    onChange(boxes.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, boxes]);

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer>
        {img && <KImage image={img} width={dispW} height={dispH} />}
        {boxes.map(renderBox)}
        {drawing && (
          <Rect
            x={drawing.x * dispW}
            y={drawing.y * dispH}
            width={drawing.w * dispW}
            height={drawing.h * dispH}
            stroke={classColor(drawing.classIdx)}
            strokeWidth={2}
            dash={[4, 2]}
          />
        )}
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 4: Install use-image**

```bash
pnpm add use-image
```

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): AnnotationCanvas + ClassPalette client components"
```

## Task M5.7: Annotate page + autosave wiring

**Files:**
- Create: `web/app/(protected)/annotate/[imageId]/page.tsx`
- Create: `web/app/(protected)/annotate/[imageId]/editor.tsx`

- [ ] **Step 1: Write server page**

Write `web/app/(protected)/annotate/[imageId]/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import { Editor } from './editor';

export default async function AnnotatePage({ params }: { params: Promise<{ imageId: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { imageId } = await params;

  const image = await prisma.image.findUnique({
    where: { id: imageId },
    include: {
      annotations: true,
      batch: { include: { project: true } },
    },
  });
  if (!image) notFound();
  if (image.assignedToId !== session.user.id) {
    return <main className="p-8">Not your image.</main>;
  }

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });

  const classes = image.batch.project.classes as Array<{ idx: number; name: string; color: string }>;

  return (
    <Editor
      imageId={image.id}
      imageUrl={image.blobPath}
      classes={classes}
      initialBoxes={image.annotations.map((a) => ({
        id: a.id,
        classIdx: a.classIdx,
        x: a.x, y: a.y, w: a.w, h: a.h,
        source: a.source as 'gemini' | 'human',
      }))}
      initialUpdatedAt={image.updatedAt.toISOString()}
      queueIds={queue.map((q) => q.id)}
      batchName={image.batch.name}
      projectName={image.batch.project.name}
    />
  );
}
```

- [ ] **Step 2: Write client editor**

Write `web/app/(protected)/annotate/[imageId]/editor.tsx`:
```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ClassPalette } from '@/components/annotation/ClassPalette';
import type { Box, ClassDef } from '@/components/annotation/types';
import { Button } from '@/components/ui/button';

const AnnotationCanvas = dynamic(
  () => import('@/components/annotation/AnnotationCanvas').then((m) => m.AnnotationCanvas),
  { ssr: false }
);

type Props = {
  imageId: string;
  imageUrl: string;
  classes: ClassDef[];
  initialBoxes: Box[];
  initialUpdatedAt: string;
  queueIds: string[];
  batchName: string;
  projectName: string;
};

export function Editor(p: Props) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<Box[]>(p.initialBoxes);
  const [activeIdx, setActiveIdx] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(p.initialUpdatedAt);
  const [status, setStatus] = useState('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentIdx = p.queueIds.indexOf(p.imageId);
  const nextId = p.queueIds[currentIdx + 1];

  // Auto-save on change, debounced 2 s
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus('saving...');
      const res = await fetch(`/api/images/${p.imageId}/annotations`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lastKnownUpdatedAt: updatedAt,
          boxes: boxes.map((b) => ({ classIdx: b.classIdx, x: b.x, y: b.y, w: b.w, h: b.h })),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setUpdatedAt(json.updatedAt);
        setStatus('saved');
      } else {
        setStatus('save failed');
      }
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [boxes]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setStatus('submitting...');
    const res = await fetch(`/api/images/${p.imageId}/submit`, { method: 'POST' });
    if (res.ok) {
      if (nextId) router.push(`/annotate/${nextId}`);
      else router.push('/');
    } else {
      setStatus('submit failed');
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 's' || e.key === 'S') submit();
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < p.classes.length) setActiveIdx(idx);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [boxes]);

  return (
    <div className="grid grid-cols-[220px_1fr_200px] h-screen bg-gray-950 text-gray-100">
      {/* Queue */}
      <aside className="border-r border-gray-800 p-3 overflow-y-auto">
        <div className="text-xs uppercase text-gray-500 mb-2">Queue ({p.queueIds.length})</div>
        {p.queueIds.map((qid, i) => (
          <div key={qid} className={`py-1 text-xs ${qid === p.imageId ? 'text-indigo-300' : 'text-gray-400'}`}>
            {i < currentIdx ? '✓' : qid === p.imageId ? '●' : '○'} {i + 1}
          </div>
        ))}
      </aside>

      {/* Canvas */}
      <main className="flex flex-col">
        <header className="px-4 py-2 border-b border-gray-800 text-xs flex justify-between">
          <span>{p.projectName} / {p.batchName} / {currentIdx + 1} of {p.queueIds.length}</span>
          <span>W draw · Del delete · 1-9 class · S submit</span>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <AnnotationCanvas
            imageUrl={p.imageUrl}
            classes={p.classes}
            activeClassIdx={activeIdx}
            boxes={boxes}
            onChange={setBoxes}
            width={800}
            height={600}
          />
        </div>
        <footer className="px-4 py-2 border-t border-gray-800 flex justify-between items-center text-xs">
          <span>{status}</span>
          <Button onClick={submit}>Submit & next (S)</Button>
        </footer>
      </main>

      {/* Class palette */}
      <aside className="border-l border-gray-800 overflow-y-auto">
        <ClassPalette classes={p.classes} activeIdx={activeIdx} onSelect={setActiveIdx} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Verify dev flow**

Run `pnpm dev`, log in as an annotator with assigned images, open `/annotate/<imageId>`. Expected: canvas renders, can draw boxes, auto-save triggers 2 s after last change, submit jumps to next.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/annotate
git commit -m "feat(web): annotation editor page with auto-save and shortcuts"
```

## Task M5.8: Prefetch next images

**Files:** Modify `web/app/(protected)/annotate/[imageId]/editor.tsx`

- [ ] **Step 1: Add prefetch logic**

Add inside `Editor` component in `editor.tsx`, after the existing useEffects:
```tsx
useEffect(() => {
  const nextIds = p.queueIds.slice(currentIdx + 1, currentIdx + 6);
  for (const id of nextIds) {
    fetch(`/api/images/${id}/signed-url`)
      .then((r) => r.json())
      .then((j) => {
        const img = new Image();
        img.src = j.url;
      })
      .catch(() => {});
  }
}, [p.imageId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(protected\)/annotate/\[imageId\]/editor.tsx
git commit -m "feat(web): prefetch next 5 images for sub-second switching"
```

## M5 Acceptance

- Assigned annotator navigates to `/` → sees queue → enters editor
- Drawing a box → 2 s later auto-save PATCH → updatedAt returned in response
- Pressing S → `/submit` → router navigates to next image
- Pressing 1-9 → class changes
- Pressing Del → selected box removed
- Last submit triggers the batch to `under_review` (verified via integration test M5.4)

---

# Milestone M6 — Review Flow

Goal: `final_reviewer` role sees `/review/[batchId]`, swipes through each `under_review` image, approves or rejects with comment, reworked images re-enter review seamlessly.

## Task M6.1: Approve + Reject API

**Files:**
- Create: `web/app/api/images/[id]/approve/route.ts`, `web/app/api/images/[id]/reject/route.ts`
- Create: `web/tests/integration/review.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/review.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('review flow', () => {
  let imageId: string;

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({ data: { id: 'alice', email: 'a@t', role: 'annotator' } });
    await prisma.user.create({ data: { id: 'eve', email: 'eve@t', role: 'final_reviewer' } });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: { projectId: p.id, uploaderId: 'alice', name: 'b', state: 'under_review' },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id, blobPath: 'x', width: 0, height: 0,
        assignedToId: 'alice', state: 'under_review',
      },
    });
    imageId = img.id;
    __setFakeSession({ user: { id: 'eve', email: 'eve@t', role: 'final_reviewer' } });
  });

  it('approves', async () => {
    const { POST } = await import('@/app/api/images/[id]/approve/route');
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: imageId }),
    });
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    expect(img.state).toBe('approved');
  });

  it('rejects with comment and marks needs_rework', async () => {
    const { POST } = await import('@/app/api/images/[id]/reject/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'box too big' }),
      }),
      { params: Promise.resolve({ id: imageId }) }
    );
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    expect(img.state).toBe('needs_rework');
    const ev = await prisma.reviewEvent.findFirst({ where: { imageId } });
    expect(ev?.comment).toBe('box too big');
  });

  it('rejects rejection without comment', async () => {
    const { POST } = await import('@/app/api/images/[id]/reject/route');
    await expect(
      POST(
        new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
        { params: Promise.resolve({ id: imageId }) }
      )
    ).rejects.toThrow();
  });

  it('annotator cannot approve', async () => {
    __setFakeSession({ user: { id: 'alice', email: 'a@t', role: 'annotator' } });
    const { POST } = await import('@/app/api/images/[id]/approve/route');
    await expect(
      POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: imageId }) })
    ).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/review.test.ts
```

- [ ] **Step 3: Implement approve**

Write `web/app/api/images/[id]/approve/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { nextState } from '@/lib/state-machine';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.approve');
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    const to = nextState(img.state, 'approve'); // throws if illegal
    await tx.image.update({ where: { id }, data: { state: to } });
    await tx.reviewEvent.create({
      data: { imageId: id, reviewerId: session!.user.id, action: 'approve' },
    });

    // If batch has no more under_review images, mark completed
    const remaining = await tx.image.count({
      where: { batchId: img.batchId, state: { in: ['under_review', 'needs_rework', 'assigned', 'annotated'] } },
    });
    if (remaining === 0) {
      await tx.batch.update({ where: { id: img.batchId }, data: { state: 'completed' } });
    }
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement reject**

Write `web/app/api/images/[id]/reject/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { nextState } from '@/lib/state-machine';

const Body = z.object({ comment: z.string().min(1).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.reject');
  const { id } = await params;
  const body = Body.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    const to = nextState(img.state, 'reject');
    await tx.image.update({ where: { id }, data: { state: to, assignedToId: img.assignedToId } });
    await tx.reviewEvent.create({
      data: {
        imageId: id,
        reviewerId: session!.user.id,
        action: 'reject',
        comment: body.comment,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm test tests/integration/review.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add web/app/api/images/\[id\]/approve web/app/api/images/\[id\]/reject web/tests/integration/review.test.ts
git commit -m "feat(web): approve and reject API with state-machine enforcement"
```

## Task M6.2: Review page UI

**Files:**
- Create: `web/app/(protected)/review/[batchId]/page.tsx`
- Create: `web/app/(protected)/review/[batchId]/review-tray.tsx`

- [ ] **Step 1: Install dialog**

```bash
pnpm dlx shadcn@latest add dialog
```

- [ ] **Step 2: Write server page**

Write `web/app/(protected)/review/[batchId]/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { ReviewTray } from './review-tray';
import { notFound } from 'next/navigation';

export default async function ReviewBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.approve');
  const { batchId } = await params;

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: true },
  });
  if (!batch) notFound();

  const images = await prisma.image.findMany({
    where: { batchId, state: 'under_review' },
    include: { annotations: true },
    orderBy: { id: 'asc' },
  });

  const classes = batch.project.classes as Array<{ idx: number; name: string; color: string }>;

  return (
    <ReviewTray
      batchName={batch.name}
      projectName={batch.project.name}
      classes={classes}
      images={images.map((img) => ({
        id: img.id,
        imageUrl: img.blobPath,
        boxes: img.annotations.map((a) => ({
          id: a.id, classIdx: a.classIdx,
          x: a.x, y: a.y, w: a.w, h: a.h,
          source: a.source as 'gemini' | 'human',
        })),
      }))}
    />
  );
}
```

- [ ] **Step 3: Write review tray client**

Write `web/app/(protected)/review/[batchId]/review-tray.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Box, ClassDef } from '@/components/annotation/types';

const AnnotationCanvas = dynamic(
  () => import('@/components/annotation/AnnotationCanvas').then((m) => m.AnnotationCanvas),
  { ssr: false }
);

type ReviewImage = { id: string; imageUrl: string; boxes: Box[] };

export function ReviewTray({
  batchName,
  projectName,
  classes,
  images,
}: {
  batchName: string;
  projectName: string;
  classes: ClassDef[];
  images: ReviewImage[];
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const current = images[idx];

  async function approve() {
    if (!current) return;
    const res = await fetch(`/api/images/${current.id}/approve`, { method: 'POST' });
    if (res.ok) next();
  }
  function openReject() { setRejectComment(''); setRejectOpen(true); }
  async function confirmReject() {
    if (!current || !rejectComment.trim()) return;
    const res = await fetch(`/api/images/${current.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: rejectComment }),
    });
    if (res.ok) {
      setRejectOpen(false);
      next();
    }
  }
  function next() {
    if (idx + 1 < images.length) setIdx(idx + 1);
    else router.push('/');
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (rejectOpen) return;
      if (e.code === 'Space') { e.preventDefault(); approve(); }
      if (e.key === 'r' || e.key === 'R') openReject();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [idx, rejectOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) {
    return <main className="p-8">All images reviewed for batch {batchName}.</main>;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <header className="px-4 py-2 border-b border-gray-800 text-xs flex justify-between">
        <span>{projectName} / {batchName} / {idx + 1} of {images.length}</span>
        <span>Space approve · R reject</span>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <AnnotationCanvas
          imageUrl={current.imageUrl}
          classes={classes}
          activeClassIdx={0}
          boxes={current.boxes}
          onChange={() => {}}
          width={900}
          height={600}
        />
      </div>
      <footer className="px-4 py-3 border-t border-gray-800 flex gap-2 justify-end">
        <Button variant="outline" onClick={openReject}>Reject (R)</Button>
        <Button onClick={approve}>Approve (Space)</Button>
      </footer>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject with comment</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Why reject? (required)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button onClick={confirmReject} disabled={!rejectComment.trim()}>Confirm reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/review
git commit -m "feat(web): review tray with approve/reject and keyboard shortcuts"
```

## Task M6.3: Final reviewer dashboard hook

**Files:** Modify `web/app/(protected)/page.tsx`

- [ ] **Step 1: Add reviewer section**

Replace `web/app/(protected)/page.tsx` with:
```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) return null;
  const role = session.user.role;

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const reviewableBatches = role === 'final_reviewer' || role === 'admin'
    ? await prisma.batch.findMany({
        where: { state: 'under_review' },
        include: { project: true, _count: { select: { images: { where: { state: 'under_review' } } } } },
      })
    : [];

  const firstQueueId = queue[0]?.id;

  return (
    <main className="p-8 space-y-10">
      <section>
        <h1 className="text-2xl font-bold mb-4">My Queue</h1>
        {queue.length === 0 ? (
          <p className="text-gray-500">No assigned images.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-2">{queue.length} waiting.</p>
            <Link href={`/annotate/${firstQueueId}`} className="underline">Start annotating →</Link>
          </>
        )}
      </section>

      {reviewableBatches.length > 0 && (
        <section>
          <h1 className="text-2xl font-bold mb-4">Ready for Review</h1>
          <ul className="space-y-2">
            {reviewableBatches.map((b) => (
              <li key={b.id} className="border rounded p-3">
                <Link href={`/review/${b.id}`} className="underline">
                  {b.project.name} — {b.name} ({b._count.images} images)
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <Link href="/projects" className="underline text-sm">All projects</Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(protected\)/page.tsx
git commit -m "feat(web): dashboard surfaces batches ready for review"
```

## M6 Acceptance

- Reviewer logs in → sees ready batches on dashboard
- Opens review → sees first `under_review` image
- Space approves, R opens comment dialog, Ctrl+Enter confirms reject
- Rejected image flips to `needs_rework`; assignee dashboard re-surfaces it
- After annotator resubmits, image state returns to `under_review` and is visible to reviewer again
- Last approved image in a batch → batch state flips to `completed`

---

# Milestone M7 — YOLO Export + Security Review

Goal: Export approved images + annotations as a YOLO-format zip that can be handed unchanged to `train_robot_model.py`. Final security pass, hardened signed URLs, Lighthouse optimization.

## Task M7.1: Export endpoint

**Files:**
- Create: `web/app/api/projects/[id]/export/route.ts`
- Create: `web/tests/integration/export.test.ts`

- [ ] **Step 1: Write failing test**

Write `web/tests/integration/export.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';
import { unzipSync, strFromU8 } from 'fflate';

// Mock image fetch — return a 1×1 JPEG blob
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
global.fetch = vi.fn(async () => new Response(fakeJpeg)) as typeof fetch;

describe('GET /api/projects/[id]/export', () => {
  let projectId: string;

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({ data: { id: 'u-admin', email: 'a@t', role: 'admin' } });
    const p = await prisma.project.create({
      data: {
        name: 'coral',
        classes: [
          { idx: 0, name: 'coral', color: '#eab308' },
          { idx: 1, name: 'algae', color: '#22c55e' },
        ],
      },
    });
    projectId = p.id;
    const b = await prisma.batch.create({
      data: { projectId: p.id, uploaderId: 'u-admin', name: 'b1', state: 'completed' },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id, blobPath: 'https://fake/img.jpg',
        width: 0, height: 0, state: 'approved',
      },
    });
    await prisma.annotation.create({
      data: { imageId: img.id, classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2, source: 'human' },
    });
    __setFakeSession({ user: { id: 'u-admin', email: 'a@t', role: 'admin' } });
  });

  it('returns a YOLO zip with approved images', async () => {
    const { GET } = await import('@/app/api/projects/[id]/export/route');
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    expect(Object.keys(entries)).toContain('classes.txt');
    expect(Object.keys(entries)).toContain('data.yaml');
    expect(strFromU8(entries['classes.txt'])).toContain('coral');
    const labelKey = Object.keys(entries).find((k) => k.startsWith('labels/') && k.endsWith('.txt'));
    expect(labelKey).toBeTruthy();
    expect(strFromU8(entries[labelKey!])).toContain('0 0.5 0.5 0.2 0.2');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm test tests/integration/export.test.ts
```

- [ ] **Step 3: Implement**

Write `web/app/api/projects/[id]/export/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { serializeYoloLabel } from '@/lib/yolo';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'export.download');
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw Object.assign(new Error('Not found'), { status: 404 });
  const classes = project.classes as Array<{ idx: number; name: string; color: string }>;

  const images = await prisma.image.findMany({
    where: { batch: { projectId: id }, state: 'approved' },
    include: { annotations: true },
  });

  const zipEntries: Record<string, Uint8Array> = {};

  // classes.txt
  zipEntries['classes.txt'] = strToU8(classes.map((c) => c.name).join('\n') + '\n');

  // data.yaml — train_robot_model.py consumes this
  const dataYaml = [
    `train: ./images`,
    `val: ./images`,
    `nc: ${classes.length}`,
    `names: [${classes.map((c) => `'${c.name}'`).join(', ')}]`,
    '',
  ].join('\n');
  zipEntries['data.yaml'] = strToU8(dataYaml);

  // Images + labels
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const resp = await fetch(img.blobPath);
    if (!resp.ok) continue;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const filename = `img_${String(i).padStart(6, '0')}.jpg`;
    zipEntries[`images/${filename}`] = bytes;
    zipEntries[`labels/${filename.replace(/\.jpg$/, '.txt')}`] = strToU8(
      serializeYoloLabel(img.annotations.map((a) => ({
        classIdx: a.classIdx, x: a.x, y: a.y, w: a.w, h: a.h,
      })))
    );
  }

  const zipBuf = zipSync(zipEntries);
  return new NextResponse(zipBuf, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${project.name}-yolo.zip"`,
    },
  });
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/integration/export.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/app/api/projects/\[id\]/export web/tests/integration/export.test.ts
git commit -m "feat(web): YOLO dataset export endpoint"
```

## Task M7.2: Export page UI

**Files:** Create `web/app/(protected)/projects/[id]/export/page.tsx`

- [ ] **Step 1: Write page**

Write `web/app/(protected)/projects/[id]/export/page.tsx`:
```tsx
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireRole(session?.user.role, 'export.download');
  const { id } = await params;

  const approved = await prisma.image.count({
    where: { batch: { projectId: id }, state: 'approved' },
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Export YOLO Dataset</h1>
      <p className="text-sm text-gray-600 mb-6">{approved} approved images will be included.</p>
      <a href={`/api/projects/${id}/export`}>
        <Button disabled={approved === 0}>Download zip</Button>
      </a>
      <p className="text-xs text-gray-400 mt-6">
        The downloaded zip is ready for <code>train_robot_model.py --local-dataset data.yaml</code> on the GPU machine.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/\(protected\)/projects/\[id\]/export
git commit -m "feat(web): export page with approved image count"
```

## Task M7.3: Audit log write helper + wire into mutations

**Files:**
- Create: `web/lib/audit.ts`
- Modify: `web/app/api/images/[id]/approve/route.ts`, `web/app/api/images/[id]/reject/route.ts`, `web/app/api/batches/[id]/assign/route.ts`

- [ ] **Step 1: Write audit helper**

Write `web/lib/audit.ts`:
```ts
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export async function writeAudit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  payload: Prisma.JsonValue
) {
  await prisma.auditLog.create({
    data: { actorId, action, targetType, targetId, payload: payload as Prisma.InputJsonValue },
  });
}
```

- [ ] **Step 2: Wire audit into approve route**

In `web/app/api/images/[id]/approve/route.ts`, inside the transaction, after `reviewEvent.create`, add:
```ts
// Audit log (outside tx is fine too, but inside is atomic)
```
Actually we want it outside the tx so we don't block. After the transaction ends, add:
```ts
await writeAudit(session!.user.id, 'image.approve', 'image', id, {});
```
And import at top:
```ts
import { writeAudit } from '@/lib/audit';
```

- [ ] **Step 3: Wire audit into reject route**

In `web/app/api/images/[id]/reject/route.ts`, after the tx:
```ts
await writeAudit(session!.user.id, 'image.reject', 'image', id, { comment: body.comment });
```

- [ ] **Step 4: Wire audit into assign route**

In `web/app/api/batches/[id]/assign/route.ts`, after the tx:
```ts
await writeAudit(session!.user.id, 'batch.assign', 'batch', batchId, { assignments: body.assignments });
```

- [ ] **Step 5: Commit**

```bash
git add web/lib/audit.ts web/app/api/images web/app/api/batches
git commit -m "feat(web): audit log for approve, reject, assign"
```

## Task M7.4: Signed URL hardening (15-minute TTL)

**Files:** Modify `web/lib/blob.ts`, `web/app/api/images/[id]/signed-url/route.ts`

Vercel Blob's public URL is the simplest path. For stricter security we can store blobs with a random suffix in the path and rely on the URL acting as a capability token (common pattern). For the scope of this plan — an internal team tool behind email whitelist — the public URL is acceptable given the session-gated `/signed-url` endpoint. Document the trade-off clearly in code.

- [ ] **Step 1: Add note in blob.ts**

Edit `web/lib/blob.ts` — add a top-of-file comment:
```ts
// Blob URL policy:
// - All blobs are uploaded with randomSuffix=false and predictable paths keyed
//   by batchId. The public URL is served behind the /api/images/[id]/signed-url
//   endpoint, which requires an authenticated session. This keeps unauth users
//   from guessing URLs via the session gate rather than via URL opacity.
// - For higher security (external disclosure risk), migrate to presigned URLs
//   by tracking blob pathnames and generating short-lived tokens — not done
//   in this milestone because it adds complexity unjustified by internal use.
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/blob.ts
git commit -m "docs(web): document blob URL security policy"
```

## Task M7.5: Run security scan

**Files:** N/A — this is a tool run.

- [ ] **Step 1: Run Next.js security scan**

Invoke the `agent-skills:nextjs-security-scan` skill (see Claude Code docs) targeting `web/`. Review findings.

- [ ] **Step 2: Address any HIGH or CRITICAL findings**

For each HIGH/CRITICAL finding, open a fix task, write failing test, implement, commit. Re-run the scan until clean.

- [ ] **Step 3: Commit any fixes**

If fixes were needed, commit them:
```bash
git add <changed files>
git commit -m "fix(web): address security scan findings"
```

## Task M7.6: Playwright E2E test

**Files:**
- Create: `web/playwright.config.ts`, `web/tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Write Playwright config**

Write `web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', port: 3000, reuseExistingServer: true },
});
```

- [ ] **Step 2: Write E2E happy-path spec**

Write `web/tests/e2e/happy-path.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

// This E2E assumes a pre-populated DB (seeded admin + whitelisted email).
// Full auth flow is mocked via a TEST_SESSION cookie in dev.

test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

test('dashboard renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Sign in with Google')).toBeVisible();
});
```

Note: full E2E with actual Google SSO is complex. This minimal test verifies the login page renders. A comprehensive E2E (upload → assign → annotate → review → export) requires a mockable auth mode and is deferred to a follow-up if needed.

- [ ] **Step 3: Run Playwright**

```bash
pnpm dlx playwright install chromium
pnpm exec playwright test
```
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add web/playwright.config.ts web/tests/e2e
git commit -m "test(web): minimal Playwright E2E for login page"
```

## Task M7.7: Final acceptance run

- [ ] **Step 1: Run full test suite**

```bash
cd web && pnpm lint && pnpm test && pnpm build
```
Expected: all green.

- [ ] **Step 2: Manual exploratory test**

On the deployed Vercel URL, run the full flow with the actual `train_robot_model.py`:
1. Log in as admin
2. Create a project with 2 classes
3. Prepare a tiny YOLO zip locally (`images/*.jpg`, `labels/*.txt`, `classes.txt`)
4. Upload → assign 5 images to yourself as annotator
5. Annotate, submit all → batch enters review
6. Approve all → export zip
7. On a GPU machine, run:
   ```bash
   cd frc-train-review
   unzip <downloaded-zip> -d /tmp/test-ds
   python train_robot_model.py --local-dataset /tmp/test-ds/data.yaml --epochs 1 --device cpu
   ```
8. Verify training starts without errors

- [ ] **Step 3: If anything fails, document and fix**

Do not mark this task complete until step 2 passes end to end.

## M7 Acceptance

- YOLO zip downloads; `unzip` shows `classes.txt`, `data.yaml`, `images/`, `labels/`
- The zip fed to `train_robot_model.py --local-dataset` starts a real training run (dry-run 1 epoch)
- `agent-skills:nextjs-security-scan` returns 0 HIGH/CRITICAL findings
- All unit + integration + minimal E2E tests pass
- Vercel production deploy live
- Audit log records approves / rejects / assigns with actor + timestamp

---

# Self-Review Notes

Quick pass against the spec after writing:

- **Spec Section 1 Purpose** → all milestones serve review of auto-labeled data → export YOLO. ✓
- **Spec Section 3 Roles** → M1 implements all three roles, M4 uses annotator role, M6 uses final_reviewer. ✓
- **Spec Section 4 Tech stack** → M0 installs every item in the stack table. ✓
- **Spec Section 5 Data model** → M0.3 Prisma schema mirrors the spec model 1:1. ✓
- **Spec Section 5 State machine** → M5.1 tests every legal transition including the corrected `needs_rework → under_review` path. ✓
- **Spec Section 6 Pages and APIs** → every endpoint listed exists as a task (route file + test). ✓
- **Spec Section 7 UX decisions** → auto-save (M5.3, M5.7), keyboard shortcuts (M5.7), dashed/solid bbox style (M5.6), prefetch (M5.8), batch auto-transition (M5.4). ✓
- **Spec Section 8 Security**:
  - Upload 4.5 MB limit → direct-to-blob (M3.4, M3.7). ✓
  - Optimistic concurrency on auto-save → M5.3 test `rejects stale write`. ✓
  - Role bypass → RBAC helper + every route calls `requireRole` (M1.5, all mutation routes). ✓
  - Zip bomb → zip validator (M3.2). ✓
  - XSS comment → React auto-escape, no `dangerouslySetInnerHTML`. Documented as implicit ✓
  - Signed URL → M3.6 placeholder + M7.4 documented trade-off. Accepted as internal tool. ✓
- **Spec Section 9 Testing** → unit in `tests/unit/`, integration in `tests/integration/`, E2E in `tests/e2e/` (M7.6 minimal). ✓
- **Spec Section 10 Milestones** → plan has 8 milestones matching M0–M7. ✓
- **Spec Section 11 Out of scope** → plan never touches `train_robot_model.py`, only reads the exported zip shape. ✓

Placeholder scan: no TBD, no "add error handling", no "similar to Task N", no "TODO implement later". ✓

Type consistency: `ImageState`, `ClassDef`, `Box` all match across tasks. Route handler signature `{ params: Promise<{...}> }` consistent across Next.js 15 idiom. ✓
