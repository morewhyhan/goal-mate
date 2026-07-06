# Plan: Real QQ Two-week Strong-inertia Trial

## 1. 输入上下文

- Feature：`docs/features/goal-mate-v0.1/04-agent.md`
- Feature：`docs/features/goal-mate-v0.1/10-intervention-planner.md`
- Feature：`docs/features/goal-mate-v0.1/11-meta-cognition.md`
- Feature：`docs/features/goal-mate-v0.1/13-control-loop-episode.md`
- Feature：`docs/features/goal-mate-v0.1/15-behavior-factor-model.md`
- Designs：`docs/designs/agent-runtime.md`
- Designs：`docs/designs/agent-prompt-system.md`
- Designs：`docs/designs/model-provider.md`
- Designs：`docs/designs/qq-bot-integration.md`
- Designs：`docs/designs/scheduler-worker.md`
- Plans：`docs/plans/verification-overview.md`
- Plans：`docs/plans/live-model-agent-flow-last-run.md`
- Plans：`docs/plans/two-week-control-loop-last-run.md`
- Plans：`docs/plans/long-term-dialogue-trial-last-run.md`
- Plans：`docs/plans/self-hosted-runtime-verification-plan.md`
- Test Cases：`docs/test-cases/agent-action-loop-v0.2-test-cases.md`
- Test Cases：`docs/test-cases/2026-07-06-real-qq-two-week-trial.md`

## 2. 目标

本轮目标是把“真实 QQ 用户和 Agent 聊天，强惰性用户被持续推进两周”的抽象想法转成可执行验收路径。

必须证明：

- 真实模型配置可用，且不是 fake model 或本地兜底在冒充 AI。
- QQ 绑定走真实用户会话，不依赖默认用户或第一个用户。
- 用户在 QQ 中发出的消息能被 QQ Gateway Worker 接收并写入 `QqMessageEvent`。
- Scheduler 主动消息能通过 QQ 发送，或失败时写入明确失败原因。
- 用户回复 Scheduler 后，系统进入 `Checkin`、`Diagnosis`、Markdown 日志、`Review`、`AgentToolAction(source=scheduler)` 和 meta-cognition。
- 两周强惰性剧本中，Agent 能处理敷衍、不回复、反感提醒、目标不真、任务太难、路径错误、证据不足和现实意外。
- 后续干预会根据前面反馈变小、变准、少打扰，而不是机械催促。

## 3. 非目标

- 不把真实 API Key、QQ Token、Cookie、Session 或 SSH 信息写入文档。
- 不伪装成“真实连续 14 个自然日”验收。本轮默认做压缩 14 天试运行。
- 不自动冒充 QQ 用户发消息。真实用户入站必须来自人工 QQ 客户端，除非后续明确引入平台允许的测试账号能力。
- 不新增数据库表或改 schema。
- 不切换主架构，不重做 Agent Runtime、QQ Worker 或 Scheduler Worker。
- 不把模拟 QQ 入站事件当作真实 QQ Gateway 验收证据。

## 4. 影响范围

- 代码：本 Plan 阶段不改代码。实现阶段可能新增 `src/scripts/verify-real-qq-two-week-trial.mjs` 作为证据收集器。
- 数据库：不改 schema；验收会写入临时测试用户、Goal、ReminderRule、QqChatBinding、QqMessageEvent、SchedulerEvent、AgentMessage、Checkin、Diagnosis、MarkdownDocument、Review 和 AgentToolAction。
- API：不改契约；使用现有 Settings、Models、Agent、Scheduler、QQ Worker 路径。
- 前端：不改页面；使用 Settings 进行模型、QQ、绑定码和运行状态确认。
- 测试：新增人工 E2E 用例规格；实现阶段可补一个半自动证据收集脚本。

## 5. 技术方案

### 5.1 验收分层

先跑低成本门禁，再跑真实外部依赖：

```text
静态门禁
  -> 真实模型连通性
  -> live long-term dialogue
  -> Web + QQ + Scheduler runtime
  -> 人工 QQ 压缩 14 天
  -> 证据收集与报告
```

### 5.2 真实模型

当前设计事实默认是 B.AI / `gpt-5-nano`，但运行时是 OpenAI-compatible 模型通道。若本轮要用 DeepSeek，应通过 Settings 或临时环境变量配置：

```text
GOAL_MATE_LIVE_MODEL_PROVIDER
GOAL_MATE_LIVE_MODEL_API_BASE
GOAL_MATE_LIVE_MODEL_MODEL
GOAL_MATE_LIVE_MODEL_API_KEY
```

验收报告只记录 provider、model、apiBase、成功/失败摘要，不记录 key。

### 5.3 真实 QQ

真实 QQ 验收必须走当前正确归属路径：

```text
登录 Web
  -> Settings 保存 QQ App ID / Token
  -> 生成绑定码
  -> 用户在 QQ 发送“绑定 GM-XXXXXX”
  -> QQ Worker 写入 QqChatBinding
  -> Settings 显示已绑定
```

陌生 QQ 会话不得自动归属到默认用户。

### 5.4 压缩两周剧本

压缩两周不等于直接写数据库模拟。真实链路必须至少包含：

- QQ Worker 收到用户真实 QQ 消息。
- Scheduler Worker 或一次性 Scheduler 创建真实 `SchedulerEvent`。
- QQ 发送结果或失败原因进入 `SchedulerEvent`。
- 用户回复后由 `src/lib/qq-scheduler-reply.mjs` 处理，不绕过 shared executor。

