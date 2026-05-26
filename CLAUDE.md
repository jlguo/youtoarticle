# CLAUDE.md

## Project

Cloudflare Worker web app — users input a YouTube link, the Worker extracts subtitles and returns them as JSON. The browser then calls AI APIs directly (unlimited CPU) for article generation.

## Architecture

- **Backend**: TypeScript on Cloudflare Workers, modular (`router.ts`, `youtube.ts`, `config.ts`)
- **YouTube**: `youtubei.js` direct → timedtext API → `src/fallback-subtitles/` hard-coded fallback
- **AI**: Browser-side — calls Gemini/DeepSeek APIs directly from the frontend
- **Storage**: Cloudflare KV, used for subtitle caching (`sub:{videoId}`, TTL 7 days)
- **Frontend**: Vanilla JS + CSS, esbuild-bundled into `public/`

## Commands

```bash
node build.mjs              # Bundle frontend
npx wrangler dev --port 34997  # Local dev
npx wrangler deploy          # Deploy
bash smoke_test.sh           # Run smoke test (build + start + API checks)
```

## API

### POST /api/generate

Extracts YouTube subtitles as JSON.

**Request:** `{ "youtubeUrl": "https://youtu.be/xRh2sVcNXQ8" }`

**Response (200):** `{ "subtitle": "...", "videoId": "xRh2sVcNXQ8", "fromFallback": false }`

## Design Tokens

- Primary: `#2563eb` / Background: `#ffffff` / Text: `#111827` / Border: `#e5e7eb`
- Font: `system-ui, sans-serif`, `16px`, line-height `1.8`

## Workflow — TDD (Two Phases)

### Phase 1: Project Initialization (main session, one-time)

Read `app_spec.xml` to understand the full requirements, then:

1. **Create `feature_list.json`** — 50+ test cases across these categories:
   - `infrastructure` — project boots, configs valid, wrangler dev starts
   - `subtitle` — URL parsing, youtubei.js, fallback, hard-coded fallback, language chain
   - `api` — POST /api/generate (JSON), static asset serving, CORS
   - `frontend` — form rendering, SSE client, typewriter DOM, chapter detection, 5W1H buttons, collapsible boxes
   - `style` — design tokens, typography, button states, responsive layout, transitions
   - `e2e` — full flow with demo video, custom rules, KV persistence across refresh, error cases

   Format: `{ "category": "...", "description": "...", "steps": ["Step 1: ...", ...], "passes": false }`
   All tests start as `"passes": false`. **Never delete/edit/reorder tests** — only toggle `passes` to `true` **after** the feature has been verified with actual tool output (curl HTTP response, browser screenshot, or test runner output). Do NOT toggle `passes` based on "the code looks right" or "should work." Every `passes: true` toggle MUST reference the verifiable tool output in the session logs.

### Phase 2: Feature Development (one session per feature)

1. Pick a single feature from `feature_list.json` (one that is `passes: false`)
2. Implement it
3. Verify it with a concrete tool (curl, wrangler, browser)
4. If it passes, toggle `passes` to `true`
5. Commit the implementation + `feature_list.json` together
6. Move to the next feature

### Validation Rules

- `npx tsc --noEmit` must pass after every code change
- `node build.mjs` must produce no errors
- After API changes: run `bash smoke_test.sh`
- After UI changes: validate in browser with Playwright
