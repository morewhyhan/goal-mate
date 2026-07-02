# Plan: Agent Tools and Proactive Scheduler

## 1. 输入上下文

- Product requirement：`docs/shit/shit.md`
- Full draft：`docs/shit/goal-mate-full-draft/07-conversation-memory-ai-output.md`
- Full draft：`docs/shit/goal-mate-full-draft/08-reminders-integrations-permissions.md`
- Full draft：`docs/shit/goal-mate-full-draft/09-self-hosted-agent-mcp.md`
- Full draft：`docs/shit/goal-mate-full-draft/11-data-model.md`
- Designs：`docs/designs/system-context.md`
- Designs：`docs/designs/architecture.md`
- Designs：`docs/designs/qq-bot-integration.md`
- Designs：`docs/designs/markdown-document-store.md`
- Standards：`docs/standards/architecture.md`
- Standards：`docs/standards/security.md`
- Standards：`docs/standards/testing.md`

## 2. 目标

- 把 Agent 从“能读上下文并聊天”推进到“能通过受控工具操作 Goal Mate 系统”。
- 增加主动推进能力：早晨规划、中午检查、晚上复盘、周复盘。
- 让 QQ Bot 复用同一套 Agent 工具和调度能力，而不是另写一套机器人逻辑。
- 为所有 Agent 写操作增加权限边界和审计记录。
- 按手册要求区分存量事实和增量计划：Plan 记录执行过程，`docs/designs` 记录长期事实。

## 3. 非目标

- 不做企业级多人协作。
- 不做移动端或桌面端。
- 不做微信、飞书、邮箱等新渠道。
- 不做高风险外部动作自动执行，例如发邮件、改日历、付款、合同、删除外部数据。
- 不要求用户学习 OKR、Gantt、MCP 等术语。
- 不把 Agent 页面做成复杂审批后台。

## 4. 影响范围

- 代码：`src/server/api/routes/agent`、`src/lib`、`src/scripts`、`src/prisma`
- 数据库：新增 Agent tool action、permission、scheduler event、audit 相关表
- API：新增 Agent 工具执行接口、提醒规则接口、审计查询接口
- 前端：Agent 页面展示工具草稿和确认结果；Settings 页面增加工具权限和提醒设置
- 测试：增加 API、业务流、真实 QQ/DeepSeek 可选验证

## 5. 技术方案

### 5.1 当前存量判断

当前 Agent 已有：

- Web Agent 对话。
- QQ Bot 收消息和回消息。
- DeepSeek 真实模型调用。
- 读取目标上下文和 Markdown 文档的能力。

当前 Agent 缺失：

- 没有统一工具注册表。
- 没有把自然语言意图转换成系统写操作的工具链。
- 没有长期定时主动推进 worker。
- 没有工具执行权限模型。
- 没有完整审计记录。

### 5.2 增量总体结构

```text
Web Agent / QQ Bot / Scheduler
  -> Agent Runtime
  -> Context Builder
  -> Tool Intent Parser
  -> Agent Tool Registry
  -> Permission Guard
  -> Business Service
  -> Audit Log
  -> Model Reply
```

Agent 不直接改数据库。所有写操作必须经过 Tool Registry、权限校验和审计。

### 5.3 Agent 工具分层

| 层级 | 含义 | 是否需要确认 |
| --- | --- | --- |
| read | 读取目标、日志、今日行动、设置 | 不需要 |
| draft | 生成草稿，例如目标草案、日报草稿、复盘草稿 | 通常不需要，但要标记为草稿 |
| execute | 真正修改目标、今日行动、日志、提醒设置 | 默认需要确认 |

### 5.4 P0 工具清单

