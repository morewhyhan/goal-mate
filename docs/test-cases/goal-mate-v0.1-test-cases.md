# Goal Mate v0.1 测试用例矩阵

## 1. 关联需求

- Feature：`docs/features/goal-mate-v0.1/README.md`
- Feature：`docs/features/goal-mate-v0.1/08-acceptance.md`
- Plan：`docs/plans/v0.1-implementation-plan.md`
- Designs：`docs/designs/api-contract.md`
- Designs：`docs/designs/ai-output-schema.md`
- Designs：`docs/designs/goal-state-machine.md`

## 2. 测试目标

本测试矩阵用于证明 v0.1 是否满足“单主目标完整推进闭环”。测试重点不是页面是否能打开，而是目标是否能从 Agent 澄清、结构化保存、进入 Today、反馈、诊断、写入 Logs，并在 Goals 和 Settings 中形成一致状态。

## 3. 测试范围

| 范围 | 覆盖内容 |
| --- | --- |
| 主链路 E2E | E2E-1 到 E2E-9 |
| 业务规则 | T-R1 到 T-R7 |
| API 契约 | settings、models、logs、goals、today、agent、reviews |
| AI 输出 Schema | goal_reasoning_card、daily_action、diagnosis、review、log_patch、setting_change_draft |
| 页面验收 | Today、Goals、Logs、Agent、Settings |
| 安全隐私 | session 鉴权、userId 隔离、API Key 脱敏、Agent 读取权限 |

## 4. 前置条件

| 条件 | 说明 |
| --- | --- |
| 数据库 | 已根据 `src/prisma/schema.prisma` 完成迁移 |
| Prisma Client | 已生成并与 schema 匹配 |
| Demo 数据 | 已运行 `src/scripts/seed-goal-mate.mjs` 或准备等价测试数据 |
| 登录用户 | `demo@goalmate.local` 或测试账号已登录 |
| 服务 | Next.js / Hono API 可访问 |
| 测试策略 | 自动化测试优先，复杂视觉和直觉验收允许人工检查 |

## 5. 主链路 E2E 用例

