// Request router — matches API paths, delegates to handlers
// Static assets in public/ are auto-served by the platform via [assets] config

export async function handleRequest(
  request: Request,
  _env: Record<string, unknown>,
  _ctx: unknown
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // POST /api/generate — SSE streaming article generation
  if (request.method === "POST" && pathname === "/api/generate") {
    return new Response("Generate not yet implemented", { status: 501 });
  }

  // POST /api/5w1h — chapter summary
  if (request.method === "POST" && pathname === "/api/5w1h") {
    return new Response("5W1H not yet implemented", { status: 501 });
  }

  return new Response("Not Found", { status: 404 });
}
