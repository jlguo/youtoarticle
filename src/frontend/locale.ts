type LocaleFn = (arg: string) => string;

interface LocaleStrings {
  btnGenerate: string;
  btnGenerating: string;
  labelSummary: string;
  labelWho: string;
  labelWhat: string;
  labelWhen: string;
  labelWhere: string;
  labelWhy: string;
  labelHow: string;
  loadingText: string;
  errRequestFailed: LocaleFn;
  errParse5W1H: string;
  errGenerateFailed: string;
  errLoadFailed: LocaleFn;
  errEmptyURL: string;
  errInvalidURL: string;
  providerGeminiLite: string;
  providerGemini: string;
  providerDeepseek: string;
}

const zh: LocaleStrings = {
  btnGenerate: "开始生成文章",
  btnGenerating: "生成中...",
  labelSummary: "5W1H 智能总结",
  labelWho: "Who（人物）",
  labelWhat: "What（事件）",
  labelWhen: "When（时间）",
  labelWhere: "Where（地点）",
  labelWhy: "Why（原因）",
  labelHow: "How（方式）",

  loadingText: "正在生成文章...",

  errRequestFailed: (status: string) => "请求失败 (HTTP " + status + ")",
  errParse5W1H: "无法解析 5W1H 响应",
  errGenerateFailed: "生成文章时发生错误，请稍后重试",
  errLoadFailed: (msg: string) => "加载失败：" + msg,

  errEmptyURL: "请输入 YouTube 链接",
  errInvalidURL: "请输入有效的 YouTube 链接（youtube.com/watch?v= 或 youtu.be/）",

  providerGeminiLite: "Gemini - gemini-3.1-flash-lite（默认）",
  providerGemini: "Gemini - gemini-2.5-flash",
  providerDeepseek: "DeepSeek - deepseek-v4-flash",
};

const en: LocaleStrings = {
  btnGenerate: "Generate Article",
  btnGenerating: "Generating...",
  labelSummary: "5W1H Summary",
  labelWho: "Who",
  labelWhat: "What",
  labelWhen: "When",
  labelWhere: "Where",
  labelWhy: "Why",
  labelHow: "How",

  loadingText: "Generating article...",

  errRequestFailed: (status: string) => "Request failed (HTTP " + status + ")",
  errParse5W1H: "Unable to parse 5W1H response",
  errGenerateFailed: "Failed to generate article. Please try again later.",
  errLoadFailed: (msg: string) => "Load failed: " + msg,

  errEmptyURL: "Please enter a YouTube URL",
  errInvalidURL: "Invalid YouTube URL (expected youtube.com/watch?v= or youtu.be/)",

  providerGeminiLite: "Gemini - gemini-3.1-flash-lite (default)",
  providerGemini: "Gemini - gemini-2.5-flash",
  providerDeepseek: "DeepSeek - deepseek-v4-flash",
};

const locales: Record<string, LocaleStrings> = { zh, en };

function detectLang(): string {
  const htmlLang = document.documentElement.lang || "";
  const lang = htmlLang.split("-")[0].toLowerCase();
  if (lang === "en") return "en";
  return "zh";
}

const currentLang: string = detectLang();
const _: LocaleStrings = locales[currentLang] || locales.zh!;

export { _, currentLang };
