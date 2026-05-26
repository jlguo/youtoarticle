// YouTube subtitle extraction module
// Fallback chain: KV cache → youtubei.js → timedtext API → hard-coded fallback

import { Innertube } from 'youtubei.js';
import { DEMO_SUBTITLE } from '../fallback-subtitles/demo';
import {
  YOUTUBE_LANG_PRIORITY,
  YOUTUBE_FETCH_TIMEOUT_MS,
  YOUTUBE_TIMEDTEXT_URL,
  SUB_CACHE_PREFIX,
  SUB_CACHE_TTL_SECONDS,
} from "./config";

const INNERTUBE_TIMEOUT_MS = 30_000;

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
 * Parse YouTube subtitle XML format into clean text.
 * YouTube timedtext XML looks like:
 *   <transcript>
 *     <text start="0.0" dur="3.5">Hello world</text>
 *     <text start="3.5" dur="2.0">How are you</text>
 *   </transcript>
 */
function parseXMLSubtitle(xmlText: string): string {
  const texts: string[] = [];
  const regex = /<text[^>]*>(.*?)<\/text>/gs;
  // Single-pass HTML entity + escape decoding
  const entityMap: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  };
  const entityRe = /&(?:amp|lt|gt|quot|#39);|\\[n"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlText)) !== null) {
    const content = match[1].replace(entityRe, (m) => {
      if (m in entityMap) return entityMap[m];
      if (m === '\\n') return ' ';
      if (m === '\\"') return '"';
      return m;
    });
    texts.push(content);
  }
  // If no XML tags found, try stripping timestamps directly (plain text fallback)
  if (texts.length === 0) {
    return stripTimestamps(xmlText);
  }
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  return joined;
}

/**
 * Extract a YouTube video ID from various URL formats.
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/
 */
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

// ========== Helper: timed fetch and timeout racing ==========

/**
 * Create a fetch-like function that adds an AbortSignal timeout to every request.
 * This prevents youtubei.js internal calls from hanging indefinitely in restricted environments.
 */
function createTimedFetch(timeoutMs: number): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = AbortSignal.timeout(timeoutMs);
    return fetch(input, { ...init, signal });
  };
}

/**
 * Race a promise against a timeout.
 * Returns the promise result if it settles within the timeout, otherwise rejects.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} exceeded ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// ========== Step 1: youtubei.js Innertube ==========

/**
 * Fetch subtitles via youtubei.js Innertube API.
 *
 * First tries the Transcript API for structured segment data,
 * then falls back to raw caption track XML parsing.
 * Language fallback via YOUTUBE_LANG_PRIORITY, then first available.
 *
 * Uses custom fetch with AbortSignal.timeout() to prevent hanging
 * in restricted network environments (e.g., local workerd dev).
 */
