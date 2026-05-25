// Cloudflare KV session storage
// Key format: session:{uuid} | Value: { fullText, chapters[], subtitle } | TTL: 3600s

export interface SessionData {
  fullText: string;
  chapters: string[];
  subtitle: string;
}

export async function saveSession(
  kv: KVNamespace,
  sessionId: string,
  data: SessionData
): Promise<void> {
  await kv.put(`session:${sessionId}`, JSON.stringify(data), {
    expirationTtl: 3600,
  });
}

export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionData | null> {
  const raw = await kv.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}
