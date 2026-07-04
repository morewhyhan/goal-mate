# Verification Strategy

## 1. 定位

Verification Strategy 说明 Goal Mate 如何证明当前能力是真的，而不是只在文档中声称存在。

`docs/plans/*last-run.md` 可以记录一次性验收结果，但长期事实必须沉淀在 `docs/designs` 中。

## 2. 验证层级

| 层级 | 目的 | 典型命令 |
| --- | --- | --- |
| Static gates | 检查关键代码和文档契约仍存在 | `pnpm verify:agent-loop:static` |
| Typecheck | 检查 TypeScript 类型 | `pnpm typecheck` |
| Fresh DB bootstrap | 检查首次建库迁移、业务表零数据和最小读写 | `pnpm verify:fresh-db` |
| Zero-to-one product flow | 检查新用户、本地配置边界、Agent 首次目标、Today 接入、自主干预、元认知自我优化、QQ 回复入库是否能串成一条本地产品主链路 | `pnpm verify:zero-to-one` |
| Empty authenticated Dashboard browser | 检查干净新用户页面空状态和配置边界 | `pnpm verify:dashboard-browser:empty-auth:write` |
| Intervention planner | 检查自主干预、元认知和记忆质量门禁 | `pnpm verify:intervention-planner` |
| AI reply quality | 检查 Agent 回复是否像秘书、少 AI 味、有边界、有下一步 | `pnpm verify:ai-reply-quality` |
| Agent prompt snapshot | 检查 system prompt 的版本、section、源码 hash 和关键规则短语没有未记录漂移 | `pnpm verify:agent-prompt-snapshot` |
| Agent context runtime | 捕获 Web Agent 实际模型请求，检查当前用户 Goal/Logs/元认知上下文、权限和用户隔离 | `pnpm verify:agent-context` |
| Agent control actions | 检查 Agent 通过确认机制修改模型配置和提醒规则，并在 Settings 留下审计 | `pnpm verify:agent-control` |
| Settings self-service | 检查用户自己在 Settings 配置模型、QQ、提醒和行为控制后，控制中心是否进入可用状态 | `pnpm verify:settings-self-service` |
| Live model Agent flow | 检查用户保存 DeepSeek Key 后，Settings 测试和 Agent 发消息是否真实调用模型 | `pnpm verify:live-model-agent:write` |
| API acceptance | 检查 API 可用和鉴权边界 | `pnpm verify:v01:api` |
| Agent loop write | 检查工具写入闭环 | `pnpm verify:agent-loop:write` |
| First-run Agent flow | 检查新用户首次目标输入、追问、草案、激活和 Today 接入 | `pnpm verify:first-run-agent` |
| Today feedback loop | 检查 Web Today 反馈是否写入行动、诊断、日志、热力图和 Goals 状态 | `pnpm verify:today-feedback` |
| Scheduler reminder rules | 检查 Settings 保存的提醒规则是否被 Scheduler 消费 | `pnpm verify:scheduler-rules` |
| QQ scheduler reply loop | 检查主动提醒回复是否写入 Check-in、Logs、Review 和 SchedulerEvent | `pnpm verify:qq-scheduler-reply` |
| Dashboard browser | 检查真实页面可读可操作 | `pnpm verify:dashboard-browser:auth:write` |
| Deployment config | 检查 systemd、env、worker 脚本 | `pnpm verify:deployment-config` |
| Scheduler one-shot | 不等真实时间验证 Scheduler | `pnpm worker:scheduler:once` |
| Server long-running | 证明电脑关闭后仍能主动推进 | 手工/服务器验收 |

## 3. 静态门禁覆盖

当前静态门禁必须覆盖：

- P0 Agent tools catalog。
- shared handlers。
- shared executor。
- confirmation policy。
- Agent prompt system。
- secretary tone rules。
- Settings read scope。
- export privacy。
- workspace data deletion。
- QQ shared runtime。
- Scheduler shared audit。
- check-in diagnosis。
- Today auto action。
- Momentum heatmap。
- Markdown rollups。
- control loop UI cues。
- Agent Reply 标准结构化输出。
- Review 生成回写目标状态判断。
- Agent Memory Context。
- Settings 最近错误聚合。
- Autonomous Intervention PRD。
- Autonomous Intervention Runtime。

