import { marked } from "marked";
import { _ } from "./locale.js";

marked.setOptions({ breaks: true, gfm: true });

// =============================================================================
// DOM References
// =============================================================================
const youtubeUrlInput = document.getElementById('youtube-url');
const customRulesInput = document.getElementById('custom-rules');
const generateBtn = document.getElementById('generate-btn');
const generateBtnText = document.getElementById('generate-btn-text');
const resultEl = document.getElementById('result');
const streamingEl = document.getElementById('streaming');
const streamingSubtext = document.getElementById('streaming-subtext');
const loadingSpinner = document.getElementById('loading-spinner');
const errorEl = document.getElementById('error');
const urlErrorEl = document.getElementById('url-error');
const metadataEl = document.getElementById('metadata');
const enhancementsEl = document.getElementById('enhancements');
const articleHeader = document.getElementById('article-header');
const headerTimestamp = document.getElementById('header-timestamp');
const headerChapterCount = document.getElementById('header-chapter-count');
const articleActions = document.getElementById('article-actions');
const articleFooter = document.getElementById('article-footer');
const fallbackWarning = document.getElementById('fallback-warning');
const tocEl = document.getElementById('toc');
const tocList = document.getElementById('toc-list');
const tocChapterCount = document.getElementById('toc-chapter-count');
const tocProgressBar = document.getElementById('toc-progress-bar');
const tocProgressText = document.getElementById('toc-progress-text');
const tocProgressSection = document.getElementById('toc-progress-section');
const toastContainer = document.getElementById('toast-container');
const emptyState = document.getElementById('empty-state');
const inputPanel = document.getElementById('input-panel');
const articleArea = document.getElementById('article-area');
const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
const btnExpandSidebar = document.getElementById('btn-expand-sidebar');

// #1: VideoInfoCard
const videoInfoCard = document.getElementById('video-info-card');
const videoInfoTitle = document.getElementById('video-info-title');
const videoInfoChannel = document.getElementById('video-info-channel');
const videoInfoDuration = document.getElementById('video-info-duration');

// #2: Demo link
const btnDemoLink = document.getElementById('btn-demo-link');

// #3: Advanced options
const btnAdvancedToggle = document.getElementById('btn-advanced-toggle');
const btnAdvancedBadge = document.getElementById('btn-advanced-badge');
const advancedOptions = document.getElementById('advanced-options');

// #4: Mobile TOC
const btnMobileToc = document.getElementById('btn-mobile-toc');
const tocBackdrop = document.getElementById('toc-backdrop');
const tocDrawer = document.getElementById('toc-drawer');
const btnTocClose = document.getElementById('btn-toc-close');
const tocDrawerList = document.getElementById('toc-drawer-list');
const tocDrawerProgress = document.getElementById('toc-drawer-progress');
const tocDrawerProgressText = document.getElementById('toc-drawer-progress-text');
const tocDrawerProgressBar = document.getElementById('toc-drawer-progress-bar');
const tocDrawerCount = document.getElementById('toc-drawer-count');

// #6: Copy icon toggle
const iconCopy = document.getElementById('icon-copy');
const iconCopied = document.getElementById('icon-copied');

// =============================================================================
// State
// =============================================================================
let sessionId = null;
let isGenerating = false;
let isFromFallback = false;
let renderScheduled = false;
let rafId = 0;
let abortController = null;
let fullArticleText = "";
let renderedLen = 0;
let fontSize = 100;
let hasReceivedFirstData = false;
let copyTimeout = null;
let tocScrollTracking = false;

/** @type {Map<string, { button: HTMLButtonElement, box: HTMLDivElement, body: HTMLDivElement, sessionId: string }>} */
const chapterSummaryMap = new Map();

// =============================================================================
// Toast
// =============================================================================
function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast toast-in';
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); }, 2500);
  setTimeout(() => { el.remove(); }, 3000);
}

