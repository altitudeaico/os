# Family Media + Google Photos — Implementation Checkpoint

Part of Olatoye Family OS. This document is the durable record of the Family Media
capability and its first ingestion source (Google Photos). It contains no secrets,
no tokens, no signed URLs.

---

## CURRENT STATE / NEXT ACTION

**Current state (as of this checkpoint):**
- Phase A (reconnaissance) complete.
- Phase B (data foundation) complete and verified in the live database.
- Phase C (Google Photos integration) NOT started. Its architecture has now been
  verified against the official Google Photos **Picker API** documentation (see
  "Phase C — verified findings"). The earlier redirect/callback sketch was wrong and
  has been corrected below.

**Next action:** Owner approved proceeding. Phase C decisions are now SETTLED (below).
Building the Family-OS side (Edge Functions + Media UI) that does not need live Google
credentials, then issuing the short one-time Google Cloud steps to the owner.

### Phase C decisions (SETTLED)
1. **Token method:** server-side OAuth 2.0 authorization-code exchange. The client secret
   lives ONLY in the Supabase Edge Function env (`GOOGLE_OAUTH_CLIENT_SECRET`), never in
   frontend. The frontend holds only the public Client ID. No refresh tokens stored
   (import is user-present and one-shot; access token covers the session + 60-min baseUrl fetches).
2. **Worker model:** Supabase Edge Functions, no pgmq/pg_cron for v1. Functions:
   `photos-auth` (OAuth start + code exchange), `photos-session` (create Picker session,
   poll, list selected items → create queued jobs), `photos-import-worker` (claim queued
   jobs, download each baseUrl into family-media, upsert content_items, mark job done),
   `photos-retry` (re-queue failed jobs). Worker invoked on selection; job tables make it
   resumable; a manual Retry endpoint covers failures. pgmq remains a future option (job
   tables already shaped for it).
3. **HEIC:** original always preserved in family-media; a browser-displayable derivative is
   generated where the runtime can; if not, the original is kept and flagged for later.

---

## OBJECTIVE

Build a reusable **Family Media** layer for Olatoye Family OS: one canonical place
that owns, organises, secures and reuses every family photo and video, consumed by
many contexts (Elsie 10, Emma, birthdays, holidays, Academy, Family HQ/TV, Family
Chat, annual reviews) rather than copies scattered across disconnected apps.

The first external ingestion source is Google Photos. Elsie 10 is the first consumer.

## NON-NEGOTIABLE ARCHITECTURAL RULE: COPY-ON-IMPORT

> Google Photos is an ingestion source. Family OS owns and serves the media it imports.

After a user selects an asset, Family OS copies the bytes into its own private
Storage. Family OS must NEVER depend on a Google temporary media URL as the permanent
asset URL. Google provenance (provider + media id) is retained for dedupe, not for serving.

## CANONICAL MEDIA MODEL

- `content_items` is the single canonical media catalogue. Do NOT create a second
  general media table.
- `content_people` is the person-tagging join `(content_item_id, person_id)`.
- `people` currently holds: Emma, Elsie, Bolaji, Funmi.
- Import tables (`media_import_sessions`, `media_import_jobs`) are OPERATIONAL import
  infrastructure only — not a media catalogue.

---

## PHASE A — RECONNAISSANCE FINDINGS

- **Repo / hosting:** `altitudeaico/os` → GitHub Pages → `olatoyefamily.com`. Vanilla
  HTML/JS, no framework. TV loads `hub/index.html` (stamped module files).
- **`content_items` already existed (137 rows)** with a schema that already matches the
  intended mapping: `source_provider, source_ref, source_view_url, storage_path,
  captured_at, file_size_bytes, duration_seconds, event_id, primary_person_id,
  content_type, lifecycle_status, visibility, featured_status, poster_url` (+ editorial
  fields). Used as-is.
- **`content_people`** (35 rows), clean join table.
- **Existing `source_provider` values:** `chat_upload, drive, github, upload`. `google_photos` is new.
- **Existing `lifecycle_status` values:** `approved, captured, created, draft`. `visibility`: only `household`.
- **Events already exist (do NOT duplicate):** `Elsie's Day Out - London` (23 Sep 2026),
  `Grandma Lunch` (26 Sep), `Craft Party` (27 Sep), `Sleepover Finale` (3 Oct), plus an
  umbrella `Elsie 10` event and `Birthday Morning`.
- **All 9 pre-existing storage buckets are PUBLIC** (card-thumbnails, elsie-artwork,
  elsie-cheer, elsie-music, elsie-photos, emma-music, emma-photos, emma-video, os-assets).
  No private bucket existed before this work.
- **Elsie admin** (`hub/elsie-admin.html`) tabs: artwork, photos, reels, cheer, music,
  latest, card. It references `content_items`/`event` but had no media-import section.
- **Existing Google integration = Drive only, via Edge Function `emma-drive-import`**,
  using a `GOOGLE_API_KEY` (simple API key) for reading PUBLIC Drive folders. This is an
  API-key model, NOT OAuth. The browser never calls Google directly; the Edge Function does.