静态门禁只能证明代码结构存在，不能证明真实模型质量或服务器长期稳定。

部署配置门禁必须额外防止 QQ 接入文档、systemd README 和运行时代码退回旧的“默认用户邮箱自动绑定”方案。v0.1 的 QQ 归属只能来自当前登录用户在 Settings 生成的绑定码和 `QqChatBinding`，不能依赖全局邮箱、第一个用户或 demo 用户；`QQ_DEFAULT_USER_EMAIL` 不能作为 Settings、QQ Worker 或 `resolveQqBotConfig` 的有效配置输入。QQ Bot App ID / Token 也是用户级配置，不能出现在 `.env.example` 或干净用户初始 Settings 状态里。

## 3.0 Zero-to-one Product Flow 验证

`pnpm verify:zero-to-one` 是本地产品闭环的组合验收入口。它把散落的关键验证合并成一个结论：

- `pnpm typecheck`：代码仍满足类型约束。
- `pnpm verify:auth-isolation`：新用户、私有数据、模型密钥和 QQ 绑定码按用户隔离。
- `pnpm verify:deployment-config`：Settings / env / systemd / worker 配置边界仍清楚。
- `pnpm verify:fresh-db`：临时全新 SQLite 数据库能执行迁移，业务表初始为空，没有假任务或 demo 残留，并能完成最小用户读写删除。
- `pnpm verify:agent-loop:static`：Agent 工具、Prompt、上下文和权限契约仍存在。
- `pnpm verify:ai-reply-quality`：Agent 回复质量门禁仍拒绝 AI 味、泛鼓励、越权和空泛回复。
- `pnpm verify:agent-prompt-snapshot`：Agent system prompt 的秘书语气、控制闭环、自主干预、元认知、记忆质量和权限规则没有发生未记录漂移。
- `pnpm verify:agent-context`：Web Agent 实际 chat-completions 请求会注入当前用户 Goal、Markdown、元认知和记忆，并遵守 Logs 读取权限和用户隔离。
- `pnpm verify:agent-control`：Web Agent 工具能先生成待确认动作，再在确认后修改当前用户模型配置和提醒规则；Settings Control Center 能看到结果和审计。
- `pnpm verify:settings-self-service`：干净用户能在 Settings 自助保存模型、QQ Bot、提醒节奏和行为控制；模型测试和 QQ 测试按当前用户配置执行；Control Center 不泄密并显示可用状态。
- `pnpm verify:intervention-planner`：Planner 能降难度、识别风险、处理无响应、拒绝泛鼓励，并把无效干预变成可验证元认知。
- `pnpm verify:control-loop-emergence`：反馈能进入统一控制回合语义，元认知和 `policy_delta` 能改变下一次干预，并能生成 AI 自我优化规则。
- `pnpm verify:first-run-agent`：全新用户能通过 Agent 从自然语言目标进入草案、确认激活和 Today。
- `pnpm verify:today-feedback`：干净用户从 Agent 建目标进入 Today 后，提交没完成反馈会写入 DailyAction、Check-in、Diagnosis、Markdown Logs、Momentum 和 Goals 只读状态。
- `pnpm verify:dashboard-browser:empty-auth`：干净新用户能打开 Today、Goals、Logs、Agent、Settings，并看到空状态/配置边界，而不是假任务或 demo 数据。
- `pnpm verify:scheduler-rules`：Settings 保存的提醒规则会被 Scheduler 消费，并尊重关闭、每日上限和免打扰。
- `pnpm verify:qq-scheduler-reply`：QQ 主动提醒后的用户回复能进入 Check-in、Diagnosis、Logs、Review 和 SchedulerEvent。

该验证回答的是“本地 v0.1 主链路是否串起来”：用户目标能进入系统，系统能产生下一步行动，反馈能改变后续干预，AI 能修正自己的下一次思考方式，QQ 回复能写回状态。它不证明真实 QQ Gateway 长连接、服务器 systemd 长期运行，也不证明真实模型长期对话质量。

