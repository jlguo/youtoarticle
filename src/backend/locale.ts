const zh = {
  invalidJSON: "无效的 JSON 格式",
  bodyNotObject: "请求体必须是 JSON 对象",
  missingField: (field: string) => `缺少必填字段：${field}`,
  invalidYouTubeURL: "无效的 YouTube 链接格式，请提供有效的 youtube.com 或 youtu.be 链接",
  notFound: "未找到",
  sessionNotFound: "会话不存在或已过期，请重新生成文章",
  unexpectedError: "服务器内部错误",
  subtitleAllFailed: "所有字幕提取方式均失败，请尝试其他视频",
  geminiError: (status: number, detail: string) => `Gemini API 错误 (HTTP ${status})：${detail}`,
  deepseekError: (status: number, detail: string) => `DeepSeek API 错误 (HTTP ${status})：${detail}`,
  provider: { gemini: "Gemini 2.5 Flash", deepseek: "DeepSeek V4 Flash" },
};

const en = {
  invalidJSON: "Invalid JSON body",
  bodyNotObject: "Request body must be a JSON object",
  missingField: (field: string) => `Missing required field: ${field}`,
  invalidYouTubeURL:
    "Invalid YouTube URL format. Please provide a valid youtube.com or youtu.be link.",
  notFound: "Not Found",
  sessionNotFound: "Session not found or expired. Please regenerate the article.",
  unexpectedError: "Internal server error",
  subtitleAllFailed: "All subtitle extraction methods failed. Please try another video.",
  geminiError: (status: number, detail: string) =>
    `Gemini API error (HTTP ${status}): ${detail}`,
  deepseekError: (status: number, detail: string) =>
    `DeepSeek API error (HTTP ${status}): ${detail}`,
  provider: { gemini: "Gemini 2.5 Flash", deepseek: "DeepSeek V4 Flash" },
};

type Locale = typeof zh;

export type Lang = "zh" | "en";

const locales: Record<Lang, Locale> = { zh, en };

export function detectLang(request: Request): Lang {
  const header = request.headers.get("Accept-Language") || "";
  const lang = header.split(",")[0]?.split("-")[0]?.toLowerCase();
  if (lang === "en") return "en";
  return "zh";
}

export function t(lang: Lang): Locale {
  return locales[lang] || locales.zh;
}
