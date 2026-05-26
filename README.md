# YouTube → AI 文章生成器

输入 YouTube 链接，AI 自动提取字幕并生成结构化的中文文章，支持实时流式输出和章节级 5W1H 摘要。

## 快速开始

```bash
cp .dev.vars.example .dev.vars   # 填入 API Key
npm install
node build.mjs
npx wrangler dev --port 34997    # http://localhost:34997
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | Gemini API Key（生产环境默认） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（本地开发，可选。设置后自动优先使用） |
| `WEBSHARE_PROXY_HOST` | Webshare 代理 IP（YouTube 反爬备用） |
| `WEBSHARE_PROXY_PORT` | Webshare 代理端口 |
| `WEBSHARE_PROXY_USERNAME` | 代理用户名 |
| `WEBSHARE_PROXY_PASSWORD` | 代理密码 |

### AI Provider 选择

系统通过环境变量自动检测 AI provider：

- **DeepSeek 优先**：设置 `DEEPSEEK_API_KEY` 后所有 AI 调用自动路由到 DeepSeek（OpenAI 兼容接口，`stream: true`）
- **Gemini 默认**：未设置 DeepSeek 时使用 Gemini `generateContentStream()` / `generateContent()`
- 两种 provider 共用同一套 prompt 模板（`prompts.ts` 同时导出纯文本和 chat messages 格式）

> 本地开发推荐使用 DeepSeek——免费额度充足，且 WSL/workerd 可直接访问（Gemini 在 WSL 的 workerd 中存在网络连接问题）。

---

## 核心流程

### 1. YouTube 字幕获取与处理

**三级回退链**，每一级静默降级，服务永不断裂：

```
youtubei.js 直连 ──失败──→ Webshare TCP 代理 ──失败──→ 内置硬编码字幕
```

#### 第一级：youtubei.js 直连

通过 [youtubei.js](https://github.com/LuanRT/YouTube.js) 调用 YouTube Innertube API：

1. `Innertube.create()` — 创建会话，传入自定义 `fetch` 函数（设置 `AbortSignal.timeout(5000ms)` 防止在受限环境中无限挂起）
2. `getInfo(videoId)` — 获取视频元数据
3. `getTranscript()` — 优先尝试 Transcript API（结构化分段数据）
4. 失败则回退到 `captions.caption_tracks`（XML 字幕轨道）

语言选择链：`zh-Hans → zh-CN → zh → en → 第一个可用语言`。

#### 第二级：Webshare TCP Socket 代理

当 youtubei.js 直连触发验证码/反爬时，通过 Cloudflare Workers 的 `cloudflare:sockets connect()` 建立 TCP 隧道：

```
Worker ──TCP──→ Webshare 代理 ──CONNECT──→ YouTube:443 ──TLS──→ timedtext API
```

- 使用 HTTP CONNECT 方法建立隧道
- 通过 `startTls()` 升级为 HTTPS 连接
- 支持 Basic Proxy-Authorization 认证
- 当前端口 5863（受限于免费 Webshare 计划），可切换到 443/80 等标准端口以兼容 Workers Free 计划的端口限制

#### 第三级：硬编码回退字幕

`src/fallback-subtitles/demo.txt` 包含 demo 视频（`xRh2sVcNXQ8`）对应的中文内容。当所有网络路径均失败时加载，确保 100% 可用。

#### 字幕清洗

`stripTimestamps()` + `parseXMLSubtitle()`：
- 移除 SRT/WebVTT 时间戳格式（`00:00:01,000 --> 00:00:03,500`）
- 清除独立的数字索引行
- 解析 YouTube XML 字幕格式（`<text start="0.0">...</text>`）
- 解码 HTML 实体（`&amp;` → `&`）
- 输出纯文本，多个空格合并为一个，trim 首尾空白

**工程取舍**：不使用 Puppeteer/浏览器自动化来绕过验证码——太重（~300MB 镜像），不符合 Workers 资源限制。TCP Socket 代理更轻量，且可复用 Worker 的 TLS 能力。

---

### 2. AI 流式输出

#### Gemini 路径（生产）

```
Gemini generateContentStream()
  ↓ NDJSON 分块
