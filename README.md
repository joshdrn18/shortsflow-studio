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

- Responsive dashboard shell with Sources, Clip Discovery, Review Center, Content Library, Publisher and Settings views.
- Workspace authentication and account-scoped source, clip, render, review and publishing APIs.
- Private R2 source uploads and byte-range video preview.
- Scheduled source transcription and AI clip discovery through the separate analysis Worker.
- Clip editing with versioned metadata, timestamped subtitles, subtitle styling and saved Brand Profiles.
- Browser-based 9:16 rendering with blurred background fill, watermark and WebM output. **This renderer still runs in the browser and pauses when the page is hidden; closing the tab does not provide background rendering.**
- Render history, protected old-render cleanup, Content Library and a version-bound Review Center approval flow.
- YouTube OAuth, approved-render selection, publishing queue and analytics endpoints. Live end-to-end publishing still depends on the correct Cloudflare bindings and YouTube credentials.
- Quality checks cover JavaScript syntax, ordered D1 migrations, frontend asset paths and cache-version consistency.

The GitHub repository and Cloudflare Pages deployment are separate checks. A passing GitHub Actions run validates the source code only; it does not prove that the intended Pages project has deployed that commit.

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

Wrangler reads the SQL files from `migrations/`. Apply migrations in order: `0001_initial.sql`, `0002_auth.sql`, `0003_workspace_settings.sql`, then `0004_processing_jobs.sql`, `0005_source_transcripts.sql`, `0006_ai_usage_budget.sql`, and `0007_clip_discovery_idempotency.sql`. Do not apply `database/schema.sql` as well; it is a reference copy of the original base schema. Bind the private R2 bucket to Pages Functions as `MEDIA`.

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

## Remaining work

- Background rendering that continues independently of the browser tab is **not implemented yet**. The current MediaRecorder/canvas renderer is browser-bound.
- End-to-end browser verification with a real source upload, saved render, Review Center decision and YouTube upload is still pending.
- Confirm the production Pages project, D1/R2 bindings, analysis Worker deployment and YouTube secrets before treating the service as production-ready.

## Analysis engine

The scheduled Worker `shortsflow-analysis-engine` runs every minute and uses the private R2 source binding, Cloudflare Media Transformations binding, and Workers AI Whisper. Media Transformations is currently in open beta; binding-based operations are not billed during the beta. Workers AI has a 10,000-Neuron daily free allocation; ShortsFlow reserves at most 8,000 estimated Whisper Neurons per UTC day for this app. The cap is an app-level safeguard, not a guarantee against usage from other Workers AI services on the same account. Sources must be MP4 with H.264 video and AAC/MP3 audio, under 100 MB and no longer than 10 minutes. Each cron invocation transcribes one 60-second chunk and persists progress in D1.
