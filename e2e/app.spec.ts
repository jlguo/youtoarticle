import { test, expect, type Page } from "@playwright/test";

const DEMO_URL = "https://www.youtube.com/watch?v=xRh2sVcNXQ8";

type Provider = "gemini" | "deepseek";
const PROVIDER: Provider = (process.env.E2E_PROVIDER || "gemini") as Provider;

// ── Mock SSE chunks ──

const GEMINI_SSE_CHUNKS = [
  'data: {"candidates":[{"content":{"parts":[{"text":"# 测试文章：AI 革命\\n\\n"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"## 第一章：智能经济的崛起\\n\\n"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"人工智能正在以前所未有的速度改变世界。从消费者市场到企业应用，"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"AI 技术正在重塑每一个行业。"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"\\n\\n## 第二章：成本塌陷与收入爆发\\n\\n"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"随着 GPU 供给改善，AI 服务的单位成本正在快速下降，"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"但收入却呈现爆发式增长。"}]}}]}\n\n',
  'data: [DONE]\n\n',
];

const DEEPSEEK_SSE_CHUNKS = [
  'data: {"id":"1","choices":[{"delta":{"content":"# 测试文章：AI 革命\\n\\n"}}]}\n\n',
  'data: {"id":"2","choices":[{"delta":{"content":"## 第一章：智能经济的崛起\\n\\n"}}]}\n\n',
  'data: {"id":"3","choices":[{"delta":{"content":"人工智能正在以前所未有的速度改变世界。从消费者市场到企业应用，"}}]}\n\n',
  'data: {"id":"4","choices":[{"delta":{"content":"AI 技术正在重塑每一个行业。"}}]}\n\n',
  'data: {"id":"5","choices":[{"delta":{"content":"\\n\\n## 第二章：成本塌陷与收入爆发\\n\\n"}}]}\n\n',
  'data: {"id":"6","choices":[{"delta":{"content":"随着 GPU 供给改善，AI 服务的单位成本正在快速下降，"}}]}\n\n',
  'data: {"id":"7","choices":[{"delta":{"content":"但收入却呈现爆发式增长。"}}]}\n\n',
  'data: [DONE]\n\n',
];

// ── Mock 5W1H data ──

const MOCK_5W1H_DATA = {
  who: "Mark Anderson",
  what: "AI 行业的收入增长、商业模式和成本下降趋势",
  when: "当前 AI 商业化早期，未来十年",
  where: "消费者 AI 市场、企业 AI 市场",
  why: "AI 依托互联网快速触达用户，为个人和企业创造效率提升和成本优化",
  how: "通过消费者订阅、企业按需计费和基于价值的变现方式",
};

function sseChunks(provider: Provider): string[] {
  return provider === "deepseek" ? DEEPSEEK_SSE_CHUNKS : GEMINI_SSE_CHUNKS;
}

function w1hResponseBody(provider: Provider): string {
  const inner = JSON.stringify(MOCK_5W1H_DATA);
  if (provider === "deepseek") {
    return JSON.stringify({ choices: [{ message: { content: inner } }] });
  }
  return JSON.stringify(MOCK_5W1H_DATA);
}

async function mockRoutes(page: Page, provider: Provider) {
  await page.route("**/api/generate*", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Session-Id": `e2e-session-${provider}`,
      },
      body: sseChunks(provider).join(""),
    });
  });

  await page.route("**/api/5w1h*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: w1hResponseBody(provider),
    });
  });
}

test.describe(`YouTube Article Generator E2E [${PROVIDER}]`, () => {
  test.beforeEach(async ({ page }) => {
    await mockRoutes(page, PROVIDER);
  });

  test("page loads with all form elements", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-title")).toHaveText("YouTube 文章生成器");
    await expect(page.locator("#youtube-url")).toBeVisible();
    await expect(page.locator("#custom-rules")).toBeVisible();
    await expect(page.locator("#ai-provider")).toBeVisible();
    await expect(page.locator("#generate-btn")).toBeVisible();
  });

  test("shows error for empty YouTube URL", async ({ page }) => {
    await page.goto("/");
    await page.locator("#generate-btn").click();
    await expect(page.locator("#url-error")).toHaveText("请输入 YouTube 链接");
  });

  test("shows error for invalid URL format", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill("not-a-valid-url");
    await page.locator("#generate-btn").click();
    await expect(page.locator("#url-error")).toContainText("请输入有效的 YouTube 链接");
  });

  test("accepts youtube.com/watch URL format", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#youtube-url").blur();
    await expect(page.locator("#url-error")).toHaveText("");
  });

  test("generates article and renders h1 and h2 headings", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();

    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });
    await expect(page.locator("#result h2")).toHaveCount(2);
    await expect(page.locator("#result h2").nth(0)).toHaveText(/智能经济的崛起/);
    await expect(page.locator("#result h2").nth(1)).toHaveText(/成本塌陷与收入爆发/);
    await expect(page.locator("#generate-btn")).toBeEnabled();
  });

  test("5W1H button appears next to each chapter heading", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();
    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });

    const buttons = page.locator(".btn-5w1h");
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveText("5W1H");
  });

  test("clicking 5W1H button fetches and displays summary", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();
    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });

    await page.locator(".btn-5w1h").first().click();
    await expect(page.locator(".summary-box.open")).toBeVisible({ timeout: 5_000 });

    const body = page.locator(".summary-body").first();
    await expect(body).toContainText("Mark Anderson");
    await expect(body).toContainText("AI 行业的收入增长");
  });

  test("5W1H summary toggles open/close on header click", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();
    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });

    await page.locator(".btn-5w1h").first().click();
    await expect(page.locator(".summary-box.open")).toBeVisible({ timeout: 5_000 });

    await page.locator(".summary-header").first().click();
    await expect(page.locator(".summary-box.open")).toHaveCount(0);
  });

  test("enter key submits the form", async ({ page }) => {
    await page.goto("/");
    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#youtube-url").press("Enter");

    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });
    await expect(page.locator("#result h2")).toHaveCount(2);
  });

  test("result area clears and repopulates on second generation", async ({ page }) => {
    await page.goto("/");

    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();
    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });

    await page.locator("#youtube-url").fill(DEMO_URL);
    await page.locator("#generate-btn").click();
    await expect(page.locator("#result h1")).toHaveText("测试文章：AI 革命", { timeout: 10_000 });
  });
});
