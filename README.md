# YouTube → AI 文章生成器

输入 YouTube 链接，AI 提取字幕并生成结构化中文文章，支持流式渲染和章节级 5W1H 摘要。

## 快速开始

```bash
npm install
node build.mjs
# 通过 wrangler secret 设置 API Key（见下方环境变量）
npx wrangler dev --port 34997    # http://localhost:34997
```

部署：
```bash
npx wrangler deploy
```

测试：
```bash
npm test              # 单元测试（57 个）
npm run test:e2e      # E2E 测试（默认 Gemini）
E2E_PROVIDER=deepseek npm run test:e2e   # E2E 切换 DeepSeek
```

## 架构

```
浏览器                                                Worker
┌──────────────────────────────────┐             ┌──────────────────────────────┐
│ POST /api/generate               │ ──────────→ │ extract subtitle → AI fetch  │
│ { youtubeUrl, rule? }            │ ←────────── │ tee SSE → KV save (后台)     │
│                                  │  SSE + sid  │                              │
│ JSON.parse → feedContent()       │             │ POST /api/5w1h               │
│ → marked.parse() → DOM           │ ──────────→ │ KV read → AI fetch           │
│                                  │ ←────────── │ return JSON (passthrough)    │
│ rAF 节流 + 5W1H 按钮注入         │    JSON     │                              │
└──────────────────────────────────┘             └──────────────────────────────┘
```

AI API Key 存于 Worker secrets，前端不暴露。Worker 对 AI 响应采用单 reader 流包装：透传原始字节给客户端的同时解析 SSE 累积文章全文，流结束后异步存入 KV（1 小时 TTL），供 5W1H 摘要使用。前端 5W1H 请求仅需传 `sessionId + chapter`，不再重新提交整篇文章。

## 字幕获取

三级回退链，静默降级：

```
youtubei.js Innertube API ──失败──→ timedtext API ──失败──→ 内置 fallback
```

YouTube 对 Cloudflare Workers IP 段严格反爬。以下方案均经过测试：

| 方案 | 方法 | 结果 |
|------|------|------|
| Innertube API 直连 | `youtubei.js` Web 客户端 | 200 但无字幕数据 |
| Innertube IOS/ANDROID | 切换客户端上下文 | HTTP 400 |
| timedtext API 直连 | `youtube.com/api/timedtext` | 超时 |
| TCP Socket + Webshare 代理 | `cloudflare:sockets` → CONNECT 隧道 → TLS | SNI 阻断，握手挂起 |
| youtubei.js `getTranscript()` | Transcript API | HTTP 400 |
| youtubei.js `caption_tracks` | XML 字幕轨道解析 | ⚠️ 部分视频成功 |

**最终方案**：`caption_tracks` + 硬编码 demo 构成三级回退，无法获取真实字幕时自动降级至 `fallback-subtitles/demo.ts`。

- KV 缓存：`sub:{videoId}`，TTL 7 天，仅缓存真实字幕（`fromFallback` guard）

## 文章生成 Prompt

**默认模式**（无自定义规则）：

```
1. 如果能识别出不同说话人：
   - 使用 ## 话题概括 作为章节标题
   - 以对话形式编排 ——「说话人：发言内容」

2. 如果不能区分说话人：
   - 按主题分段，精炼总结核心内容（不逐字保留）

统一：Markdown 格式，# 一级标题，非中文先翻译
```

**自定义模式**（填写规则）：系统 prompt 追加用户要求，AI 严格遵循。

## 前端渲染

- `marked` 库解析 Markdown → HTML
- 流式更新通过 `requestAnimationFrame` 节流，`renderedLen` 跟踪跳过冗余重解析
- `JSON.parse()` 解析 SSE 数据行（Gemini `candidates[].content.parts[].text` / DeepSeek `choices[].delta.content`）
- `onStreamComplete` 取消待定 rAF，最终渲染后注入 5W1H 按钮

## 5W1H 摘要

每个章节旁注入 `[5W1H]` 按钮，点击后由 Worker 读取 KV 中缓存的文章全文并调用 AI API 生成结构化总结：

```json
{
  "who": "涉及的人物或角色",
  "what": "核心事件或主题",
  "when": "时间背景",
  "where": "地点或场景",
  "why": "原因或动机",
  "how": "实现方式或过程"
}
```

- 会话管理：`POST /api/generate` 返回 `X-Session-Id`，文章全文在 Worker 端通过 SSE 流 tee 累积并存入 KV（`article:{sessionId}`，TTL 24 小时）
- 5W1H 请求仅需 `{ sessionId, chapter }`，前端不再重新提交整篇文章内容
- 摘要框折叠/展开（CSS `max-height` 过渡动画），已加载的摘要缓存在 DOM 中不重复请求

## 项目结构