- **Queue/worker infra availability:** `pgmq`, `pg_net`, `pg_cron` are all AVAILABLE on
  this Supabase project but NONE are installed yet. So a Supabase-native worker is
  feasible without external infrastructure.

## KEY CONFLICT FOUND

A blanket `UNIQUE(source_provider, source_ref)` on `content_items` is IMPOSSIBLE:
15 existing rows share `('github','altitudeaico/os')`. Dedupe must be scoped to
Google Photos only (done — partial index, see Phase B).

---

## PHASE B — CHANGES ACTUALLY APPLIED (verified live)

Delivered as proper migrations. Exact migration names:
1. `family_media_phase_b_foundation`
2. `family_media_private_bucket`
3. `family_media_force_private` (correction — the bucket pre-existed as public; forced private)

### media_import_sessions
One row per Picker/import operation.
Fields: id, provider (default `google_photos`), requested_by (→people), context_type,
context_id, status, total_items, completed_items, failed_items, metadata (jsonb),
created_at, started_at, completed_at.
Status values: `created | importing | completed | completed_with_errors | cancelled`.

### media_import_jobs
One row per selected external asset.
Fields: id, session_id (→sessions, cascade), provider, source_ref (Google media id),
status, attempt_count, content_item_id (→content_items), error_code, error_message,
metadata (jsonb: filename/mime/size/captured_at/dims), created_at, started_at, completed_at.
Status values: `queued | processing | completed | failed | skipped_duplicate`.
Indexes: by session, by status, and a partial index on `created_at WHERE status='queued'`
(so a worker can claim oldest queued jobs efficiently).

### trg_media_session_recount
Trigger + function `fn_media_session_recount()` on media_import_jobs
(AFTER INSERT / UPDATE OF status / DELETE). Recomputes each session's completed_items,
failed_items, status and completed_at from its jobs. This makes import progress
server-authoritative — progress survives the browser being closed.

### Partial Google Photos dedupe index (and WHY partial)
`uq_content_items_google_photos_ref` = UNIQUE on `content_items(source_ref)`
`WHERE source_provider='google_photos' AND source_ref IS NOT NULL`.
Partial because a blanket unique constraint would break the 15 existing github rows
sharing the same source_ref. Scoping to google_photos guarantees one canonical record
per Google asset without touching any existing data.

### family-media bucket configuration
- id/name: `family-media`
- **public = false (PRIVATE) — confirmed via live query after a correction**
- file_size_limit = 2147483648 (2 GB) for large phone videos
- The bucket pre-existed as public; `ON CONFLICT DO NOTHING` skipped the intended insert,
  so a forced `UPDATE ... SET public=false` was applied and re-verified.

### Storage / RLS approach
- `family-media` has a SELECT policy scoped to the bucket; NO anon write policy.
- Writes are intended to come only from the service-role import worker (service role
  bypasses RLS). Objects are never public. Delivery to the app will be via short-lived
  signed URLs. This is deliberately stricter than the existing public buckets.
- The new import tables use the project's current single-household anon read/write model,
  consistent with existing tables; they carry no media bytes, only operational rows.

### Confirmation: existing system untouched
- All 9 existing buckets still present and still public — unchanged.
- `content_items` unchanged (still 137 rows; no columns added/altered).
- No existing RLS or runtime behaviour changed outside the new Family Media structures.

## OUT OF SCOPE (explicitly)
- Legacy public-bucket migration. Existing public buckets are left exactly as they are.
  A future, separate effort may audit consumers, migrate legacy assets, switch consumers,
  then retire public buckets. NOT part of this work.
- Also out of scope for v1: facial recognition, AI photo scoring, automatic deletion,
  full video transcoding, Google Photos write-back, Apple/OneDrive integration,
  automatic yearbooks/films, semantic search, perceptual-hash dedupe, location experiences.

---

## PHASE C — VERIFIED FINDINGS (Google Photos Picker API)

Verified against official Google documentation (not Google Drive Picker docs).
Sources listed at the bottom. These findings CORRECT the earlier proposed architecture.

1. **API to enable:** Google **Photos Picker API** — service `photospicker.googleapis.com`.
   (This is separate from the legacy Google Photos Library API. Enable the Picker API.)
2. **OAuth scope required:** exactly one —
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   This is a sensitive/restricted-class scope (not a basic profile scope).
3. **Flow is a Picker SESSION + POLLING model, NOT redirect/callback into our own page:**
   - Obtain an OAuth 2.0 access token for the user.
   - `POST https://photospicker.googleapis.com/v1/sessions` → returns a `pickerUri` and a
     `PollingConfig` (pollInterval, timeoutIn) and an `expireTime`.
   - Direct the user to the `pickerUri` (opens Google Photos' own picker; it CANNOT be
     embedded in an iframe).
   - Poll `GET /v1/sessions/{sessionId}` until `mediaItemsSet == true`.
   - `GET /v1/mediaItems?sessionId=...` to list the selected `PickedMediaItem`s.
   - `DELETE /v1/sessions/{sessionId}` when done (session quotas exist; clean up).
   The earlier idea of a `photos-callback.html` redirect URI as the core Picker mechanism
   was based on the Drive Picker / generic OAuth redirect model and is NOT how the Photos
   Picker session flow works. A redirect URI is still only relevant to the underlying
   OAuth token acquisition, not to receiving the photo selection.
