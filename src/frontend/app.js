import { marked } from "marked";

// =============================================================================
// DOM References
// =============================================================================
const youtubeUrlInput = document.getElementById('youtube-url');
const customRulesInput = document.getElementById('custom-rules');
const generateBtn = document.getElementById('generate-btn');
const resultArea = document.getElementById('result');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const urlErrorEl = document.getElementById('url-error');

// =============================================================================
// API Keys — TODO: replace with your own keys
// =============================================================================
var DEEPSEEK_API_KEY = "sk-66b19541c7aa4ef29dbb6fa117b8fc2d";
var GEMINI_API_KEY = "AIzaSyAAGhNi4xkRvHmJNklir4pM9Vcm-7HzR6Q";

// =============================================================================
// AI Provider Config
// =============================================================================
var DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions";
var DEEPSEEK_MODEL = "deepseek-v4-flash";
var GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:streamGenerateContent";
var GEMINI_NONSTREAM_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";
var GEMINI_MODEL = "gemini-2.5-flash";

// =============================================================================
// State
// =============================================================================
let sessionId = null;
let isGenerating = false;
var renderScheduled = false;
var rafId = 0;
let abortController = null;

/**
 * Map of chapter title -> { button, box, body }
 * @type {Map<string, { button: HTMLButtonElement, box: HTMLDivElement, body: HTMLDivElement }>}
 */
const chapterSummaryMap = new Map();

var fullArticleText = "";  // accumulated for 5W1H generation

// =============================================================================
// Prompt Building Functions
// =============================================================================

function buildArticleMessages(subtitle, rule) {
  var systemPrompt;
  if (rule && rule.trim()) {
    systemPrompt = "你是一位专业的内容编辑。请基于 YouTube 视频字幕，按照用户要求生成一篇中文文章。\n\n格式要求（严格遵守）：\n1. 使用标准 Markdown 格式输出，每个标题前后必须有换行符\n2. 一级标题（# 标题）为文章主标题，后面紧跟空行再开始正文\n3. 二级标题（## 标题）为各章节标题，每个二级标题前要有空行，标题后换行再接正文\n4. 段落之间用空行分隔\n内容要求：\n5. 章节之间逻辑清晰，内容连贯\n6. 严格遵循以下用户要求：" + rule;
  } else {
    systemPrompt = "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文文章。\n\n处理规则：\n\n1. 如果能识别出字幕中的不同说话人：\n   - 使用 ## 话题概括 作为章节标题\n   - 内容以对话形式编排，格式为「说话人：发言内容」\n   - 每次说话人切换时另起一段，保留问答节奏\n\n2. 如果不能区分说话人：\n   - 按主题分段，使用 ## 主题概括 作为章节标题\n   - 用自己的话精炼总结该主题的核心内容\n\n统一要求：\n- # 一级标题为文章主标题\n- 使用标准 Markdown 格式\n- 如果不是中文，先翻译为中文再输出";
  }
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: "字幕内容：\n" + subtitle }
  ];
}

function feedContent(text) {
  fullArticleText += text;
  if (!renderScheduled) {
    renderScheduled = true;
    rafId = requestAnimationFrame(function () {
      resultArea.innerHTML = marked.parse(fullArticleText) + '<span id="stream-cursor" class="cursor-blink"></span>';
      renderScheduled = false;
      rafId = 0;
    });
  }
}