// =============================================================================
// Streaming: SSE → DOM
// =============================================================================
function feedContent(text) {
  if (!hasReceivedFirstData) {
    hasReceivedFirstData = true;
    emptyState.style.display = 'none';
    streamingEl.classList.add('hidden');
    articleHeader.classList.remove('hidden');
    metadataEl.classList.remove('hidden');
    enhancementsEl.classList.remove('hidden');
    articleActions.classList.remove('hidden');
    if (isFromFallback) fallbackWarning.classList.remove('hidden');
    headerTimestamp.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  fullArticleText += text;
  if (!renderScheduled) {
    renderScheduled = true;
    rafId = requestAnimationFrame(() => {
      if (fullArticleText.length > renderedLen) {
        resultEl.innerHTML = marked.parse(fullArticleText);
        const cursor = document.createElement('span');
        cursor.id = 'stream-cursor';
        cursor.className = 'cursor-blink';
        const lastChild = resultEl.lastElementChild;
        if (lastChild && lastChild.textContent) {
          lastChild.appendChild(cursor);
        } else {
          resultEl.appendChild(cursor);
        }
        renderedLen = fullArticleText.length;
        classifyBlocks();
        wrapNewChapters();
        updateMetadata();
        updateTOCItems();
      }
      renderScheduled = false;
      rafId = 0;
    });
  }
}

async function streamArticle(youtubeUrl, rule, model, signal) {
  const qs = `model=${model}`;
  const response = await fetch("/api/generate?" + qs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl, rule: rule || undefined }),
    signal,
  });

  if (!response.ok) {
    let errMsg = _.errRequestFailed(response.status);
    try { const ed = await response.json(); if (ed.error) errMsg = ed.error; } catch (_) {}
    throw new Error(errMsg);
  }

  sessionId = response.headers.get("X-Session-Id");
  isFromFallback = response.headers.get("X-From-Fallback") === "true";
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
      if (jsonStr === "[DONE]") { onStreamComplete(); return; }

      let parsed;
      try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

      const geminiText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (geminiText) { feedContent(geminiText); continue; }

      const deepseekText = parsed?.choices?.[0]?.delta?.content;
      if (deepseekText) { feedContent(deepseekText); }
    }
  }

  if (isGenerating) {
    onStreamComplete();
  }
}

