// Style feature tests — verifies all 8 style features from feature_list.json
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:34997';
const DEMO_URL = 'https://youtu.be/xRh2sVcNXQ8';

let passed: number = 0;
let failed: number = 0;

function pass(msg: string): void { console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`); passed++; }
function fail(msg: string, detail: string): void { console.log(`  \x1b[31mFAIL\x1b[0m  ${msg} — ${detail}`); failed++; }

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // =========================================================================
    // Style #1: Design tokens — #2563eb, #ffffff, #111827
    // =========================================================================
    console.log('\n=== Style #1: Design Tokens ===');
    const btnBg = await page.$eval('.btn-primary', el => getComputedStyle(el).backgroundColor) as string;
    if (btnBg === 'rgb(37, 99, 235)') pass('Primary button color is #2563eb');
    else fail('Primary color', btnBg);

    const bodyBg = await page.$eval('body', el => getComputedStyle(el).backgroundColor) as string;
    if (bodyBg === 'rgb(255, 255, 255)') pass('Page background is #ffffff');
    else fail('Background', bodyBg);

    const bodyColor = await page.$eval('body', el => getComputedStyle(el).color) as string;
    if (bodyColor === 'rgb(17, 24, 39)') pass('Body text color is #111827');
    else fail('Text color', bodyColor);

    // =========================================================================
    // Style #2: Typography — system-ui, 16px, 1.8 line-height
    // =========================================================================
    console.log('\n=== Style #2: Typography ===');
    const fontFamily = await page.$eval('body', el => getComputedStyle(el).fontFamily) as string;
    if (fontFamily.includes('system-ui')) pass('Font family is system-ui, sans-serif');
    else fail('Font family', fontFamily);

    const fontSize = await page.$eval('body', el => getComputedStyle(el).fontSize) as string;
    if (fontSize === '16px') pass('Base font size is 16px');
    else fail('Font size', fontSize);

    const lineHeight = await page.$eval('body', el => getComputedStyle(el).lineHeight) as string;
    // 1.8 * 16 = 28.8px
    if (lineHeight === '28.8px') pass('Line height is 1.8 (28.8px at 16px)');
    else fail('Line height', lineHeight);

    // =========================================================================
    // Style #3: Input elements — rounded, light gray bg, focus ring
    // =========================================================================
    console.log('\n=== Style #3: Input Elements ===');
    const borderRadius = await page.$eval('.url-input', el => getComputedStyle(el).borderRadius) as string;
    // border-radius: 8px -> '8px'
    if (borderRadius !== '0px') pass(`Input has border-radius (${borderRadius})`);
    else fail('Border radius', borderRadius);

    const inputBg = await page.$eval('.url-input', el => getComputedStyle(el).backgroundColor) as string;
    // #f9fafb = rgb(249, 250, 251)
    if (inputBg === 'rgb(249, 250, 251)') pass('Input background is light gray (#f9fafb)');
    else fail('Input background', inputBg);

    // Focus the input and check for focus ring
    await page.focus('.url-input');
    await page.waitForTimeout(200);
    const focusOutline = await page.$eval('.url-input', el => getComputedStyle(el).outlineStyle) as string;
    if (focusOutline !== 'none') pass('Input has visible focus outline');
    else {
      const boxShadow = await page.$eval('.url-input', el => getComputedStyle(el).boxShadow) as string;
      if (boxShadow !== 'none') pass('Input has focus ring (box-shadow)');
      else fail('Focus ring', 'no outline or box-shadow on focus');
    }

    // =========================================================================
    // Style #4: Button hover + disabled state
    // =========================================================================
    console.log('\n=== Style #4: Buttons ===');
    // Hover state — move mouse over button
    const btnBefore = await page.$eval('.btn-primary', el => getComputedStyle(el).backgroundColor) as string;
    await page.hover('.btn-primary');
    await page.waitForTimeout(200);
    const btnHover = await page.$eval('.btn-primary', el => getComputedStyle(el).backgroundColor) as string;
    if (btnHover !== btnBefore) pass('Button hover state changes background color');
    else fail('Hover state', 'no color change on hover');

    // Disabled state — click generate with empty URL to trigger validation (doesn't disable)
    // Actually trigger generation to test disabled state
    await page.fill('#youtube-url', DEMO_URL);
    await page.selectOption('#ai-provider', 'deepseek');
    await page.click('#generate-btn');
    await page.waitForTimeout(500);

    const isDisabled = await page.$eval('#generate-btn', el => (el as HTMLButtonElement).disabled) as boolean;
    const disabledBg = await page.$eval('#generate-btn', el => getComputedStyle(el).backgroundColor) as string;
    const disabledCursor = await page.$eval('#generate-btn', el => getComputedStyle(el).cursor) as string;

    if (isDisabled) pass('Generate button is disabled during generation');
    else fail('Disabled state', 'button not disabled');

    if (disabledBg === 'rgb(156, 163, 175)') pass('Disabled button color is #9ca3af (grayed out)');
    else fail('Disabled color', disabledBg);

    if (disabledCursor === 'not-allowed') pass('Disabled button cursor is not-allowed');
    else fail('Disabled cursor', disabledCursor);

    // Wait for completion to clean up
    try {
      await page.waitForFunction(() => {
        const btn = document.getElementById('generate-btn');
        return btn && !(btn as HTMLButtonElement).disabled;
      }, { timeout: 120000 });
    } catch { /* continue */ }

    // =========================================================================
    // Style #5: Chapter headings — comfortable margin, no borders
    // =========================================================================
    console.log('\n=== Style #5: Chapter Headings ===');
    const h2Count = await page.$$eval('.chapter-heading-row h2', els => els.length) as number;
    if (h2Count > 0) {
      const h2Margin = await page.$eval('.chapter-heading-row', el => getComputedStyle(el).marginTop) as string;
      const marginPx = parseInt(h2Margin) || 0;
      if (marginPx >= 20) pass(`Chapter heading top margin >= 20px (${h2Margin})`);
      else fail('Chapter heading margin', h2Margin);

      // Verify no border on chapter elements
      const borderStyle = await page.$eval('.chapter-heading-row', el => getComputedStyle(el).borderTopStyle) as string;
      if (borderStyle === 'none') pass('Chapter heading row has no border');
      else fail('Chapter border', `has border: ${borderStyle}`);
    } else {
      fail('Chapter headings', 'no .chapter-heading-row found');
    }

    // Verify no .chapter-block elements
    const blockCount = await page.$$eval('.chapter-block', els => els.length) as number;
    if (blockCount === 0) pass('No .chapter-block border boxes present');
    else fail('Chapter blocks', `${blockCount} .chapter-block elements exist`);

    // =========================================================================
    // Style #6: 5W1H summary box — light gray bg, distinct
    // =========================================================================
    console.log('\n=== Style #6: 5W1H Summary Box ===');
    const btn5w1hCount = await page.$$eval('.btn-5w1h', els => els.length) as number;
    if (btn5w1hCount > 0) {
      await page.click('.btn-5w1h');
      try { await page.waitForSelector('.summary-box.open', { timeout: 30000 }); } catch {}

      const summaryBg = await page.$eval('.summary-header', el => getComputedStyle(el).backgroundColor) as string;
      const articleBg = await page.$eval('#result', el => getComputedStyle(el).backgroundColor) as string;

      if (summaryBg !== articleBg) pass('Summary box background differs from article background');
      else fail('Summary bg', `same as article: ${summaryBg}`);
    } else {
      fail('5W1H buttons', 'none found to test');
    }

    // =========================================================================
    // Style #7: Smooth transitions on summary expand/collapse
    // =========================================================================
    console.log('\n=== Style #7: Summary Transitions ===');
    const summaryBox = await page.$('.summary-box');
    if (summaryBox) {
      const transition = await page.$eval('.summary-box', el => getComputedStyle(el).transitionProperty) as string;
      if (transition !== 'none' && transition !== 'all') pass(`Summary box has CSS transition (${transition})`);
      else fail('Transition', transition);
    } else {
      fail('Summary box', 'not found');
    }

    // =========================================================================
    // Style #8: Responsive layout (mobile 375px, desktop 1024px)
    // =========================================================================
    console.log('\n=== Style #8: Responsive Layout ===');

    // Mobile: 375px
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForTimeout(300);
    const mobileNoOverflow = await page.$eval('body', el => el.scrollWidth <= window.innerWidth + 5) as boolean;
    if (mobileNoOverflow) pass('Mobile (375px): no horizontal overflow');
    else fail('Mobile overflow', 'horizontal scrollbar');

    const mobileBtnWidth = await page.$eval('.btn-primary', el => (el as HTMLElement).offsetWidth) as number;
    if (mobileBtnWidth <= 375) pass('Mobile: button fits within viewport');
    else fail('Mobile button', `width: ${mobileBtnWidth}px`);

    // Desktop: 1024px
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(300);
    const containerWidth = await page.$eval('.container', el => (el as HTMLElement).offsetWidth) as number;
    if (containerWidth <= 1024 && containerWidth > 0) pass(`Desktop (1024px): container ${containerWidth}px fits`);
    else fail('Desktop container', `width: ${containerWidth}px`);

    const desktopNoOverflow = await page.$eval('body', el => el.scrollWidth <= window.innerWidth + 5) as boolean;
    if (desktopNoOverflow) pass('Desktop (1024px): no horizontal overflow');
    else fail('Desktop overflow', 'horizontal scrollbar');

  } catch (e) {
    const err = e as Error;
    console.error('Test error:', err.message);
    fail('Test script', err.message);
  } finally {
    await browser.close();
  }

  const total = passed + failed;
  console.log(`\n=========================================`);
  console.log(`  Style Tests: ${passed}/${total} passed`);
  console.log(`  Pass: ${passed}  Fail: ${failed}`);
  console.log(`=========================================`);
  if (failed > 0) process.exit(1);
}

main();