export async function fetchSubtitlesViaInnertube(videoId: string): Promise<string> {
  const timedFetch = createTimedFetch(YOUTUBE_FETCH_TIMEOUT_MS);

  // Innertube.create() accepts a custom fetch function that applies to all internal requests
  const innertube = await withTimeout(
    Innertube.create({
      fetch: timedFetch,
      generate_session_locally: true,
      retrieve_innertube_config: false,
    }),
    INNERTUBE_TIMEOUT_MS,
    'Innertube.create()',
  );

  // getInfo also uses the custom fetch from session
  const info = await withTimeout(
    innertube.getInfo(videoId),
    INNERTUBE_TIMEOUT_MS,
    'innertube.getInfo()',
  );

  // ----- Approach 1: Transcript API (structured segments) -----
  try {
    const transcriptInfo = await info.getTranscript();
    const availableLangs = transcriptInfo.languages as string[];

    // Find best matching language
    let selectedLang = '';
    for (const lang of YOUTUBE_LANG_PRIORITY) {
      if (availableLangs.includes(lang)) {
        selectedLang = lang;
        break;
      }
    }
    if (!selectedLang && availableLangs.length > 0) {
      selectedLang = availableLangs[0];
    }
    if (!selectedLang) {
      throw new Error('No transcript languages available');
    }

    // Select the language if not already selected
    let transcript = transcriptInfo;
    if (selectedLang !== transcriptInfo.selectedLanguage) {
      transcript = await transcriptInfo.selectLanguage(selectedLang);
    }

    // Extract text from segments
    const searchPanel = transcript.transcript.content;
    const segmentList = searchPanel?.body;
    const segments = segmentList?.initial_segments;

    if (!segments || segments.length === 0) {
      throw new Error('No transcript segments found');
    }

    const texts: string[] = [];
    for (const segment of segments) {
      // Both TranscriptSegment and TranscriptSectionHeader have snippet
      if (segment && 'snippet' in segment) {
        const snippet = (segment as { snippet: { toString(): string } }).snippet;
        texts.push(snippet.toString());
      }
    }

    const result = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (result) {
      return stripTimestamps(result);
    }
    throw new Error('Transcript segments produced empty text');
  } catch (transcriptErr) {
    console.log('[youtube] Transcript API failed, trying caption tracks:', transcriptErr instanceof Error ? transcriptErr.message : transcriptErr);
  }

  // ----- Approach 2: Caption tracks (XML subtitles) -----
  if (!info.captions?.caption_tracks || info.captions.caption_tracks.length === 0) {
    throw new Error('No subtitles available for this video');
  }

  const tracks = info.captions.caption_tracks;

  // Find best language match
  let selectedTrack: (typeof tracks)[0] | null = null;
  for (const lang of YOUTUBE_LANG_PRIORITY) {
    const track = tracks.find((t) => t.language_code === lang);
    if (track) {
      selectedTrack = track;
      break;
    }
  }
  if (!selectedTrack && tracks.length > 0) {
    selectedTrack = tracks[0];
  }
  if (!selectedTrack) {
    throw new Error('No caption track available');
  }

  // Fetch and parse the subtitle XML (with timeout)
  const response = await fetch(selectedTrack.base_url, {
    signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch caption track: HTTP ${response.status}`);
  }
  const xmlText = await response.text();
  const parsed = parseXMLSubtitle(xmlText);

  if (!parsed) {
    throw new Error('Caption track produced empty text');
  }
  return parsed;
}

// ========== Step 2: timedtext API ==========

/**
 * Fetch subtitles via YouTube's timedtext API (lightweight HTTP GET).
 * Much less CPU-intensive than youtubei.js — a single fetch + XML parse.
 */
async function fetchSubtitlesViaTimedtext(videoId: string): Promise<string> {
  for (const lang of YOUTUBE_LANG_PRIORITY) {
    const url = `${YOUTUBE_TIMEDTEXT_URL}?v=${videoId}&lang=${lang}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) continue;
    const xmlText = await response.text();
    const parsed = parseXMLSubtitle(xmlText);
    if (parsed) return parsed;
  }
  throw new Error('Timedtext API returned no usable subtitles');
}

// ========== Step 3: Hard-coded fallback ==========

/**
 * Load hard-coded fallback subtitles for the demo video.
 */
export function fetchFallbackSubtitles(): string {
  return DEMO_SUBTITLE;
}

// ========== Orchestrator ==========

/**
 * Orchestrator: KV cache → youtubei.js → timedtext API → hard-coded fallback.
 * Caches successful fetches in KV to avoid repeated YouTube API calls.
 */
export async function fetchSubtitlesWithFallback(videoId: string, env: Env): Promise<{ text: string; fromFallback: boolean }> {
  // Step 0: Check KV cache (avoids all YouTube API calls on repeat visits)
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

  // Step 1: youtubei.js Innertube API
  try {
    console.log(`[subtitle] Attempting Innertube fetch for video ${videoId}...`);
    result = await fetchSubtitlesViaInnertube(videoId);
  } catch (innertubeErr) {
    console.log(`[subtitle] Innertube fetch failed:`, innertubeErr instanceof Error ? innertubeErr.message : innertubeErr);
  }

  // Step 2: Timedtext API
  if (!result) {
    try {
      console.log(`[subtitle] Attempting timedtext fetch for video ${videoId}...`);
      result = await fetchSubtitlesViaTimedtext(videoId);
    } catch (timedtextErr) {
      console.log(`[subtitle] Timedtext fetch failed:`, timedtextErr instanceof Error ? timedtextErr.message : timedtextErr);
    }
  }

  // Step 3: Hard-coded fallback
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

  // Cache real results (skip fallback to avoid poisoning cache with demo text)
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
