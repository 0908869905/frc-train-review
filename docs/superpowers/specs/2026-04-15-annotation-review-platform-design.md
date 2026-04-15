# Annotation Review Platform — Design Spec

**Date**: 2026-04-15
**Status**: Draft, pending user approval
**Author**: brainstorming session with Claude

---

## 1. Purpose

Build an internal web platform (similar to Roboflow) for the FRC team where members can review Gemini-auto-labeled object detection data and export approved datasets for training a new onboard vision model for the robot.

**Important scope boundary**: This is a brand-new, independent pipeline. It does **NOT** modify or interact with the existing `train_robot_model.py` script, which trains Red/Blue chassis detection for the scoring-analyzer match video pipeline. The two pipelines must remain fully isolated.

---

## 2. Goals and Non-Goals

### Goals
- Teammates (16+) can review and correct Gemini-auto-labeled bounding boxes from any location
- Admin can upload batches, assign review work, and manage classes per project
- Final reviewer does a single-pass QA on fully-annotated batches before export
- Export approved data as a YOLO-format zip that can be fed directly to the existing `train_robot_model.py` (or any future YOLO trainer) without any format conversion
- Support multiple parallel training projects (e.g. `coral-detector-2026`, `apriltag-v1`) each with their own class list

### Non-Goals
- No in-browser Gemini auto-labeling — labeling is done off-platform by an external Python script
- No in-platform training — training runs on a separate GPU machine using existing scripts
- No multi-tenancy — single team workspace only
- No changes to the existing `train_robot_model.py` or the scoring-analyzer pipeline
- No mobile app — desktop-first browser experience only

---

## 3. Users and Roles

Single workspace for one FRC team, 16+ active members.

| Role | Responsibilities |
|---|---|
| **admin** | Creates projects, manages class lists, uploads batches, assigns work, manages email whitelist, triggers export |
| **annotator** | Reviews assigned images, corrects Gemini-preset bounding boxes, submits annotations |
| **final_reviewer** | After all annotators in a batch finish, does a single pass to approve or reject each image |

A single user may hold multiple roles (e.g. the team lead is admin + final_reviewer).

Authentication: Google OAuth with a server-side email whitelist. Non-whitelisted Google accounts cannot log in regardless of account validity.

---

## 4. System Architecture

### Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript end-to-end |
| Frontend UI | React Server Components + Client Islands, Tailwind, shadcn/ui |
| Canvas | react-konva |
| Backend | Next.js Route Handlers + Server Actions (same process) |
| ORM | Prisma |
| Database | Neon Postgres (serverless) |
| Object storage | Vercel Blob |
| Auth | Auth.js (Google OAuth provider) |
| Deployment | Vercel (git push to deploy) |
| CI | GitHub Actions (lint + unit + integration + E2E) |

### Why Next.js full-stack

1. The workload is 90% CRUD + canvas UI, which is Next.js's sweet spot
2. Single repo, single language, single deployment — minimum ops burden
3. Vercel-native integrations (Blob + Neon) avoid separate credential management
4. Future extensions (e.g. calling Gemini from the server, triggering remote training) can still be added via Route Handlers without architectural change
5. The existing `train_robot_model.py` stays fully decoupled — the only contact point is a downloaded YOLO zip

### High-level data flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (annotator / admin / reviewer) — Canvas, shortcuts     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTPS via Vercel Edge / CDN / prefetch
┌──────────────────────▼──────────────────────────────────────────┐
│  Next.js 15 (App Router) — SSR pages + Client annotation editor │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Route Handlers + Server Actions (in-process)
┌──────────────────────▼──────────────────────────────────────────┐
│  Auth.js │ Prisma │ @vercel/blob │ state-machine validator      │
└──────┬──────────┬──────────┬────────────────────────────────────┘
       │          │          │
  Neon Postgres  Vercel Blob  Google OAuth