4. **Retrieving selected media:** each `PickedMediaItem.mediaFile` has a `baseUrl`.
   To download bytes, append a parameter (`=d` for images with metadata; `=dv` for video
   bytes) and send an `Authorization: Bearer <access token>` header. Requests to baseUrl
   MUST carry the OAuth bearer token.
5. **baseUrl lifetime:** base URLs are active for **60 minutes** and require the OAuth
   token. Therefore copy-on-import must fetch bytes promptly within the token/baseUrl
   validity window — reinforcing an async worker that runs soon after selection, not days later.
6. **Client secret / client type:** the token can be acquired with a Web-application OAuth
   client. Whether a client secret is strictly required depends on the token-acquisition
   method chosen (server-side auth-code exchange uses a secret; a PKCE public-client flow
   can avoid a long-lived secret). DECISION DEFERRED to Phase C design — see "open decisions".
7. **Refresh tokens:** for a one-shot import (user present, selects, we copy within the
   hour) a refresh token is NOT required — a single access token covers session + baseUrl
   fetches. A refresh token would only be needed for unattended/background re-access, which
   copy-on-import does not require. Recommendation: avoid storing refresh tokens in v1.
8. **Testing-mode limits (important):** while the OAuth consent screen is in "Testing",
   Google treats the app as unverified: max 100 test users, and any refresh tokens issued
   expire after 7 days. Since v1 does not need refresh tokens, the 7-day limit is not a
   blocker; users just re-consent when they next import. Test users must be explicitly added.
9. **Verification requirement:** the Picker scope is sensitive/restricted, so an unverified
   app shows an "unverified app" warning at consent. For a handful of family accounts this
   is acceptable (Personal Use apps under 100 users need not complete verification; users
   click through the warning). Full Google verification is only needed to remove the warning
   / grow beyond 100 users.

### Changes these findings make to the proposed Phase C architecture
- Replace the "redirect callback receives the selection" model with the correct
  **create-session → user picks at pickerUri → poll → list mediaItems** model.
- The import worker downloads each `baseUrl` (with `=d`/`=dv` + bearer token) into
  `family-media`, within the 60-minute window, then writes/updates `content_items`.
- Prefer NOT storing refresh tokens in v1 (import is user-present and short-lived).
- Keep OAuth in Testing mode initially (family test users), accepting the unverified
  warning; revisit publishing/verification only if needed.
- pgmq/pg_net/pg_cron are available if we want a fully Supabase-native queue+worker;
  decision to be made in Phase C design rather than assumed now.

### Open decisions for Phase C design (before any Google Cloud config)
- Token acquisition method: server-side auth-code (uses client secret, stored only in
  Supabase Function env) vs PKCE public client (no long-lived secret). To be decided.
- Worker invocation/recovery: pgmq+pg_cron vs Edge Function invoked on selection with a
  lightweight recovery poll. To be decided.
- HEIC display-derivative generation strategy (original always preserved; derivative may
  degrade gracefully if the runtime cannot process a format).

---

## ORIGINAL ACCEPTANCE CRITERIA (unchanged target)
Parent: Control → Elsie 10 → Media → Import from Google Photos → Google Picker →
select (e.g. 10 photos + 2 videos) → returns "12 selected, import started". Browser can
be closed. Later: "11 imported, 1 failed" → Retry failed → "12 imported". Assets now in
Family-OS private Storage; `content_items` has canonical records; Google provenance
retained; media filterable to London Day; a 23 Sep asset suggests London Day (changeable);
parent keeps the image; the Elsie 10 experience can use it; re-selecting the same Google
photo is recognised as a duplicate; the final experience never depends on a Google URL.

## KNOWN RISKS
- baseUrl 60-minute expiry → import must run promptly; large-video downloads must complete
  in-window.
- Large phone videos (hundreds of MB) → do not buffer whole files in Edge Function memory;
  stream / use resumable approaches; 2 GB bucket ceiling set.
- Testing-mode unverified warning + 100-user cap (fine for family).
- HEIC display in browsers may need a derivative; original preserved regardless.
- Private-storage model is new to this project (all prior buckets public) — worker must
  use service role; frontend must use signed URLs; no service-role key in frontend.

## OFFICIAL DOCUMENTATION SOURCES
- Picker API get started: https://developers.google.com/photos/picker/guides/get-started-picker
- Sessions: https://developers.google.com/photos/picker/guides/sessions
- sessions.create: https://developers.google.com/photos/picker/reference/rest/v1/sessions/create
- REST overview: https://developers.google.com/photos/picker/reference/rest
- List/retrieve media items: https://developers.google.com/photos/picker/guides/media-items
- API limits/quotas: https://developers.google.com/photos/overview/api-limits-quotas
- OAuth testing-mode / refresh token expiry: https://developers.google.com/identity/protocols/oauth2 (and Google Cloud "Manage App Audience": https://support.google.com/cloud/answer/15549945)