| ID | 需求 | 用户路径 | 关键断言 |
| --- | --- | --- | --- |
| E2E-1 | 用户输入模糊目标，Agent 先澄清成功标准和时间范围 | 打开 Agent，发送“我想暑假变好” | Assistant 不直接列任务，返回成功标准或时间边界相关追问 |
| E2E-2 | 用户确认目标后生成目标推理卡、KR、条件、阶段计划 | 调用目标推理卡草案确认流程 | Goal 有 confirmed ReasoningCard，KeyResult、GoalCondition、StagePlan 存在 |
| E2E-2a | 新用户自然语言说明足够具体的目标 | 发送“我想在30天内完成一个可上线演示的小产品，现在只有想法和一点代码” | Agent 创建目标草案、KR、条件、阶段、今日行动和目标 Markdown，并生成待确认激活动作 |
| E2E-3 | Today 只展示一个主行动、完成标准、最小启动和反馈入口 | 打开 `/dashboard/today` | 页面只有一个主行动，显示 linked condition、done_when、minimum_step 和反馈按钮 |
| E2E-4 | 用户完成行动后更新 Checkin、KR/条件证据，并写入当日日志 | 在 Today 点击完成 | DailyAction 状态更新，Checkin 创建，LogEntry 追加 Check-in 区块 |
| E2E-5 | 用户未完成行动后触发诊断 | 在 Today 点击没做并提供反馈 | Diagnosis 创建，category 属于 motivation/ability/prompt/path/condition/goal/unknown |
| E2E-6 | Goals 只读展示 O、多条 KR、条件、Gantt/周期进度 | 打开 `/dashboard/goals` | 显示 Objective、KR、Conditions、Cycle Plan，不出现编辑/删除目标按钮 |
| E2E-7 | Logs 展示年/季/月/周/日文件树和 Markdown 编辑器 | 打开 `/dashboard/logs` | 文件树层级存在，点击日志显示 Markdown，可保存已有日志 |
| E2E-8 | Agent 有历史、消息区、固定输入框 | 打开 `/dashboard/agent` | 左侧历史存在，中间消息区滚动，底部输入框始终可见 |
| E2E-9 | Settings 能配置模型、提醒、日志、数据和隐私 | 打开 `/dashboard/settings` | Models、Logs、Agent、Notifications、Data & Privacy 等分类可见，模型测试按钮调用 API |
| E2E-10 | Settings 能为当前账号生成 QQ 绑定码 | 保存 QQ Bot 配置后点击生成绑定码 | 返回 `绑定 GM-XXXXXX`；QQ Worker 只有收到该绑定码才创建当前用户的 `QqChatBinding` |
| E2E-11 | QQ 主动提醒后用户回复 | evening_review SchedulerEvent 已发送，用户回复“没完成，太难了” | 产生 Check-in、Diagnosis、Markdown 日志、daily Review、SchedulerEvent responded 和 scheduler 审计 |
| E2E-11a | QQ 主动提醒发送内容 | 用户已有绑定 QQ、当前 Goal 和今日行动，Scheduler 到达提醒时间 | fake QQ API 收到消息；消息包含今日行动和 fallback；SchedulerEvent、AgentMessage、AgentToolAction 记录 Planner 决策和可验证信号 |
| E2E-12 | 从零到一产品闭环 | 新用户完成配置边界检查、Agent 首次目标、Today 接入、QQ 回复入库 | `pnpm verify:zero-to-one` 通过，证明本地关键链路被组合验收覆盖 |
| E2E-13 | 干净新用户页面空状态 | 新注册账号不 seed 数据，打开 Today、Goals、Logs、Agent、Settings | 页面显示空状态和真实配置边界，不出现假任务、假 KR、假日志或 demo 数据 |
| E2E-14 | 用户配置 DeepSeek 后 Agent 真实调用模型 | 新用户保存真实 DeepSeek Key，测试连接，再向 Agent 发消息 | `pnpm verify:live-model-agent` 通过；模型 Key 不泄露，Settings 测试成功，Agent 回复不是兜底或模型错误 |
| E2E-15 | Agent 真实运行时读取当前用户上下文 | 构造当前用户 Goal、Markdown、元认知和另一个用户冲突日志，向 Web Agent 发普通消息 | `pnpm verify:agent-context` 通过；捕获到的模型请求包含当前用户上下文，不包含其他用户日志；关闭 Logs 权限后不再注入日志 |
| E2E-16 | Agent 作为系统控制入口修改配置 | 新用户通过 Agent tools 请求修改模型配置和提醒规则 | `pnpm verify:agent-control` 通过；未确认前不落库，确认后写入当前用户，密钥脱敏，Settings Control Center 展示结果和审计 |
| E2E-17 | 全新数据库首次启动干净可用 | 使用临时 SQLite 数据库执行迁移 | `pnpm verify:fresh-db` 通过；核心业务表存在，所有业务表初始为 0，没有假任务或 demo 残留，并能完成最小用户读写删除 |
| E2E-18 | Web Today 反馈闭环 | 干净用户通过 Agent 创建目标，进入 Today 后提交“没完成”反馈 | `pnpm verify:today-feedback` 通过；DailyAction、Check-in、Diagnosis、Markdown Logs、Momentum、Goals 只读状态全部更新 |
| E2E-19 | Settings 自助配置闭环 | 干净用户在 Settings 保存模型、QQ、提醒和行为控制 | `pnpm verify:settings-self-service` 通过；模型测试、QQ 测试、绑定码、提醒规则、控制中心、导出脱敏全部成立 |

## 6. API 契约用例

