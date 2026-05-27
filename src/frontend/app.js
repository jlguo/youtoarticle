import { marked } from "marked";
import { _ } from "./locale.js";

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
let renderScheduled = false;
let rafId = 0;
let abortController = null;

/** @type {Map<string, { button: HTMLButtonElement, box: HTMLDivElement, body: HTMLDivElement }>} */
const chapterSummaryMap = new Map();

let fullArticleText = "";
let renderedLen = 0;

// =============================================================================
// Streaming: SSE → DOM
// =============================================================================

function feedContent(text) {
  fullArticleText += text;
  if (!renderScheduled) {
    renderScheduled = true;
    rafId = requestAnimationFrame(() => {
      if (fullArticleText.length > renderedLen) {
        resultArea.innerHTML = marked.parse(fullArticleText)
          + '<span id="stream-cursor" class="cursor-blink"></span>';
        renderedLen = fullArticleText.length;
      }
      renderScheduled = false;
      rafId = 0;
    });
  }
}

async function streamArticle(youtubeUrl, rule, provider, signal) {
  const response = await fetch("/api/generate?provider=" + provider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl, rule: rule || undefined }),
    signal,
  });

  if (!response.ok) {
    let errMsg = _.errRequestFailed(response.status);
    try {
      const ed = await response.json();
      if (ed.error) errMsg = ed.error;
    } catch (_) { /* body not JSON */ }
    throw new Error(errMsg);
  }

  const sessionId = response.headers.get("X-Session-Id");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineStart = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
      const line = buffer.slice(lineStart, newlineIdx).trim();
      lineStart = newlineIdx + 1;

      if (line.slice(0, 6) !== "data: ") continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      if (jsonStr === "[DONE]") break;

      let parsed;
      try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

      // Gemini SSE: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
      const geminiText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (geminiText) { feedContent(geminiText); continue; }

      // DeepSeek SSE: { choices: [{ delta: { content: "..." } }] }
      const deepseekText = parsed?.choices?.[0]?.delta?.content;
      if (deepseekText) { feedContent(deepseekText); continue; }
    }
  }
  return sessionId;
}

// =============================================================================
// 5W1H Generation (non-streaming)
// =============================================================================

async function generate5W1H(sessionId, chapterTitle) {
  const provider = document.getElementById("ai-provider")?.value || "deepseek";
  const res = await fetch("/api/5w1h?provider=" + provider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, chapter: chapterTitle }),
  });

  if (!res.ok) {
    let em = _.errRequestFailed(res.status);
    try {
      const ed = await res.json();
      if (ed.error) em = ed.error;
    } catch (_) { /* body not JSON */ }
    throw new Error(em);
  }

  const data = await res.json();

  // DeepSeek format: { choices: [{ message: { content: "..." } }] }
  const rawContent = data?.choices?.[0]?.message?.content || "";
  if (rawContent) return parse5W1H(rawContent);

  // Gemini format: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (raw) return parse5W1H(raw);

  // Fallback: if the response IS already the 5W1H object
  if (data.who || data.what) return data;

  throw new Error(_.errParse5W1H);
}

function parse5W1H(raw) {
  // 1. Strip markdown code fences (multi-line aware)
  raw = raw.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();

  // 2. Try direct JSON.parse
  try { return JSON.parse(raw); } catch (_) { /* continue */ }

  // 3. Clean: remove trailing commas, try again
  const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // 4. Regex fallback — extract each field individually
  const result = {};
  const keys = ["who", "what", "when", "where", "why", "how"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const re = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const m = raw.match(re);
    if (m) {
      result[k] = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (result.who || result.what) return result;

  throw new Error(_.errParse5W1H);
}

// =============================================================================
// YouTube URL Validation
// =============================================================================
const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+(&\S*)?$/,
  /^https?:\/\/youtu\.be\/[\w-]+(\?\S*)?$/,
];

function isValidYoutubeUrl(url) {
  return YOUTUBE_PATTERNS.some(p => p.test(url.trim()));
}

function validateUrl() {
  const url = youtubeUrlInput.value.trim();
  if (!url) { urlErrorEl.textContent = ''; return true; }
  if (!isValidYoutubeUrl(url)) {
    urlErrorEl.textContent = _.errInvalidURL;
    return false;
  }
  urlErrorEl.textContent = '';
  return true;
}

// =============================================================================
// Generation Flow
// =============================================================================

async function startGeneration(youtubeUrl, rule) {
  abortController = new AbortController();
  isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.textContent = _.btnGenerating;
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  resultArea.innerHTML = "";
  chapterSummaryMap.clear();
  fullArticleText = "";
  renderedLen = 0;
  renderScheduled = false;
  rafId = 0;
  sessionId = null;

  try {
    const provider = document.getElementById("ai-provider")?.value || "deepseek";
    sessionId = await streamArticle(youtubeUrl, rule, provider, abortController.signal);
    onStreamComplete();
  } catch (err) {
    if (err.name === "AbortError") return;
    showError(err.message || _.errGenerateFailed);
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtn.textContent = _.btnGenerate;
    loadingEl.style.display = "none";
    abortController = null;
  }
}

// =============================================================================
// Post-completion: inject 5W1H buttons next to each h2
// =============================================================================

function onStreamComplete() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; renderScheduled = false; }
  resultArea.innerHTML = marked.parse(fullArticleText);
  const h2s = resultArea.querySelectorAll("h2");
  for (let i = 0; i < h2s.length; i++) {
    inject5W1HButton(h2s[i], sessionId);
  }
}

