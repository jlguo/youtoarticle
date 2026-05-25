// YouTube subtitle extraction module
// Fallback chain: youtubei.js direct → Webshare TCP Socket proxy → hard-coded subtitle

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchSubtitles(
  videoId: string,
  env: Env
): Promise<string> {
  // TODO: implement youtubei.js direct fetch with zh-CN → zh → en fallback
  throw new Error("Subtitle fetch not yet implemented");
}

export async function fetchSubtitlesWithProxy(
  videoId: string,
  env: Env
): Promise<string> {
  // TODO: implement Webshare TCP Socket proxy via cloudflare:sockets connect()
  throw new Error("Proxy subtitle fetch not yet implemented");
}

export async function fetchFallbackSubtitles(): Promise<string> {
  // TODO: load and return src/fallback-subtitles/demo.txt
  throw new Error("Fallback subtitle not yet implemented");
}
