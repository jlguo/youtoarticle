# CLAUDE.md

## Project

Cloudflare Worker web app — users input a YouTube link, the app extracts subtitles, streams an AI-generated Chinese article in real-time via SSE, and provides per-chapter 5W1H (Who/What/When/Where/Why/How) summaries.

## Architecture

- **Backend**: TypeScript on Cloudflare Workers, modular (`router.ts`, `youtube.ts`, `gemini.ts`, `session.ts`, `prompts.ts`)
- **YouTube**: `youtubei.js` direct → Webshare TCP Socket proxy → `src/fallback-subtitles/` hard-coded fallback
- **AI**: Gemini via `generateContentStream()` (SSE) and `generateContent()` (5W1H JSON)
- **Storage**: Cloudflare KV, key `session:{uuid}`, TTL 3600s
- **Frontend**: Vanilla JS + CSS, esbuild-bundled into `public/`, SSE streaming DOM rendering
- **Chapter detection**: Frontend parses `##` headings, injects [5W1H] buttons; server retrieves context from KV (no client re-transmission)

## Commands

```bash
node build.mjs              # Bundle frontend
npx wrangler dev --port 34997  # Local dev
npx wrangler deploy          # Deploy
```

## Design Tokens

- Primary: `#2563eb` / Background: `#ffffff` / Text: `#111827` / Border: `#e5e7eb`
- Font: `system-ui, sans-serif`, `16px`, line-height `1.8`

## Workflow — TDD (Two Phases)

### Phase 1: Project Initialization (main session, one-time)

Read `app_spec.xml` to understand the full requirements, then:

1. **Create `feature_list.json`** — 50+ test cases across these categories:
   - `infrastructure` — project boots, configs valid, wrangler dev starts
   - `subtitle` — URL parsing, youtubei.js, proxy fallback, hard-coded fallback, language chain
   - `gemini` — streaming generation, 5W1H generation, prompt rule injection, error handling
   - `session` — KV write/read, TTL expiry, schema correctness
   - `api` — POST /api/generate (SSE), POST /api/5w1h (JSON), static asset serving, CORS
   - `frontend` — form rendering, SSE client, typewriter DOM, chapter detection, 5W1H buttons, collapsible boxes
   - `style` — design tokens, typography, button states, responsive layout, transitions
   - `e2e` — full flow with demo video, custom rules, KV persistence across refresh, error cases

   Format: `{ "category": "...", "description": "...", "steps": ["Step 1: ...", ...], "passes": false }`
   All tests start as `"passes": false`. **Never delete/edit/reorder tests** — only toggle `passes` to `true` **after** the feature has been verified with actual tool output (curl HTTP response, browser screenshot, or test runner output). Do NOT toggle `passes` based on "the code looks right" or "should work." Every `passes: true` toggle must be backed by concrete verification evidence produced in that same turn.

2. **Scaffold the project skeleton:**
   - `package.json` — `type: "module"`, deps: `youtubei.js` + Gemini SDK, devDeps: `wrangler`, `esbuild`, `typescript`, `@cloudflare/workers-types`
   - `tsconfig.json` — `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `types: ["@cloudflare/workers-types"]`
   - `wrangler.toml` — `compatibility_flags = ["nodejs_compat"]`, `main = "src/backend/index.ts"`, KV binding with placeholder IDs
   - `build.mjs` — esbuild: `src/frontend/app.js` → `public/`, `bundle: true`, `format: "esm"`
   - `.dev.vars` — `GEMINI_API_KEY=`, `WEBSHARE_PROXY_HOST=`, `WEBSHARE_PROXY_PORT=` placeholders
   - `.gitignore` — `node_modules/`, `public/`, `.dev.vars`, `.wrangler/`
   - `src/backend/` — placeholder files: `index.ts`, `router.ts`, `youtube.ts`, `gemini.ts`, `session.ts`, `prompts.ts`
   - `src/frontend/` — placeholder files: `app.js`, `app.css`
   - `src/fallback-subtitles/demo.txt` — hard-coded subtitle sample for video `xRh2sVcNXQ8`

3. **Verify the skeleton works:**

   ```bash
   npm install && node build.mjs && npx wrangler dev --port 34997
   ```

   Then `curl -s -w "\nHTTP:%{http_code}\n" http://localhost:34997/` should return 200.

4. **Create `claude-progress.txt`** with initial state (0/XX tests passing).

5. **Git init + first commit** with all scaffolding files.

### Phase 2: Feature Implementation Loop (main session orchestrates)

For each feature in `feature_list.json` with `"passes": false` (in priority order):

1. **Kill any stale dev server:** `fuser -k 34997/tcp 2>/dev/null`
2. **Start fresh dev server:** `node build.mjs && npx wrangler dev --port 34997`
3. **Spawn the implementation subagent:**

   ```text
   Agent(subagent_type="fullstack-builder", description="Implement feature #X",
     prompt="Implement this feature from feature_list.json:
     [paste the feature entry: category, description, steps]
     ...")
   ```

4. **Review the subagent's changes** — read the diff, then independently verify each step in the feature entry using the Testing Strategy below (curl for API, Playwright for UI). Do NOT toggle `passes` to `true` unless every step was verified with concrete output.
5. **Commit** the feature with a descriptive message referencing the feature ID.
6. **Update `claude-progress.txt`** with new completion count.
7. Repeat until all features pass.

### Testing Strategy

- **API/backend features**: curl commands (pre-approved in settings.local.json) — verify HTTP codes, headers (`X-Session-Id`, `Content-Type`), SSE `data:` format, JSON structure
- **UI/frontend features**: Playwright for browser automation — navigate, click, type, screenshot, verify DOM state, check console errors. Verify design tokens, interactivity (button states, typewriter effect, collapsible boxes), and responsive layout

## Anti-patterns (never do these)

- Never batch-toggle multiple `passes` fields at once — verify and toggle one feature at a time
- Never mark a test passing because "the code is written" — only passing when verified with tool output
- Never toggle frontend/style/e2e tests without browser/Playwright verification
- If a feature can't be fully verified (e.g., proxy requires Cloudflare network), leave it `false`
