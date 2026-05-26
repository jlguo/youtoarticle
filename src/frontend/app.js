/**
 * Frontend application — SSE client, Markdown renderer, UI state management.
 *
 * Architecture:
 *   - Validates YouTube URL on input (youtube.com/watch?v= or youtu.be/)
 *   - POSTs to /api/generate, reads SSE stream via ReadableStream reader
 *   - Incrementally parses markdown (lines) as they arrive
 *   - Injects [5W1H] buttons next to ## chapter headings
 *   - Fetches 5W1H summaries from /api/5w1h without re-transmitting article text
 *   - Collapsible summary boxes with smooth CSS transitions
 */

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
let currentChapterDiv = null;
let fullTextBuffer = '';
let renderedLength = 0;
let abortController = null;

/**
 * Map of chapter title -> { button, box, body }
 * Stores DOM references for 5W1H button and summary box of each chapter.
 * @type {Map<string, { button: HTMLButtonElement, box: HTMLDivElement, body: HTMLDivElement }>}
 */
const chapterSummaryMap = new Map();

// =============================================================================
// YouTube URL Validation
// =============================================================================
const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+(&\S*)?$/,
  /^https?:\/\/youtu\.be\/[\w-]+(\?\S*)?$/,
];

/**
 * Check if a URL matches a known YouTube link format.
 * @param {string} url
 * @returns {boolean}
 */
function isValidYoutubeUrl(url) {
  return YOUTUBE_PATTERNS.some((p) => p.test(url.trim()));
}

/**
 * Validate the current URL input and show/hide inline error.
 * @returns {boolean} true if valid
 */
function validateUrl() {
  const url = youtubeUrlInput.value.trim();
  if (!url) {
    urlErrorEl.textContent = '';
    return true; // empty is allowed until submission
  }
  if (!isValidYoutubeUrl(url)) {
    urlErrorEl.textContent = '请输入有效的 YouTube 链接（youtube.com/watch?v= 或 youtu.be/）';
    return false;
  }
  urlErrorEl.textContent = '';
  return true;
}

// =============================================================================
// SSE Client
// =============================================================================

/**
 * Start article generation — POST to /api/generate and stream results.
 * @param {string} youtubeUrl
 * @param {string} [rule]
 */