```

External / out of scope (not reached by the web platform at runtime):
- **Gemini labeling script** — runs on admin's local machine, outputs a YOLO zip, uploaded manually
- **GPU training machine** — downloads the exported YOLO zip, runs `train_robot_model.py`, produces `.onnx`

---

## 5. Data Model

Prisma schema sketch:

```
User {
  id, email (unique), name, role (admin|annotator|final_reviewer),
  is_active, created_at
}

Project {
  id, name, description,
  classes: ClassDefinition[],       // ordered; defines YOLO class_idx
  created_at
}

ClassDefinition (embedded as JSON on Project) {
  idx, name, color
}

Batch {
  id, project_id, uploader_id,
  name, source (e.g. "gemini-2026-04-15"),
  state: pending_upload | ready | in_annotation | under_review | completed,
  created_at
}

Image {
  id, batch_id, blob_path, thumbnail_path,
  width, height,
  assigned_to (User?),
  state: unassigned | assigned | annotated | under_review | approved | needs_rework,
  updated_at            // used for optimistic concurrency on auto-save
}

Annotation {
  id, image_id, class_idx,
  x, y, w, h,           // YOLO-normalized (0..1)
  source: gemini | human,
  author_id, updated_at
}

ReviewEvent {
  id, image_id, reviewer_id,
  action: approve | reject,
  comment (required on reject, nullable on approve),
  created_at
}

AuditLog {
  id, actor_id, action, target_type, target_id,
  payload (JSON), created_at
}

EmailWhitelist {
  email (pk), role, added_by, added_at
}
```

### Image state machine

```
unassigned ──admin assign──▶ assigned ──submit──▶ annotated
                                                      │
                                        batch all annotated
                                                      ▼
                                               under_review ◀──┐
                                                  │      │    │
                                            approve      reject│+ comment
                                                  │      │    │
                                                  ▼      ▼    │
                                             approved  needs_rework
                                                         │    │
                                                         └──annotator resubmit──┘
                                                            (directly back to under_review)
