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
- Cloudflare R2 for source and rendered media (integration pending)
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
- D1 schema and ordered migrations

The dashboard does not pretend that upload, AI processing, rendering, or YouTube publishing is active before those services are configured.

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

Wrangler reads the SQL files from `migrations/`. Apply both `0001_initial.sql` and `0002_auth.sql` in order. Do not apply `database/schema.sql` as well; it is a reference copy of the original base schema.

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

Video upload to R2, AI clip discovery, transcript/subtitle generation, video rendering, Review Center actions, YouTube OAuth, publishing queue workers and analytics.