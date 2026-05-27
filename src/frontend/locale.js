const zh = {
  btnGenerate: "开始生成",
  btnGenerating: "生成中...",
  btn5W1H: "5W1H",
  btnLoading: "加载中...",

  labelSummary: "5W1H 摘要",
  labelWho: "Who（人物）",
  labelWhat: "What（事件）",
  labelWhen: "When（时间）",
  labelWhere: "Where（地点）",
  labelWhy: "Why（原因）",
  labelHow: "How（方式）",

  loadingText: "正在生成文章...",

  errRequestFailed: (status) => "请求失败 (HTTP " + status + ")",
  errParse5W1H: "无法解析 5W1H 响应",
  errGenerateFailed: "生成文章时发生错误，请稍后重试",
  errLoadFailed: (msg) => "加载失败：" + msg,

  errEmptyURL: "请输入 YouTube 链接",
  errInvalidURL: "请输入有效的 YouTube 链接（youtube.com/watch?v= 或 youtu.be/）",

  providerGemini: "Gemini 2.5 Flash（默认）",
  providerDeepseek: "DeepSeek V4 Flash",
};

const en = {
  btnGenerate: "Generate",
  btnGenerating: "Generating...",
  btn5W1H: "5W1H",
  btnLoading: "Loading...",

  labelSummary: "5W1H Summary",
  labelWho: "Who",
  labelWhat: "What",
  labelWhen: "When",
  labelWhere: "Where",
  labelWhy: "Why",
  labelHow: "How",

  loadingText: "Generating article...",

  errRequestFailed: (status) => "Request failed (HTTP " + status + ")",
  errParse5W1H: "Unable to parse 5W1H response",
  errGenerateFailed: "Failed to generate article. Please try again later.",
  errLoadFailed: (msg) => "Load failed: " + msg,

  errEmptyURL: "Please enter a YouTube URL",
  errInvalidURL: "Invalid YouTube URL (expected youtube.com/watch?v= or youtu.be/)",

  providerGemini: "Gemini 2.5 Flash (default)",
  providerDeepseek: "DeepSeek V4 Flash",
};

const locales = { zh, en };

function detectLang() {
  const htmlLang = document.documentElement.lang || "";
  const lang = htmlLang.split("-")[0].toLowerCase();
  if (lang === "en") return "en";
  return "zh";
}

const currentLang = detectLang();
const _ = locales[currentLang] || locales.zh;

export { _, currentLang };