```

### State transition rules (server-enforced)

| Trigger | Action | From → To | Guard |
|---|---|---|---|
| admin | assign | `unassigned → assigned` | target user has annotator role |
| annotator | submit | `assigned → annotated` | caller must equal `Image.assigned_to` |
| system | enter_review | `annotated → under_review` | automatic when batch's images are all annotated |
| final_reviewer | approve | `under_review → approved` | caller has `final_reviewer` role |
| final_reviewer | reject | `under_review → needs_rework` | comment required (non-empty string) |
| annotator | resubmit | `needs_rework → under_review` | caller must equal original `assigned_to`; bypasses batch-level gate so individual reworked images can be re-reviewed without waiting |

No retry count limit on rework. Rejected images do not reset the entire batch to review — each image is re-reviewed independently after rework.

---

## 6. Pages and API

### Pages

| Path | Role | Purpose |
|---|---|---|
| `/login` | public | Google SSO |
| `/` | all | Dashboard: my queue + project list |
| `/projects/[id]` | all | Project home: batches, progress, class list |
| `/projects/[id]/upload` | admin | Upload YOLO zip |
| `/projects/[id]/batches/[batchId]/assign` | admin | Distribute images to annotators |
| `/annotate/[imageId]` | annotator | Canvas editor |
| `/review/[batchId]` | final_reviewer | Approve / reject sweep |
| `/projects/[id]/export` | admin | Download YOLO zip |
| `/admin/users` | admin | Manage email whitelist |

### Core React components

- `<AnnotationCanvas>` — react-konva stage with bbox create/edit/delete, zoom, pan, vertex drag
- `<ClassPalette>` — right panel; keys 1–9 switch active class; color swatches match bbox borders
- `<ImageQueue>` — left thumbnail column with `done / current / pending` markers; prefetch next 5 images
- `<BatchUploader>` — dropzone → direct-to-Blob client upload → metadata POST
- `<AssignmentMatrix>` — admin UI to drag or bulk-input N images to teammate X; shows workload per person
- `<ReviewTray>` — streamlined approve/reject view with spacebar (approve) / R (reject+comment) keyboard flow

### API (Route Handlers)

```
POST   /api/projects                        create project
PATCH  /api/projects/[id]                   rename / update classes
POST   /api/projects/[id]/batches           initiate batch upload (returns presigned URL)
POST   /api/batches/[id]/finalize           after client direct-upload, post metadata
POST   /api/batches/[id]/assign             admin assign
GET    /api/me/queue                        my assigned images
PATCH  /api/images/[id]/annotations         auto-save (requires updated_at for concurrency)
POST   /api/images/[id]/submit              mark annotated
POST   /api/batches/[id]/enter-review       internal (called by submit handler)
POST   /api/images/[id]/approve             final reviewer
POST   /api/images/[id]/reject              final reviewer; comment required
GET    /api/projects/[id]/export            stream YOLO zip
GET    /api/admin/users                     list whitelist
POST   /api/admin/users                     add to whitelist
DELETE /api/admin/users/[email]             remove from whitelist
```

All state-mutating endpoints require:
1. Authenticated session
2. Role check against the required role for this action
3. State transition validation against the current `Image.state`

---

## 7. Key UX Decisions

- **Auto-save**: annotations are PATCHed every 2 seconds during editing. Never rely on an explicit "Save" button for safety. Submit is a distinct action that transitions state.
- **Keyboard-first**: once a bounding box is drawn, the annotator should not need to leave the canvas. Shortcuts: `W` new box, `Del` delete selected, `1-9` switch class, `←/→` prev/next image, `S` submit, `Esc` deselect.
- **Gemini-preset vs human-edited**: preset boxes display with a dashed border; once a user edits or confirms them they become solid. This makes "which boxes are still AI suggestions?" visible at a glance.
- **Prefetch**: the next 5 images in a queue are requested as soon as the current image loads, making `→` feel instant.
- **Batch-level auto-transition**: when the last image in a batch becomes `annotated`, the system automatically enters review mode and notifies the final reviewer (in-app badge + optional email).
- **Review ergonomics**: spacebar = approve + next. `R` = open reject dialog with comment field + next. Goal: a reviewer can clear 100 images in under 10 minutes.

---

## 8. Error Handling and Security

### High risk — must address

**Upload size limit (critical)**
Vercel Function request body is capped at 4.5 MB. A single batch of 100 images × 2 MB each = 200 MB, which cannot go through a standard POST.
**Fix**: Client uses `@vercel/blob/client`'s `upload()` helper to stream files directly from the browser to Blob. After upload completes, the client POSTs the metadata (file paths, original Gemini labels parsed from the YOLO txt files) to a finalize endpoint which records everything in Postgres in a single transaction.

**Server-side state machine enforcement**
All state transitions happen in server code. The client never tells the server "set state to approved" — the client calls semantic endpoints (`/approve`) and the server decides whether that transition is legal given current state and caller role. A hostile client sending handcrafted requests cannot bypass validation.

### Medium risk

| Risk | Mitigation |
|---|---|
| Concurrent assignment by two admins | DB transaction with `WHERE state = 'unassigned'` clause; failed rows return 409 |
| Auto-save out-of-order (network reorder) | Each PATCH includes the client's last-known `updated_at`; server rejects stale writes |
| Role bypass (annotator hitting reviewer endpoint) | Every API handler derives the role from the session on the server; never trusts the client |
| Whitelist removal without session invalidation | Session TTL 1 hour; every protected request re-checks the whitelist |

### Lower risk (still must fix)

- **Reject comment XSS**: store raw string, render with React's text interpolation; never use `dangerouslySetInnerHTML`.
- **Malicious zip upload**: enforce max zip entries (600), max single-file size (20 MB), total batch cap (500 images), reject any entry whose normalized path escapes the extraction root (zip slip).
- **Signed image URLs**: Blob uploads are stored as private. The backend mints short-lived (15-minute) signed URLs per request. Browsers cannot hotlink images.
- **SQL injection**: all queries go through Prisma parametrized queries.

### Stability

- **Idempotency**: `submit`, `approve`, `reject` accept an optional `request_id` and dedupe on it — safe to retry on network flake.
- **Audit log**: every state mutation writes an `AuditLog` row — who, when, what. Enables post-hoc investigation of disputed rejects or lost work.
- **DB backup**: Neon PITR (point-in-time recovery) is enabled by default on the free tier (7-day window).
- **Connection pooling**: use Neon's serverless driver or Prisma Data Proxy to avoid exhausting Postgres connections from Vercel's serverless instances.

---

## 9. Testing Strategy

```
             ╱╲
            ╱E2╲            Playwright — 4 critical flows
           ╱────╲
          ╱      ╲
         ╱  INT   ╲          Vitest + Neon branch DB
        ╱──────────╲
       ╱            ╲
      ╱     UNIT     ╲       Vitest, pure functions only
     ╱────────────────╲
