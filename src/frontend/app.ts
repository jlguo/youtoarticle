import { marked } from "marked";
import { _ } from "./locale.js";
import { show, hide, showToast } from "./helpers.js";
import {
  youtubeUrlInput, customRulesInput, generateBtn, generateBtnText,
  resultEl, streamingEl, errorEl, urlErrorEl, metadataEl, enhancementsEl,
  articleHeader, headerTimestamp, headerChapterCount, articleActions, articleFooter,
  fallbackWarning, tocEl, tocList, tocChapterCount, tocProgressBar, tocProgressText,
  tocProgressSection, toastContainer, emptyState, inputPanel,
  btnCollapseSidebar, btnExpandSidebar, videoInfoCard, videoInfoTitle,
  videoInfoChannel, videoInfoDuration, btnDemoLink, btnAdvancedToggle,
  btnAdvancedBadge, advancedOptions, btnMobileToc, tocBackdrop, tocDrawer,
  btnTocClose, tocDrawerList, tocDrawerProgress, tocDrawerProgressText,
  tocDrawerProgressBar, tocDrawerCount, iconCopy, iconCopied,
} from "./dom.js";
import { state, type AppState } from "./state.js";

marked.setOptions({ breaks: true, gfm: true });

interface ChapterSummaryEntry {
  button: HTMLButtonElement;
  box: HTMLDivElement;
  body: HTMLDivElement;
  sessionId: string | null;
}

interface W1HLabel {
  key: string;
  label: string;
  icon: string;
  className: string;
}

interface ChapterWrapResult {
  section: HTMLElement;
  title: string;
}

const chapterSummaryMap = new Map<string, ChapterSummaryEntry>();

// =============================================================================

function feedContent(text: string): void {
  if (!state.hasReceivedFirstData) {
    state.hasReceivedFirstData = true;
    emptyState.style.display = 'none';
    streamingEl.classList.add('hidden');
    articleHeader.classList.remove('hidden');
    metadataEl.classList.remove('hidden');
    enhancementsEl.classList.remove('hidden');
    articleActions.classList.remove('hidden');
    if (state.isFromFallback) fallbackWarning.classList.remove('hidden');
    headerTimestamp.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  state.fullArticleText += text;
  if (!state.renderScheduled) {
    state.renderScheduled = true;
    state.rafId = requestAnimationFrame(() => {
      if (state.fullArticleText.length > state.renderedLen) {
        resultEl.innerHTML = marked.parse(state.fullArticleText) as string;
        const cursor = document.createElement('span');
        cursor.id = 'stream-cursor';
        cursor.className = 'cursor-blink';
        const lastChild = resultEl.lastElementChild;
        if (lastChild && lastChild.textContent) {
          lastChild.appendChild(cursor);
        } else {
          resultEl.appendChild(cursor);
        }
        state.renderedLen = state.fullArticleText.length;
        classifyBlocks();
        wrapNewChapters();
        updateMetadata();
        updateTOCItems();
      }
      state.renderScheduled = false;
      state.rafId = 0;
    });
  }
}

async function streamArticle(youtubeUrl: string, rule: string, model: string, signal: AbortSignal): Promise<void> {
  const qs = `model=${model}`;
  const response = await fetch("/api/generate?" + qs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl, rule: rule || undefined }),
    signal,
  });

  if (!response.ok) {
    let errMsg = _.errRequestFailed(String(response.status));
    try { const ed = await response.json() as { error?: string }; if (ed.error) errMsg = ed.error; } catch (_e) { /* ignore */ }
    throw new Error(errMsg);
  }

  state.sessionId = response.headers.get("X-Session-Id");
  state.isFromFallback = response.headers.get("X-From-Fallback") === "true";
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineStart = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
      const line = buffer.slice(lineStart, newlineIdx).trim();
      lineStart = newlineIdx + 1;

      if (line.slice(0, 6) !== "data: ") continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      if (jsonStr === "[DONE]") { onStreamComplete(); return; }

      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(jsonStr) as Record<string, unknown>; } catch (_e) { continue; }

      const geminiText = (parsed as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (geminiText) { feedContent(geminiText); continue; }

      const deepseekText = (parsed as { choices?: Array<{ delta?: { content?: string } }> })?.choices?.[0]?.delta?.content;
      if (deepseekText) { feedContent(deepseekText); }
    }
  }

  if (state.isGenerating) {
    onStreamComplete();
  }
}

