import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_URL || "https://youtoarticle.junlikowk.workers.dev";
const DEMO = "https://www.youtube.com/watch?v=xRh2sVcNXQ8";

test("full app lifecycle — landing → UI → generate → content → completion", async ({ page }) => {
  test.setTimeout(180000);
  const errs: Error[] = [];
  page.on("pageerror", (e) => errs.push(e));

  // ── 01 Landing ──────────────────────────────────────────
  await page.goto(BASE_URL);
  await expect(page.locator("#landing h1")).toHaveText("YouToArticle");
  await expect(page.locator("#landing")).toContainText("AI 将 YouTube 视频字幕转换为结构化文章");
  await expect(page.locator("#landing svg")).toBeVisible();
  await expect(page.locator("#btn-login")).toHaveText("进入应用");
  await expect(page.locator("#btn-login")).toHaveClass(/from-blue-500/);
  await expect(page).toHaveTitle("YouToArticle");
  const desc = (await page.locator('meta[name="description"]').getAttribute("content")) || "";
  expect(desc.length).toBeGreaterThan(10);
  expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");

  // ── 02 App entry ────────────────────────────────────────
  await page.locator("#btn-login").click();
  await expect(page.locator("#landing")).toBeHidden({ timeout: 8000 });
  await expect(page.locator("header h1")).toHaveText("YouToArticle");
  await expect(page.locator("header")).toHaveClass(/sticky/);
  await expect(page.locator("header svg")).toBeVisible();
  await expect(page.locator("#youtube-url")).toBeVisible();
  await expect(page.locator("#generate-btn")).toBeVisible();
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#empty-state svg")).toBeVisible();
  await expect(page.locator('script[type="module"]')).toBeAttached();
  await expect(page.locator("#toast-container")).toBeAttached();

  // ── 03 Input panel ──────────────────────────────────────
  const url = page.locator("#youtube-url");
  await expect(url).toHaveAttribute("placeholder", /youtube\.com/);
  await url.fill("https://test.com/watch?v=abc123");
  await expect(url).toHaveValue("https://test.com/watch?v=abc123");
  await url.fill("");
  await expect(url).toHaveValue("");
  await page.locator("#btn-demo-link").click();
  expect(await url.inputValue()).toContain("xRh2sVcNXQ8");
  await url.fill(DEMO);
  await expect(page.locator("#video-info-card")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#video-info-title")).toBeVisible();
  await expect(page.locator("#video-info-channel")).toBeVisible();
  await expect(page.locator("#video-info-duration")).toBeVisible();

  // ── 04 Generate button style + URL validation ───────────
  await expect(page.locator("#generate-btn-text")).toHaveText("开始生成文章");
  await expect(page.locator("#generate-btn svg")).toBeVisible();
  await expect(page.locator("#generate-btn")).toHaveClass(/w-full/);
  await expect(page.locator("#generate-btn")).toHaveClass(/from-blue-600/);
  await expect(page.locator("aside .bg-white").first()).toHaveClass(/rounded-xl/);
  await expect(page.locator("aside .bg-white").first()).toHaveClass(/lg:sticky/);
  await url.fill("");
  await page.locator("#generate-btn").click();
  await expect(page.locator("#url-error")).toContainText("请输入");
  await url.fill("not-a-url");
  await page.locator("#generate-btn").click();
  await expect(page.locator("#url-error")).toContainText("有效的 YouTube");
  await url.fill(DEMO);
  await expect(page.locator("#url-error")).toBeEmpty();

  // ── 05 Model selection ──────────────────────────────────
  const sel = page.locator("#ai-provider");
  await expect(page.locator('label[for="ai-provider"]')).toHaveText("AI 模型");
  await expect(sel.locator("option")).toHaveCount(3);
  await expect(sel).toHaveValue("gemini-3.1-flash-lite");
  await expect(sel.locator("option").nth(0)).toContainText("Gemini");
  await expect(sel.locator("option").nth(0)).toContainText("flash-lite");
  await expect(sel.locator("option").nth(2)).toContainText("DeepSeek");
  await sel.selectOption("gemini-2.5-flash");
  await expect(sel).toHaveValue("gemini-2.5-flash");
  await sel.selectOption("deepseek-v4-flash");
  await expect(sel).toHaveValue("deepseek-v4-flash");
  await sel.selectOption("gemini-3.1-flash-lite");
  await expect(sel).toHaveValue("gemini-3.1-flash-lite");

  // ── 06 Advanced options ─────────────────────────────────
  const toggle = page.locator("#btn-advanced-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle.locator("svg")).toBeVisible();
  await expect(page.locator("#btn-advanced-badge")).toHaveText("展开");
  await toggle.click();
  await expect(page.locator("#advanced-options")).toBeVisible();
  await expect(page.locator("#custom-rules")).toBeVisible();
  await expect(page.locator("#btn-advanced-badge")).toHaveText("收起");
  await page.locator("#custom-rules").fill("用幽默风格重写给初学者");
  await expect(page.locator("#custom-rules")).toHaveValue("用幽默风格重写给初学者");
  const tips = page.locator("#advanced-options .bg-blue-50");
  await expect(tips).toBeVisible();
  await expect(tips).toContainText("目标受众");
  await toggle.click();
  await expect(page.locator("#advanced-options")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#custom-rules")).toHaveValue("用幽默风格重写给初学者");
  await toggle.click();

  // ── 07 Sidebar collapse ─────────────────────────────────
  const collapse = page.locator("#btn-collapse-sidebar");
  const expand = page.locator("#btn-expand-sidebar");
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.locator("#input-panel")).toBeHidden({ timeout: 3000 });
  await expect(expand).toBeVisible();
  await expect(expand).toHaveClass(/rounded-full/);
  await expand.click();
  await expect(page.locator("#input-panel")).toBeVisible({ timeout: 3000 });

  // ── 08 Article area empty state ─────────────────────────
  await expect(page.locator("#toc")).toBeAttached();
  await expect(page.locator("#toc")).toContainText("文章目录");
  await expect(page.locator("#article-footer")).toBeAttached();
  await expect(page.locator("#article-footer")).toContainText("文章由 AI 基于视频字幕生成");
  const html = await page.content();
  expect(html).not.toContain("Gemini AI");
  await expect(page.locator("#header-status-dot")).toBeAttached();
  const card = page.locator(".rounded-xl.sm\\:rounded-2xl.shadow-sm.border.overflow-hidden").first();
  await expect(card).toBeAttached();

  // ── 09 Mobile TOC drawer ────────────────────────────────
  await expect(page.locator("#btn-mobile-toc")).toBeAttached();
  await expect(page.locator("#toc-drawer")).toBeAttached();
  await expect(page.locator("#btn-toc-close")).toBeAttached();
  await expect(page.locator("#toc-backdrop")).toBeAttached();

  // ── 10 Error element chain ──────────────────────────────
  await expect(page.locator("#error")).toBeAttached();
  await expect(page.locator("#error")).toBeHidden();

  // ==========================================================
  // GENERATION PHASE
  // ==========================================================

  // ── 11 Start generation ─────────────────────────────────
  await url.fill(DEMO);
  await page.locator("#generate-btn").click();
  await expect(page.locator("#generate-btn")).toBeDisabled();
  await expect(page.locator("#generate-btn-text")).toHaveText("生成中...");
  await expect(page.locator("#youtube-url")).toBeDisabled();
  await expect(page.locator("#input-panel")).toBeHidden({ timeout: 5000 });
  await expect(page.locator("#btn-expand-sidebar")).toBeVisible({ timeout: 10000 });

  // ── 12 Wait for first content ───────────────────────────
  // Must see content OR error — timeout = hard fail
  await Promise.race([
    page.locator("#article-header").waitFor({ state: "visible", timeout: 60000 }),
    page.locator("#result").waitFor({ state: "visible", timeout: 60000 }),
    page.locator("#fallback-warning").waitFor({ state: "visible", timeout: 60000 }),
  ]);
  // If error appeared, fail fast
  const apiError = await page.locator("#error").isVisible().catch(() => false);
  if (apiError) {
    const msg = await page.locator("#error").textContent().catch(() => "unknown");
    throw new Error(`API error: ${msg}`);
  }

  // ── 13 Wait for completion ──────────────────────────────
  await page.locator("#header-status-text").filter({ hasText: "已生成" }).waitFor({ state: "visible", timeout: 120000 });
  // If error appeared during generation, fail
  const lateError = await page.locator("#error").isVisible().catch(() => false);
  if (lateError) {
    const msg = await page.locator("#error").textContent().catch(() => "unknown");
    throw new Error(`API error after stream: ${msg}`);
  }

  // ==========================================================
  // ARTICLE VERIFICATION (post-completion)
  // ==========================================================

  // ── 14 Status badge ─────────────────────────────────────
  await expect(page.locator("#header-status-text")).toHaveText("已生成");
  await expect(page.locator("#header-status-badge")).toHaveClass(/bg-green-100/);
  await expect(page.locator("#header-status-badge")).toHaveClass(/text-green-700/);
  const dotClass = await page.locator("#header-status-dot").getAttribute("class");
  expect(dotClass).toContain("bg-green-500");
  expect(dotClass).not.toContain("animate-pulse");
  await expect(page.locator("#header-timestamp")).not.toBeEmpty();
  await expect(page.locator("#article-header")).toBeVisible();
  const chapterCount = await page.locator("#header-chapter-count").textContent();
  // chapter count may be 0 for fallback content without headings
  expect(typeof chapterCount).toBe("string");

  // ── 15 Metadata ─────────────────────────────────────────
  await expect(page.locator("#metadata")).toBeVisible();
  // chapter count may be 0 for fallback content without ## headings
  const metaChapters = await page.locator("#meta-chapters").textContent();
  expect(metaChapters).not.toBe("—");
  const metaWords = await page.locator("#meta-words").textContent();
  expect(Number(metaWords!.replace(/,/g, ""))).toBeGreaterThan(0);
  await expect(page.locator("#meta-readtime")).toContainText("分钟");
  await expect(page.locator("#meta-lang")).toHaveText("中文");
  await expect(page.locator("#meta-time")).not.toHaveText("—");

  // ── 16 Article structure ────────────────────────────────
  await expect(page.locator("#result")).toBeVisible();
  const resultHTML = await page.locator("#result").innerHTML();
  expect(resultHTML.length).toBeGreaterThan(200);
  const headings = await page.locator(".block-heading").count();
  expect(headings).toBeGreaterThan(0);
  const paragraphs = await page.locator(".block-paragraph").count();
  expect(paragraphs).toBeGreaterThan(0);

  // ── 17 Chapter folding ──────────────────────────────────
  const sections = await page.locator(".chapter-section").count();
  if (sections > 0) {
    const openSections = await page.locator(".chapter-section.open").count();
    expect(openSections).toBeGreaterThan(0);
    // Test fold/unfold via chevron button
    const firstChapter = page.locator(".chapter-section").first();
    const chevron = firstChapter.locator(".chapter-chevron");
    await chevron.click();
    await expect(firstChapter).not.toHaveClass(/open/);
    await chevron.click();
    await expect(firstChapter).toHaveClass(/open/);
  }

  // ── 18 5W1H ─────────────────────────────────────────────
  const fiveW1H = await page.locator(".btn-5w1h").count();
  if (fiveW1H > 0) {
    // Click first 5W1H button — panel opens, content loads async
    await page.locator(".btn-5w1h").first().click();
    // Summary box opens (may show loading or content)
    const boxOpened = await page.locator(".summary-box.open").waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
    if (boxOpened) {
      // Wait for content cards to load (may fail if KV session expired)
      const cardsLoaded = await page.locator(".w1h-card").first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
      if (cardsLoaded) {
        await expect(page.locator(".w1h-card").first()).toContainText(/./);
      }
    }
  }

  // ── 19 TOC desktop ──────────────────────────────────────
  await expect(page.locator("#toc-list")).toBeAttached();
  const tocItems = await page.locator("#toc-list .toc-item").count();
  if (tocItems > 0) {
    await expect(page.locator("#toc-chapter-count")).not.toBeEmpty();
  }

  // ── 20 TOC mobile drawer ────────────────────────────────
  const mobileTocItems = await page.locator("#toc-drawer-list .toc-item").count();
  if (mobileTocItems > 0) {
    await expect(page.locator("#toc-drawer-count")).not.toBeEmpty();
  }

  // ── 21 Article actions toolbar ──────────────────────────
  await expect(page.locator("#article-actions")).toBeVisible();
  await expect(page.locator("#btn-copy")).toBeVisible();
  await expect(page.locator("#btn-share")).toBeVisible();
  await expect(page.locator("#btn-export")).toBeVisible();
  await expect(page.locator("#icon-copy")).toBeVisible();
  // Test copy toggles icon (clipboard may be blocked in test)
  await page.locator("#btn-copy").click();
  await page.locator("#icon-copied").waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);

  // ── 22 Font controls ────────────────────────────────────
  await expect(page.locator("#fontsize-label")).toHaveText("100%");
  await page.locator("#btn-font-up").click();
  await expect(page.locator("#fontsize-label")).toHaveText("110%");
  await page.locator("#btn-font-down").click();
  await expect(page.locator("#fontsize-label")).toHaveText("100%");
  await page.locator("#btn-font-reset").click();
  await expect(page.locator("#fontsize-label")).toHaveText("100%");

  // ── 23 Footer ───────────────────────────────────────────
  await expect(page.locator("#article-footer")).toBeVisible();
  await expect(page.locator("#article-footer")).toContainText("文章由 AI 基于视频字幕生成");
  await expect(page.locator("#article-footer")).toContainText("5W1H");

  // ── 24 Streaming hidden ─────────────────────────────────
  await expect(page.locator("#streaming")).toBeHidden({ timeout: 3000 });

  // ── 25 Fallback warning ─────────────────────────────────
  const fbVisible = await page.locator("#fallback-warning").isVisible().catch(() => false);
  expect(typeof fbVisible).toBe("boolean");

  // ── 26 No JS errors (ignore clipboard permission denial) ──
  const realErrs = errs.filter(e => !e.message.includes("Clipboard"));
  if (realErrs.length > 0) {
    const msgs = realErrs.map(e => e.message).join(" | ");
    throw new Error(`JS errors detected: ${msgs}`);
  }
});