Server 解析 candidates[0].content.parts[0].text
  ↓ 重新封装为 clean SSE
前端 ReadableStream → appendTextContent() → DOM 增量渲染
```

- Gemini 返回 NDJSON 格式的 SSE 流，每个 chunk 包含 `candidates[0].content.parts[0].text`
- Server 端解析后重新封装为干净的 `data: {text}\n\n` 格式，统一前后端协议
- 遇到解析失败的行静默跳过，不中断流

#### DeepSeek 路径（本地开发）

```
DeepSeek chat/completions (stream: true)
  ↓ OpenAI SSE 格式
Server 解析 choices[0].delta.content
  ↓ 分割 \n → 空 payload 换行标记
前端 ReadableStream → 换行标记转回 \n → appendTextContent() → DOM 增量渲染
```

- DeepSeek 使用 OpenAI 兼容的 SSE 格式，每个 chunk 包含 `choices[0].delta.content`
- **关键实现细节**：SSE 协议用 `\n\n` 作为消息分隔符。DeepSeek 生成的内容中包含 `\n`（段落换行），若直接放入 SSE payload 会破坏消息边界。解决方案：server 端将内容按 `\n` 分割，用空 payload（`data: \n\n`）作为换行标记；前端将空 payload 转换为 `\n` 追加到行缓冲，触发增量 Markdown 解析器逐行渲染

#### 增量 Markdown 解析器

前端采用行级增量渲染策略：

1. 接收到的文本累积到 `fullTextBuffer`
2. 检测完整行（必须包含 `\n`）：只渲染已完成的"行"
3. 行级匹配：`# ` → `<h1>`，`## ` → `<h2>` + 5W1H 按钮，空行 → 跳过长段落 → `<p>`
4. 未完成的行保留在 buffer 中，等待后续 chunk 补全
5. 流结束时调用 `flushPartialLine()` 强制渲渲染最后一行

**工程取舍**：不引入第三方 Markdown 库（如 marked）。行级正则匹配足够覆盖 # / ## / 段落三种元素，且每个 chunk 只需 O(n) 的字符串操作。第三方库需要解析完整文档，无法增量工作。

---

### 3. 自定义生成要求

用户可在输入框中填写自然语言指令（`rule` 参数），影响 AI 文章的风格和内容。

#### Prompt 注入策略

- Gemini 路径：在 system prompt 末尾追加 `"遵循以下用户要求：${rule}"`
- DeepSeek 路径：在 system message 中追加相同指令
- `rule` 为可选参数——不传则使用默认 prompt

#### 常见用法

| 规则示例 | 效果 |
|----------|------|
| `用儿童能理解的语言，简短回答` | 输出用词简单、句子简短，避免专业术语 |
| `受众：技术专家，深入分析技术原理` | 输出偏向技术深度，保留英文术语 |
| `生成一篇新闻稿风格的报道` | 输出采用正式新闻语体，客观中立 |
| `强调商业价值分析和数据` | 输出偏重商业模式、市场规模和量化指标 |

**工程取舍**：不使用复杂的多轮对话或 RAG 架构。对于 MVP，单次 prompt 注入足够验证"自定义规则影响输出"这一核心假设。规则以自由文本形式传递而非结构化字段（如 `audience`, `style`, `tone`），给用户最大的表达自由度。

---

### 4. 章节级 5W1H 总结

#### 章节检测

前端增量解析器在流式渲染过程中实时识别 `## ` 开头的行，自动注入 `[5W1H]` 按钮。每个章节标题规范化（去除首尾空白）后作为唯一标识存储。

#### 无重传架构

```
[5W1H] 点击
  ↓ POST /api/5w1h { sessionId, chapter }
Server 从 KV 读取 session → 获取 fullText
  ↓ Gemini/DeepSeek generateContent（全文 + 章节标题）
{ who, what, when, where, why, how } → 前端渲染
```

