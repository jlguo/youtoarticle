// Centralized configuration constants for the subtitle Worker.
// All magic numbers, URLs, timeouts, and route paths live here.

// =============================================================================

// YouTube
// =============================================================================
export const YOUTUBE_LANG_PRIORITY = ["en"];
export const YOUTUBE_FETCH_TIMEOUT_MS = 5_000;
export const YOUTUBE_TIMEDTEXT_URL = "https://www.youtube.com/api/timedtext";

// Lightweight Innertube API (YouTube's internal JSON API — no heavy library needed)
export const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
export const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const INNERTUBE_CLIENT_VERSION = "2.20260206.01.00";

// =============================================================================

// Session (KV) — kept for subtitle caching in youtube.ts
// =============================================================================
export const SESSION_KV_PREFIX = "session:";
export const SESSION_TTL_SECONDS = 3600;

// Subtitle cache: keyed by video ID, avoids re-fetching from YouTube
export const SUB_CACHE_PREFIX = "sub:";
export const SUB_CACHE_TTL_SECONDS = 604800; // 7 days

// =============================================================================

// Route Paths
// =============================================================================
export const ROUTE_GENERATE = "/api/generate";

// =============================================================================

// HTTP / CORS
// =============================================================================
export const CORS_ALLOW_ORIGIN = "*";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const CORS_ALLOW_HEADERS = "Content-Type";