// =============================================================================
// Metadata
// =============================================================================
function updateMetadata() {
  const text = fullArticleText;
  const chapters = (text.match(/^## /gm) || []).length;
  const chars = text.replace(/\s/g, '').length;
  const words = Math.round(chars * 0.6);
  const readTime = Math.max(1, Math.round(words / 200));

  document.getElementById('meta-chapters').textContent = chapters;
  document.getElementById('meta-readtime').textContent = readTime + ' 分钟';
  document.getElementById('meta-words').textContent = words.toLocaleString();
  document.getElementById('meta-lang').textContent = '中文';
  document.getElementById('meta-time').textContent =
    new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  headerChapterCount.textContent = chapters + ' 章';
}

// =============================================================================
// Reading Enhancements
// =============================================================================
function applyFontSize() {
  resultEl.style.setProperty('--article-font-size', (fontSize / 100) + 'em');
  document.getElementById('fontsize-label').textContent = fontSize + '%';
}

document.getElementById('btn-font-down').addEventListener('click', () => {
  if (fontSize > 80) { fontSize -= 10; applyFontSize(); }
});
document.getElementById('btn-font-up').addEventListener('click', () => {
  if (fontSize < 140) { fontSize += 10; applyFontSize(); }
});
document.getElementById('btn-font-reset').addEventListener('click', () => {
  fontSize = 100; applyFontSize();
});

// #6: Copy with icon toggle
document.getElementById('btn-copy').addEventListener('click', () => {
  if (copyTimeout) clearTimeout(copyTimeout);
  const text = fullArticleText.replace(/#{1,6}\s/g, '');
  navigator.clipboard.writeText(text).then(() => {
    iconCopy.classList.add('hidden');
    iconCopied.classList.remove('hidden');
    copyTimeout = setTimeout(() => {
      iconCopied.classList.add('hidden');
      iconCopy.classList.remove('hidden');
    }, 2000);
  });
});

// #6: Share
document.getElementById('btn-share').addEventListener('click', () => {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => showToast('分享链接已复制到剪贴板'));
});

// #6: Export
document.getElementById('btn-export').addEventListener('click', () => {
  const text = fullArticleText;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'article.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('文章已导出');
});

// =============================================================================
// #1: VideoInfoCard — URL validation and card display
// =============================================================================
function validateYouTubeUrl(url) {
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
  ];
  return patterns.some(p => p.test(url));
}

function extractVideoId(url) {
  const m1 = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return m1 ? m1[1] : null;
}

function handleVideoUrlInput(url) {
  const isValid = validateYouTubeUrl(url);
  const empty = url.trim() === '';

  if (isValid) {
    videoInfoCard.classList.remove('hidden');
    // Try to fetch video info via oEmbed
    const videoId = extractVideoId(url);
    if (videoId) {
      try {
        fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json')
          .then(r => r.json())
          .then(data => {
            videoInfoTitle.textContent = data.title || url;
            videoInfoChannel.textContent = data.author_name || 'YouTube';
            videoInfoDuration.textContent = '—';
          })
          .catch(() => {
            videoInfoTitle.textContent = url;
            videoInfoChannel.textContent = 'YouTube';
            videoInfoDuration.textContent = '—';
          });
      } catch (_) {
        videoInfoTitle.textContent = url;
        videoInfoChannel.textContent = 'YouTube';
        videoInfoDuration.textContent = '—';
      }
    }
  } else {
    videoInfoCard.classList.add('hidden');
  }

  if (empty) {
    videoInfoCard.classList.add('hidden');
  }
}

youtubeUrlInput.addEventListener('input', () => {
  const url = youtubeUrlInput.value;
  handleVideoUrlInput(url);

  // Clear URL error on input
  if (url.trim()) urlErrorEl.textContent = '';
});

// #2: Demo link
btnDemoLink.addEventListener('click', () => {
  const demoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  youtubeUrlInput.value = demoUrl;
  handleVideoUrlInput(demoUrl);
});

// Enable/disable demo link based on generating state
function updateDemoLinkState() {
  btnDemoLink.disabled = isGenerating;
}

// =============================================================================
// #3: Advanced Options Toggle
// =============================================================================
let isAdvancedOpen = false;

btnAdvancedToggle.addEventListener('click', () => {
  isAdvancedOpen = !isAdvancedOpen;
  if (isAdvancedOpen) {
    advancedOptions.classList.remove('hidden');
    advancedOptions.classList.add('animate-in');
    btnAdvancedBadge.textContent = '收起';
  } else {
    advancedOptions.classList.add('hidden');
    advancedOptions.classList.remove('animate-in');
    btnAdvancedBadge.textContent = '展开';
  }
});

// =============================================================================
// Article Completion
// =============================================================================
function onStreamComplete() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; renderScheduled = false; }
  resultEl.innerHTML = marked.parse(fullArticleText);
  renderedLen = fullArticleText.length;
  updateMetadata();

  classifyBlocks();
  wrapNewChapters();

  initTOC();

  const sections = resultEl.querySelectorAll('.chapter-section');
  sections.forEach((section) => {
    const h2 = section.querySelector('h2');
    if (h2) addChapter5W1H(section, h2.textContent || '');
  });

  articleFooter.classList.remove('hidden');

  const badge = document.getElementById('header-status-badge');
  badge.className = badge.className.replace('bg-blue-100 text-blue-700', 'bg-green-100 text-green-700');
  document.getElementById('header-status-dot').className = 'w-1.5 h-1.5 bg-green-500 rounded-full';
  document.getElementById('header-status-text').textContent = '已生成';

  isGenerating = false;
  generateBtn.disabled = false;
  generateBtnText.textContent = _.btnGenerate;
  youtubeUrlInput.disabled = false;
  customRulesInput.disabled = false;
  updateDemoLinkState();
}

function classifyBlocks() {
  resultEl.querySelectorAll('h1').forEach(el => { el.classList.add('block-heading', 'h1'); });
  resultEl.querySelectorAll('h2').forEach(el => { el.classList.add('block-heading', 'h2'); });
  resultEl.querySelectorAll('h3,h4,h5,h6').forEach(el => el.classList.add('block-heading'));
  resultEl.querySelectorAll('p').forEach(el => el.classList.add('block-paragraph'));
  resultEl.querySelectorAll('ul,ol').forEach(el => el.classList.add('block-list'));
  resultEl.querySelectorAll('blockquote').forEach(el => {
    const text = el.textContent?.trim() || '';
    if (text.startsWith('💡') || text.startsWith('**💡')) {
      el.classList.add('block-highlight');
    } else {
      el.classList.add('block-quote');
    }
  });
  resultEl.querySelectorAll('pre').forEach(el => {
    el.classList.add('block-code');
    const dots = document.createElement('div');
    dots.className = 'code-dots';
    dots.innerHTML = '<span class="code-dot code-dot-red"></span><span class="code-dot code-dot-yellow"></span><span class="code-dot code-dot-green"></span>';
    el.insertBefore(dots, el.firstChild);
  });
}

function wrapNewChapters() {
  const h2s = resultEl.querySelectorAll('h2');
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    if (h2.closest('.chapter-section')) continue;
    wrapChapterStructure(h2, i);
  }
}

