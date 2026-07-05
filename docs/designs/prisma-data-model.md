# Goal Mate v0.1 Prisma 数据模型设计

## 1. 定位

本文件说明 `src/prisma/schema.prisma` 如何承载 v0.1 PRD。Prisma schema 是后续 Hono API、React Query hooks、Agent 结构化输出落库的数据库依据。

## 2. 保留认证模型

继续保留 Better Auth 需要的模型：

| 模型 | 说明 |
| --- | --- |
| user | 用户 |
| session | 登录会话 |
| account | 账号登录方式 |
| verification | 验证记录 |

模板里的 `task` 已删除，Goal Mate 不再使用任务清单作为业务核心。

## 3. 目标推进核心

| 模型 | PRD 对应 | 说明 |
| --- | --- | --- |
| Goal | F1/F6 | 用户目标，v0.1 可多个，但 Today 只使用 current_focus_goal |
| GoalReasoningCard | F1/F3 | 目标推理卡，保存 AI 对目标、成功标准、条件和当前缺口的结构化理解 |
| KeyResult | F1/F6 | 隐式 OKR 的 KR，用户可见但不要求学习 OKR |
| GoalCondition | F1/F6 | 必要条件、假设条件、支撑条件 |
| StagePlan | F1/F6 | 阶段节点和周期计划 |
| DailyAction | F1/F2/F6 | 今日行动，必须绑定 GoalCondition |
| Checkin | F1/F7 | 用户完成、部分完成、没做等反馈 |
| Diagnosis | F1/F3/F7 | 未完成诊断，区分 motivation、ability、prompt、path、condition、goal |
| Review | F1/F4/F7 | 日/周/月/年/目标周期复盘 |

## 4. 日志和 Agent

| 模型 | PRD 对应 | 说明 |
| --- | --- | --- |
| LogEntry | F4/F6 | Markdown 日志，按年/季/月/周/日路径保存 |
| AgentThread | F3/F6 | 对话历史线程 |
| AgentMessage | F3/F6 | 对话消息，可保存 structured_output 草案 |

## 5. 设置和模型

| 模型 | PRD 对应 | 说明 |
| --- | --- | --- |
| UserSetting | F5/F6 | General、Goals、Logs、Today、Agent、Notifications、Data & Privacy 配置 |
| ModelConfig | F5/F6 | B.AI 等 OpenAI-compatible模型配置，保存 apiKeyRef，不保存明文 API Key |

## 6. 后续预留

| 模型 | 说明 |
| --- | --- |
| IntegrationAccount | 微信、飞书、Telegram、日历等后续接入账号 |
| ExternalActionRequest | 外部工具执行请求，v0.1 只预留，执行必须确认 |

## 7. 关键不变量

| 编号 | 不变量 | 承载方式 |
| --- | --- | --- |
| INV-1 | 一个用户同一时间只能有一个 current_focus_goal 进入 Today | Goal.isCurrentFocus + 应用层校验 |
| INV-2 | active goal 必须有 confirmed GoalReasoningCard | Goal.status + Goal.currentReasoningCardId + ReasoningCardStatus |
| INV-3 | DailyAction 必须有 linked_condition | DailyAction.conditionId 必填 |
| INV-4 | Agent 关键修改必须确认 | AgentMessage.structuredOutput + 后续 confirm API |
| INV-5 | API Key 不明文返回 | ModelConfig.apiKeyRef |
| INV-6 | 日志不能覆盖用户手写内容 | LogEntry.content + log_patch write_mode 规则 |

## 8. 当前状态

当前 `src/prisma/schema.prisma` 已经承载 Goal Mate v0.1 的核心模型：

- 目标推进核心模型。
- MarkdownDocument 和 MarkdownDocumentLink。
- AgentThread 和 AgentMessage。
- ModelConfig 和 UserSetting。
- QQ Bot 绑定和消息事件。
- ReminderRule 和 SchedulerEvent。
- AgentToolAction 审计。
- QQ 一次性绑定码不新增独立表，保存在当前用户 `IntegrationAccount(provider=qq_bot).permissions` 中；绑定成功后清空绑定码，并写入 `QqChatBinding`。

后续如果继续演进，需要优先同步：

- schema。
- API route。
- seed / demo data。
- `docs/designs/prisma-data-model.md`。
- `docs/designs/database.sql`。
