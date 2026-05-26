# Potential Improvements

## 1. Free-tier performance UX messaging

Because all services run on free plans, users may encounter slowness, rate limits, or degraded fallback paths. The app should surface contextual status messages so users understand _why_ something is slow rather than assuming it's broken.

### 1.1 Subtitle extraction progress indicator

The subtitle fallback chain (direct → proxy → hard-coded) is opaque to the user — they just see "生成中..." for a long time.

**Proposed changes:**

- **Backend**: `POST /api/generate` should begin streaming SSE immediately with a `data: [STATUS] <message>` line before Gemini even starts, so the frontend can show what's happening.
- **Frontend**: Render a status line (e.g., "正在提取字幕..." → "正在通过代理获取字幕..." → "正在使用备用字幕...") below the loading spinner, updated as each SSE status message arrives.
- **Fallback awareness**: When the hard-coded fallback is used, show a persistent banner: "当前视频字幕提取失败，正在使用演示字幕生成文章" so the user knows the article isn't based on their actual video.

### 1.2 Gemini free-tier rate limit handling

Gemini's free tier (`gemini-2.5-flash`) has low RPM quotas. When the API returns 429, the error currently surfaces as a generic failure.

**Proposed changes:**

- **Backend (`gemini.ts`)**: Catch 429 responses in `geminiFetch()` and throw a specific `RateLimitError` with a retry-after hint.
- **Backend (`router.ts`)**: Catch `RateLimitError` in the generate handler and return a user-friendly JSON error instead of a 500.
- **Frontend**: On 429, show: "AI 服务当前繁忙（免费套餐请求频率限制），请稍后重试。" with a suggestion to wait ~30 seconds.

### 1.3 Cloudflare Workers free-plan CPU timeout awareness

Free-plan Workers have a 10ms CPU time limit per request. Long subtitle extraction or large prompt processing may hit this wall.

**Proposed changes:**

- **Backend**: Wrap `fetchSubtitlesWithFallback` with timing instrumentation. If any step (Innertube create, proxy fetch) exceeds a threshold, log a warning.
- **Frontend**: If the SSE stream abruptly disconnects without `[DONE]`, show: "生成过程中连接中断，可能是免费套餐资源限制导致。请尝试更短的视频。"

### 1.4 Loading state refinements

**Proposed changes:**

- Replace the static "生成中..." text with a multi-stage indicator:
  ```
  正在提取字幕...        (spinner)
  正在生成文章...        (spinner, after subtitle fetch completes)
  正在分析章节摘要...    (shown during /api/5w1h calls)
  ```
- Add an approximate wait-time hint based on where the user is in the flow (e.g., "字幕提取可能需要 5-15 秒，取决于网络状况").
