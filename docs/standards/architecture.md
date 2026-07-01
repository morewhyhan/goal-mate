# 架构规范

## 核心判断

Goal Mate 不是知识库软件，而是行动推进系统。日志、OKR、甘特图、热力图和 Agent 对话都只是为了让用户知道：现在要做什么、为什么这个进度可信、下一步如何推进。

## 产品层级

- Web Console：第一版主产品形态，承载 Today、Goals、Logs、Agent、Settings。
- Agent：对话入口，读取目标和日志，帮助用户规划、解释、调整和生成下一步。
- Channel：微信、飞书、QQ 等消息入口，后续作为 Agent 的外部触达层。
- Markdown Vault：系统最终产出的一套可读、可编辑、可迁移的 Markdown 目标日志。

## 页面职责

- Today：只回答“我现在下一步做什么”。
- Goals：只读展示目标、子目标、KR、进度和周期计划。
- Logs：以 Markdown 层级文件展示年报、季报、月报、周报、日报，并允许直接编辑。
- Agent：像 Codex 一样的专业对话工作台，用来提问、整理、规划和控制系统。
- Settings：配置产品行为、模型、通知、集成、数据和隐私。

## 工程分层

- `app/`：Next.js 页面和布局，只做路由、页面组合和少量服务端读取。
- `components/`：可复用 UI 组件；业务组件按模块分目录。
- `components/ui/`：shadcn/ui 组件源码，可按产品视觉定制。
- `hooks/`：前端数据 hooks，封装 Hono RPC + React Query。
- `lib/`：通用工具、API client、格式化、常量。
- `server/api/`：Hono API 入口、路由、中间件、错误处理。
- `server/api/routes/<resource>/`：每个资源独立路由。
- `prisma/`：数据模型和迁移。
- `docs/`：需求、设计、规范和架构说明。

## 模块边界

- 页面不能直接拼接接口 URL，必须通过 API client 或 hooks。
- 页面不能直接理解复杂方法论，只展示必要结果。
- Agent 可以解释方法论，但不能把所有中间推理都塞进普通页面。
- Logs 是可编辑记录层，Goals 是结构化进度层，两者通过引用关系联动。
- Settings 只放真实会影响系统行为的配置，不放假按钮。

## Ignite 模板借鉴点

- 借鉴它的 Next.js + Hono + Prisma + React Query 分层。
- 借鉴它的 feature-first 开发流程：Model -> API -> Hook -> Page。
- 借鉴它的统一错误处理、类型推导和 shadcn/ui 组件策略。
- 不照抄它的业务命名、页面内容和模板文案。
