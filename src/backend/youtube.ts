// YouTube subtitle extraction module
// Fallback chain: Innertube API (lightweight, <50ms CPU) → timedtext API → hard-coded fallback

import { DEMO_SUBTITLE } from '../fallback-subtitles/demo';
import {
  YOUTUBE_FETCH_TIMEOUT_MS,
  YOUTUBE_TIMEDTEXT_URL,
  INNERTUBE_PLAYER_URL,
  INNERTUBE_API_KEY,
  SUB_CACHE_PREFIX,
  SUB_CACHE_TTL_SECONDS,
} from "./config";

// Mobile client profiles for Innertube API
const INNERTUBE_CLIENTS = {
  IOS: { clientName: "IOS", clientVersion: "20.10.4", platform: "MOBILE" },
  ANDROID: { clientName: "ANDROID", clientVersion: "20.10.38", platform: "MOBILE" },
} as const;

function stripTimestamps(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^\d+$/.test(l)) continue;
    if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(l)) continue;
    out.push(l);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse YouTube subtitle XML into clean text using indexOf (avoids regex backtracking on large input).
 * YouTube timedtext XML: <transcript><text start="0.0" dur="3.5">Hello</text>...</transcript>
 */
function parseXMLSubtitle(xmlText: string): string {
  const TAG_OPEN = "<text ";
  const TAG_CLOSE = "</text>";
  let pos = 0;
  let result = "";

  while ((pos = xmlText.indexOf(TAG_OPEN, pos)) !== -1) {
    const contentStart = xmlText.indexOf(">", pos) + 1;
    if (contentStart === 0) break;
    const contentEnd = xmlText.indexOf(TAG_CLOSE, contentStart);
    if (contentEnd === -1) break;

    let content = xmlText.slice(contentStart, contentEnd);
    content = content
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"');

    if (result) result += " ";
    result += content;
    pos = contentEnd + TAG_CLOSE.length;
  }

  if (!result) return "";
  return result;
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ========== API Key (dynamic, fetched from watch page) ==========

let _cachedApiKey: string | null = null;

/**
 * Fetch the Innertube API key from a YouTube watch page, caching per Worker isolate.
 * The key is embedded in the page HTML and rotates periodically — hardcoding it
 * (as most libraries do) eventually breaks. Falls back to hardcoded key.
 */
async function getApiKey(videoId: string, env: Env): Promise<string> {
  if (_cachedApiKey) return _cachedApiKey;

  try {
    const response = await fetchViaProxy(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(10_000),
    }, env);

    if (response.ok) {
      const html = await response.text();
      const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
                 || html.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);
      if (match) {
        _cachedApiKey = match[1];
        console.log("[youtube] Fetched dynamic Innertube API key");
        return _cachedApiKey;
      }
    }
  } catch (e) {
    console.log("[youtube] API key fetch failed, using hardcoded fallback:", e instanceof Error ? e.message : e);
  }

  // Fallback to hardcoded key
  _cachedApiKey = INNERTUBE_API_KEY;
  return _cachedApiKey;
}

// ========== Proxy fetch helper ==========

/**
 * Fetch through webshare proxy when WEBSHARE_* env bindings are configured,
 * otherwise pass through directly. Env bindings read at request time (not module
 * load) because Cloudflare secrets are only available via the env parameter.
 */
function fetchViaProxy(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  env: Env,
): Promise<Response> {
  const host = env.WEBSHARE_PROXY_HOST;
  const port = env.WEBSHARE_PROXY_PORT;
  const useProxy = host && port;

  if (useProxy) {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> || {}) };
    if (env.WEBSHARE_PROXY_USERNAME) {
      headers['Proxy-Authorization'] =
        'Basic ' + btoa(`${env.WEBSHARE_PROXY_USERNAME}:${env.WEBSHARE_PROXY_PASSWORD || ''}`);
    }
    return fetch(input, {
      ...init,
      headers,
      cf: { resolveOverride: `${host}:${port}` },
    } as RequestInit);
  }
  return fetch(input, init);
}

// ========== Step 1: Lightweight Innertube API (no youtubei.js) ==========

interface InnertubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
}

interface InnertubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: InnertubeCaptionTrack[];
    };
  };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    shortDescription?: string;
    viewCount?: string;
  };
}

async function callInnertubePlayer(
  videoId: string,
  env: Env,
  client: { clientName: string; clientVersion: string; platform?: string } = INNERTUBE_CLIENTS.IOS,
): Promise<InnertubePlayerResponse> {
  const apiKey = await getApiKey(videoId, env);
  const url = `${INNERTUBE_PLAYER_URL}?key=${apiKey}`;
  const body = JSON.stringify({
    context: { client },
    videoId,
  });

  const response = await fetchViaProxy(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://www.youtube.com",
    },
    body,
    signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
  }, env);

  if (!response.ok) {
    throw new Error(`Innertube API returned HTTP ${response.status}`);
  }

  return response.json() as Promise<InnertubePlayerResponse>;
}