```
src/
├── backend/
│   ├── index.ts          # Worker 入口（8 行，纯委托）
│   ├── router.ts         # 路由分发 + provider 选择 + session 管理
│   ├── config.ts         # 集中常量（YouTube / AI / KV / CORS）
│   ├── youtube.ts        # 字幕提取 + 三级回退 + KV 缓存
│   ├── gemini.ts         # Gemini API 客户端（stream + non-stream）
│   ├── deepseek.ts       # DeepSeek API 客户端（stream + non-stream）
│   ├── prompts.ts        # Prompt 模板（常量共享，Gemini/DeepSeek 格式分离）
│   ├── tee.ts            # SSE 流 tee：透传 + 累积全文 + KV 存储
│   ├── api-client.ts     # 共享 AI 响应包装（corsResponse / errorResponse）
│   ├── response.ts       # 通用 HTTP 响应（jsonResponse / corsHeaders）
│   └── validation.ts     # 请求体验证（parseJSONBody / getStringField）
├── frontend/
│   ├── app.js            # SSE 解析 + marked 渲染 + rAF 节流 + 5W1H
│   ├── app.css           # 设计 tokens + Markdown 样式 + 响应式 + 动画
│   └── index.html        # 入口页面
├── fallback-subtitles/
│   └── demo.ts           # Demo 视频硬编码回退字幕
├── __tests__/            # 单元测试（vitest）
│   ├── tee.test.ts       # 流 tee / KV 保存 / 双 reader 防护
│   ├── youtube.test.ts   # URL 解析
│   ├── prompts.test.ts   # Prompt 模板
│   ├── validation.test.ts # 输入校验
│   └── router.test.ts    # 路由 / 错误处理 / provider 选择
└── e2e/                  # E2E 测试（Playwright）
    └── app.spec.ts       # 完整用户流程（支持 Gemini / DeepSeek 切换）
```

## 技术栈

- **Runtime**: Cloudflare Workers
- **AI**: DeepSeek V4 Flash + Gemini 2.5 Flash
- **YouTube**: youtubei.js (Innertube API)
- **存储**: Cloudflare KV（字幕缓存 7 天 + 文章会话 24 小时）
- **前端**: Vanilla JS + CSS
- **渲染**: marked (Markdown → HTML)
- **打包**: esbuild (bundle + ESM)
- **传输**: Server-Sent Events (SSE)
- **测试**: vitest（单元 57 个）+ Playwright（E2E 10 个）

## 测试

```bash
npm test              # 单元测试（vitest，57 个用例）
npm run test:e2e      # E2E 测试（Playwright，默认 Gemini mock）
npm run test:all      # 全部测试
```

E2E 测试通过 `page.route()` 拦截 API 请求，返回模拟的 SSE 流和 JSON 响应，不依赖真实 AI API。通过 `E2E_PROVIDER` 环境变量切换 Gemini / DeepSeek mock 格式：

```bash
E2E_PROVIDER=deepseek npm run test:e2e   # 使用 DeepSeek 格式
```

## 环境变量

Worker 端需通过 `wrangler secret` 设置 AI API Key：

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | Gemini API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（可选，缺省时回退 Gemini） |

KV namespace 在 `wrangler.toml` 中配置（`SESSION_KV`）。

## 工程取舍

| 决策 | 取舍 | 理由 |
|------|------|------|
| AI 调用 → Worker 中转 | 多一跳额外延迟 ~30ms | API Key 存于 Worker secrets，前端不暴露 |
| SSE 流 → 单 reader tee | Worker CPU 略增（解析 SSE） | 无需 `tee()` 双 reader，避免"locked to a reader"错误；累积全文后存入 KV 实现会话级 5W1H |
| 5W1H 上下文 → KV 会话存储 | 增加 KV 写入操作 | 前端仅传 `sessionId`，不再重新提交整篇文章；符合题目"不得由前端重新提交"要求 |
| 字幕获取 → 硬编码回退 | 仅 demo 视频有 fallback | 三级回退链确保 demo 100% 可用，其他视频依赖实时查询 |
| Markdown 渲染 → marked 库 | 增加打包体积 ~50KB | 完整支持 h1/h2/p/strong/em/hr，比手动 DOM 更稳健 |
| 流式渲染 → rAF 节流 + renderedLen | 不是逐 token 实时更新 | 跳过冗余重解析，平衡性能与感知 |
| Prompt → 双重策略 | 对话 vs 总结由 AI 判断 | 自动适配访谈类和独白类视频 |
| KV 字幕缓存 → fromFallback guard | 不缓存 demo 字幕 | 避免将非真实字幕误缓存在任意视频 ID 下 |
| 多 Provider → Gemini/DeepSeek 双支持 | 需维护两套 API 格式 | `?provider=` query param 切换，DeepSeek key 缺省时自动回退 Gemini |
| 测试 → vitest + Playwright | 增加 CI 时间 | 57 个单元测试 + 10 个 E2E 覆盖核心路径和边界条件 |

## 已知局限

1. **YouTube 实时字幕提取不稳定。** Cloudflare Workers 出口 IP 被 YouTube 反爬，多数方案失败，仅 `caption_tracks` 部分可用，否则降级至 demo。详见上节「字幕获取」。

2. **CPU 使用率。** 透传 + tee 架构下 Worker CPU 保持在免费计划 10ms 限制内。tee 模块通过单 reader `ReadableStream` 同时做透传和 SSE 解析，避免 `tee()` 的双 reader 开销。

3. **Session 过期。** 文章 KV 缓存 TTL 24 小时。过期后 5W1H 请求返回 404，需重新生成文章。用户停留页面超过 24 小时后点击 5W1H 会遇到此情况。