function inject5W1HButton(h2, sid) {
  if (h2.parentElement?.classList.contains("chapter-heading-row")) return;

  const title = h2.textContent || "";

  const row = document.createElement("span");
  row.className = "chapter-heading-row";
  h2.parentNode.insertBefore(row, h2);
  row.appendChild(h2);

  const btn = document.createElement("button");
  btn.className = "btn-5w1h";
  btn.textContent = _.btn5W1H;
  btn.dataset.chapter = title;
  row.appendChild(btn);

  const summaryBox = document.createElement("div");
  summaryBox.className = "summary-box";
  const summaryHeader = document.createElement("div");
  summaryHeader.className = "summary-header";
  summaryHeader.textContent = _.labelSummary;
  const summaryBody = document.createElement("div");
  summaryBody.className = "summary-body";
  summaryBox.appendChild(summaryHeader);
  summaryBox.appendChild(summaryBody);

  row.parentNode.insertBefore(summaryBox, row.nextSibling);

  chapterSummaryMap.set(title, { button: btn, box: summaryBox, body: summaryBody, sessionId: sid });

  btn.addEventListener("click", () => handle5W1HClick(title));
  summaryHeader.addEventListener("click", () => toggleSummaryBox(title));
}

// =============================================================================
// 5W1H Handler
// =============================================================================

async function handle5W1HClick(chapterTitle) {
  const entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;

  if (entry.body.children.length > 0) {
    entry.box.classList.toggle("open");
    return;
  }

  entry.button.disabled = true;
  entry.button.textContent = _.btnLoading;

  try {
    const data = await generate5W1H(entry.sessionId, chapterTitle);

    const labels = {
      who: _.labelWho, what: _.labelWhat, when: _.labelWhen,
      where: _.labelWhere, why: _.labelWhy, how: _.labelHow
    };
    const keys = ["who", "what", "when", "where", "why", "how"];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (data[key]) {
        const item = document.createElement("div");
        item.className = "summary-item";
        item.innerHTML = "<strong>" + labels[key] + "：</strong>" + escapeHtml(data[key]);
        entry.body.appendChild(item);
      }
    }
    entry.box.classList.add("open");
  } catch (err) {
    entry.body.innerHTML = '<div class="summary-item">' + _.errLoadFailed(err.message) + '</div>';
    entry.box.classList.add("open");
  } finally {
    entry.button.disabled = false;
    entry.button.textContent = "5W1H";
  }
}

function toggleSummaryBox(chapterTitle) {
  const entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;
  if (entry.body.children.length > 0) entry.box.classList.toggle('open');
}

// =============================================================================
// Utilities
// =============================================================================

function escapeHtml(str) {
  const div = document.createElement('div');
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

// Set localized text on static DOM elements
(function initLocale() {
  const loadingText = document.querySelector(".loading-text");
  if (loadingText) loadingText.textContent = _.loadingText;
  const geminiOpt = document.querySelector("#ai-provider option[value=\"gemini\"]");
  if (geminiOpt) geminiOpt.textContent = _.providerGemini;
  const dsOpt = document.querySelector("#ai-provider option[value=\"deepseek\"]");
  if (dsOpt) dsOpt.textContent = _.providerDeepseek;
})();

youtubeUrlInput.addEventListener('input', validateUrl);
youtubeUrlInput.addEventListener('blur', validateUrl);

generateBtn.addEventListener('click', () => {
  if (isGenerating) return;
  const url = youtubeUrlInput.value.trim();
  if (!url) { urlErrorEl.textContent = _.errEmptyURL; return; }
  if (!validateUrl()) return;
  const rule = customRulesInput.value.trim();
  startGeneration(url, rule);
});

youtubeUrlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); generateBtn.click(); }
});