async function startGeneration(youtubeUrl, rule) {
  // Reset state
  abortController = new AbortController();
  isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.textContent = '生成中...';
  loadingEl.style.display = 'flex';
  errorEl.style.display = 'none';
  resultArea.innerHTML = '';
  // Add blinking cursor
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  cursor.id = 'stream-cursor';
  resultArea.appendChild(cursor);
  fullTextBuffer = '';
  renderedLength = 0;
  currentChapterDiv = null;
  sessionId = null;
  chapterSummaryMap.clear();

  try {
    const provider = document.getElementById('ai-provider')?.value || 'gemini';
    const response = await fetch(`/api/generate?provider=${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeUrl, rule: rule || undefined }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      let errMsg = `请求失败（HTTP ${response.status}）`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch {
        // Use default error message
      }
      throw new Error(errMsg);
    }

    // Extract session ID from response headers
    sessionId = response.headers.get('X-Session-Id');

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });

      // Split on SSE message boundaries (\n\n)
      const messages = sseBuffer.split('\n\n');
      // Keep the last (potentially incomplete) part in the buffer
      sseBuffer = messages.pop() || '';

      for (const msg of messages) {
        if (!msg.startsWith('data: ')) continue;

        const payload = msg.slice(6);

        if (payload === '[DONE]') {
          flushPartialLine();
          continue;
        }

        if (payload.startsWith('ERROR: ')) {
          throw new Error(payload.slice(7));
        }

        // Empty payload = line break marker (server can't send raw \n in SSE)
        // Append \n to trigger the line-based incremental parser
        appendTextContent(payload === '' ? '\n' : payload);
      }
    }

    // Flush any remaining content after stream ends
    flushPartialLine();
  } catch (err) {
    // Don't show error for user-aborted requests
    if (err.name === 'AbortError') return;
    showError(err.message || '生成文章时发生错误，请稍后重试');
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtn.textContent = '开始生成';
    loadingEl.style.display = 'none';
    abortController = null;
    // Remove blinking cursor
    const cursor = document.getElementById('stream-cursor');
    if (cursor) cursor.remove();
  }
}

// =============================================================================
// Incremental Markdown Parser
// =============================================================================

/**
 * Append new text content and process any complete lines.
 * @param {string} text
 */
function appendTextContent(text) {
  fullTextBuffer += text;

  const unprocessed = fullTextBuffer.slice(renderedLength);
  if (!unprocessed) return;

  // Find the last complete line (must end with \n)
  const lastNewlineIdx = unprocessed.lastIndexOf('\n');
  if (lastNewlineIdx === -1) return; // no complete line yet

  const completeLines = unprocessed.slice(0, lastNewlineIdx).split('\n');

  for (const line of completeLines) {
    renderLine(line);
  }

  renderedLength += lastNewlineIdx + 1; // +1 for the \n we consumed
}

/**
 * Flush any remaining (partial) text in the buffer.
 * Called when the stream ends.
 */
function flushPartialLine() {
  const remaining = fullTextBuffer.slice(renderedLength);
  if (remaining && remaining.trim()) {
    renderLine(remaining);
  }
  renderedLength = fullTextBuffer.length;
}

/**
 * Render a single complete line as the appropriate DOM element.
 * @param {string} line
 */
function renderLine(line) {
  if (line.startsWith('# ') && !line.startsWith('## ')) {
    // level-1 heading → article title
    renderH1(line.slice(2));
  } else if (line.startsWith('## ')) {
    // level-2 heading → chapter heading + 5W1H button
    const chapterTitle = line.slice(3).trim();
    if (chapterTitle) {
      renderChapter(chapterTitle);
    }
  } else if (line.trim() === '') {
    // Skip blank lines
  } else {
    // Regular paragraph text
    renderParagraph(line);
  }
}

/**
 * Render the article title as an h1.
 * @param {string} title
 */
function renderH1(title) {
  const h1 = document.createElement('h1');
  h1.className = 'article-title animate-in';
  h1.textContent = title;
  const cursor = document.getElementById('stream-cursor');
  resultArea.insertBefore(h1, cursor);
}

/**
 * Render a chapter: heading with [5W1H] button + hidden summary box.
 * @param {string} title — the chapter title (without ## prefix, trimmed)
 */
function renderChapter(title) {
  // Create chapter block
  const chapterDiv = document.createElement('div');
  chapterDiv.className = 'chapter-block animate-in';

  // Header row: h2 + 5W1H button
  const headerDiv = document.createElement('div');
  headerDiv.className = 'chapter-header';

  const h2 = document.createElement('h2');
  h2.textContent = title;

  const btn = document.createElement('button');
  btn.className = 'btn-5w1h';
  btn.textContent = '5W1H';
  btn.dataset.chapter = title;

  headerDiv.appendChild(h2);
  headerDiv.appendChild(btn);
  chapterDiv.appendChild(headerDiv);

  // Summary box (collapsed by default)
  const summaryBox = document.createElement('div');
  summaryBox.className = 'summary-box';
  summaryBox.dataset.chapter = title;

  // Summary header (always visible, clickable)
  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'summary-header';
  summaryHeader.textContent = '5W1H 摘要';

  // Summary body (expandable content)
  const summaryBody = document.createElement('div');
  summaryBody.className = 'summary-body';

  summaryBox.appendChild(summaryHeader);
  summaryBox.appendChild(summaryBody);
  chapterDiv.appendChild(summaryBox);

  const cursor = document.getElementById('stream-cursor');
  resultArea.insertBefore(chapterDiv, cursor);

  // Track current chapter for subsequent paragraph insertion
  currentChapterDiv = chapterDiv;

  // Store DOM references for 5W1H handling
  chapterSummaryMap.set(title, {
    button: btn,
    box: summaryBox,
    body: summaryBody,
  });

  // Wire up 5W1H button click
  btn.addEventListener('click', () => handle5W1HClick(title));

  // Wire up summary header click for collapse/expand
  summaryHeader.addEventListener('click', () => toggleSummaryBox(title));
}

/**
 * Render a paragraph of text inside the current chapter or directly in the result area.
 * @param {string} text
 */
function renderParagraph(text) {
  const p = document.createElement('p');
  p.className = 'animate-in';
  p.textContent = text;

  if (currentChapterDiv) {
    const summaryBox = currentChapterDiv.querySelector('.summary-box');
    if (summaryBox) {
      currentChapterDiv.insertBefore(p, summaryBox);
    } else {
      currentChapterDiv.appendChild(p);
    }
  } else {
    const cursor = document.getElementById('stream-cursor');
    resultArea.insertBefore(p, cursor);
  }
}

// =============================================================================
// 5W1H Handler
// =============================================================================

/**
 * Handle click on a [5W1H] button — fetch summary and display.
 * @param {string} chapterTitle — normalized chapter title
 */
async function handle5W1HClick(chapterTitle) {
  const entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;

  const { button, box, body } = entry;

  // If already populated, just toggle expand/collapse
  if (body.children.length > 0) {
    box.classList.toggle('open');
    return;
  }

  // Loading state on button
  button.disabled = true;
  button.textContent = '加载中...';

  try {
    if (!sessionId) {
      throw new Error('会话 ID 丢失，请重新生成文章');
    }

    const provider = document.getElementById('ai-provider')?.value || 'gemini';
    const response = await fetch(`/api/5w1h?provider=${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chapter: chapterTitle }),
    });

    if (!response.ok) {
      let errMsg = `请求失败（HTTP ${response.status}）`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch {
        // Use default message
      }
      throw new Error(errMsg);
    }

    /** @type {{ who: string, what: string, when: string, where: string, why: string, how: string }} */
    const data = await response.json();

    // Populate summary body with structured items
    const labels = {
      who: 'Who（人物）',
      what: 'What（事件）',
      when: 'When（时间）',
      where: 'Where（地点）',
      why: 'Why（原因）',
      how: 'How（方式）',
    };

    for (const key of /** @type {const} */ (['who', 'what', 'when', 'where', 'why', 'how'])) {
      if (data[key]) {
        const item = document.createElement('div');
        item.className = 'summary-item';
        item.innerHTML = `<strong>${labels[key]}：</strong>${escapeHtml(data[key])}`;
        body.appendChild(item);
      }
    }

    // Open the summary box
    box.classList.add('open');
  } catch (err) {
    // Show error inside the summary body
    body.innerHTML = `<div class="summary-item">加载失败：${escapeHtml(err.message)}</div>`;
    box.classList.add('open');
  } finally {
    button.disabled = false;
    button.textContent = '5W1H';
  }
}

/**
 * Toggle a summary box between collapsed and expanded.
 * @param {string} chapterTitle
 */
function toggleSummaryBox(chapterTitle) {
  const entry = chapterSummaryMap.get(chapterTitle);
  if (!entry) return;
  // Only toggle if the box has been populated
  if (entry.body.children.length > 0) {
    entry.box.classList.toggle('open');
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Display an error message in the error area.
 * @param {string} message
 */
function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

// =============================================================================
// Event Listeners
// =============================================================================

// Real-time URL validation
youtubeUrlInput.addEventListener('input', validateUrl);
youtubeUrlInput.addEventListener('blur', validateUrl);

// Generate button click
generateBtn.addEventListener('click', () => {
  if (isGenerating) return;

  const url = youtubeUrlInput.value.trim();
  if (!url) {
    urlErrorEl.textContent = '请输入 YouTube 链接';
    return;
  }

  if (!validateUrl()) return;

  const rule = customRulesInput.value.trim();
  startGeneration(url, rule);
});

// Allow Enter key in the URL field to trigger generation
youtubeUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    generateBtn.click();
  }
});
