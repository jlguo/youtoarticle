// Cloudflare Worker entry point — delegates to router
import { handleRequest } from "./router";

export default {
  async fetch(request: Request, env: Record<string, unknown>, _ctx: unknown): Promise<Response> {
    return handleRequest(request, env, _ctx);
  },
};
