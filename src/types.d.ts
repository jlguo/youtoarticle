// Global type declarations for Cloudflare Worker environment

interface Env {
  SESSION_KV: KVNamespace;
  GEMINI_API_KEY: string;
  WEBSHARE_PROXY_HOST: string;
  WEBSHARE_PROXY_PORT: string;
  WEBSHARE_PROXY_USERNAME?: string;
  WEBSHARE_PROXY_PASSWORD?: string;
  CLOUDFLARE_API_TOKEN?: string;
}