压缩方式：

- 在 `src/` 下通过 `node scripts/scheduler-worker.mjs --once --force-reminder=<type>` 触发早晨、中午、晚上、周复盘；`pnpm worker:scheduler:once` 只用于默认 morning smoke。
- 人工在 QQ 客户端按用例回复当天剧本文案。
- 每个“模拟日”之间等待 worker 完成处理并检查数据库证据。

### 5.5 证据收集器

实现阶段建议新增一个只收集证据、不保存密钥的脚本：

```text
src/scripts/verify-real-qq-two-week-trial.mjs
```

它可以做：

- 创建或读取指定测试用户。
- 检查当前用户模型配置是否可用。
- 检查 QQ 绑定和 worker heartbeat。
- 打印下一步需要人工在 QQ 发送的剧本文案。
- 轮询 `QqMessageEvent`、`SchedulerEvent`、`AgentMessage`、`Checkin`、`Diagnosis`、`MarkdownDocument`、`AgentToolAction`。
- 生成脱敏 last-run 报告。

它不应该做：

- 写入真实 API Key。
- 冒充用户 QQ 客户端发消息。
- 把模拟入站事件标记成真实 QQ 证据。

## 6. 任务拆分

| 状态 | 任务 | 验收方式 |
| --- | --- | --- |
| Done | 梳理现有文档和验证资产 | 本 Plan 引用当前事实 |
| Done | 新增真实 QQ 两周用例规格 | `docs/test-cases/2026-07-06-real-qq-two-week-trial.md` |
| Todo | 确认本轮模型供应商：DeepSeek 或继续 B.AI | Settings 模型测试或 `verify:live-model-agent` 通过 |
| Todo | 执行静态门禁 | `pnpm verify:static` |
| Todo | 执行真实模型 smoke | `pnpm verify:live-model-agent:write` |
| Todo | 执行 live 长期对话试运行 | `RUN_REAL_LONG_TERM_AI=1 pnpm verify:long-term-dialogue-trial:write` |
| Todo | 启动 Web、QQ Worker、Scheduler Worker | Settings RuntimeHeartbeat 显示最近心跳 |
| Todo | 完成真实 QQ 绑定 | `QqChatBinding.status=ENABLED` 且来源为绑定码 |
| Todo | 创建真实测试目标和提醒规则 | Goals / ReminderRule 可读 |
| Todo | 逐日执行压缩 14 天 QQ 剧本 | 每日都有真实 QQ 入站事件和系统回复 |
| Todo | 收集证据并写入 last-run 报告 | 新报告不得包含密钥或 token |

## 7. 测试策略

- 单元测试：本轮不新增业务单元测试，除非实现阶段新增证据收集器解析逻辑。
- API 测试：复用 `pnpm verify:live-model-agent:write`、`pnpm verify:agent-context:write`、`pnpm verify:agent-control:write`。
- E2E 测试：按 `docs/test-cases/2026-07-06-real-qq-two-week-trial.md` 人工执行真实 QQ 入站出站。
- 手工验证：Settings 页面确认模型、QQ、绑定、RuntimeHeartbeat、SchedulerEvent 和 AgentToolAction。

## 8. 风险与回滚

- 风险：DeepSeek 余额、限流或网络失败。
  回滚：先切回已经跑通过的 B.AI 通道，或只记录真实模型失败原因，不把失败当业务逻辑缺陷。
- 风险：QQ 平台限制主动 C2C 消息。
  回滚：保留 `SchedulerEvent.status=failed` 与 `errorMessage`，再验证用户主动发起 QQ 对话后的回复闭环。
- 风险：人工 QQ 压缩剧本漏发或发错。
  回滚：证据收集器逐步提示下一条消息，并按真实 `QqMessageEvent` 判断是否进入下一步。
- 风险：模型回复质量不稳定。
  回滚：用质量门禁记录失败样本，后续再改 prompt 或模型配置；不直接伪造通过。
- 风险：测试数据污染用户真实工作区。
  回滚：使用独立测试账号或保留明确 `verification` metadata；删除测试用户时只删该用户数据。

## 9. 执行记录

- 2026-07-06：已阅读现有文档。当前已有 deterministic two-week control loop、deterministic/live long-term dialogue trial、live model agent flow、本地 QQ scheduler reply loop；缺口是真实 QQ Gateway 入站出站加压缩 14 天强惰性人工剧本。
- 2026-07-06：新增本 Plan 和真实 QQ 两周 E2E 用例规格。等待确认后再进入实现或真实外部依赖验收。
- 2026-07-06：按用户要求新增并执行动态 DeepSeek QQ-like 试运行。`pnpm verify:dynamic-deepseek-qq:write -- --keep-data` 已接通 `.env` 中 DeepSeek，完成 14 轮非固定脚本对话，写入 QQ-like inbound/outbound、SchedulerEvent、AgentToolAction、Check-in、Diagnosis、Markdown day/week logs、Review 和 Meta-Cognition。最近报告为 `docs/plans/dynamic-deepseek-qq-trial-last-run.md`，结果 FAIL：DeepSeek 连接、QQ-like 数据语义、工具审计、控制闭环、回复质量和负载控制均 PASS；诊断覆盖只出现 `MOTIVATION` / `PATH`，未达到至少三类诊断覆盖。因此本轮不能声明完整真实 QQ 两周验收通过，也仍不证明真实 QQ Gateway 客户端送达。
