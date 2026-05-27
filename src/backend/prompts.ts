export function buildArticleMessages(subtitle: string, rule?: string): Array<{ role: string; content: string }> {
  let systemPrompt: string;
  if (rule && rule.trim()) {
    systemPrompt = "你是一位专业的内容编辑。请基于 YouTube 视频字幕，按照用户要求生成一篇中文文章。\n\n格式要求（严格遵守）：\n1. 使用标准 Markdown 格式输出，每个标题前后必须有换行符\n2. 一级标题（# 标题）为文章主标题，后面紧跟空行再开始正文\n3. 二级标题（## 标题）为各章节标题，每个二级标题前要有空行，标题后换行再接正文\n4. 段落之间用空行分隔\n内容要求：\n5. 章节之间逻辑清晰，内容连贯\n6. 严格遵循以下用户要求：" + rule;
  } else {
    systemPrompt = "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文文章。\n\n处理规则：\n\n1. 如果能识别出字幕中的不同说话人：\n   - 使用 ## 话题概括 作为章节标题\n   - 内容以对话形式编排，格式为「说话人：发言内容」\n   - 每次说话人切换时另起一段，保留问答节奏\n\n2. 如果不能区分说话人：\n   - 按主题分段，使用 ## 主题概括 作为章节标题\n   - 用自己的话精炼总结该主题的核心内容\n\n统一要求：\n- # 一级标题为文章主标题\n- 使用标准 Markdown 格式\n- 如果不是中文，先翻译为中文再输出";
  }
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: "字幕内容：\n" + subtitle },
  ];
}

export function buildArticlePrompt(subtitle: string, rule?: string): string {
  if (rule && rule.trim()) {
    return "你是一位专业的内容编辑。请基于 YouTube 视频字幕，按照用户要求生成一篇中文文章。\n\n格式要求（严格遵守）：\n1. 使用标准 Markdown 格式输出，每个标题前后必须有换行符\n2. 一级标题（# 标题）为文章主标题，后面紧跟空行再开始正文\n3. 二级标题（## 标题）为各章节标题，每个二级标题前要有空行，标题后换行再接正文\n4. 段落之间用空行分隔\n\n内容要求：\n5. 章节之间逻辑清晰，内容连贯\n6. 严格遵循以下用户要求：" + rule + "\n\n字幕内容：\n" + subtitle;
  } else {
    return "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文文章。\n\n处理规则：\n\n1. 如果能识别出字幕中的不同说话人：\n   - 使用 ## 话题概括 作为章节标题\n   - 内容以对话形式编排，格式为「说话人：发言内容」\n   - 每次说话人切换时另起一段，保留问答节奏\n\n2. 如果不能区分说话人：\n   - 按主题分段，使用 ## 主题概括 作为章节标题\n   - 用自己的话精炼总结该主题的核心内容\n\n统一要求：\n- # 一级标题为文章主标题\n- 使用标准 Markdown 格式\n- 如果不是中文，先翻译为中文再输出\n\n字幕内容：\n" + subtitle;
  }
}

export function build5W1HMessages(chapter: string, fullText: string): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content: "你是一位专业的文章分析助手。请基于整篇文章的完整上下文，提取 5W1H 结构化总结。返回严格的 JSON 格式，不要包含 markdown 代码块或其他内容：\n{\n  \"who\": \"涉及的人物或角色\",\n  \"what\": \"该章节讨论的核心事件或主题\",\n  \"when\": \"时间背景或时间跨度\",\n  \"where\": \"地点或场景环境\",\n  \"why\": \"原因、动机或背景分析\",\n  \"how\": \"实现方式、方法或过程\"\n}",
    },
    {
      role: "user",
      content: "完整文章内容：\n" + fullText + "\n\n请输出「" + chapter + "」章节的 5W1H 分析：",
    },
  ];
}

export function build5W1HPrompt(chapter: string, fullText: string): string {
  return "你是一位专业的文章分析助手。请基于整篇文章的完整上下文，提取 5W1H 结构化总结。返回严格的 JSON 格式，不要包含 markdown 代码块或其他内容：\n{\n  \"who\": \"涉及的人物或角色\",\n  \"what\": \"该章节讨论的核心事件或主题\",\n  \"when\": \"时间背景或时间跨度\",\n  \"where\": \"地点或场景环境\",\n  \"why\": \"原因、动机或背景分析\",\n  \"how\": \"实现方式、方法或过程\"\n}\n\n完整文章内容：\n" + fullText + "\n\n请输出「" + chapter + "」章节的 5W1H 分析：";
}
