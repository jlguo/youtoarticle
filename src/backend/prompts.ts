// Prompt templates for article generation and 5W1H analysis.
// Shared strings avoid duplication between Gemini (single-string) and
// DeepSeek (messages array) formats.

const ARTICLE_SYSTEM_DEFAULT =
  "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文文章。\n\n" +
  "处理规则：\n\n" +
  "1. 如果能识别出字幕中的不同说话人：\n" +
  "   - 使用 ## 话题概括 作为章节标题\n" +
  "   - 内容以对话形式编排，格式为「说话人：发言内容」\n" +
  "   - 每次说话人切换时另起一段，保留问答节奏\n\n" +
  "2. 如果不能区分说话人：\n" +
  "   - 按主题分段，使用 ## 主题概括 作为章节标题\n" +
  "   - 用自己的话精炼总结该主题的核心内容\n\n" +
  "统一要求：\n" +
  "- # 一级标题为文章主标题\n" +
  "- 使用标准 Markdown 格式\n" +
  "- 如果不是中文，先翻译为中文再输出";

const ARTICLE_SYSTEM_CUSTOM =
  "你是一位专业的内容编辑。请基于 YouTube 视频字幕，按照用户要求生成一篇中文文章。\n\n" +
  "格式要求（严格遵守）：\n" +
  "1. 使用标准 Markdown 格式输出，每个标题前后必须有换行符\n" +
  "2. 一级标题（# 标题）为文章主标题，后面紧跟空行再开始正文\n" +
  "3. 二级标题（## 标题）为各章节标题，每个二级标题前要有空行，标题后换行再接正文\n" +
  "4. 段落之间用空行分隔\n" +
  "内容要求：\n" +
  "5. 章节之间逻辑清晰，内容连贯\n" +
  "6. 严格遵循以下用户要求：";

const W1H_SYSTEM =
  "你是一位专业的文章分析助手。请基于整篇文章的完整上下文，提取 5W1H 结构化总结。" +
  "返回严格的 JSON 格式，不要包含 markdown 代码块或其他内容：\n" +
  "{\n" +
  '  "who": "涉及的人物或角色",\n' +
  '  "what": "该章节讨论的核心事件或主题",\n' +
  '  "when": "时间背景或时间跨度",\n' +
  '  "where": "地点或场景环境",\n' +
  '  "why": "原因、动机或背景分析",\n' +
  '  "how": "实现方式、方法或过程"\n' +
  "}";

function subtitleUserPrompt(subtitle: string): string {
  return "字幕内容：\n" + subtitle;
}

function w1hUserPrompt(chapter: string, fullText: string): string {
  return "完整文章内容：\n" + fullText + "\n\n请输出「" + chapter + "」章节的 5W1H 分析：";
}

// ── Gemini format (single string) ──

export function buildArticlePrompt(subtitle: string, rule?: string): string {
  const system = rule?.trim() ? ARTICLE_SYSTEM_CUSTOM : ARTICLE_SYSTEM_DEFAULT;
  const suffix = rule?.trim() ? "\n" + rule + "\n\n" : "\n\n";
  return system + suffix + subtitleUserPrompt(subtitle);
}

export function build5W1HPrompt(chapter: string, fullText: string): string {
  return W1H_SYSTEM + "\n\n" + w1hUserPrompt(chapter, fullText);
}

// ── DeepSeek format (messages array) ──

export function buildArticleMessages(subtitle: string, rule?: string): Array<{ role: string; content: string }> {
  const system = rule?.trim() ? ARTICLE_SYSTEM_CUSTOM + " " + rule : ARTICLE_SYSTEM_DEFAULT;
  return [
    { role: "system", content: system },
    { role: "user", content: subtitleUserPrompt(subtitle) },
  ];
}

export function build5W1HMessages(chapter: string, fullText: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: W1H_SYSTEM },
    { role: "user", content: w1hUserPrompt(chapter, fullText) },
  ];
}