```

**Unit (Vitest)**
- State machine transition rules (every legal and illegal transition)
- YOLO format parser / serializer (round-trip invariance)
- Assignment distribution algorithm
- Zip validation (size caps, path traversal, entry count)

**Integration (Vitest against a real Neon branch DB)**
- API handler + real Postgres (each test gets a transaction that rolls back)
- Auth middleware + whitelist enforcement
- End-to-end upload → Blob → DB metadata write
- Concurrent assignment transactions (two parallel requests, verify only one succeeds)

**E2E (Playwright, runs in CI on a preview deployment)**
- Login → dashboard visibility per role
- Admin upload → assign → annotator receives in queue
- Annotator draws box → auto-save → submit → next image
- Reviewer approve final image → batch marked complete → export → YOLO zip structure validates

---

## 10. Milestones

Each milestone is an independently shippable PR with its own acceptance criteria.

| # | Theme | Acceptance |
|---|---|---|
| **M0** | Project bootstrap | Next.js repo, Vercel deploy, Neon DB, Vercel Blob, Auth.js wired, Prisma schema, CI lint+test pass |
| **M1** | Auth + whitelist + roles | Non-whitelisted Google account blocked; three roles switchable; non-admin GET `/admin/users` returns 403 |
| **M2** | Project + class management | Admin CRUD projects; annotator sees only projects with their assignments |
| **M3** | Batch upload (direct-to-blob) | 500-image zip uploaded in under 2 minutes; thumbnails display; malicious zip rejected |
| **M4** | Assignment UI | Admin distributes batch; concurrent admin assigns do not double-assign |
| **M5** | Canvas annotation editor (largest) | Sub-1-second image switch (prefetch working); 30-second offline does not lose data; submit auto-advances |
| **M6** | Review flow + state machine | Last submit auto-enters review; reject returns image to assigned; full E2E happy path passes |
| **M7** | YOLO export + security review | Exported zip feeds `train_robot_model.py` unchanged; `agent-skills:nextjs-security-scan` clean; Lighthouse > 90 |

M5 is the largest. If it exceeds one PR's scope, split into:
- **M5a** — basic canvas, box draw/edit, manual save, single image per page load
- **M5b** — prefetch, auto-save, keyboard shortcuts, queue navigation

---

## 11. Out of Scope (Explicit)

The following are explicitly excluded and should not be built as part of this spec:

- **Any change to `train_robot_model.py`** — it remains exactly as-is
- **Any change to the scoring-analyzer pipeline** or the existing Red/Blue chassis model
- **In-platform Gemini auto-labeling** — the external script does all labeling
- **In-platform training** — training runs elsewhere on GPU hardware
- **Multi-tenant / multi-team support** — single workspace only
- **Mobile-optimized UI** — desktop only
- **Billing / quotas** — internal tool, no usage caps beyond the free-tier limits of Vercel / Neon / Blob
- **Dataset versioning / augmentation** — Roboflow has these, we don't; export the current approved set as-is

---

## 12. Open Questions (Tracked for Implementation Plan)

- Exact class color scheme (8-10 distinguishable high-contrast colors) — decided at M2
- Notification delivery mechanism (in-app badge only, or email via Resend) — decided at M6
- Export naming convention and whether to include `data.yaml` auto-pointing to `train_robot_model.py` conventions — decided at M7
- Thumbnail generation: on upload (batch process) or on first request (lazy cache) — decided at M3
