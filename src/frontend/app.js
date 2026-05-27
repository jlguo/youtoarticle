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

function unescapeJsonString(str) {
  return str.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

async function streamArticle(youtubeUrl, rule, provider, signal) {
  var response = await fetch("/api/generate?provider=" + provider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl: youtubeUrl, rule: rule || undefined }),
    signal: signal,
  });

  if (!response.ok) {
    var errMsg = "请求失败 (HTTP " + response.status + ")";
    try { var ed = await response.json(); if (ed.error) errMsg = ed.error; } catch (_) {}
    throw new Error(errMsg);
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
      if (jsonStr === "[DONE]") return;

      var match = jsonStr.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match) {
        var content = unescapeJsonString(match[1]);
        if (content) feedContent(content);
        continue;
      }

      var matches = jsonStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
      if (matches) {
        for (var i = 0; i < matches.length; i++) {
          var tm = matches[i].match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (tm && tm[1]) {
            var content = unescapeJsonString(tm[1]);
            if (content) feedContent(content);
          }
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
  var res = await fetch("/api/5w1h?provider=" + provider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapter: chapterTitle, fullText: fullArticleText }),
  });

  if (!res.ok) {
    var em = "请求失败 (HTTP " + res.status + ")";
    try { var ed = await res.json(); if (ed.error) em = ed.error; } catch (_) {}
    throw new Error(em);
  }

  var data = await res.json();

  // DeepSeek format: { choices: [{ message: { content: "..." } }] }
  var rawContent = data?.choices?.[0]?.message?.content || "";
  if (rawContent) {
    rawContent = rawContent.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, "").trim();
    return JSON.parse(rawContent);
  }

  // Gemini format: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  var raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (raw) {
    raw = raw.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, "").trim();
    return JSON.parse(raw);
  }

  // Fallback: if the response IS already the 5W1H object
  if (data.who || data.what) return data;

  throw new Error("无法解析 5W1H 响应");
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
// Generation — Worker Passthrough
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
    var provider = document.getElementById("ai-provider")?.value || "deepseek";
    await streamArticle(youtubeUrl, rule, provider, abortController.signal);
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