function buildArticlePrompt(subtitle, rule) {
  if (rule && rule.trim()) {
    return "你是一位专业的内容编辑。请基于 YouTube 视频字幕，按照用户要求生成一篇中文文章。\n\n格式要求（严格遵守）：\n1. 使用标准 Markdown 格式输出，每个标题前后必须有换行符\n2. 一级标题（# 标题）为文章主标题，后面紧跟空行再开始正文\n3. 二级标题（## 标题）为各章节标题，每个二级标题前要有空行，标题后换行再接正文\n4. 段落之间用空行分隔\n\n内容要求：\n5. 章节之间逻辑清晰，内容连贯\n6. 严格遵循以下用户要求：" + rule + "\n\n字幕内容：\n" + subtitle;
  } else {
    return "你是一位专业的内容编辑。请基于 YouTube 视频字幕生成一篇结构清晰的中文文章。\n\n处理规则：\n\n1. 如果能识别出字幕中的不同说话人：\n   - 使用 ## 话题概括 作为章节标题\n   - 内容以对话形式编排，格式为「说话人：发言内容」\n   - 每次说话人切换时另起一段，保留问答节奏\n\n2. 如果不能区分说话人：\n   - 按主题分段，使用 ## 主题概括 作为章节标题\n   - 用自己的话精炼总结该主题的核心内容\n\n统一要求：\n- # 一级标题为文章主标题\n- 使用标准 Markdown 格式\n- 如果不是中文，先翻译为中文再输出\n\n字幕内容：\n" + subtitle;
  }
}

function build5W1HMessages(chapter, fullText) {
  return [
    {
      role: "system",
      content: "你是一位专业的文章分析助手。请基于整篇文章的完整上下文，提取 5W1H 结构化总结。返回严格的 JSON 格式，不要包含 markdown 代码块或其他内容：\n{\n  \"who\": \"涉及的人物或角色\",\n  \"what\": \"该章节讨论的核心事件或主题\",\n  \"when\": \"时间背景或时间跨度\",\n  \"where\": \"地点或场景环境\",\n  \"why\": \"原因、动机或背景分析\",\n  \"how\": \"实现方式、方法或过程\"\n}"
    },
    {
      role: "user",
      content: "完整文章内容：\n" + fullText + "\n\n请输出「" + chapter + "」章节的 5W1H 分析："
    }
  ];
}

function build5W1HPrompt(chapter, fullText) {
  return "你是一位专业的文章分析助手。请基于整篇文章的完整上下文，提取 5W1H 结构化总结。返回严格的 JSON 格式，不要包含 markdown 代码块或其他内容：\n{\n  \"who\": \"涉及的人物或角色\",\n  \"what\": \"该章节讨论的核心事件或主题\",\n  \"when\": \"时间背景或时间跨度\",\n  \"where\": \"地点或场景环境\",\n  \"why\": \"原因、动机或背景分析\",\n  \"how\": \"实现方式、方法或过程\"\n}\n\n完整文章内容：\n" + fullText + "\n\n请输出「" + chapter + "」章节的 5W1H 分析：";
}

function unescapeJsonString(str) {
  return str.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

// =============================================================================
// DeepSeek SSE Streaming
// =============================================================================

async function streamDeepSeekArticle(subtitle, rule, signal) {
  var messages = buildArticleMessages(subtitle, rule);
  var response = await fetch(DEEPSEEK_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + DEEPSEEK_API_KEY,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: messages,
      stream: true,
      temperature: 0.7,
    }),
    signal: signal,
  });

  if (!response.ok) {
    var errText = "";
    try { errText = await response.text(); } catch (_) {}
    throw new Error("DeepSeek API error (HTTP " + response.status + "): " + errText.slice(0, 300));
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = "";
  var lineStart = 0;

  while (true) {
    var rr = await reader.read();
    if (rr.done) break;
    buffer += decoder.decode(rr.value, { stream: true });

    var newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
      var line = buffer.slice(lineStart, newlineIdx).trim();
      lineStart = newlineIdx + 1;

      if (line.slice(0, 6) !== "data: ") continue;
      var jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      if (jsonStr === "[DONE]") return; // streaming complete

      // Regex extract delta.content
      var match = jsonStr.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (!match) continue;
      var content = unescapeJsonString(match[1]);
      if (!content) continue;

      feedContent(content);
    }
  }
}

// =============================================================================
// Gemini SSE Streaming
// =============================================================================

