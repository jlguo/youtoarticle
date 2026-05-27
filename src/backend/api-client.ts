// Shared HTTP response utilities for AI API clients (Gemini, DeepSeek).
// Both providers return passthrough streams to the browser, so they share
// the same CORS-aware response wrapping and error formatting.

export function corsResponse(body: ReadableStream | null, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": status === 200 && contentType === "text/event-stream" ? "no-cache" : "",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function errorResponse(message: string, status: number): Response {
  return corsResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: message })));
        controller.close();
      },
    }),
    "application/json",
    status,
  );
}