| 工具 | 能力 | 权限 |
| --- | --- | --- |
| `goal.list` | 列出目标摘要 | read |
| `goal.get` | 查看目标详情、KR、条件、阶段计划 | read |
| `goal.create_draft` | 根据对话生成目标草案和目标推理卡 | draft |
| `goal.update` | 修改目标状态、KR、条件或阶段节点 | execute |
| `today.get` | 获取今天下一步行动 | read |
| `today.set_next_action` | 设置或调整今天下一步行动 | execute |
| `checkin.submit` | 提交完成、部分完成、未完成和原因 | execute |
| `log.write_daily` | 写入或更新当天 Markdown 日志 | execute |
| `review.generate` | 生成日复盘或周复盘草稿 | draft |
| `reminder.schedule` | 创建或更新提醒规则 | execute |
| `settings.model.get` | 读取当前模型配置 | read |
| `settings.model.update` | 修改模型配置 | execute |

P0 不做数量很多的工具。先保证规划、推进、记录、复盘、提醒这条闭环可用。

### 5.5 调度 worker

新增 `worker:scheduler`，独立于 Next.js Web 进程运行。

```text
Scheduler Tick
  -> 读取 enabled reminder rules
  -> 判断本地时区、免打扰、每日上限、重复发送
  -> 读取当前目标、今日行动、最近日志、最近 QQ 绑定
  -> 生成主动推进消息
  -> 通过 QQ 发送
  -> 写入 AgentThread、SchedulerEvent、AuditLog
```

P0 提醒类型：

- Morning Planning：今天只推进哪一步。
- Midday Check：现在是否偏离，需要不需要缩小动作。
- Evening Review：今天完成了什么，没完成为什么。
- Weekly Review：本周推进了哪个条件，下周推进什么。

### 5.6 权限和审计

所有工具调用必须记录：

- 谁触发：Web 用户、QQ 用户、Scheduler。
- 想做什么：工具名、输入摘要。
- 影响什么：目标、日志、提醒、设置。
- 风险级别：low、medium、high。
- 是否需要确认。
- 执行结果：drafted、approved、executed、failed、rejected。

高风险外部动作本阶段只允许生成草稿，不允许自动执行。

### 5.7 用户体验原则

- 用户不需要看到工具名，除非在设置或审计里查看。
- Agent 回复必须落到一个行动结果，不能只解释概念。
- 每次提醒只问一个关键问题。
- 没完成时先诊断原因，不提高催促频率。
- Today 页面仍然保持低熵，只显示下一步和必要反馈。

## 6. 任务拆分

| 状态 | 任务 | 验收方式 |
| --- | --- | --- |
| Done | 明确当前 Agent 存量能力和缺口 | 本 Plan 和设计事实文档已记录 |
| Done | 新增 Agent Tool Registry | `src/lib/agent-tools.ts` 已注册 read/draft/execute 工具 |
| Done | 新增 Tool Permission Guard | execute 工具未确认时进入 `pending_confirmation` |
| Done | 新增 Tool Audit Log | `AgentToolAction` 记录工具调用 |
| Done | 接入 Web Agent 工具意图 | Agent 对话可识别显式系统操作，确认后执行写工具 |
| Done | 接入 Web Agent 工具确认 UI | Agent 页面显示待确认动作卡片，可点击确认或取消 |
| Done | 实现 `goal.list`、`goal.get` | 显式工具 API 可读取目标结构 |
| Done | 实现 `today.get`、`today.set_next_action` | 显式工具 API 可读取和设置今日行动 |
| Done | 实现 `checkin.submit` | 显式工具 API 可提交完成情况 |
| Done | 实现 `log.write_daily` | 显式工具 API 可写入 Markdown 日志 |
| Done | 实现 `review.generate` | 显式工具 API 可生成日/周复盘草稿 |
| Done | 实现 `reminder.schedule` | 显式工具 API 可创建或调整提醒规则 |
| Done | 新增 Scheduler Worker | `worker:scheduler` 已添加，按规则生成主动推进消息 |
| Done | 接入 QQ 主动发送 | Scheduler 已复用 QQ OpenAPI 发送提醒；长期稳定性待验证 |
| Done | 接入 QQ 工具确认流程 | QQ 对话里可生成待确认动作，回复“确认执行”后执行并审计 |
| Done | 接入 Scheduler 回复闭环 | QQ 回复最近的 Scheduler 提醒后，可写入 check-in、日志和周复盘草稿 |
| Done | 设置页补齐模型、提醒、权限配置 | Settings Control Center 已承载模型、提醒、QQ、工具审计、数据导出 |
| Done | 更新验收用例 | 新增 Agent Action Loop v0.2 测试矩阵和 `verify:agent-loop` 脚本 |