| ID | API | 操作 | 期望 |
| --- | --- | --- | --- |
| API-SET-1 | `GET /api/settings` | 已登录用户读取设置 | 返回 `{ data }`，包含 general、goals、logs、today、agent、notifications、dataPrivacy |
| API-SET-2 | `PUT /api/settings` | 保存提醒或日志设置 | 返回更新后的 UserSetting，后续读取一致 |
| API-SET-3 | `GET /api/settings/export` | 导出用户数据 | 返回 goals、logs、agentThreads、models、settings，models 不含明文 API Key |
| API-MOD-1 | `GET /api/models` | 读取模型配置 | 至少返回 DeepSeek 默认配置，apiKeyRef 脱敏 |
| API-MOD-2 | `POST /api/settings/models/test` | 测试默认模型连接 | 返回 `{ ok: true }` 或明确模型连接失败错误 |
| API-MOD-2b | `POST /api/settings/models/test` | DeepSeek 返回余额不足、Key 无效或限流 | 返回结构化 `reason` 和用户可理解 `message`，不直接暴露原始 JSON |
| API-LOG-1 | `GET /api/logs/tree` | 读取日志树 | 返回按 path 排序的日志节点数据 |
| API-LOG-2 | `PUT /api/logs/:id` | 保存 Markdown | 返回更新后的 LogEntry |
| API-LOG-3 | `POST /api/logs/patch` | 追加 log_patch | 不覆盖用户手写内容，追加系统区块 |
| API-GOAL-1 | `GET /api/goals` | 读取目标列表 | 返回目标、KR、条件、阶段、最近行动 |
| API-GOAL-2 | `POST /api/goals/reasoning-card/draft` | 创建推理卡草案 | 新卡状态为 pending_user_confirmation |
| API-GOAL-3 | `POST /api/goals/reasoning-card/:id/confirm` | 确认推理卡 | 当前卡 confirmed，旧 confirmed 卡 stale |
| API-TODAY-1 | `GET /api/today` | 读取今日行动 | 有 current focus 时返回 goal 和唯一 planned action；无目标时返回空 Today 数据，不返回假任务 |
| API-TODAY-2 | `POST /api/today/checkin` | 提交 done | 创建 Checkin，更新 DailyAction，追加日志 |
| API-TODAY-3 | `POST /api/today/checkin` | 提交 not_done | 创建 Checkin、Diagnosis，追加日志诊断问题 |
| API-AGENT-1 | `GET /api/agent/threads` | 读取对话历史 | 返回线程和最近消息 |
| API-AGENT-2 | `POST /api/agent/threads/:id/messages` | 发送消息 | 保存 user message 和 assistant message |
| API-REV-1 | `POST /api/reviews/generate` | 生成周复盘 | 创建 Review，写入 LogEntry，返回 Markdown |

## 7. 业务规则用例

| ID | 规则 | 前置条件 | 操作 | 期望 |
| --- | --- | --- | --- | --- |
| T-R1 | active goal 缺少推理卡不得进入每日推进 | Goal 无 confirmed card | 请求 Today | 不返回可执行 action 或返回明确错误状态 |
| T-R2 | DailyAction 缺少 linked_condition 保存失败 | 构造无 conditionId 的行动 | 保存 DailyAction | 数据层或服务层拒绝 |
| T-R3 | 连续 3 次未完成触发路径层诊断 | 同一目标已有 2 次 not_done/partial | 第 3 次提交 not_done | Diagnosis category 为 PATH 或 CONDITION/GOAL |
| T-R4 | Agent 修改目标必须确认 | Agent 返回 goal_reasoning_card 草案 | 未调用 confirm | Goal 正式状态不变 |
| T-R5 | Agent 修改设置必须确认 | Agent 返回 setting_change_draft | 未调用确认 | UserSetting 不变 |
| T-R6 | 导出数据不包含明文 API Key | ModelConfig 有 apiKeyRef | 调用 export | 响应中只出现脱敏值或安全引用 |
| T-R7 | 用户删除记忆后 Agent 不得引用 | memory_enabled=false 或删除记忆 | Agent 回答 | 回答不引用被禁用或删除的记忆 |

## 8. AI 输出 Schema 用例