async function streamGeminiArticle(subtitle, rule, signal) {
  var prompt = buildArticlePrompt(subtitle, rule);
  var response = await fetch(GEMINI_BASE_URL + "?alt=sse&key=" + GEMINI_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
    signal: signal,
  });

  if (!response.ok) {
    var errText = "";
    try { errText = await response.text(); } catch (_) {}
    throw new Error("Gemini API error (HTTP " + response.status + "): " + errText.slice(0, 300));
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = "";
  var lineStart = 0;

  while (true) {
    var rr = await reader.read();
    if (rr.done) break;
    buffer += decoder.decode(rr.value, { stream: true });

    var newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
      var line = buffer.slice(lineStart, newlineIdx).trim();
      lineStart = newlineIdx + 1;

      if (line.slice(0, 6) !== "data: ") continue;
      var jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      var match = jsonStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
      if (!match) continue;

      for (var i = 0; i < match.length; i++) {
        var tm = match[i].match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (tm && tm[1]) {
          var content = unescapeJsonString(tm[1]);
          feedContent(content);
        }
      }
    }
  }
}

// =============================================================================
// 5W1H Generation (non-streaming)
// =============================================================================

async function generate5W1H(chapterTitle) {
  var provider = document.getElementById("ai-provider")?.value || "deepseek";

  if (provider === "deepseek") {
    var messages = build5W1HMessages(chapterTitle, fullArticleText);
    var res = await fetch(DEEPSEEK_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: messages,
        temperature: 0.3,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!res.ok) throw new Error("DeepSeek 5W1H error: HTTP " + res.status);
    var data = await res.json();
    var rawContent = data?.choices?.[0]?.message?.content || "";
    // Strip markdown code fences if present
    rawContent = rawContent.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, "").trim();
    return JSON.parse(rawContent);
  } else {
    // Gemini
    var prompt = build5W1HPrompt(chapterTitle, fullArticleText);
    var res = await fetch(GEMINI_NONSTREAM_URL + "?key=" + GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) throw new Error("Gemini 5W1H error: HTTP " + res.status);
    var data = await res.json();
    var raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    raw = raw.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, "").trim();
    return JSON.parse(raw);
  }
}

// =============================================================================
// YouTube URL Validation
// =============================================================================
const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+(&\S*)?$/,
  /^https?:\/\/youtu\.be\/[\w-]+(\?\S*)?$/,
];

function isValidYoutubeUrl(url) {
  return YOUTUBE_PATTERNS.some(function (p) { return p.test(url.trim()); });
}

function validateUrl() {
  var url = youtubeUrlInput.value.trim();
  if (!url) { urlErrorEl.textContent = ''; return true; }
  if (!isValidYoutubeUrl(url)) {
    urlErrorEl.textContent = '请输入有效的 YouTube 链接（youtube.com/watch?v= 或 youtu.be/）';
    return false;
  }
  urlErrorEl.textContent = '';
  return true;
}

// =============================================================================
// Generation — Browser AI API Calls
// =============================================================================

async function startGeneration(youtubeUrl, rule) {
  abortController = new AbortController();
  isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.textContent = "生成中...";
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  resultArea.innerHTML = "";
  chapterSummaryMap.clear();
  fullArticleText = "";
  renderScheduled = false;
  rafId = 0;

  sessionId = null;

  try {
    // Step 1: Fetch subtitle from Worker
    var subResponse = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeUrl: youtubeUrl }),
      signal: abortController.signal,
    });

    if (!subResponse.ok) {
      var em = "Subtitle fetch failed (HTTP " + subResponse.status + ")";
      try { var ed = await subResponse.json(); if (ed.error) em = ed.error; } catch (_) {}
      throw new Error(em);
    }

    var subData = await subResponse.json();
    if (!subData.subtitle) throw new Error("No subtitle text returned");

    // Step 2: Stream AI article
    var provider = document.getElementById("ai-provider")?.value || "deepseek";

    if (provider === "deepseek") {
      await streamDeepSeekArticle(subData.subtitle, rule, abortController.signal);
    } else {
      await streamGeminiArticle(subData.subtitle, rule, abortController.signal);
    }

    // Step 3: Complete
    onStreamComplete();

  } catch (err) {
    if (err.name === "AbortError") return;
    showError(err.message || "生成文章时发生错误，请稍后重试");
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtn.textContent = "开始生成";
    loadingEl.style.display = "none";
    abortController = null;
  }
}