Dashboard 浏览器验证必须等登录守卫结束后再断言页面文本。若 `useSession` 长时间 pending，产品层必须有同源 session probe 兜底；验证层必须把“正在确认登录状态”视为未完成加载，而不是把它当成页面内容通过或立即误判。该规则用于防止真实用户进入 Goals / Logs / Agent / Settings 时被永久挡在认证确认页。

## 3.0.1 Fresh DB Bootstrap 验证

`pnpm verify:fresh-db` 用于证明第一次部署或全新建库时，系统不会因为迁移缺失、seed 残留或假数据污染而让新用户看到不属于自己的任务。

该验证必须覆盖：

- 使用临时 SQLite 数据库，不触碰当前开发数据库。
- 执行 `prisma migrate deploy` 成功。
- 核心业务表存在：`user`、`Goal`、`MarkdownDocument`、`AgentThread`、`ModelConfig`、`ReminderRule`、`SchedulerEvent`。
- 除 Prisma migration 表外，所有业务表初始行数为 0。
- 能创建、读取并删除一个最小用户，删除后用户表重新归零。

该验证只证明首次本地建库和空状态数据边界，不证明服务器长期运行，也不替代登录后的页面空状态 smoke。

## 3.0.2 Today Feedback Loop 验证

`pnpm verify:today-feedback` 用于证明 Today 页面不是只展示下一步，而是真正能接收用户每天完成情况，并把反馈变成系统状态。

该验证必须覆盖：

- 注册干净用户，不使用 seed/demo 数据。
- 通过 Agent 创建并激活第一个目标。
- `GET /api/today` 能读取 Agent 创建的当前目标和唯一下一步。
- `POST /api/today/checkin` 接收没完成反馈。
- 数据库中 `DailyAction.status`、`Checkin`、`Diagnosis` 被更新。
- 自动写入当日 Markdown 日志和日志 rollup。
- 生成可供后续 Planner 消费的 meta-cognition 证据。
- 再次读取 Today 时 Momentum 有反馈活动。
- Goals 和 Logs API 能读取到这次反馈产生的状态和 Markdown 证据。

该验证只证明 Web Today 反馈闭环，不证明 QQ 主动触达或真实模型长期质量。

## 3.1 Intervention Planner 验证

`pnpm verify:intervention-planner` 必须覆盖：

- 某目标中核心行动多次没完成时，Planner 识别难度问题并降难度。
- 关键风险点导致默认高风险行为时，Planner 生成提前风险提示和 fallback_action。
- 连续无响应时，Planner 不盲目加频率，而是降复杂度、调时或建议重审。
- 缺少模型 API Key 时，Planner 使用 `fallback_rule` 保底，并记录原因。
- 合法 AI Policy JSON 通过质量门禁后，Planner 使用 `ai_policy` 结果。
- 泛泛鼓励、鸡汤话、缺少风险点或缺少可验证信号的 AI 输出会被拒绝。
- Scheduler 写入结构化消息时必须记录 `planner_source`。
- 干预无效后，Meta-Cognition 能生成可验证假设。
- Check-in 写入 Daily Log 时，必须生成 `System Reflection`，同时记录下次怎么干预用户和 AI 下次怎么修正自己的推理。
- 模糊记忆“用户状态不好”会被 Memory Quality Gate 拒绝进入核心记忆。

## 3.2 ControlLoopEpisode / 涌现效果验证

`pnpm verify:control-loop-emergence` 必须覆盖：

- EMG-1：连续 3 次没做后，系统不重复催促，必须改变诊断问题、行动难度、提醒时机或风险提示。
- EMG-2：策略调整后完成率改善，元认知增强该假设。
- EMG-3：策略调整后仍无效，元认知削弱或修正该假设。
- EMG-4：Today 打卡和 Agent 对话反馈表达同一事实时，必须进入同一套 ControlLoopEpisode 语义。
- EMG-5：Review 压缩多个 ControlLoopEpisode 的有效性，而不是只总结日志文本。
- EMG-6：下一次 Planner 必须能说明读取了哪些活跃元认知、哪些 `policy_delta` 改变了本次干预。
- EMG-7：旧元认知被证伪时，必须生成 `AiSelfOptimizationUpdate`，说明 AI 上一次推理错误和下一次规则。
- EMG-8：下一次 Planner 必须消费 AI 自我优化规则，改变问题、推理顺序或行动安排。

