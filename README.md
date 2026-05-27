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

## 架构

```
浏览器                                          Worker (CPU ~0.8ms)
┌──────────────────────────────────┐           ┌─────────────────────────────┐
│ POST /api/generate               │ ────────→ │ extract subtitle → AI fetch  │
│ { youtubeUrl, rule? }            │ ←──────── │ return raw SSE (passthrough) │
│                                  │    SSE    │                              │
│ regex parse SSE → feedContent()  │           │ POST /api/5w1h               │
│ → marked.parse() → DOM           │ ────────→ │ build prompt → AI fetch      │
│                                  │ ←──────── │ return raw JSON (passthrough)│
│ rAF 节流刷新 + 5W1H 按钮注入     │    JSON   │                              │
└──────────────────────────────────┘           └─────────────────────────────┘
```

AI API Key 存于 Worker secrets，前端不暴露。Worker 对 AI 响应不做任何解析 — `fetch()` + `return new Response(body)` 纯透传，CPU ~0.8ms，免费计划 10ms 限制内稳定运行。

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

- 语言选择：`en`（`config.ts` → `YOUTUBE_LANG_PRIORITY`）
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
- 流式更新通过 `requestAnimationFrame` 节流
- `onStreamComplete` 取消待定 rAF，最终渲染后注入 5W1H 按钮
- 5W1H 按钮与章节标题基线对齐，`font-size: inherit` 同高

## 5W1H 摘要

每个章节旁注入 `[5W1H]` 按钮，点击后由 Worker 调用 AI API，提取该章节在整篇文章上下文中的结构化总结：

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

- 摘要框折叠/展开（CSS `max-height` 过渡动画），已加载的摘要缓存在 DOM 中不重复请求
- JSON 解析容错：直接解析 → 正则剥离 markdown 代码块 → 匹配自由文本

## 项目结构

```
src/
├── backend/
│   ├── index.ts          # Worker 入口
│   ├── router.ts         # POST /api/generate + /api/5w1h（含 AI 透传）
│   ├── config.ts         # YouTube + AI + CORS 配置
│   ├── youtube.ts        # 字幕提取 + 三级回退 + KV 缓存
│   ├── deepseek.ts       # DeepSeek API 透传（OpenAI 兼容 SSE）
│   ├── gemini.ts         # Gemini API 透传（REST SSE + NDJSON）
│   └── prompts.ts        # Prompt 模板（对话/总结双策略）
├── frontend/
│   ├── app.js            # SSE 解析 + marked 渲染 + rAF 节流 + 5W1H
│   ├── app.css           # 设计 tokens + Markdown 样式 + 响应式 + 动画
│   └── index.html        # 入口页面
└── fallback-subtitles/
    └── demo.ts           # Demo 视频硬编码回退字幕
```

## 技术栈

- **Runtime**: Cloudflare Workers
- **AI**: DeepSeek V4 Flash + Gemini 2.5 Flash（透传模式，Worker 零解析）
- **YouTube**: youtubei.js (Innertube API)
- **缓存**: Cloudflare KV（字幕缓存，7 天 TTL）
- **前端**: Vanilla JS + CSS
- **渲染**: marked (Markdown → HTML)
- **打包**: esbuild (bundle + ESM)
- **传输**: Server-Sent Events (SSE)

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
| AI 调用 → Worker 透传 | 多一跳额外延迟 ~30ms | API Key 存于 Worker secrets，前端不暴露 |
| Worker AI 处理 → 纯透传 | 无法缓冲/拦截 AI 流 | `fetch()` + `return new Response(body)` = 零 CPU，免费计划安全 |
| 5W1H 上下文 → 前端传全文 | 轻微增加请求体积 | 透传架构下 Worker 不保存生成上下文，AI 需完整文章做分析 |
| 字幕获取 → 硬编码回退 | 仅 demo 视频有 fallback | 三级回退链确保 demo 100% 可用，其他视频依赖实时查询 |
| Markdown 渲染 → marked 库 | 增加打包体积 ~50KB | 完整支持 h1/h2/p/strong/em/hr，比手动 DOM 更稳健 |
| 流式渲染 → rAF 节流 | 不是逐 token 实时更新 | 每个 token 重绘 DOM 无意义，rAF 节流平衡性能与感知 |
| Prompt → 双重策略 | 对话 vs 总结由 AI 判断 | 自动适配访谈类和独白类视频 |
| KV 字幕缓存 → fromFallback guard | 不缓存 demo 字幕 | 避免将非真实字幕误缓存在任意视频 ID 下 |

## 已知局限

1. **YouTube 实时字幕提取不稳定。** Cloudflare Workers 出口 IP 被 YouTube 反爬，多数方案失败，仅 `caption_tracks` 部分可用，否则降级至 demo。详见上节「字幕获取」。

2. **CPU 使用率仍需持续优化。** 当前透传架构已将 Worker CPU 降至 ~0.8ms，稳定运行于免费计划。但前端 SSE 解析（`TextDecoder`、正则匹配）受设备性能影响，后续可评估更高效的流处理方案或将 AI 中转完全外移。
