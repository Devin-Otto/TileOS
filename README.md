# TileOS

TileOS is a glassmorphic portfolio OS for showcasing live projects in-place.

## What It Does

- Left-side chat control plane with Gemini only
- Right-side project library with Netflix-style tiles
- Glass window preview that opens inside the same page
- Public create flows with personal draft workspaces and admin-curated publishing
- Admin-only publish, unpublish, edit, rename, delete, and reorder controls for showcase tiles
- File-backed persistence with no client-exposed secrets
- Public-safe integration manifest at `tileos.project.json`
- Base-path aware runtime so it can be mounted behind a portfolio shell such as `/tileos/app`

## Setup

1. Copy `.env.example` to `.env.local` for local development, or set the same values in your hosting provider's secure environment settings.
2. Set at least:
   - `TILEOS_PUBLIC_URL`
   - `TILEOS_BASE_PATH` if the app is mounted below `/`
   - `TILEOS_DATA_ROOT`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
3. Add your Gemini key pool with `GEMINI_API_KEYS` as a comma-separated list when you want live AI generation.
4. Leave `TILEOS_SECURE_COOKIES` unset unless you need to override the default HTTPS-aware cookie behavior.
4. Run:

```bash
npm start
```

The app serves from `http://localhost:9273` by default.

## Local Demo Mode

TileOS can boot without Gemini keys for proof-of-life and mounted showcase validation.

- With `GEMINI_API_KEYS` configured, TileOS uses live server-side Gemini generation.
- Without Gemini keys, TileOS stays usable in fallback demo mode:
  - chat still works
  - tile creation still works through built-in fallback generation
  - admin publish, unpublish, reorder, and delete flows still work

This is useful for local verification, public-safe demos, and CI checks where you want deterministic behavior without live provider calls.

## Container / Proxy Hosting

TileOS can run as its own container while being presented inside another site.

- Set `TILEOS_PUBLIC_URL` to the public mounted URL, for example `https://devcandoit.com/tileos/app`
- Set `TILEOS_BASE_PATH=/tileos/app`
- Set `TILEOS_DATA_ROOT=/data` and mount a persistent volume there
- Leave `TILEOS_SECURE_COOKIES` unset in normal production use so Secure cookies follow the public HTTPS URL automatically
- Proxy public traffic for `/tileos/app` into the TileOS container
- For CI or local production-mode verification, set `TILEOS_DISABLE_DOTENV=1` so local secret files do not bleed into checks

## Security Notes

- No API keys are embedded in the browser bundle.
- Real secrets live only in runtime environment variables, never in git.
- `.env`, `.env.local`, and every `.env.*` variant are ignored by git, except `.env.example`.
- Anyone can create tiles, but non-admin tiles are saved as private drafts for that visitor workspace.
- Admin login is required to publish drafts into the shared showcase and to delete or reorder published tiles.
- Live state is stored under `TILEOS_DATA_ROOT/state.json`. Local development can keep using `./data/state.json`, which is ignored by git.
- Seed content lives in `data/seed.js`.

## Public Repo Prep

Before pushing TileOS to a public repo:

1. Keep real keys only in `.env.local` or your hosting provider's secure environment settings.
2. Run:

```bash
npm run verify:release
```

3. Confirm `git status --ignored` shows `.env.local` and `data/state.json` as ignored.
4. If any real keys have ever been pasted into chat, screenshots, or other shared systems, rotate them before production use.
5. Before a public deploy, manually verify:
   - anonymous users only see published tiles plus their own drafts
   - admin login is required for publish, unpublish, delete, and reorder
   - browser source and network responses do not expose secrets
   - the mounted public path matches `TILEOS_PUBLIC_URL` and `TILEOS_BASE_PATH`
   - the mounted `/tileos/app` flow works end to end if TileOS is being proxied through DevCanDoIT

## Project Layout

- `server.js` - minimal Node server and API
- `public/` - frontend app and runtime helpers
- `data/seed.js` - starter projects and memory
- `tileos.project.json` - public-safe integration contract for DevCanDoIT or other portfolio shells
- `Dockerfile` / `railway.json` - container and Railway deployment contract