该验证用于证明“涌现效果”的必要链路存在：反馈会变证据，证据会变假设，假设会变策略差量，策略差量会影响下一次干预。

## 3.3 当前增量事实：AI 自我优化闭环

截至 2026-07-03，本地验证已经覆盖 AI 不只优化用户行为，也优化自己下一次推理方式：

- `pnpm verify:control-loop-emergence` 已覆盖 EMG-7 和 EMG-8：旧元认知被证伪时生成 `AiSelfOptimizationUpdate`，下一次 Planner 消费该规则并改变提问方式。
- `pnpm verify:intervention-planner` 已确认原有难度、风险、无响应、AI-first fallback 和质量门禁仍通过。
- `pnpm verify:agent-loop:static` 已确认需求规格、事实文档、运行时代码和验证脚本之间的静态契约仍一致。
- `pnpm typecheck` 已确认当前 TypeScript 类型检查通过。

这只能证明本地闭环和静态契约成立，不等于已经完成真实多日运行、真实 QQ 长期主动消息和真实用户行为质量验收。

## 3.4 当前增量事实：抽象层通用化边界

截至 2026-07-03，核心规格、Planner、元认知、验证脚本和原型文案已经完成一次具体场景词清理。

当前原则：

- 核心规则只允许表达通用控制结构：方向、难度、提示、路径、证据不足、行动仓位、风险点、替代动作、默认高风险行为。
- 不允许把某个用户故事写进系统内核，例如具体饮食、具体运动、具体学习材料、具体指标数字或具体平台。
- 测试样例可以有场景，但断言必须验证通用结构，而不是验证某个生活场景词。
- Demo / Seed / Prototype 可以展示样例，但不能让样例反向决定 Planner、Prompt 或需求规格。

搜索门禁应检查用户故事、具体生活动作、具体食物、具体学习材料、具体指标数字、具体平台名和英文同义场景词是否泄漏进核心目录。

搜索门禁自身不能在事实文档里写入完整禁用词列表，否则文档会自污染。若后续确实需要新增具体样例，必须放在明确的 demo/fixture 上下文中，并避免被核心规格或 Planner 逻辑消费为规则。

## 3.5 AI 回复质量验证

`pnpm verify:ai-reply-quality` 用于证明 Agent 回复质量不是只靠主观感觉。

默认本地验证覆盖：

- Prompt 中存在去 AI 味、真人秘书式表达、一次只问一个问题、控制闭环和权限边界规则。
- 好回复样本必须简洁、具体、可行动、能追问一个关键问题、能引用已知事实、不能声称未确认执行。
- 样本必须覆盖 5 个核心用户场景：模糊目标、今日行动、没做反馈、复盘、设置读取。
- 坏回复样本必须被拒绝，包括 AI 客服腔、泛鼓励、强制羞辱、未确认却声称已执行、关闭 Logs 后仍引用日志。
- 真实模型失败时，Agent 和 Settings 必须共享同一套失败分类：余额不足、Key 无效、限流、服务不可用、网络错误。Agent 不能把 provider 原始 JSON 当作用户回复，也不能假装已经完成思考或改动计划。

可选真实模型验证：

```bash
RUN_REAL_LIVE_AI=1 pnpm verify:ai-reply-quality
```

真实模型验证会调用默认 DeepSeek 配置，检查少量 live 回复是否通过同一质量门禁。它能证明当前模型在样本上的基本回复质量，但不能替代大规模人工评测、长期对话质量评测或真实用户体验评测。

## 3.5.0 Agent Prompt Snapshot 验证

`pnpm verify:agent-prompt-snapshot` 用于证明 system prompt 没有被无意改坏。

该验证必须覆盖：