| ID | Schema | 有效输入 | 无效输入 | 期望 |
| --- | --- | --- | --- | --- |
| AI-1 | goal_reasoning_card | 包含 purpose_summary、objective、KR、conditions、current_gap | 缺少 key_results | 校验失败，不得落库 |
| AI-2 | daily_action | 包含 title、linked_condition、done_when、minimum_step、fallback_action | 缺少 linked_condition | 校验失败，不得进入 Today |
| AI-3 | diagnosis | category 为 ability/path 等枚举 | category 为 lazy | 校验失败 |
| AI-4 | review | 包含 period、progress_summary、condition_changes、next_focus、log_markdown | 缺少 log_markdown | 校验失败 |
| AI-5 | setting_change_draft | requires_confirmation=true | requires_confirmation=false | 校验失败或拒绝执行 |
| AI-6 | log_patch | write_mode 为 append/create/replace_system_block | write_mode 为 overwrite_all | 校验失败 |

## 9. 页面验收用例

| 页面 | 检查项 | 通过标准 |
| --- | --- | --- |
| Today | 首屏理解 | 用户 3 秒内能说出今天下一步是什么 |
| Today | 单行动原则 | 页面主视觉只突出一个 primary action |
| Today | 热力图 | Momentum 是独立小面板，默认年度，方形小格，支持周期切换入口 |
| Goals | 只读原则 | 不出现编辑、删除、拖拽管理等操作 |
| Goals | 结构清晰 | O、KR、条件、当前缺口、阶段计划分层明确 |
| Logs | 文件树 | 年、季、月、周、日为层级，不是并列卡片 |
| Logs | Markdown 编辑 | 编辑区可输入，可保存真实日志 |
| Agent | 输入框固定 | 不需要滚动整个页面寻找输入框 |
| Agent | 历史记录 | 左侧历史可见，消息区独立滚动 |
| Settings | 配置真实 | 每项配置有当前值和影响说明，不是假按钮 |
| Settings | 模型配置 | DeepSeek、模型名、API Base、API Key、测试连接可见 |

自动化页面 smoke：

```bash
cd src
pnpm verify:dashboard-browser
```

覆盖：Today 热力图、Goals 只读结构、Logs Markdown 编辑区、Agent 固定输入框、Settings 无横向溢出和真实配置控件。完整直觉判断仍需人工验收，但布局回归不得绕过该脚本。

登录态真实数据 smoke：

```bash
cd src
pnpm verify:dashboard-browser:auth
```

覆盖：真实暑假目标、KR、日志、Agent 历史和模型配置在浏览器中可见，且仍满足无横向溢出、Agent 输入框固定、Logs 编辑区可见、Goals 只读等页面约束。

### 5.4 First-run Agent Flow Smoke

命令：

```bash
pnpm verify:first-run-agent
```

覆盖：新用户空工作区、模糊目标只追问、具体自然语言目标生成完整目标草案、确认激活后 Today 接住下一步、目标 Markdown 写入。

### 5.5 QQ Scheduler Reply Loop Smoke

命令：

```bash
pnpm verify:qq-scheduler-reply
```

覆盖：本地构造 QQ evening_review 主动提醒事件，模拟用户回复，验证反馈进入 Check-in、Diagnosis、Markdown、Review、SchedulerEvent、AgentToolAction 和 `system/meta-cognition/<goal>.md`；元认知必须包含下一次干预、AI 下次思考规则、`policy_delta` 和可验证信号。

### 5.6 Scheduler Reminder Rules Smoke

命令：

```bash
pnpm verify:scheduler-rules
```

覆盖：用户自己的 ReminderRule 被 Scheduler 消费；另一个用户更新更晚但 disabled 的 QQ 配置不会阻断当前用户规则；关闭的规则不触发；当天已达到 `maxPerDay` 不重复触发；命中 `quietHours` 不触发；没有 QQ 绑定时事件进入可审计失败状态，而不是静默丢失。

### 5.7 Zero-to-one Product Flow Smoke

命令：

```bash
pnpm verify:zero-to-one
```

覆盖：类型检查、用户隔离、模型密钥隔离、QQ 绑定码归属、部署配置边界、fresh DB 首次建库、Settings 自助配置、Agent 静态契约、AI 回复质量门禁、自主干预 Planner、控制闭环涌现、首次目标输入、Today 反馈入库、Dashboard 空状态、Scheduler 读取提醒规则和 QQ 主动提醒回复入库。