async function fetchSubtitlesViaInnertube(videoId: string, env: Env): Promise<string> {
  // Try IOS first, then ANDROID as fallback (different profiles return different
  // caption availability depending on the requesting IP region)
  for (const [name, client] of Object.entries(INNERTUBE_CLIENTS)) {
    try {
      const playerData = await callInnertubePlayer(videoId, env, client);

      const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks || tracks.length === 0) {
        console.log(`[youtube] ${name} profile: 0 caption tracks`);
        continue;
      }

      const track = tracks.find(t => t.languageCode === "en") || tracks[0];

      // Strip format override param (youtube-transcript-edge pattern) to get standard XML
      const captionUrl = track.baseUrl.replace(/&fmt=[^&]+/, '');

      const response = await fetchViaProxy(captionUrl, {
        signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
      }, env);

      if (!response.ok) {
        console.log(`[youtube] ${name} profile: caption fetch HTTP ${response.status}`);
        continue;
      }

      const xmlText = await response.text();
      const parsed = parseXMLSubtitle(xmlText);
      if (!parsed) {
        console.log(`[youtube] ${name} profile: caption XML parsed empty`);
        continue;
      }

      console.log(`[youtube] ${name} profile: ${parsed.length} chars extracted`);
      return parsed;
    } catch (e) {
      console.log(`[youtube] ${name} profile failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw new Error("No caption tracks available (tried IOS + ANDROID profiles)");
}

// ========== Step 2: timedtext API ==========

async function fetchSubtitlesViaTimedtext(videoId: string): Promise<string> {
  for (const lang of ["en", "zh"]) {
    const url = `${YOUTUBE_TIMEDTEXT_URL}?v=${videoId}&lang=${lang}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) continue;
    const xmlText = await response.text();
    const parsed = parseXMLSubtitle(xmlText);
    if (parsed) return parsed;
  }
  throw new Error("Timedtext API returned no usable subtitles");
}

// ========== Step 3: Hard-coded fallback ==========

export function fetchFallbackSubtitles(): string {
  return DEMO_SUBTITLE;
}

// ========== Orchestrator ==========

export async function fetchSubtitlesWithFallback(videoId: string, env: Env): Promise<{ text: string; fromFallback: boolean }> {
  try {
    const cached = await env.SESSION_KV.get(`${SUB_CACHE_PREFIX}${videoId}`);
    if (cached) {
      console.log(`[subtitle] KV cache hit for video ${videoId}`);
      return { text: cached, fromFallback: false };
    }
  } catch (kvErr) {
    console.log(`[subtitle] KV cache read failed, continuing:`, kvErr);
  }

  let result: string | null = null;
  let fromFallback = false;

  try {
    console.log(`[subtitle] Attempting Innertube fetch for video ${videoId}...`);
    result = await fetchSubtitlesViaInnertube(videoId, env);
  } catch (innertubeErr) {
    console.log(`[subtitle] Innertube fetch failed:`, innertubeErr instanceof Error ? innertubeErr.message : innertubeErr);
  }

  if (!result) {
    try {
      console.log(`[subtitle] Attempting timedtext fetch for video ${videoId}...`);
      result = await fetchSubtitlesViaTimedtext(videoId);
    } catch (timedtextErr) {
      console.log(`[subtitle] Timedtext fetch failed:`, timedtextErr instanceof Error ? timedtextErr.message : timedtextErr);
    }
  }

  if (!result) {
    try {
      console.log(`[subtitle] Loading fallback subtitles for video ${videoId}...`);
      result = fetchFallbackSubtitles();
      fromFallback = true;
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.log(`[subtitle] Fallback also failed:`, msg);
      throw new Error('All subtitle extraction methods failed. Please try another video.');
    }
  }

  if (!fromFallback) {
    try {
      await env.SESSION_KV.put(`${SUB_CACHE_PREFIX}${videoId}`, result!, {
        expirationTtl: SUB_CACHE_TTL_SECONDS,
      });
      console.log(`[subtitle] Cached subtitles for video ${videoId}`);
    } catch (kvErr) {
      console.log(`[subtitle] KV cache write failed:`, kvErr);
    }
  }

  return { text: result, fromFallback };
}

export interface VideoMetadata {
  title: string;
  channel: string;
  duration: string;
  description: string;
  viewCount: number;
  videoId: string;
}

export async function fetchVideoInfo(videoId: string, env: Env): Promise<VideoMetadata | null> {
  try {
    const playerData = await callInnertubePlayer(videoId, env);
    const details = playerData.videoDetails;
    if (!details) return null;

    const secs = parseInt(details.lengthSeconds || "0", 10);
    const mins = Math.floor(secs / 60);
    const seconds = secs % 60;

    return {
      title: details.title || videoId,
      channel: details.author || "YouTube",
      duration: `${mins}:${seconds.toString().padStart(2, "0")}`,
      description: details.shortDescription || "",
      viewCount: parseInt(details.viewCount || "0", 10),
      videoId,
    };
  } catch {
    return null;
  }
}