## 7. 测试策略

- 单元测试：Tool Registry、Permission Guard、Schedule 计算、Audit 写入。
- API 测试：Agent 工具执行、提醒规则 CRUD、模型设置。
- 业务流测试：目标澄清 -> 今日行动 -> QQ check-in -> 写入日志 -> 晚间复盘。
- 手工验证：QQ 真实收发、DeepSeek 真实回复、定时提醒内容是否符合产品口吻。

测试不在每次小改后自动执行。只有用户明确要求验证时再运行对应命令。

## 8. 风险与回滚

- 风险：QQ 对主动 C2C 消息可能有窗口或权限限制。
- 回滚：Scheduler 记录发送失败，不影响 Web 使用；必要时降级为 Web 内提醒。
- 风险：Agent 自动写操作可能误改数据。
- 回滚：execute 工具默认走确认和审计；高风险动作只生成草稿。
- 风险：工具过多导致系统复杂。
- 回滚：P0 只保留目标、今日行动、日志、复盘、提醒、模型配置。

## 9. 执行记录

- 2026-07-02：确认当前 Agent 仍处于“能聊、能读、能通过 QQ 回复”的阶段，缺少工具化、调度和审计。
- 2026-07-02：建立 Agent 工具化与主动推进 Plan。
- 2026-07-02：新增 `AgentToolAction`、`ReminderRule`、`SchedulerEvent` 数据模型和迁移。
- 2026-07-02：新增 `src/lib/agent-tools.ts`，提供 P0 工具注册、权限确认和审计记录。
- 2026-07-02：新增 `/api/agent/tools`、`/api/agent/tools/actions`、`/api/agent/tools/execute`。
- 2026-07-02：新增 `src/scripts/scheduler-worker.mjs` 和 `worker:scheduler` 脚本。
- 2026-07-02：Web Agent 消息链路接入工具意图识别；execute 工具默认挂起，用户回复“确认执行”后再执行。
- 2026-07-02：QQ Worker 接入工具意图识别；read/draft 工具可直接返回，execute 工具进入待确认，QQ 回复“确认执行”后执行并写入 `AgentToolAction`。
- 2026-07-02：Settings 页面改为 Control Center，接入真实模型配置、提醒规则、QQ 绑定、工具审计、调度记录和数据导出。
- 2026-07-02：QQ Worker 接入 Scheduler 回复闭环；用户回复最近一次 QQ Scheduler 提醒后，系统会记录 check-in、追加今日日志，周复盘场景生成复盘草稿，并把 SchedulerEvent 标记为 `responded`。
- 2026-07-02：新增 `docs/test-cases/agent-action-loop-v0.2-test-cases.md` 和 `src/scripts/verify-agent-action-loop.mjs`，提供 Agent 工具、Settings Control Center、提醒规则、导出和 DB 契约的自动化验收入口。
- 2026-07-02：强化 `goal.create_draft`，现在会一次性生成 Goal、GoalReasoningCard、KR、必要条件、阶段计划、今日启动行动和目标 Markdown；`goal.update` 在确认成为当前主目标时会同步确认推理卡，避免 active goal 缺少 confirmed reasoning card。
- 2026-07-02：Agent 页面新增工具确认卡片；新增工具动作确认/取消 API，用户可在 Web 里点击确认或取消，不再依赖输入“确认执行”。
- 2026-07-02：发现 Web / QQ 工具逻辑重复风险；新增共享工具运行时重构计划和自部署 worker 运行事实文档。
- 2026-07-02：新增 `deploy/systemd` 模板，覆盖 Web、QQ Worker、Scheduler Worker，并提供服务器安装、启动、日志查看和验证顺序说明。
- 2026-07-02：新增 `verify:deployment-config` 静态检查脚本和部署配置测试矩阵，部署前可检查 systemd 模板、package scripts、环境变量样例和事实文档是否一致。
- 2026-07-02：Settings Control Center 新增 runtime status，汇总 Web、模型、QQ、Scheduler、Agent Tools 的当前运行状态，便于部署后快速定位断点。
- 2026-07-02：新增 `docs/plans/self-hosted-runtime-verification-plan.md`，明确服务器真实长期运行验证步骤；`verify:deployment-config` 已增加该计划文件的静态存在性检查。
- 2026-07-02：新增 `docs/plans/self-hosted-runtime-verification-report-template.md`，服务器验收结果必须按脱敏模板记录；`verify:deployment-config` 已增加报告模板检查。
- 2026-07-02：修正 `src/.env.example` 中容易误判为真实密钥的占位符，并在部署静态检查中增加 token-shaped placeholder 扫描。
- 2026-07-02：补齐部署建议变量说明，明确 `QQ_ALLOWED_CONTEXT_IDS` 和 `QQ_SCHEDULER_REPLY_WINDOW_HOURS` 分别用于限制 QQ 会话范围和 Scheduler 回复识别窗口。
- 2026-07-02：新增 `verify:secrets` 仓库密钥卫生静态检查，扫描模型 API Key、Bot Token、Bearer Token 形状的误提交风险。
- 2026-07-02：新增 `verify:static` 轻量静态门禁，组合 `verify:secrets` 和 `verify:deployment-config`，并在 `docs/plans/static-verification-gates.md` 记录它与运行时验收的边界。
- 2026-07-02：新增 `docs/plans/verification-overview.md`，集中说明静态门禁、v0.1 验收、Agent Loop 验收和服务器长期运行验收的层级、边界和当前未执行状态。
- 2026-07-02：新增仓库根 `README.md`，把产品定位、当前状态、常用命令、验收分层和安全边界作为项目总入口。
- 2026-07-02：共享工具运行时重构推进第一步；Web 和 QQ 现在共享工具目录、确认语识别和工具回复文案，业务 handler 后续再抽。
- 2026-07-02：共享工具运行时重构推进第二步；Web 和 QQ 现在共享参数读取、日期路径、状态归一化和工具意图 JSON 解析。

