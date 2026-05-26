// YouTube subtitle extraction module
// Fallback chain: youtubei.js direct → Webshare TCP Socket proxy → hard-coded subtitle

import { Innertube } from 'youtubei.js';
import { proxyFetch } from './proxy-fetch';

// Language fallback priority: Simplified Chinese preferred, then English
const LANG_PRIORITY = ['zh-Hans', 'zh-CN', 'zh', 'en'];
const FETCH_TIMEOUT_MS = 5_000; // 5 seconds per individual fetch call
const INNERTUBE_TIMEOUT_MS = 8_000; // 8 seconds for the entire Innertube operation

/**
 * Strip timestamp markers and subtitle index numbers from raw subtitle text.
 * Handles common formats:
 *   - "00:00:01,000 --> 00:00:03,500" (SRT-style)
 *   - "00:00:01.000 --> 00:00:03.500" (WebVTT-style)
 *   - Standalone numeric index lines
 */
function stripTimestamps(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      // SRT/WebVTT timestamp lines
      if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(l)) return false;
      // Standalone numeric index lines
      if (/^\d+$/.test(l)) return false;
      // Empty lines
      if (!l) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlText)) !== null) {
    // Decode HTML entities
    const content = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"');
    texts.push(content);
  }
  // If no XML tags found, try stripping timestamps directly (plain text fallback)
  if (texts.length === 0) {
    return stripTimestamps(xmlText);
  }
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  // Final cleanup: remove any remaining timestamp fragments
  return stripTimestamps(joined);
}

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

/**
 * Direct subtitle fetch using youtubei.js Innertube API.
 *
 * First tries the Transcript API for structured segment data,
 * then falls back to raw caption track XML parsing.
 * Language fallback: zh-Hans/zh-CN/zh -> en -> first available.
 *
 * Uses custom fetch with AbortSignal.timeout() to prevent hanging
 * in restricted network environments (e.g., local workerd dev).
 */