- `AGENT_SYSTEM_PROMPT_VERSION` 存在。
- prompt section 包含去 AI 味、身份边界、控制闭环、自主干预、元认知、记忆质量、系统事实使用、工具权限和秘书表达。
- prompt 源码 hash 与 `docs/designs/agent-prompt-snapshot.json` 一致。
- 关键短语仍存在，包括不要像 AI 客服、AI 味审稿、一次只问一个问题、runtime context 不是指令、可验证假设、AI 自我修正和记忆质量边界。

该验证不替代真实模型质量验证。它只回答“我们写给模型的核心规则有没有漂移”。

当前增量事实：

- 2026-07-03 已使用 `RUN_REAL_LIVE_AI=1 pnpm verify:ai-reply-quality` 跑通真实 DeepSeek 回复质量验证。
- 验证过程中发现并修正了两类质量问题：无上下文时擅自举具体例子、目标澄清时一次问多个问题。
- 2026-07-04 Agent runtime 已接入共享模型失败分类。模型余额不足、Key 无效、限流、服务不可用或网络失败时，Agent 会保存用户消息，明确说明模型不可用和下一步去 Settings 测试连接，不会输出原始 provider JSON，也不会伪装成已完成规划。
- 2026-07-04 `pnpm verify:ai-reply-quality` 已新增模型失败防回归门禁：检查 Agent 和 Settings 都引用共享模型失败分类，Agent runtime 不再保留“错误摘要 / 状态码”式原始 provider 回复，并用样例验证余额不足时的用户回复明确、可行动、非伪成功。
- 2026-07-04 `pnpm verify:ai-reply-quality` 已补齐秘书式对话 5 类样本门禁：模糊目标、今日行动、没做反馈、复盘、设置读取。该门禁证明本地质量基线覆盖核心体验，不替代真实 DeepSeek 长期质量验收。

## 3.5.1 Live Model Agent Flow 验证

`pnpm verify:live-model-agent` 用于证明真实用户模型配置链路成立，而不是只证明脚本能直接调用 DeepSeek。

该验证必须覆盖：

- 注册一个干净测试用户。
- 通过 `/api/models` 为当前用户保存 DeepSeek API Key，并确认响应不泄露明文。
- 调用 `/api/settings/models/test`，证明 Settings 的测试按钮等价链路能访问 DeepSeek。
- 如果 DeepSeek 返回余额不足、Key 无效、限流或网络失败，系统必须返回结构化 `reason` 和用户能理解的 `message`，不能把原始 JSON 错误直接丢给用户。
- 创建 Agent 对话并发送一条普通消息，证明 Agent 使用当前用户保存的模型配置生成回复。
- 检查回复不是缺 key、模型失败、客服腔、泛鼓励或强制语气。

运行要求：

```bash
GOAL_MATE_LIVE_MODEL_API_KEY=... pnpm verify:live-model-agent:write
```

也可以使用 `DEEPSEEK_API_KEY` 环境变量。报告不得写入 API Key。

该验证是强 live 证据；如果没有真实 key 或网络权限，不能声明“用户配置 DeepSeek 后 Agent 真实调用 AI”已经通过。

当前增量事实：

- 2026-07-04 Settings 模型测试已增加失败分类：`missing_api_key`、`insufficient_balance`、`invalid_api_key`、`rate_limited`、`provider_unavailable`、`provider_error`、`network_error`。
- 前端模型测试会在 toast 和 Settings 页面内同时显示测试结果，不再无条件提示“已提交”。

## 3.5.2 Agent Context Runtime 验证

`pnpm verify:agent-context` 用于证明 Agent 不是只在静态代码里“可以读取上下文”，而是在一次真实 Web Agent 对话中把当前用户数据放进模型请求。

该验证必须覆盖：

- 注册当前用户和另一个用户，构造同名检索标记，证明 Markdown 检索按 `userId` 隔离。
- 给当前用户写入 Goal、KR、条件、阶段、今日行动、Check-in、Diagnosis、Review、Markdown 日志和 `system/meta-cognition/<goal>.md`。
- 给当前用户配置一个本地 fake model，捕获实际 `/chat/completions` 请求。
- 断言 runtime system prompt 包含当前用户 Goal、Markdown、对话记忆、Meta-Cognition 和 AI 下次思考规则。
- 断言 runtime system prompt 不包含另一个用户的 Markdown 标记。
- 关闭 `agent.can_read_logs` 后再次对话，断言 prompt 明确出现 Logs 读取关闭提示，并且不包含 Markdown 日志内容。