- 2026-07-02：强化共享 `checkin.submit`，Agent/QQ 路径现在和 Today 页面一样会在 partial/not_done 时生成 Diagnosis，并把 Check-in、诊断问题和调整建议写入当天 LogEntry/MarkdownDocument。

- 2026-07-02：统一 Agent 日志路径，`log.write_daily` 默认写入 `logs/<year>/Qx/<year-month>/Wx/<day>.md`，和 Today Check-in、Logs 文件树保持一致。

- 2026-07-02：强化共享 `review.generate`，Agent/QQ 路径现在会生成 Review，并同步写入周期 LogEntry 与 MarkdownDocument；复盘不再只是返回一段临时 markdown。

- 2026-07-02：强化 Agent 工具路由，`generateAgentToolIntent` 在模型缺失、JSON 解析失败或置信度不足时，会对明确的查看目标、查看今日行动、查看模型、创建目标草稿、写日志、生成复盘指令使用保守本地兜底；不自动猜测高风险操作。

- 2026-07-02：强化 Agent 页面交互，空对话状态下用户可以直接输入第一句话，页面会自动创建线程并发送消息；发送消息后会刷新工具动作审计，确认卡不会在缺少动作编号时触发无效确认。

- 2026-07-02：强化 Logs 页面闭环，文件树隐藏内部 `logs/` 根路径并从年份开始展示；空状态下用户可直接创建今日日志；编辑区显示创建中/未保存/保存中/已保存状态，避免无变更保存。

- 2026-07-02：强化 Settings 页面闭环，新增真实保存的系统行为配置区，覆盖 General、Goals、Logs、Today、Agent、Data & Privacy；字段直接写入 `/api/settings` 的 UserSetting，不再只是模型/提醒/审计展示。
