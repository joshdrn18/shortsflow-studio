# ShortsFlow Studio

AI-assisted short-form video production workspace. The core workflow is:

1. Add a source video.
2. Discover candidate clips.
3. Edit framing, subtitles and metadata.
4. Render and run quality checks.
5. Review and explicitly approve a specific asset + metadata version.
6. Publish approved clips to YouTube.
7. Track publishing status and errors.

**Safety rule:** publishing must never happen without an explicit approval record tied to the exact rendered asset version and metadata version. Any edit after approval invalidates that approval.

## Stack

- Cloudflare Pages + Pages Functions
- Cloudflare Workers-compatible runtime
- Cloudflare D1 for workflow metadata
- Cloudflare R2 for source and rendered media
- YouTube Data API for authorized publishing

Heavy video processing is intentionally kept out of request-bound Workers. A separate rendering/processing runtime will be selected and connected through durable job orchestration.

## Current foundation

- Responsive dashboard shell
- Workspace navigation
- Live API health endpoint at `/api/health`
- Initial D1 schema in `database/schema.sql`

The dashboard does not pretend that upload, AI processing, rendering, or YouTube publishing is active before those services are configured.

## Deploy

Create a Cloudflare Pages project connected to this repository.

- Production branch: `main`
- Build command: none
- Build output directory: `/`
- Root directory: `/`

After creating a D1 database, apply `database/schema.sql` and bind it to the Pages project as `DB`. Configure R2 and secrets only when their corresponding features are implemented.

## API

- `GET /api/health` — runtime and optional D1 connectivity check.

## Development status

Foundation phase. Upload processing, AI clipping, subtitle generation, rendering, review actions, OAuth and publishing are not yet enabled.