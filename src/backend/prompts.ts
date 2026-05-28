// Prompt templates for article generation and 5W1H analysis.
// Shared strings avoid duplication between Gemini (single-string) and
// DeepSeek (messages array) formats.

const ARTICLE_SYSTEM_DEFAULT =
  "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文访谈文章。\n\n" +
  "格式要求：\n" +
  "1. 主标题：参考「对话[嘉宾名]：[核心主题]」的形式拟定，贴合采访核心话题。\n" +
  "2. 整体结构：\n" +
  "   - 开头用主标题引出全文，无需额外引言。\n" +
  "   - 主体按「【小标题 + 问答】」的形式呈现，小标题概括该话题的核心方向。\n" +
  "   - 每个话题下，先写提问者的问题，再写嘉宾的回答。必须从字幕原文中识别提问者和嘉宾的真实姓名，使用「姓名: 内容」格式标注；如确实无法从原文确定姓名，可使用「提问者」「嘉宾」作为替代。\n" +
  "3. 分点格式：当嘉宾在对话中明确使用了分点列举（如「第一…第二…」「一是…二是…」「首先…其次…最后…」「first…second…」「one…two…」或数字序号等表述）时，必须在文章中按分点呈现，格式与嘉宾原话保持一致。\n" +
  "4. 语言与内容：\n" +
  "   - 完整保留采访原文的核心观点和细节，不添加、不编造任何额外信息，不做主观解读。\n" +
  "   - 语言保持专业、克制风格，还原嘉宾的表达逻辑，不口语化、不冗余。\n" +
  "5. 排版规范：\n" +
  "   - 主标题单独一行（# 一级标题），板块小标题使用 ## 二级标题，与正文空一行分隔。\n" +
  "   - 提问和回答分段呈现，对话标识格式一致，避免大段文字堆砌。\n\n" +
  "统一要求：\n" +
  "- 使用标准 Markdown 格式（# 一级标题、## 二级标题）\n" +
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

// ── Shared prompt logic (not model-specific) ──

function buildArticleSystemPrompt(rule?: string): string {
  if (rule?.trim()) {
    return ARTICLE_SYSTEM_CUSTOM + "\n" + rule;
  }
  return ARTICLE_SYSTEM_DEFAULT;
}

// ── Gemini format (single string) ──

export function buildArticlePrompt(subtitle: string, rule?: string): string {
  return buildArticleSystemPrompt(rule) + "\n\n" + subtitleUserPrompt(subtitle);
}

export function build5W1HPrompt(chapter: string, fullText: string): string {
  return W1H_SYSTEM + "\n\n" + w1hUserPrompt(chapter, fullText);
}

// ── DeepSeek format (messages array) ──

export function buildArticleMessages(subtitle: string, rule?: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: buildArticleSystemPrompt(rule) },
    { role: "user", content: subtitleUserPrompt(subtitle) },
  ];
}

export function build5W1HMessages(chapter: string, fullText: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: W1H_SYSTEM },
    { role: "user", content: w1hUserPrompt(chapter, fullText) },
  ];
}
