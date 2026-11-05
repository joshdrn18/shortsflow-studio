# ShortsFlow Studio

AI-assisted short-form video production workspace.

## Product workflow

1. Add a source video.
2. Discover candidate clips.
3. Edit framing, subtitles and metadata.
4. Render and run quality checks.
5. Review and explicitly approve a specific asset + metadata version.
6. Publish approved clips to YouTube.
7. Track publishing status and errors.

**Publishing safety rule:** a publish job must reference an approval record for the exact rendered asset version and metadata version. Editing either version must invalidate the previous approval. Publishing must never happen just because a render completed.

## Stack

- Cloudflare Pages + Pages Functions
- Cloudflare D1 for accounts, workspace and workflow metadata
- Cloudflare R2 for private source media storage (source upload integration implemented)
- YouTube Data API for authorized publishing (integration pending)

Heavy video processing will not run inside request-bound Pages Functions. A separate rendering runtime and durable job orchestration will be selected before implementing that pipeline.

## Current implementation

- Responsive dashboard shell and navigation
- API health endpoint: `GET /api/health`
- Account registration: `POST /api/auth/register`
- Account login: `POST /api/auth/login`
- Current session: `GET /api/auth/me`
- Logout: `POST /api/auth/logout`
- PBKDF2-SHA-256 password hashing (100,000 iterations)
- Random opaque session tokens stored as SHA-256 hashes; HttpOnly, Secure, SameSite=Lax cookie; 7-day expiry
- Login attempt throttling by account email
- Workspace created for each new account
- D1 schema and ordered migrations, including workspace watermark settings
- Authenticated source-video upload to private R2 (MP4, MOV, WebM, MKV, OGG; 90 MB endpoint limit)
- Workspace-scoped source-video listing and private streaming preview API with HTTP byte-range support
- Source preview player in the Sources workspace
- Persistent, workspace-scoped processing job queue for source-analysis requests, with safe cancellation of queued jobs and manual retry of failed jobs (queue storage only; no worker consumes jobs yet)
- Scheduled analysis Worker using Cloudflare Media Transformations (beta) to extract audio from private R2 MP4 sources and Workers AI Whisper to create timestamped transcripts
- Versioned source-transcript storage and a daily app-level safety budget capped at 8,000 estimated Whisper Neurons
- Workspace watermark settings API and 9:16 preview controls

The dashboard does not pretend that rendering or YouTube publishing is active before those services are configured. The transcription Worker is active on a one-minute cron schedule; it processes one 60-second audio chunk per invocation.

## Cloudflare Pages setup

Connect this repository to a Cloudflare Pages project:

- Production branch: `main`
- Build command: leave empty
- Build output directory: `/`
- Root directory: `/`

Create a D1 database and bind it to the Pages project with the binding name `DB`.

Apply D1 migrations in order from the repository root:

```bash
npx wrangler d1 migrations apply <DATABASE_NAME> --remote
```

Wrangler reads the SQL files from `migrations/`. Apply migrations in order: `0001_initial.sql`, `0002_auth.sql`, `0003_workspace_settings.sql`, then `0004_processing_jobs.sql`, `0005_source_transcripts.sql`, and `0006_ai_usage_budget.sql`. Do not apply `database/schema.sql` as well; it is a reference copy of the original base schema. Bind the private R2 bucket to Pages Functions as `MEDIA`.

After binding D1 and applying migrations, deploy the Pages project and verify:

- `/api/health` reports database connectivity.
- Registration creates a user, a workspace and an owner membership.
- Login creates an authenticated session.
- `/api/auth/me` returns the current session.
- Logout revokes the session.

## Security and deployment notes

- No default admin password or hard-coded credentials.
- No session token is stored in browser local storage.
- Passwords are never returned by the API.
- Authentication endpoints require the D1 binding.
- Email verification, bot protection and account recovery are not yet implemented; do not treat this first auth foundation as a fully hardened public SaaS launch.

## Not implemented yet

AI clip discovery and scoring, subtitle generation and word-highlighting UI, actual watermark burn-in, video rendering, Review Center actions, YouTube OAuth, publishing queue workers and analytics. Transcription is active for MP4 (H.264/AAC) sources up to 10 minutes and 90 MB; other uploaded formats remain available for private storage and preview but are not supported by the current analysis Worker. Source upload, private video streaming preview and watermark configuration are implemented. End-to-end browser verification with a real uploaded video is still pending.

## Analysis engine

The scheduled Worker `shortsflow-analysis-engine` runs every minute and uses the private R2 source binding, Cloudflare Media Transformations binding, and Workers AI Whisper. Media Transformations is currently in open beta; binding-based operations are not billed during the beta. Workers AI has a 10,000-Neuron daily free allocation; ShortsFlow reserves at most 8,000 estimated Whisper Neurons per UTC day for this app. The cap is an app-level safeguard, not a guarantee against usage from other Workers AI services on the same account. Sources must be MP4 with H.264 video and AAC/MP3 audio, under 100 MB and no longer than 10 minutes. Each cron invocation transcribes one 60-second chunk and persists progress in D1.
