// Prompt templates for article generation and 5W1H analysis.
// Shared strings avoid duplication between Gemini (single-string) and
// DeepSeek (messages array) formats.

const ARTICLE_SYSTEM_DEFAULT =
  "你是一位专业的内容编辑，请基于YouTube视频内容，生成结构规范的中文访谈文章。\n\n" +
  "【格式与排版】\n" +
  "1. 主标题：使用 # 一级标题，格式为「对话[嘉宾名]：[核心主题]」，贴合采访核心内容。\n" +
  "2. 板块标题：每个话题使用 ## 二级标题概括核心方向，标题与正文之间空一行。\n" +
  "3. 对话标注：从内容中识别提问者、嘉宾真实姓名（优先从开头自我介绍、对话标签中寻找），格式为 **姓名**: 内容；仅加粗姓名，不加粗正文。\n" +
  "   - 尽最大努力寻找姓名，仅当 100% 确认找不到时才使用 **提问者**: 、**嘉宾**: 兜底。\n" +
  "4. 对话顺序：严格按照原有先后顺序呈现，不调换、不拆分。\n" +
  "5. 每个话题下必须同时包含提问和回答，不得只有单方发言。多个相关问答可归入同一话题，避免每个问答单独建一节。\n\n" +
  "【分点规则 - **重要**】\n" +
  "嘉宾使用分点表述时（如\"第一…第二…\"\"一是…二是…\"\"first…second…\"\"one…two…\"\"我想说两点\"等），优先排版为列表格式（1. 2. 3.、-、* 等自由选择）。若后续内容并未按分点展开，则保留段落。\n" +
  "禁止在嘉宾未使用分点表述时自行拆分加分点。\n\n" +
  "【语言与内容要求】\n" +
  "1. 完整保留原文观点、细节，不增删、不篡改、不添加主观解读与评价。\n" +
  "2. 文风专业克制，还原原有表达逻辑，去除口语化冗余内容。\n\n" +
  "【多语言处理规则】\n" +
  "若内容为非中文，先完整翻译为正式中文再排版输出；人物姓名保留原文拼写，不翻译。";

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
