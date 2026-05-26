# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-27
**Branch:** master
**See also:** `CLAUDE.md` — full project description, TDD workflow, design tokens

## OVERVIEW

Cloudflare Worker app — YouTube subtitle extraction via JSON API. Browser calls AI APIs directly for article generation.
Stack: TypeScript Workers, KV storage (subtitle caching), vanilla JS/CSS frontend, esbuild bundler.

## STRUCTURE

```
./
├── src/
│   ├── backend/          # Worker: router, YouTube subtitle extraction
│   ├── frontend/         # Vanilla JS/CSS/HTML → bundled to public/
│   ├── fallback-subtitles/# Hard-coded demo subtitle (video xRh2sVcNXQ8)
│   └── types.d.ts        # Env interface (KV)
├── wrangler.toml         # Worker config, KV binding, assets dir
├── build.mjs             # esbuild: app.js → public/ (bundle, esm, no minify)
├── smoke_test.sh         # Build + start + API checks (port 34997)
├── feature_list.json     # 88 TDD test cases, passes:boolean, never reorder
└── CLAUDE.md             # Full project docs, TDD workflow, design tokens
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Worker entry point | `src/backend/index.ts` | 8 lines — delegates to router |
| Request routing | `src/backend/router.ts` | `POST /api/generate` → JSON subtitle extraction |
| YouTube subtitles | `src/backend/youtube.ts` | Fallback chain: Innertube → timedtext → hard-coded |
| Config constants | `src/backend/config.ts` | Timeouts, URLs, route paths, CORS |
| Frontend | `src/frontend/app.js` | Calls Worker for subtitles, then AI directly in browser |
| Frontend styles | `src/frontend/app.css` | CSS custom properties, 444 lines |
| Environment bindings | `src/types.d.ts` | `SESSION_KV: KVNamespace` (subtitle cache) |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `handleRequest` | export function | router.ts | index.ts | Main request dispatcher |
| `extractVideoId` | export function | youtube.ts | router.ts | Parse YouTube URL → video ID |
| `fetchSubtitlesWithFallback` | export async | youtube.ts | router.ts | 3-tier subtitle extraction |
| `fetchSubtitlesViaInnertube` | export async | youtube.ts | youtube.ts | Innertube API subtitle fetch |

## API

### POST /api/generate

Extracts YouTube subtitles as JSON. No AI processing — browser calls AI APIs directly.

**Request:**
```json
{ "youtubeUrl": "https://youtu.be/xRh2sVcNXQ8" }
```

**Response (200):**
```json
{
  "subtitle": "Full subtitle text...",
  "videoId": "xRh2sVcNXQ8",
  "fromFallback": false
}
```

**Error responses:**
- 400: Invalid JSON body, missing `youtubeUrl`, or invalid YouTube URL format
- 500: Subtitle extraction failure

## CONVENTIONS

- **TypeScript strict**: `strict: true`, `noEmit: true`, `moduleResolution: "bundler"` — no file extensions in imports
- **Worker compat**: `compatibility_flags = ["nodejs_compat"]`, `@cloudflare/workers-types` (no DOM types)
- **Build**: `esbuild` bundles `src/frontend/app.js` → `public/` only; no bundling for backend (Worker platform handles ESM)
- **Fallback chain**: Innertube API → timedtext API → hard-coded `DEMO_SUBTITLE`
- **Port**: dev server always on 34997
- **No bundler config for backend** — Workers runtime resolves ESM imports directly

## ANTI-PATTERNS (THIS PROJECT)

- Never skip `smoke_test.sh` after code changes
- Never batch-toggle multiple `passes` in `feature_list.json` — one at a time, with verification evidence
- Never mark tests passing without actual tool output (curl response, Playwright screenshot)
- Never toggle frontend/style/e2e tests without browser verification
- Never delete/edit/reorder entries in `feature_list.json`
- No `as any`, `@ts-ignore`, `@ts-expect-error` — type safety is enforced
- No DOM types in backend (`lib: ["ESNext"]` only)

## COMMANDS

```bash
node build.mjs                          # Bundle frontend
npx wrangler dev --port 34997           # Local dev server
npx wrangler deploy                     # Deploy to Cloudflare
bash smoke_test.sh                      # Build + start + API checks
npx tsc --noEmit                        # Type-check only
```

## NOTES

- `feature_list.json` has 88 TDD test cases across 8 categories: infrastructure, subtitle, gemini, session, api, frontend, style, e2e
- `youtubei.js` needs TCP proxy when running on Workers (no direct Innertube fetches on CF network)
- `src/types.d.ts` augments global `Env` — no `import` needed, available everywhere in `src/`
