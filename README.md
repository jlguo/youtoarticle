# YouTube → AI 文章生成器

输入 YouTube 链接，AI 提取字幕并生成结构化中文文章，支持流式渲染和章节级 5W1H 摘要。

## 快速开始

```bash
npm install
node build.mjs
# 编辑 src/frontend/app.js，填入 DEEPSEEK_API_KEY / GEMINI_API_KEY
npx wrangler dev --port 34997    # http://localhost:34997
```

部署：
```bash
npx wrangler deploy
```

## 架构

```
浏览器                                     Worker (CPU ~0.5ms)
┌──────────────────────────────┐          ┌──────────────────────┐
│ 1. POST /api/generate        │ ───────→ │ extractVideoId()     │
│    { youtubeUrl }            │ ←─────── │ fetchSubtitles()     │
│                              │   JSON   │ KV cache hit/miss    │
│ 2. AI API 直连（浏览器调用） │          └──────────────────────┘
│    DeepSeek / Gemini         │
│    SSE stream → fullArticleText
│ 3. marked.parse() 渲染       │
│    rAF 节流刷新              │
│ 4. 5W1H 按钮注入 h2 章节     │
│    → 浏览器调用 AI API       │
└──────────────────────────────┘
```

**设计取舍**：AI 调用从 Worker 移至浏览器。Worker 免费计划 CPU 限制 10ms，流式 AI 处理轻松超过 2000ms。浏览器无 CPU 限制，Worker 只做字幕提取（<1ms CPU），职责单一稳定。

### Provider 选择

前端下拉菜单切换：

| Provider | URL | API 格式 |
|----------|-----|----------|
| DeepSeek | `api.deepseek.com/v1/chat/completions` | OpenAI 兼容 |
| Gemini | `generativelanguage.googleapis.com/v1/models` | Gemini REST |

API Key 嵌入前端 JS（`src/frontend/app.js`），`esbuild` 打包进 bundle。

## 字幕获取

三级回退链，静默降级：

```
youtubei.js Innertube API ──失败──→ timedtext API ──失败──→ 内置 fallback
```

- `youtubei.js` 调用 YouTube Innertube API，设置 `retrieve_player: false` 跳过视频播放器解析
- 语言选择链：`en`（可在 config.ts 中配置 `YOUTUBE_LANG_PRIORITY`）
- KV 缓存字幕结果：`sub:{videoId}`，TTL 7 天。仅缓存真实 YouTube 获取的字幕，fallback demo 字幕不缓存

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

浏览器直接调用 AI API（非流式），传入完整文章 + 章节标题，返回结构化 JSON：

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

- 摘要框折叠/展开（CSS `max-height` 过渡动画）
- 已加载的摘要缓存在 DOM 中，不重复请求
- JSON 解析容错：直接解析 → 正则剥离 markdown 代码块 → 正则匹配自由文本

## 项目结构

```
src/
├── backend/
│   ├── index.ts          # Worker 入口
│   ├── router.ts         # POST /api/generate → subtitle JSON
│   ├── config.ts         # YouTube + CORS 配置
│   └── youtube.ts        # 字幕提取 + 三级回退 + KV 缓存
├── frontend/
│   ├── app.js            # AI 客户端 + prompt + SSE 解析 + marked 渲染 + 5W1H
│   ├── app.css           # 设计 tokens + 响应式 + Markdown 样式 + 过渡动画
│   └── index.html        # 入口页面
└── fallback-subtitles/
    └── demo.ts           # Demo 视频硬编码回退字幕
```

## 技术栈

- **Runtime**: Cloudflare Workers
- **AI**: DeepSeek V4 Flash / Gemini 2.5 Flash
- **YouTube**: youtubei.js (Innertube API)
- **缓存**: Cloudflare KV（字幕，7 天 TTL）
- **前端**: Vanilla JS + CSS
- **渲染**: marked (Markdown → HTML)
- **打包**: esbuild (bundle + ESM)
- **传输**: Server-Sent Events (SSE)

## 环境变量

Worker 端无需 AI API Key（AI 调用在浏览器）。仅需：
- `SESSION_KV`: Cloudflare KV namespace ID（wrangler.toml 中配置）

## 工程取舍

| 决策 | 取舍 | 理由 |
|------|------|------|
| AI 调用 → 浏览器 | 前端暴露 API Key | Worker 免费计划 CPU 限制 10ms，无法承载流式 AI |
| 字幕获取 → 硬编码回退 | 仅 demo 视频有 fallback | 确保 demo 100% 可用，其他视频依赖网络查询 |
| Markdown 渲染 → marked 库 | 增加打包体积 ~50KB | 完整支持 h1/h2/p/strong/em/hr，比手动 DOM 更稳健 |
| 流式渲染 → rAF 节流 | 不是逐 token 实时更新 | 每个 token 重绘 DOM 无意义，rAF 节流平衡性能与感知 |
| Prompt → 双重策略 | 对话 vs 总结由 AI 判断 | 自动适配访谈类和独白类视频 |
| KV 字幕缓存 → fromFallback guard | 不缓存 demo 字幕 | 避免将非真实字幕误缓存在任意视频 ID 下 |