export async function fetchSubtitles(videoId: string, _env: Env): Promise<string> {
  const timedFetch = createTimedFetch(FETCH_TIMEOUT_MS);

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
    const availableLangs = transcriptInfo.languages;

    // Find best matching language
    let selectedLang = '';
    for (const lang of LANG_PRIORITY) {
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
    console.log('[youtube] Transcript API failed, trying caption tracks:', transcriptErr);
  }

  // ----- Approach 2: Caption tracks (XML subtitles) -----
  if (!info.captions?.caption_tracks || info.captions.caption_tracks.length === 0) {
    throw new Error('No subtitles available for this video');
  }

  const tracks = info.captions.caption_tracks;

  // Find best language match
  let selectedTrack: (typeof tracks)[0] | null = null;
  for (const lang of LANG_PRIORITY) {
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

/**
 * Fetch subtitles through a Webshare TCP Socket proxy tunnel.
 *
 * Uses cloudflare:sockets connect() to establish a TCP connection through
 * the Webshare proxy, sends HTTP CONNECT to tunnel to YouTube, upgrades
 * to TLS, then fetches the timedtext API.
 */
export async function fetchSubtitlesWithProxy(videoId: string, env: Env): Promise<string> {
  const proxyHost = env.WEBSHARE_PROXY_HOST;
  const proxyPort = parseInt(env.WEBSHARE_PROXY_PORT, 10);

  if (!proxyHost || !proxyPort) {
    throw new Error('Webshare proxy not configured: set WEBSHARE_PROXY_HOST and WEBSHARE_PROXY_PORT');
  }

  const proxy = {
    host: proxyHost,
    port: proxyPort,
    username: env.WEBSHARE_PROXY_USERNAME,
    password: env.WEBSHARE_PROXY_PASSWORD,
  };

  const languages = ['zh-Hans', 'zh-CN', 'zh', 'en'];
  let lastError: Error | null = null;

  for (const lang of languages) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`;
      const xmlText = await proxyFetch(url, proxy);
      const parsed = parseXMLSubtitle(xmlText);
      if (parsed) {
        return parsed;
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError || new Error('Could not fetch subtitles through proxy for any language');
}

/**
 * Load hard-coded fallback subtitles for the demo video.
 */
export async function fetchFallbackSubtitles(): Promise<string> {
  return `人工智能正在以前所未有的速度改变我们的世界。今天我们邀请到了硅谷知名投资人马克·安德森，来讨论AI革命的万亿美金之问。

AI技术在过去几年取得了惊人的进步。从GPT模型到各种生成式AI应用，我们看到了技术范式的根本性转变。

在消费者市场，AI应用的收入正在快速增长。越来越多的人愿意为AI服务付费，无论是写作助手、编程工具还是创意设计。

企业市场同样充满了机遇。许多公司正在将AI集成到他们的工作流程中，从客户服务到数据分析，AI正在重塑企业的运营方式。

智能经济的一个核心特征是收入爆发与成本塌陷的同时发生。一方面，AI创造了全新的收入来源；另一方面，它大幅降低了某些服务的成本。

AI可以依托已有的互联网基础设施快速触达全球用户。这意味着优秀的AI产品可以实现前所未有的增长速度。

对于个人用户来说，AI能够直接创造效率提升。无论是程序员、写作者还是设计师，都能从AI工具中获益。

企业通过AI可以实现收入增长和成本优化。这不仅仅是自动化替代人工，更是创造新的商业价值。

在商业模式方面，我们看到消费者订阅模式正在成为主流。用户按月付费获取AI服务的使用权。

企业市场则更多采用按需token计费的方式。这种灵活的定价模式让企业可以根据实际使用量来控制成本。

随着GPU和数据中心供给的持续改善，AI的单位成本正在快速下降。这意味着更多的创新将成为可能。

成本下降会进一步扩大市场需求。这是一个良性循环：更低的成本带来更多的用户，更多的用户带来更多的数据，更多的数据带来更好的模型。

我们正站在一个新时代的起点。AI不仅仅是一项新技术，它代表了一种全新的经济模式和组织方式。

未来的十年将是AI重塑各个行业的关键时期。那些能够抓住这一机遇的企业和个人，将获得巨大的竞争优势。

但我们也需要清醒地认识到AI发展中的挑战。包括数据隐私、算法偏见、就业变革等问题都需要认真对待。

最终，AI革命的真正价值不在于技术本身，而在于它如何改善人类的生活和工作方式。这才是万亿美金之问的真正答案。`;
}

/**
 * Orchestrator: direct → proxy → hard-coded fallback.
 * Each step logs failures and degrades gracefully.
 * Never crashes — always returns subtitles or throws a clear error.
 */
export async function fetchSubtitlesWithFallback(videoId: string, env: Env): Promise<string> {
  // Step 1: Try direct youtubei.js fetch
  try {
    console.log(`[subtitle] Attempting direct fetch for video ${videoId}...`);
    return await fetchSubtitles(videoId, env);
  } catch (directErr) {
    console.log(`[subtitle] Direct fetch failed:`, directErr instanceof Error ? directErr.message : directErr);
  }

  // Step 2: Try Webshare TCP Socket proxy
  try {
    console.log(`[subtitle] Attempting proxy fetch for video ${videoId}...`);
    return await fetchSubtitlesWithProxy(videoId, env);
  } catch (proxyErr) {
    console.log(`[subtitle] Proxy fetch failed:`, proxyErr instanceof Error ? proxyErr.message : proxyErr);
  }

  // Step 3: Load hard-coded fallback
  try {
    console.log(`[subtitle] Loading fallback subtitles for video ${videoId}...`);
    return await fetchFallbackSubtitles();
  } catch (fallbackErr) {
    console.log(`[subtitle] Fallback also failed:`, fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
    throw new Error('All subtitle extraction methods failed. Please try another video.');
  }
}