function updateMetadata(): void {
  const text = state.fullArticleText;
  const chapters = (text.match(/^## /gm) || []).length;
  const chars = text.replace(/\s/g, '').length;
  const words = Math.round(chars * 0.6);
  const readTime = Math.max(1, Math.round(words / 200));

  document.getElementById('meta-chapters')!.textContent = String(chapters);
  document.getElementById('meta-readtime')!.textContent = readTime + ' 分钟';
  document.getElementById('meta-words')!.textContent = words.toLocaleString();
  document.getElementById('meta-lang')!.textContent = '中文';
  document.getElementById('meta-time')!.textContent =
    new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  headerChapterCount.textContent = chapters + ' 章';
}

function applyFontSize(): void {
  resultEl.style.setProperty('--article-font-size', (state.fontSize / 100) + 'em');
  document.getElementById('fontsize-label')!.textContent = state.fontSize + '%';
}

document.getElementById('btn-font-down')!.addEventListener('click', () => {
  if (state.fontSize > 80) { state.fontSize -= 10; applyFontSize(); }
});
document.getElementById('btn-font-up')!.addEventListener('click', () => {
  if (state.fontSize < 140) { state.fontSize += 10; applyFontSize(); }
});
document.getElementById('btn-font-reset')!.addEventListener('click', () => {
  state.fontSize = 100; applyFontSize();
});

// Copy with icon toggle
document.getElementById('btn-copy')!.addEventListener('click', () => {
  if (state.copyTimeout) clearTimeout(state.copyTimeout);
  const text = state.fullArticleText.replace(/#{1,6}\s/g, '');
  navigator.clipboard.writeText(text).then(() => {
    iconCopy.classList.add('hidden');
    iconCopied.classList.remove('hidden');
    state.copyTimeout = setTimeout(() => {
      iconCopied.classList.add('hidden');
      iconCopy.classList.remove('hidden');
    }, 2000);
  });
});

// Share
document.getElementById('btn-share')!.addEventListener('click', () => {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => showToast('分享链接已复制到剪贴板'));
});

// Export
document.getElementById('btn-export')!.addEventListener('click', () => {
  const text = state.fullArticleText;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'article.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('文章已导出');
});

function validateYouTubeUrl(url: string): boolean {
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
  ];
  return patterns.some(p => p.test(url));
}

function extractVideoId(url: string): string | null {
  const m1 = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return m1 ? m1[1] : null;
}

function handleVideoUrlInput(url: string): void {
  const isValid = validateYouTubeUrl(url);
  const empty = url.trim() === '';

  if (isValid) {
    videoInfoCard.classList.remove('hidden');
    const videoId = extractVideoId(url);
    if (videoId) {
      try {
        fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json')
          .then(r => r.json())
          .then(data => {
            videoInfoTitle.textContent = (data as { title?: string }).title || url;
            videoInfoChannel.textContent = (data as { author_name?: string }).author_name || 'YouTube';
            videoInfoDuration.textContent = '—';
          })
          .catch(() => {
            videoInfoTitle.textContent = url;
            videoInfoChannel.textContent = 'YouTube';
            videoInfoDuration.textContent = '—';
          });
      } catch (_e) {
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

(youtubeUrlInput as HTMLInputElement).addEventListener('input', () => {
  const url = (youtubeUrlInput as HTMLInputElement).value;
  handleVideoUrlInput(url);

  if (url.trim()) urlErrorEl.textContent = '';
});

// Demo link
btnDemoLink.addEventListener('click', () => {
  const demoUrl = 'https://www.youtube.com/watch?v=xRh2sVcNXQ8';
  (youtubeUrlInput as HTMLInputElement).value = demoUrl;
  handleVideoUrlInput(demoUrl);
});

function updateDemoLinkState(): void {
  (btnDemoLink as HTMLButtonElement).disabled = state.isGenerating;
}

btnAdvancedToggle.addEventListener('click', () => {
  state.isAdvancedOpen = !state.isAdvancedOpen;
  if (state.isAdvancedOpen) {
    advancedOptions.classList.remove('hidden');
    advancedOptions.classList.add('animate-in');
    btnAdvancedBadge.textContent = '收起';
  } else {
    advancedOptions.classList.add('hidden');
    advancedOptions.classList.remove('animate-in');
    btnAdvancedBadge.textContent = '展开';
  }
});

function onStreamComplete(): void {
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; state.renderScheduled = false; }
  resultEl.innerHTML = marked.parse(state.fullArticleText) as string;
  state.renderedLen = state.fullArticleText.length;
  updateMetadata();

  classifyBlocks();
  wrapNewChapters();

  initTOC();

  const sections = resultEl.querySelectorAll('.chapter-section') as NodeListOf<HTMLElement>;
  sections.forEach((section) => {
    const h2 = section.querySelector('h2');
    if (h2) addChapter5W1H(section, h2.textContent || '');
  });

  articleFooter.classList.remove('hidden');

  const badge = document.getElementById('header-status-badge')!;
  badge.className = badge.className.replace('bg-blue-100 text-blue-700', 'bg-green-100 text-green-700');
  document.getElementById('header-status-dot')!.className = 'w-1.5 h-1.5 bg-green-500 rounded-full';
  document.getElementById('header-status-text')!.textContent = '已生成';

  state.isGenerating = false;
  (generateBtn as HTMLButtonElement).disabled = false;
  generateBtnText.textContent = _.btnGenerate;
  (youtubeUrlInput as HTMLInputElement).disabled = false;
  (customRulesInput as HTMLTextAreaElement).disabled = false;
  updateDemoLinkState();
}

function classifyBlocks(): void {
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

function wrapNewChapters(): void {
  const h2s = resultEl.querySelectorAll('h2');
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    if (h2.closest('.chapter-section')) continue;
    wrapChapterStructure(h2, i);
  }
}

function wrapChapterStructure(h2: HTMLHeadingElement, index: number): ChapterWrapResult {
  const id = 'chapter-' + index;
  h2.id = id;

  const section = document.createElement('section');
  section.className = 'chapter-section open';
  section.dataset.chapterId = id;

  h2.parentNode!.insertBefore(section, h2);
  section.appendChild(h2);

  let next = section.nextSibling;
  while (next && (next as Element).tagName !== 'H2') {
    const current = next;
    next = current.nextSibling;
    section.appendChild(current);
  }

  const title = h2.textContent || '';
  const row = document.createElement('div');
  row.className = 'chapter-heading-row';
  h2.parentNode!.insertBefore(row, h2);
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

function addChapter5W1H(section: HTMLElement, title: string): void {
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

  chapterSummaryMap.set(title, { button: btn, box: summaryBox, body: summaryBody, sessionId: state.sessionId });

  btn.addEventListener('click', () => handle5W1HClick(title));
  summaryHeader.addEventListener('click', () => toggleSummaryBox(title));
}

function updateTOCItems(): void {
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

    const itemHTML = (num: number): string =>
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

  if (state.tocScrollTracking) updateActiveTOC();
}

function initTOC(): void {
  updateTOCItems();
  if (!state.tocScrollTracking) {
    state.tocScrollTracking = true;
    window.addEventListener('scroll', updateActiveTOC, { passive: true });
  }
}

function updateActiveTOC(): void {
  const h2s = resultEl.querySelectorAll('h2');
  if (h2s.length === 0) return;

  const desktopItems = tocList.querySelectorAll('.toc-item');
  const mobileItems = tocDrawerList.querySelectorAll('.toc-item');
  let activeIdx = -1;

  h2s.forEach((h2, i) => {
    const rect = h2.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.5) activeIdx = i;
  });

  desktopItems.forEach((item, i) => {
    item.classList.toggle('active', i === activeIdx);
  });

  mobileItems.forEach((item, i) => {
    item.classList.toggle('active', i === activeIdx);
  });

  const total = h2s.length;
  const pct = total > 0 ? Math.min(100, Math.round(((activeIdx + 1) / total) * 100)) : 0;

  (tocProgressBar as HTMLElement).style.width = pct + '%';
  tocProgressText.textContent = pct + '%';
  (tocDrawerProgressBar as HTMLElement).style.width = pct + '%';
  tocDrawerProgressText.textContent = pct + '%';

  h2s.forEach((h2, i) => {
    const section = h2.closest('.chapter-section');
    if (section) {
      section.classList.toggle('active', i === activeIdx);
    }
  });
}

function openMobileToc(): void {
  tocDrawer.classList.remove('translate-x-full');
  tocBackdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeMobileToc(): void {
  tocDrawer.classList.add('translate-x-full');
  tocBackdrop.classList.add('hidden');
  document.body.style.overflow = '';
}

btnMobileToc.addEventListener('click', openMobileToc);
btnTocClose.addEventListener('click', closeMobileToc);
tocBackdrop.addEventListener('click', closeMobileToc);

const W1H_LABELS: W1HLabel[] = [
  { key: 'who', label: _.labelWho, icon: '👤', className: 'w1h-blue' },
  { key: 'what', label: _.labelWhat, icon: '📋', className: 'w1h-green' },
  { key: 'when', label: _.labelWhen, icon: '⏰', className: 'w1h-amber' },
  { key: 'where', label: _.labelWhere, icon: '📍', className: 'w1h-red' },
  { key: 'why', label: _.labelWhy, icon: '🎯', className: 'w1h-purple' },
  { key: 'how', label: _.labelHow, icon: '🔧', className: 'w1h-indigo' },
];

function toggleSummaryBox(title: string): void {
  const entry = chapterSummaryMap.get(title);
  if (!entry) return;
  entry.box.classList.toggle('open');
}

async function handle5W1HClick(title: string): Promise<void> {
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
    const model = (document.getElementById('ai-provider') as unknown as HTMLSelectElement).value;
    const resp = await fetch(`/api/5w1h?model=${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: title, sessionId: entrySessionId }),
    });
    if (!resp.ok) throw new Error(_.errRequestFailed(String(resp.status)));
    const data = await resp.json() as { summary?: Record<string, string> };
    render5W1H(body, data.summary || data);
    box.dataset.loaded = 'true';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    body.innerHTML = '<div class="w1h-error">' + _.errLoadFailed(msg) + '</div>';
    box.dataset.loaded = '';
  }
}

function render5W1H(body: HTMLElement, summary: unknown): void {
  if (!summary || typeof summary !== 'object') {
    body.innerHTML = '<div class="w1h-error">' + _.errParse5W1H + '</div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'w1h-cards';

  const summaryRecord = summary as Record<string, string>;

  W1H_LABELS.forEach(({ key, label, icon, className }) => {
    const card = document.createElement('div');
    card.className = 'w1h-card ' + className;
    card.innerHTML =
      '<div class="w1h-card-header">' + icon + ' ' + label + '</div>'
      + '<div class="w1h-card-body">' + (summaryRecord[key] || '—') + '</div>';
    container.appendChild(card);
  });

  body.innerHTML = '';
  body.appendChild(container);
}

function validateURL(url: string): string | null {
  if (!url || !url.trim()) return _.errEmptyURL;
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
  ];
  if (!patterns.some(p => p.test(url.trim()))) return _.errInvalidURL;
  return null;
}

function setUIState(generating: boolean): void {
  state.isGenerating = generating;
  (generateBtn as HTMLButtonElement).disabled = generating;
  generateBtnText.textContent = generating ? _.btnGenerating : _.btnGenerate;
  (youtubeUrlInput as HTMLInputElement).disabled = generating;
  (customRulesInput as HTMLTextAreaElement).disabled = generating;
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
    state.fullArticleText = '';
    state.renderedLen = 0;
    state.hasReceivedFirstData = false;
    state.tocScrollTracking = false;

    const badge = document.getElementById('header-status-badge')!;
    badge.className = badge.className.replace('bg-green-100 text-green-700', 'bg-blue-100 text-blue-700');
    document.getElementById('header-status-dot')!.className = 'w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse';
    document.getElementById('header-status-text')!.textContent = '生成中';

    streamingEl.classList.remove('hidden');
  }
}

generateBtn.addEventListener('click', async () => {
  urlErrorEl.textContent = '';

  const url = (youtubeUrlInput as HTMLInputElement).value;
  const urlErr = validateURL(url);
  if (urlErr) { urlErrorEl.textContent = urlErr; return; }

  setUIState(true);

  if (state.abortController) state.abortController.abort();
  state.abortController = new AbortController();

  const rule = (customRulesInput as HTMLTextAreaElement).value;
  const model = (document.getElementById('ai-provider') as unknown as HTMLSelectElement).value;

  try {
    await streamArticle(url.trim(), rule, model, state.abortController.signal);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    streamingEl.classList.add('hidden');
    const msg = err instanceof Error ? err.message : String(err);
    errorEl.textContent = msg || _.errGenerateFailed;
    errorEl.classList.remove('hidden');
    articleHeader.classList.add('hidden');
    metadataEl.classList.add('hidden');
    enhancementsEl.classList.add('hidden');
    articleActions.classList.add('hidden');
    state.fullArticleText = ''; state.renderedLen = 0;
    state.isGenerating = false;
    (generateBtn as HTMLButtonElement).disabled = false;
    generateBtnText.textContent = _.btnGenerate;
    (youtubeUrlInput as HTMLInputElement).disabled = false;
    (customRulesInput as HTMLTextAreaElement).disabled = false;
    updateDemoLinkState();
    emptyState.style.display = '';
  } finally {
    state.abortController = null;
  }
});

function collapseSidebar(): void {
  inputPanel.classList.add('sidebar-sliding');
  setTimeout(() => {
    document.body.classList.add('sidebar-collapsed');
    inputPanel.classList.remove('sidebar-sliding');
  }, 350);
}

function expandSidebar(): void {
  document.body.classList.remove('sidebar-collapsed');
  inputPanel.offsetHeight; // force reflow
  inputPanel.classList.add('sidebar-sliding');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inputPanel.classList.remove('sidebar-sliding');
    });
  });
}

btnCollapseSidebar.addEventListener('click', collapseSidebar);
btnExpandSidebar.addEventListener('click', expandSidebar);

document.getElementById('btn-login')!.addEventListener('click', () => {
  const landing = document.getElementById('landing')!;
  landing.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  landing.style.opacity = '0';
  landing.style.transform = 'scale(1.05)';
  setTimeout(() => {
    landing.style.display = 'none';
    document.getElementById('app-container')!.classList.remove('hidden');
  }, 400);
});

applyFontSize();
updateDemoLinkState();