function wrapChapterStructure(h2, index) {
  const id = 'chapter-' + index;
  h2.id = id;

  const section = document.createElement('section');
  section.className = 'chapter-section open';
  section.dataset.chapterId = id;

  h2.parentNode.insertBefore(section, h2);
  section.appendChild(h2);

  let next = section.nextSibling;
  while (next && next.tagName !== 'H2') {
    const current = next;
    next = current.nextSibling;
    section.appendChild(current);
  }

  const title = h2.textContent || '';
  const row = document.createElement('div');
  row.className = 'chapter-heading-row';
  h2.parentNode.insertBefore(row, h2);
  row.appendChild(h2);

  const chevron = document.createElement('button');
  chevron.className = 'chapter-chevron';
  chevron.setAttribute('aria-label', 'Toggle chapter');
  chevron.innerHTML = '<svg class="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  chevron.addEventListener('click', () => {
    section.classList.toggle('open');
  });
  row.insertBefore(chevron, h2);

  const body = document.createElement('div');
  body.className = 'chapter-body';
  const content = document.createElement('div');
  content.className = 'chapter-content';
  body.appendChild(content);
  section.appendChild(body);

  while (section.children.length > 2) {
    const child = section.children[1];
    if (child === body) break;
    content.appendChild(child);
  }

  return { section, title };
}

function addChapter5W1H(section, title) {
  const row = section.querySelector('.chapter-heading-row');
  if (!row || row.querySelector('.btn-5w1h')) return;

  const sparklesSvg = '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/><path d="M19 3l.5 2L21 5.5l-1.5.5L19 8l-.5-2L17 5.5l1.5-.5z"/><path d="M5 15l.5 2L7 17.5l-1.5.5L5 20l-.5-2L3 17.5l1.5-.5z"/></svg>';
  const textSpan = '<span class="btn-5w1h-text">5W1H</span>';

  const btn = document.createElement('button');
  btn.className = 'btn-5w1h';
  btn.dataset.chapter = title;
  btn.innerHTML = sparklesSvg + textSpan;
  row.appendChild(btn);

  const body = section.querySelector('.chapter-body');
  if (!body) return;

  const summaryBox = document.createElement('div');
  summaryBox.className = 'summary-box';

  const glow = document.createElement('div');
  glow.className = 'summary-glow';
  summaryBox.appendChild(glow);

  const container = document.createElement('div');
  container.className = 'summary-container';

  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'summary-header';
  summaryHeader.innerHTML = sparklesSvg + '<span class="summary-header-title">5W1H 智能总结</span>';
  container.appendChild(summaryHeader);

  const summaryBody = document.createElement('div');
  summaryBody.className = 'summary-body';
  container.appendChild(summaryBody);

  summaryBox.appendChild(container);

  const content = body.querySelector('.chapter-content');
  if (content) {
    body.insertBefore(summaryBox, content);
  } else {
    body.appendChild(summaryBox);
  }

  chapterSummaryMap.set(title, { button: btn, box: summaryBox, body: summaryBody, sessionId });

  btn.addEventListener('click', () => handle5W1HClick(title));
  summaryHeader.addEventListener('click', () => toggleSummaryBox(title));
}

