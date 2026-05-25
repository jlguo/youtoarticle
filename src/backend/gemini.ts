// Gemini AI module — streaming article generation and 5W1H summaries
import { buildArticlePrompt, build5W1HPrompt } from "./prompts";

export async function streamArticle(
  subtitle: string,
  rule?: string,
  env?: Env
): Promise<ReadableStream> {
  // TODO: call Gemini generateContentStream with article prompt
  // Return SSE-formatted ReadableStream via TransformStream
  throw new Error("Stream article not yet implemented");
}

export async function generate5W1H(
  chapter: string,
  fullText: string,
  env?: Env
): Promise<{ who: string; what: string; when: string; where: string; why: string; how: string }> {
  // TODO: call Gemini generateContent with 5W1H prompt
  // Return structured JSON
  throw new Error("5W1H generation not yet implemented");
}
