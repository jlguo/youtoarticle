// Centralized configuration constants for the subtitle Worker.
// All magic numbers, URLs, timeouts, and route paths live here.

// =============================================================================

// YouTube
// =============================================================================
export const YOUTUBE_FETCH_TIMEOUT_MS = 15_000;
export const YOUTUBE_TIMEDTEXT_URL = "https://www.youtube.com/api/timedtext";

// Lightweight Innertube API (YouTube's internal JSON API — no heavy library needed)
export const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
export const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const INNERTUBE_CLIENT_VERSION = "2.20260206.01.00";

// =============================================================================

// Session (KV) — kept for subtitle caching in youtube.ts
// =============================================================================
export const ARTICLE_TTL_SECONDS = 86400; // 24 hours
export const SUB_CACHE_TTL_SECONDS = 2592000; // 30 days (subtitle cache)
export const ARTICLE_KV_PREFIX = "article:";
export const SUB_CACHE_PREFIX = "sub:";

// =============================================================================

// Route Paths
// =============================================================================
export const ROUTE_GENERATE = "/api/generate";

export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_MODEL_LITE = "gemini-3.1-flash-lite";
export function geminiStreamURL(model: string) {
  return `https://generativelanguage.googleapis.com/v1/models/${model}:streamGenerateContent`;
}
export function geminiNonStreamURL(model: string) {
  return `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
}

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_ARTICLE_TEMPERATURE = 0.7;
export const DEEPSEEK_5W1H_TEMPERATURE = 0.3;
export const DEEPSEEK_5W1H_MAX_TOKENS = 1024;

export const ROUTE_5W1H = "/api/5w1h";
export const ROUTE_VIDEO_INFO = "/api/video-info";

export const PROVIDER_GEMINI = "gemini";
export const PROVIDER_DEEPSEEK = "deepseek";

// HTTP / CORS
// =============================================================================
export const CORS_ALLOW_ORIGIN = "*";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const CORS_ALLOW_HEADERS = "Content-Type";