// =============================================================================
// Post-completion: inject 5W1H next to each chapter heading
// =============================================================================

function onStreamComplete() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; renderScheduled = false; }
  resultArea.innerHTML = marked.parse(fullArticleText);
  var h2s = resultArea.querySelectorAll("h2");
  for (var i = 0; i < h2s.length; i++) {
    inject5W1HButton(h2s[i]);
  }
}

function inject5W1HButton(h2) {
  if (h2.parentElement && h2.parentElement.classList.contains("chapter-heading-row")) return;

  var title = h2.textContent || "";

  var row = document.createElement("span");
  row.className = "chapter-heading-row";
  h2.parentNode.insertBefore(row, h2);
  row.appendChild(h2);

  var btn = document.createElement("button");
  btn.className = "btn-5w1h";
  btn.textContent = "5W1H";
  btn.dataset.chapter = title;
  row.appendChild(btn);

  var summaryBox = document.createElement("div");
  summaryBox.className = "summary-box";
  var summaryHeader = document.createElement("div");
  summaryHeader.className = "summary-header";
  summaryHeader.textContent = "5W1H 摘要";
  var summaryBody = document.createElement("div");
  summaryBody.className = "summary-body";
  summaryBox.appendChild(summaryHeader);
  summaryBox.appendChild(summaryBody);

  row.parentNode.insertBefore(summaryBox, row.nextSibling);

  chapterSummaryMap.set(title, { button: btn, box: summaryBox, body: summaryBody });

  btn.addEventListener("click", function () { handle5W1HClick(title); });
  summaryHeader.addEventListener("click", function () { toggleSummaryBox(title); });
}

// =============================================================================
// 5W1H Handler — Browser AI API Call
// =============================================================================

async function handle5W1HClick(chapterTitle) {
  var entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;

  if (entry.body.children.length > 0) {
    entry.box.classList.toggle("open");
    return;
  }

  entry.button.disabled = true;
  entry.button.textContent = "加载中...";

  try {
    var data = await generate5W1H(chapterTitle);

    var labels = {
      who: "Who（人物）", what: "What（事件）", when: "When（时间）",
      where: "Where（地点）", why: "Why（原因）", how: "How（方式）"
    };
    var keys = ["who", "what", "when", "where", "why", "how"];

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (data[key]) {
        var item = document.createElement("div");
        item.className = "summary-item";
        item.innerHTML = "<strong>" + labels[key] + "：</strong>" + escapeHtml(data[key]);
        entry.body.appendChild(item);
      }
    }
    entry.box.classList.add("open");
  } catch (err) {
    entry.body.innerHTML = "<div class=\"summary-item\">加载失败：" + escapeHtml(err.message) + "</div>";
    entry.box.classList.add("open");
  } finally {
    entry.button.disabled = false;
    entry.button.textContent = "5W1H";
  }
}

function toggleSummaryBox(chapterTitle) {
  var entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;
  if (entry.body.children.length > 0) entry.box.classList.toggle('open');
}

// =============================================================================
// Utilities
// =============================================================================

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

// =============================================================================
// Event Listeners
// =============================================================================

youtubeUrlInput.addEventListener('input', validateUrl);
youtubeUrlInput.addEventListener('blur', validateUrl);

generateBtn.addEventListener('click', function () {
  if (isGenerating) return;
  var url = youtubeUrlInput.value.trim();
  if (!url) { urlErrorEl.textContent = '请输入 YouTube 链接'; return; }
  if (!validateUrl()) return;
  var rule = customRulesInput.value.trim();
  startGeneration(url, rule);
});

youtubeUrlInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); generateBtn.click(); }
});
