// Global type declarations for Cloudflare Worker environment

interface Env {
  SESSION_KV: KVNamespace;
  GEMINI_API_KEY: string;
  DEEPSEEK_API_KEY?: string;
}