- 客户端不重传全文——只发送 `sessionId` + `chapter` 标题（~75 bytes）
- Server 通过 `session:{sessionId}` key 从 Cloudflare KV 中检索完整的文章内容
- 将全文作为上下文传入 AI，生成该章节的 5W1H 结构化总结
- KV 会话 TTL 为 3600 秒（1 小时），自动过期清理

#### 5W1H JSON 解析

AI 返回的 JSON 经过三层容错解析：

1. 直接 `JSON.parse()` — 最理想的情况
2. 正则匹配 markdown 代码块（` ```json ... ``` `）— 模型常额外包裹格式
3. 正则匹配自由文本中嵌入的 `{"who": ..., "how": ...}` — 最后的保底策略

解析失败时返回中文错误提示的 fallback 对象，确保 API 永不 500。

#### 交互设计

- 摘要框默认折叠（`max-height: 0`，`overflow: hidden`）
- 展开后 `max-height` 过渡到 600px（0.35s ease 过渡动画）
- 点击摘要标题可折叠，再次点击 `[5W1H]` 按钮可展开（已缓存内容不重新请求）
- `[5W1H]` 按钮点击后显示 `加载中...` 状态

---

## 主要工程取舍

| 决策 | 取舍 | 理由 |
|------|------|------|
| YouTube 字幕获取 → 硬编码回退 | 牺牲通用性，换取 100% demo 可用 | 三级回退链确保任何网络条件下 demo 都能跑通 |
| SSE 传输 → 行级增量解析 | 不处理嵌套 Markdown（列表/代码块），只解析 #/## /段落 | 覆盖 95% 实际使用场景，每个 chunk O(n) 处理 |
| AI provider → 环境变量自动切换 | 不支持运行时动态切换 | 单次部署通常只需一个 provider；代码路径清晰 |
| 5W1H 上下文 → KV 存储全文 | KV 存储最长 25MiB 的值，大文章可能超限 | 平均文章 ~2KB，远小于限制 |
| 前端 → 零框架 vanilla JS | 需要手动管理 DOM 状态 | 打包体积 < 10KB，无运行时开销 |
| 不引入 Puppeteer/浏览器自动化 | 反爬能力弱于真实浏览器 | 300MB 镜像不兼容 Workers 轻量运行环境 |
| 双 provider prompt 模板 | 需要维护两套 prompt 格式 | Gemini 用纯文本，DeepSeek 用 chat messages，API 对齐成本低 |

## 项目架构

```
src/
├── backend/
│   ├── index.ts          # Worker 入口
│   ├── router.ts         # 路由 + SSE + CORS + KV 存储调度
│   ├── youtube.ts        # YouTube 字幕提取 + 三级回退链
│   ├── gemini.ts         # Gemini AI (generateContentStream + generateContent)
│   ├── deepseek.ts       # DeepSeek AI (chat/completions, stream: true)
│   ├── prompts.ts        # 双格式 Prompt 模板（纯文本 + chat messages）
│   ├── proxy-fetch.ts    # TCP Socket 代理（cloudflare:sockets）
│   └── session.ts        # Cloudflare KV 会话存储
├── frontend/
│   ├── app.js            # SSE 客户端 + 增量 Markdown 解析器 + 5W1H 交互
│   ├── app.css           # 样式（设计 tokens + 响应式 + 过渡动画）
│   └── index.html        # 入口页面
└── fallback-subtitles/
    └── demo.txt          # Demo 视频硬编码回退字幕
```

## 技术栈

- **Runtime**: Cloudflare Workers
- **AI**: Gemini 2.5 Flash + DeepSeek Chat（OpenAI 兼容）
- **YouTube**: youtubei.js (Innertube API)
- **代理**: Webshare TCP Socket (cloudflare:sockets)
- **存储**: Cloudflare KV
- **前端**: Vanilla JS + CSS, esbuild 打包
- **传输**: Server-Sent Events (SSE)