该验证不访问外部模型，不证明 DeepSeek 长期回复质量。它证明的是 Agent Runtime 的上下文注入、权限边界和用户隔离在真实 API 路径上成立。

当前增量事实：

- 2026-07-04 已执行 `pnpm verify:agent-context:write` 并通过。
- 2026-07-04 已执行 `pnpm verify:zero-to-one:write` 并通过，`ZOF-AGENT-CONTEXT-RUNTIME` 已成为本地从零到一组合门禁的一部分。

## 3.5.3 Agent Control Actions 验证

`pnpm verify:agent-control` 用于证明 Agent 是系统控制入口，而不只是聊天入口。

该验证必须覆盖：

- 注册一个干净用户。
- 通过 `/api/agent/tools/execute` 调用 `settings.model.update`，确认未确认前不会写入 `ModelConfig`。
- 通过 `/api/agent/tools/actions/:id/confirm` 确认后，模型配置写入当前用户，API Key 加密保存，读取、导出和 Control Center 不泄露明文。
- 通过 `/api/agent/tools/execute` 调用 `reminder.schedule`，确认未确认前不会写入 `ReminderRule`。
- 确认后提醒规则写入当前用户，并能在 Settings Control Center 的 `reminderRules` 和 `toolActions` 中看到。

当前增量事实：

- 2026-07-04 已执行 `pnpm verify:agent-control:write` 并通过。
- 2026-07-04 该验证已纳入 `pnpm verify:zero-to-one`。
- 该验证证明 Agent 可以控制模型配置和提醒节奏，但不证明真实模型长期质量或真实 QQ 平台送达。

## 3.5.4 Settings Self-service 验证

`pnpm verify:settings-self-service` 用于证明 Settings 不是只展示配置项，而是用户可以自己把关键接入信息配置到可用状态。

该验证必须覆盖：

- 注册干净用户。
- 读取 Settings Control Center，确认配置入口和运行状态可读。
- 通过 `/api/models` 保存当前用户模型配置，API Key 响应脱敏、数据库加密。
- 通过 `/api/settings/models/test` 调用当前用户默认模型和用户配置的 API Base。
- 通过 `/api/settings/qq-bot` 保存当前用户 QQ Bot 配置，token 响应脱敏、数据库加密。
- 通过 `/api/settings/qq-bot/test` 调用当前用户 QQ 配置；当 `apiBase` 为自定义地址时，测试也必须使用该地址获取 token。
- 通过 `/api/settings/qq-bot/binding-code` 生成只归属当前用户的绑定码。
- 通过 `/api/settings/reminders` 保存早中晚提醒节奏，并以 `ReminderRule` 作为真实调度来源。
- 通过 `/api/settings` 保存 Logs、Agent、Today 行为控制，不创建第二套假调度字段。
- Control Center 能同时看到模型已配置、QQ 已配置、提醒规则存在，并且导出不泄露模型 Key 或 QQ token。

该验证使用本地 fake model 和 fake QQ token server，不证明外部 DeepSeek 余额或真实 QQ Gateway 长期送达。

## 3.6 当前增量事实：首次 Agent 建目标闭环

截至 2026-07-04，首次目标输入有专门验证：

- `pnpm verify:first-run-agent` 创建全新用户，确认空工作区没有目标和 Markdown 业务数据。
- 模糊输入只返回一个关键追问，不创建假目标。
- 足够具体的自然语言目标会创建目标草案、KR、条件、阶段、今日行动和目标 Markdown。
- 用户确认待激活动作后，目标变为 current focus，Today 能读取下一步行动。

该验证证明首次目标闭环有本地兜底路径，不依赖模型一定正确选择工具。它不等于真实模型长期对话质量已经充分通过。

## 3.7 当前增量事实：QQ Scheduler 回复闭环

截至 2026-07-04，主动提醒后的用户回复有本地运行时验证：

