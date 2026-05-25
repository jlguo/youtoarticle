// Gemini prompt templates for article generation and 5W1H summaries

export function buildArticlePrompt(
  subtitle: string,
  rule?: string
): string {
  let prompt = `你是一位专业的内容编辑。请基于以下 YouTube 视频字幕，生成一篇结构清晰的中文文章。

要求：
1. 使用 Markdown 格式输出，一级标题（#）为文章主标题，二级标题（##）为各章节标题
2. 保持对话风格的自然叙述，同时优化阅读体验
3. 准确传达视频的核心观点和信息
4. 章节之间逻辑清晰，内容连贯`;

  if (rule) {
    prompt += `\n5. 遵循以下用户要求：${rule}`;
  }

  prompt += `\n\n---\n字幕内容：\n${subtitle}\n---\n\n请开始生成文章：`;

  return prompt;
}

export function build5W1HPrompt(
  chapter: string,
  fullText: string
): string {
  return `你是一位专业的文章分析助手。请基于以下整篇文章的完整上下文，针对章节「${chapter}」，提取 5W1H 结构化总结。

返回严格的 JSON 格式，不要包含其他内容：
{
  "who": "涉及的人物或角色",
  "what": "该章节讨论的核心事件或主题",
  "when": "时间背景或时间跨度",
  "where": "地点或场景环境",
  "why": "原因、动机或背景分析",
  "how": "实现方式、方法或过程"
}

---
完整文章内容：
${fullText}
---

请输出「${chapter}」章节的 5W1H 分析：`;
}
