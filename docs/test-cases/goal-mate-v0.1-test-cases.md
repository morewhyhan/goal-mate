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
| E2E-3 | Today 只展示一个主行动、完成标准、最小启动和反馈入口 | 打开 `/dashboard/today` | 页面只有一个主行动，显示 linked condition、done_when、minimum_step 和反馈按钮 |
| E2E-4 | 用户完成行动后更新 Checkin、KR/条件证据，并写入当日日志 | 在 Today 点击完成 | DailyAction 状态更新，Checkin 创建，LogEntry 追加 Check-in 区块 |
| E2E-5 | 用户未完成行动后触发诊断 | 在 Today 点击没做并提供反馈 | Diagnosis 创建，category 属于 motivation/ability/prompt/path/condition/goal/unknown |
| E2E-6 | Goals 只读展示 O、多条 KR、条件、Gantt/周期进度 | 打开 `/dashboard/goals` | 显示 Objective、KR、Conditions、Cycle Plan，不出现编辑/删除目标按钮 |
| E2E-7 | Logs 展示年/季/月/周/日文件树和 Markdown 编辑器 | 打开 `/dashboard/logs` | 文件树层级存在，点击日志显示 Markdown，可保存已有日志 |
| E2E-8 | Agent 有历史、消息区、固定输入框 | 打开 `/dashboard/agent` | 左侧历史存在，中间消息区滚动，底部输入框始终可见 |
| E2E-9 | Settings 能配置模型、提醒、日志、数据和隐私 | 打开 `/dashboard/settings` | Models、Logs、Agent、Notifications、Data & Privacy 等分类可见，模型测试按钮调用 API |

## 6. API 契约用例

| ID | API | 操作 | 期望 |
| --- | --- | --- | --- |
| API-SET-1 | `GET /api/settings` | 已登录用户读取设置 | 返回 `{ data }`，包含 general、goals、logs、today、agent、notifications、dataPrivacy |
| API-SET-2 | `PUT /api/settings` | 保存提醒或日志设置 | 返回更新后的 UserSetting，后续读取一致 |
| API-SET-3 | `GET /api/settings/export` | 导出用户数据 | 返回 goals、logs、agentThreads、models、settings，models 不含明文 API Key |
| API-MOD-1 | `GET /api/models` | 读取模型配置 | 至少返回 DeepSeek 默认配置，apiKeyRef 脱敏 |
| API-MOD-2 | `POST /api/settings/models/test` | 测试默认模型连接 | 返回 `{ ok: true }` 或明确模型连接失败错误 |
| API-LOG-1 | `GET /api/logs/tree` | 读取日志树 | 返回按 path 排序的日志节点数据 |
| API-LOG-2 | `PUT /api/logs/:id` | 保存 Markdown | 返回更新后的 LogEntry |
| API-LOG-3 | `POST /api/logs/patch` | 追加 log_patch | 不覆盖用户手写内容，追加系统区块 |
| API-GOAL-1 | `GET /api/goals` | 读取目标列表 | 返回目标、KR、条件、阶段、最近行动 |
| API-GOAL-2 | `POST /api/goals/reasoning-card/draft` | 创建推理卡草案 | 新卡状态为 pending_user_confirmation |
| API-GOAL-3 | `POST /api/goals/reasoning-card/:id/confirm` | 确认推理卡 | 当前卡 confirmed，旧 confirmed 卡 stale |
| API-TODAY-1 | `GET /api/today` | 读取今日行动 | 返回 current focus goal 和唯一 planned action |
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

## 10. 安全和隐私用例

| ID | 场景 | 期望 |
| --- | --- | --- |
| SEC-1 | 未登录访问用户数据 API | 返回 UNAUTHORIZED |
| SEC-2 | 用户访问他人 goal/log/thread | 返回 FORBIDDEN 或 NOT_FOUND |
| SEC-3 | 模型配置读取 | API Key 不明文返回 |
| SEC-4 | 日志路径包含 `../` | 请求被拒绝或规范化，不能路径穿越 |
| SEC-5 | Agent 读取 Logs 权限关闭 | Agent 不引用日志内容 |
| SEC-6 | 删除目标、日志、记忆 | 必须强确认 |
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