- `pnpm verify:qq-scheduler-reply` 构造一个 sent 状态的 evening_review SchedulerEvent。
- 模拟用户通过 QQ 回复“没完成，太难了”。
- 共用 `src/lib/qq-scheduler-reply.mjs`，这也是 QQ Worker 调用的回复处理模块。
- 验证 Check-in、Diagnosis、Markdown 日志、daily Review、SchedulerEvent responded、AgentToolAction 审计都被写入。
- 验证 daily Review 会写入 `system/meta-cognition/<goal>.md`，并包含下一次干预用户、下一次 AI 思考规则、`policy_delta` 和可验证信号。

该验证证明“回复进入系统状态”的闭环成立。它不证明真实 QQ 平台消息一定能送达，也不证明服务器长期运行稳定。
- 当前生产 Prompt 已增加约束：不在缺少上下文时随手举例；一次回复最多保留一个问号。
- 当前 live 样本通过范围：未完成诊断、目标不清澄清、去 AI 味、权限边界、未确认执行边界。

## 3.8 当前增量事实：Scheduler 读取用户提醒规则

截至 2026-07-04，主动提醒规则有本地运行时验证：

- `pnpm verify:scheduler-rules` 创建一个干净测试用户，保存用户自己的 QQ Bot 配置和 ReminderRule。
- 同时创建另一个更新更晚但 QQ 配置 disabled 的用户，验证按 userId 解析配置不会串号，全局解析不会被 disabled 用户覆盖。
- 验证启用的提醒规则会被 Scheduler 消费并生成 SchedulerEvent。
- 验证关闭的提醒规则不会被消费。
- 验证当天已达到 `maxPerDay` 后不会重复创建提醒事件。
- 验证命中 `quietHours` 时不会创建提醒事件。
- 验证有 QQ 绑定时，Scheduler 会使用用户配置的 API Base 走 fake QQ token + send，发送内容包含今日行动、fallback、Planner 决策和可验证信号。
- 验证发送成功会同时写入 `SchedulerEvent(status=sent)`、`AgentMessage(structuredOutputType=scheduler_reminder)` 和 `AgentToolAction(toolName=reminder.send,status=executed)`。

该验证证明 Settings 中的提醒节奏和 QQ API Base 不是前端假配置，主动提醒内容也不是空模板。它不证明真实 QQ 平台消息已送达，也不证明服务器长期运行稳定。

## 4. 浏览器验收覆盖

Dashboard browser 验收必须覆盖：

- Today：下一步行动清楚，热力图可见。
- Goals：只读目标状态链路可读。
- Logs：层级文件树和 Markdown 编辑器可操作。
- Agent：消息区滚动，输入框固定可见。
- Settings：模型、提醒、权限、日志、数据控件不溢出。

## 5. 运行验收覆盖

服务器长期验收必须证明：

- Web 进程可长期运行。
- QQ Worker 可长期连接 Gateway。
- Scheduler Worker 可按规则触发。
- QQ 主动提醒可发送或失败可审计。
- 用户回复提醒后能进入 Agent Tool Runtime。
- Settings 能看到 runtime status、SchedulerEvent、AgentToolAction。

如果未完成服务器长期验收，产品不能声称已经满足“电脑关闭后也能主动推进”。

## 6. 真实 AI 验收

真实 AI 验收必须区分：

| 项 | 验证什么 |
| --- | --- |
| 模型连接 | DeepSeek API 可调用 |
| 用户配置模型链路 | 当前用户保存的加密 Key 能被 Settings 测试和 Agent 回复共同使用 |
| 对话质量 | 回复像目标秘书，不像 AI 客服 |
| 工具路由 | 明确命令能转成工具意图 |
| 诊断能力 | 没做时进入 motivation / ability / prompt / path |
| 权限边界 | 关闭读取后不引用对应上下文 |

不能只用 mock 或静态检查证明真实 AI 质量。

## 7. 验证报告位置

一次性报告放在：

```text
docs/plans/*last-run.md
```

长期验证策略放在：

```text
docs/designs/verification-strategy.md
```

如果一次性报告揭示了新的长期事实，必须同步到 `docs/designs`。