边界：该命令证明本地产品主链路可串联，并证明反馈、元认知、`policy_delta` 和 AI 自我优化能影响下一次干预；它不证明服务器长期运行、真实 QQ Gateway 送达和真实模型长期质量。

### 5.7.1 Fresh DB Bootstrap Smoke

命令：

```bash
pnpm verify:fresh-db
```

覆盖：全新 SQLite 数据库可以执行 Prisma 迁移，核心业务表存在，所有业务表初始为空，没有 seed/demo/fallback 业务数据，且可以完成最小用户创建、读取和删除。该脚本使用临时数据库，不 reset 当前开发库。

### 5.7.2 Today Feedback Loop Smoke

命令：

```bash
pnpm verify:today-feedback
```

覆盖：干净用户通过 Agent 创建第一个目标并激活，Today 读取当前下一步，提交没完成反馈后，系统写入 DailyAction 状态、Check-in、Diagnosis、Markdown 日志、Momentum、Meta-Cognition，并让 Goals/Logs API 能读到这次反馈结果。

### 5.7.3 Settings Self-service Smoke

命令：

```bash
pnpm verify:settings-self-service
```

覆盖：干净用户通过 Settings Web/API 表面保存模型 API Key、QQ Bot token、提醒节奏和行为控制；模型测试和 QQ 测试必须使用当前用户配置；绑定码只归属当前用户；Control Center 显示模型/QQ/提醒已配置；导出不泄露模型 Key 或 QQ token。

### 5.8 Empty Authenticated Dashboard Browser Smoke

命令：

```bash
pnpm verify:dashboard-browser:empty-auth
```

覆盖：新注册但没有 seed 数据的用户打开五个 Dashboard 页面时，Today/Goals/Logs/Agent/Settings 显示干净空状态、真实配置边界、无横向溢出、Agent 输入区固定可见。

### 5.9 Live Model Agent Flow Smoke

命令：

```bash
GOAL_MATE_LIVE_MODEL_API_KEY=... pnpm verify:live-model-agent
```

覆盖：新用户保存 DeepSeek Key、响应脱敏、Settings 模型测试成功、Agent 消息使用当前用户模型配置生成真实回复。

边界：该命令需要真实模型 Key 和网络权限；未执行通过前，不能声明真实模型链路已完成生产验收。

## 10. 安全和隐私用例

| ID | 场景 | 期望 |
| --- | --- | --- |
| SEC-1 | 未登录访问用户数据 API | 返回 UNAUTHORIZED |
| SEC-2 | 用户访问他人 goal/log/thread | 返回 FORBIDDEN 或 NOT_FOUND |
| SEC-3 | 模型配置读取 | API Key 不明文返回 |
| SEC-4 | 日志路径包含 `../` | 请求被拒绝或规范化，不能路径穿越 |
| SEC-5 | Agent 读取 Logs 权限关闭 | Agent 不引用日志内容 |
| SEC-6 | 陌生 QQ 会话无绑定码 | 给 QQ Bot 发送普通消息 | Worker 不自动绑定默认用户或第一个用户，只回复绑定引导 |
| SEC-7 | 删除目标、日志、记忆 | 必须强确认 |
| SEC-7 | 外部动作 execute | v0.1 不执行，必须返回确认需求或未启用 |

## 11. 人工验收清单

| 项 | 标准 |
| --- | --- |
| 产品感 | 看起来是专业目标推进工具，不是玩具聊天页 |
| 低熵 | 页面没有大量解释废话和无用卡片 |
| 直觉 | 用户能知道页面干什么、怎么用、下一步是什么 |
| 专业 | Agent 像 Codex 式工作台，输入框固定，历史清楚 |
| 行动导向 | 每个页面最终服务规划或推进 |

## 12. 未执行说明

本文档只定义测试用例。当前未执行迁移、seed、测试、类型检查、浏览器预览或人工验收。