// =============================================================================
// #4 + #18: Table of Contents — desktop + mobile
// =============================================================================
function updateTOCItems() {
  const h2s = resultEl.querySelectorAll('h2');
  const total = h2s.length;

  tocList.innerHTML = '';
  tocChapterCount.textContent = total + ' 章';
  if (total > 0) {
    tocProgressSection.classList.remove('hidden');
    if (window.innerWidth >= 1024) tocEl.classList.remove('hidden');
  } else {
    tocProgressSection.classList.add('hidden');
  }

  tocDrawerList.innerHTML = '';
  tocDrawerCount.textContent = total + ' 章';
  if (total > 0) tocDrawerProgress.classList.remove('hidden');
  else tocDrawerProgress.classList.add('hidden');

  h2s.forEach((h2, i) => {
    const title = h2.textContent || '';

    const itemHTML = (num) =>
      '<span class="toc-num">' + num + '</span>'
      + '<span class="flex-1 line-clamp-2 text-left">' + title + '</span>'
      + '<svg class="toc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    const desktopBtn = document.createElement('button');
    desktopBtn.className = 'toc-item';
    desktopBtn.innerHTML = itemHTML(i + 1);
    desktopBtn.addEventListener('click', () => {
      h2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    tocList.appendChild(desktopBtn);

    const mobileBtn = document.createElement('button');
    mobileBtn.className = 'toc-item';
    mobileBtn.innerHTML = itemHTML(i + 1);
    mobileBtn.addEventListener('click', () => {
      h2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeMobileToc();
    });
    tocDrawerList.appendChild(mobileBtn);
  });

  if (tocScrollTracking) updateActiveTOC();
}

function initTOC() {
  updateTOCItems();
  if (!tocScrollTracking) {
    tocScrollTracking = true;
    window.addEventListener('scroll', updateActiveTOC, { passive: true });
  }
}

function updateActiveTOC() {
  const h2s = resultEl.querySelectorAll('h2');
  if (h2s.length === 0) return;

  const desktopItems = tocList.querySelectorAll('.toc-item');
  const mobileItems = tocDrawerList.querySelectorAll('.toc-item');
  let activeIdx = -1;

  h2s.forEach((h2, i) => {
    const rect = h2.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.5) activeIdx = i;
  });

  // Update desktop
  desktopItems.forEach((item, i) => {
    item.classList.toggle('active', i === activeIdx);
  });

  // Update mobile drawer
  mobileItems.forEach((item, i) => {
    item.classList.toggle('active', i === activeIdx);
  });

  // Progress bars
  const total = h2s.length;
  const pct = total > 0 ? Math.min(100, Math.round(((activeIdx + 1) / total) * 100)) : 0;

  tocProgressBar.style.width = pct + '%';
  tocProgressText.textContent = pct + '%';
  tocDrawerProgressBar.style.width = pct + '%';
  tocDrawerProgressText.textContent = pct + '%';

  // Track active chapter sections for highlighting
  h2s.forEach((h2, i) => {
    const section = h2.closest('.chapter-section');
    if (section) {
      section.classList.toggle('active', i === activeIdx);
    }
  });
}

// #4: Mobile TOC — drawer open/close
function openMobileToc() {
  tocDrawer.classList.remove('translate-x-full');
  tocBackdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeMobileToc() {
  tocDrawer.classList.add('translate-x-full');
  tocBackdrop.classList.add('hidden');
  document.body.style.overflow = '';
}

btnMobileToc.addEventListener('click', openMobileToc);
btnTocClose.addEventListener('click', closeMobileToc);
tocBackdrop.addEventListener('click', closeMobileToc);

// =============================================================================
// 5W1H Summary API
// =============================================================================
const W1H_LABELS = [
  { key: 'who', label: _.labelWho, icon: '👤', className: 'w1h-blue' },
  { key: 'what', label: _.labelWhat, icon: '📋', className: 'w1h-green' },
  { key: 'when', label: _.labelWhen, icon: '⏰', className: 'w1h-amber' },
  { key: 'where', label: _.labelWhere, icon: '📍', className: 'w1h-red' },
  { key: 'why', label: _.labelWhy, icon: '🎯', className: 'w1h-purple' },
  { key: 'how', label: _.labelHow, icon: '🔧', className: 'w1h-indigo' },
];

function toggleSummaryBox(title) {
  const entry = chapterSummaryMap.get(title);
  if (!entry) return;
  entry.box.classList.toggle('open');
}

async function handle5W1HClick(title) {
  const entry = chapterSummaryMap.get(title);
  if (!entry) return;

  const { box, body, sessionId: entrySessionId } = entry;

  const section = box.closest('.chapter-section');
  if (section && !section.classList.contains('open')) {
    section.classList.add('open');
  }

  if (box.dataset.loaded === 'true') {
    box.classList.toggle('open');
    return;
  }

  box.classList.add('open');
  body.innerHTML = '<div class="summary-loading text-slate-500"><svg class="w-4 h-4 animate-spin text-purple-500" viewBox="0 0 24 24" fill="none"><path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> AI 正在分析章节内容...</div>';

  try {
    if (!entrySessionId) throw new Error('No session');
    const model = document.getElementById('ai-provider').value;
    const resp = await fetch(`/api/5w1h?model=${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: title, sessionId: entrySessionId }),
    });
    if (!resp.ok) throw new Error(_.errRequestFailed(resp.status));
    const data = await resp.json();
    render5W1H(body, data.summary || data);
    box.dataset.loaded = 'true';
  } catch (e) {
    body.innerHTML = '<div class="w1h-error">' + _.errLoadFailed(e.message) + '</div>';
    box.dataset.loaded = '';
  }
}

function render5W1H(body, summary) {
  if (!summary || typeof summary !== 'object') {
    body.innerHTML = '<div class="w1h-error">' + _.errParse5W1H + '</div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'w1h-cards';

  W1H_LABELS.forEach(({ key, label, icon, className }) => {
    const card = document.createElement('div');
    card.className = 'w1h-card ' + className;
    card.innerHTML =
      '<div class="w1h-card-header">' + icon + ' ' + label + '</div>'
      + '<div class="w1h-card-body">' + (summary[key] || '—') + '</div>';
    container.appendChild(card);
  });

  body.innerHTML = '';
  body.appendChild(container);
}

// =============================================================================
// Generate Button
// =============================================================================
function validateURL(url) {
  if (!url || !url.trim()) return _.errEmptyURL;
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
  ];
  if (!patterns.some(p => p.test(url.trim()))) return _.errInvalidURL;
  return null;
}

function setUIState(generating) {
  isGenerating = generating;
  generateBtn.disabled = generating;
  generateBtnText.textContent = generating ? _.btnGenerating : _.btnGenerate;
  youtubeUrlInput.disabled = generating;
  customRulesInput.disabled = generating;
  updateDemoLinkState();

  if (generating) {
    if (!document.body.classList.contains('sidebar-collapsed')) {
      collapseSidebar();
    }
    emptyState.style.display = 'none';
    fallbackWarning.classList.add('hidden');
    articleHeader.classList.add('hidden');
    articleFooter.classList.add('hidden');
    articleActions.classList.add('hidden');
    metadataEl.classList.add('hidden');
    enhancementsEl.classList.add('hidden');
    streamingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    resultEl.innerHTML = '';
    fullArticleText = '';
    renderedLen = 0;
    hasReceivedFirstData = false;
    tocScrollTracking = false;

    const badge = document.getElementById('header-status-badge');
    badge.className = badge.className.replace('bg-green-100 text-green-700', 'bg-blue-100 text-blue-700');
    document.getElementById('header-status-dot').className = 'w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse';
    document.getElementById('header-status-text').textContent = '生成中';

    loadingSpinner.classList.add('hidden');
    streamingEl.classList.remove('hidden');
  }
}

generateBtn.addEventListener('click', async () => {
  urlErrorEl.textContent = '';

  const url = youtubeUrlInput.value;
  const urlErr = validateURL(url);
  if (urlErr) { urlErrorEl.textContent = urlErr; return; }

  setUIState(true);

  // Cancel previous request
  if (abortController) abortController.abort();
  abortController = new AbortController();

  const rule = customRulesInput.value;
  const model = document.getElementById('ai-provider').value;

  try {
    await streamArticle(url.trim(), rule, model, abortController.signal);
  } catch (err) {
    if (err.name === 'AbortError') return;
    streamingEl.classList.add('hidden');
    errorEl.textContent = err.message || _.errGenerateFailed;
    errorEl.classList.remove('hidden');
    articleHeader.classList.add('hidden');
    metadataEl.classList.add('hidden');
    enhancementsEl.classList.add('hidden');
    articleActions.classList.add('hidden');
    fullArticleText = ''; renderedLen = 0;
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtnText.textContent = _.btnGenerate;
    youtubeUrlInput.disabled = false;
    customRulesInput.disabled = false;
    updateDemoLinkState();
    emptyState.style.display = '';
  } finally {
    abortController = null;
  }
});


function collapseSidebar() {
  inputPanel.classList.add('sidebar-sliding');
  setTimeout(() => {
    document.body.classList.add('sidebar-collapsed');
    inputPanel.classList.remove('sidebar-sliding');
  }, 350);
}

function expandSidebar() {
  document.body.classList.remove('sidebar-collapsed');
  inputPanel.offsetHeight;
  inputPanel.classList.add('sidebar-sliding');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inputPanel.classList.remove('sidebar-sliding');
    });
  });
}

btnCollapseSidebar.addEventListener('click', collapseSidebar);
btnExpandSidebar.addEventListener('click', expandSidebar);

document.getElementById('btn-login').addEventListener('click', () => {
  const landing = document.getElementById('landing');
  landing.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  landing.style.opacity = '0';
  landing.style.transform = 'scale(1.05)';
  setTimeout(() => {
    landing.style.display = 'none';
    document.getElementById('app-container').classList.remove('hidden');
  }, 400);
});

applyFontSize();
updateDemoLinkState();
