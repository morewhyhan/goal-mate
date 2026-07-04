# Scheduler Worker

## 1. 定位

Scheduler Worker 是 Goal Mate 的主动推进触发层。

它负责在合适的时间主动联系用户，但不应该把固定模板当作干预策略。真正决定问什么、怎么提示风险、是否降难度或是否建议重审目标的，是 Intervention Planner。

## 2. 当前事实

截至 2026-07-02：

- QQ Bot 已经可以收消息并回复。
- Agent 已经可以读取部分目标和 Markdown 上下文。
- 系统已经新增 `src/scripts/scheduler-worker.mjs`。
- 系统已经新增 `worker:scheduler` 启动脚本。
- 系统已经新增 `ReminderRule` 和 `SchedulerEvent` 数据模型。
- Scheduler 可以按规则生成早晨规划、中午检查、晚上复盘和周复盘消息。
- Scheduler 已接入 AI-first `Intervention Planner`：到点后先让 AI Policy Planner 判断问什么、为什么问、控制哪个风险点，再发送消息。
- 模型不可用、输出不可解析或质量门禁未通过时，Scheduler 使用 `fallback_rule` 保底，不能中断主动推进。
- SchedulerEvent、AgentMessage 和 AgentToolAction 会记录 `intervention_decision` 与 `planner_source`，用于审计和后续复盘。

尚未完成：

- 长期服务器部署。
- 真实长期运行稳定性验证。
- QQ 平台主动消息限制下的完整降级策略验证。

## 3. P0 提醒类型

| 类型 | 默认时间 | 目的 |
| --- | --- | --- |
| Morning Planning | 08:30 | 确认今天只推进哪一个最小行动 |
| Midday Check | 12:30 | 判断是否偏离、是否需要缩小动作 |
| Evening Review | 21:30 | 记录完成情况、未完成原因和明日调整 |
| Weekly Review | 周日 21:00 | 总结本周推进了哪个条件，下周推进什么 |

时间必须可配置，默认值只是系统初始建议。

Settings Control Center 已承载这些提醒规则。用户可以在设置页启用/关闭早晨规划、中午检查、晚上复盘和周复盘，并修改触发时间。

## 4. 调度流程

```text
worker:scheduler
  -> load enabled reminder rules
  -> respect timezone and quiet hours
  -> skip duplicate events
  -> build goal and today context
  -> ask Intervention Planner to decide intervention
  -> ask Agent Runtime to render the message
  -> send through QQ
  -> store scheduler event
  -> store audit log
```

启动命令：

```bash
pnpm worker:scheduler
```

环境变量：

| 变量 | 默认值 |
| --- | --- |
| `SCHEDULER_TICK_SECONDS` | `60` |
| `SCHEDULER_TIMEZONE` | `Asia/Shanghai` |
| `SCHEDULER_MORNING_TIME` | `08:30` |
| `SCHEDULER_MIDDAY_TIME` | `12:30` |
| `SCHEDULER_EVENING_TIME` | `21:30` |
| `SCHEDULER_WEEKLY_TIME` | `SUN 21:00` |
| `QQ_SCHEDULER_REPLY_WINDOW_HOURS` | `18` |

## 5. 回复闭环

QQ Worker 会把最近一次状态为 `sent` 的 QQ SchedulerEvent 视为可回复提醒。

默认窗口是 18 小时。用户回复后：

```text
QQ reply
  -> classify done / partial / not_done
  -> classify motivation / ability / prompt / path / unknown
  -> write check-in when relevant
  -> append daily Markdown log
  -> generate weekly review draft when relevant
  -> mark SchedulerEvent as responded
```

待确认工具优先级高于 Scheduler 回复。也就是说，如果用户回复“确认执行”，系统会优先确认工具动作，不会把它误判为提醒反馈。

当前增量事实：

```text
QQ Scheduler Reply Runtime
  -> classify QQ reply
  -> checkin.submit
  -> log.write_daily
  -> review.generate when evening_review / weekly_review
  -> SchedulerEvent.status = responded
  -> AgentToolAction audit
```

`src/lib/qq-scheduler-reply.mjs` 是 QQ Worker 和本地验证共用的回复处理模块。  
`pnpm verify:qq-scheduler-reply` 已覆盖 evening_review 回复场景：用户回复“没完成，太难了”后，会产生 `Checkin(NOT_DONE)`、`Diagnosis(ABILITY)`、当日 Markdown、daily Review、`AgentToolAction(source=scheduler)`，把原 `SchedulerEvent` 标记为 `responded`，并写入 `system/meta-cognition/<goal>.md`，使下一次 Planner 能读取新的干预假设、AI 下次思考规则和 `policy_delta`。

`pnpm verify:scheduler-rules` 已覆盖提醒规则消费和发送内容场景：用户保存的 `ReminderRule` 会被 Scheduler 读取；另一个用户更新更晚但 disabled 的 QQ 配置不会阻断当前用户规则；关闭的规则不会触发；当天达到 `maxPerDay` 后不会重复触发；命中 `quietHours` 时不会创建事件；没有 QQ 绑定时会留下 failed `SchedulerEvent`，而不是静默丢失；有 QQ 绑定时会通过本地 fake QQ API 完成 token + send，捕获到的消息必须包含今日行动、fallback、Planner 决策和后续审计。

这个验证证明回复闭环的本地运行时可用；它不证明真实 QQ Gateway 长连、平台主动消息权限或服务器长期运行已经通过。

当前新增边界：

- 官方默认消息 API 仍使用 `https://api.sgroup.qq.com`。
- 官方默认 token API 使用 `https://bots.qq.com`。
- 当用户在 Settings 配置自定义 `apiBase` 时，Scheduler 会对该 base 调用 `/app/getAppAccessToken` 和消息发送接口，便于自部署网关、代理或本地 fake QQ 验证。
- 该能力证明“Settings 中的 QQ API Base 会真实影响 Scheduler 发送链路”，不是只影响部分请求。

## 6. 发送内容原则

- 一次只问一个关键问题。
- 必须关联当前目标或今日行动。
- 不做无上下文催促。
- 用户连续无响应时，不提高频率，触发诊断。
- 没完成时同时判断行为原因和路径原因。
- 必须识别当前风险点，并在必要时给出提前提示或止损动作。
- 不能使用强制、羞辱或机械施压表达。
- 主动消息必须能被后续反馈验证其有效性。

## 6.1 与 Intervention Planner 的关系

```text
Scheduler = 何时触发
Intervention Planner = 为什么此刻干预、问什么、控什么风险
Agent Runtime = 用真人秘书式语言表达
Agent Tools = 用户反馈后更新系统状态
Meta-Cognition = 根据干预效果更新下一次策略
```

Scheduler 不应该硬编码每类提醒的完整话术。固定提醒类型只提供默认触达窗口；具体内容必须由目标状态、风险点、最近反馈和元认知判断生成。

## 7. QQ 主动消息边界

QQ 主动消息能力依赖平台权限和最近会话上下文。

系统策略：

- 优先使用已绑定的 `QqChatBinding`。
- 发送前读取最近一条可用 QQ 消息事件作为上下文。
- 发送失败时记录失败原因，不丢失调度事件。
- 如果 QQ 平台限制主动 C2C 消息，Web 内提醒作为降级路径。

## 8. 数据需求

P0 需要新增或复用：

| 数据 | 用途 |
| --- | --- |
| Reminder Rule | 用户设置提醒时间、渠道、每日上限 |
| Scheduler Event | 防止重复发送，记录调度结果 |
| Tool Audit Log | 记录调度触发的 Agent 工具动作 |
| QqChatBinding | 找到 QQ 推送目标 |
| AgentThread | 保存主动提醒和用户回复 |

## 9. 与 Agent 工具的关系

Scheduler 不直接生成业务结论。

Scheduler 只负责触发，具体内容由 Intervention Planner 和 Agent Runtime 基于当前目标、今日行动、日志、记忆和元认知生成。

Scheduler 主动发送提醒时会写入内部审计动作 `reminder.send`。该动作不暴露给用户调用，但必须通过 shared audit writer 写入 `AgentToolAction`，便于在 Settings 中看到主动提醒是否实际发送成功。

```text
Scheduler = 什么时候问
Intervention Planner = 问什么、为什么问、控制哪个风险点
Agent Runtime = 怎么问、如何根据回答推进
Agent Tools = 需要更新系统时执行什么
```

相关规格：

- `docs/features/goal-mate-v0.1/10-intervention-planner.md`
- `docs/features/goal-mate-v0.1/11-meta-cognition.md`

## 10. 验证

本地不依赖服务器的验证入口：

```bash
pnpm verify:intervention-planner
pnpm verify:agent-loop:static
```

`verify:intervention-planner` 用纯本地场景证明 Planner 不是固定模板：它能识别难度问题、关键风险点、连续无响应；能优先接受合法 AI Policy 输出；能在缺少 API Key、模型输出鸡汤话或缺少可验证信号时降级到 fallback；还能生成元认知假设和拒绝模糊记忆。

`verify:scheduler-rules` 用本地 fake QQ API 证明 Scheduler 发送出去的主动消息不是空提醒：它必须指向当前 DailyAction，包含 fallback 行动，持久化 `intervention_decision`，并写入 `AgentMessage` 与 `AgentToolAction(reminder.send)`。

## 11. 当前增量事实：Scheduler 到 ControlLoopEpisode

Scheduler 负责触发主动干预，并在消息发送前记录 `intervention_decision`。

后续用户通过 QQ / Agent / Today 反馈完成情况时，反馈必须进入 `submitControlLoopFeedback()` 代表的 ControlLoopEpisode 语义：

```text
Scheduler intervention_decision
  -> 用户回复或打卡
  -> ControlLoopEpisode
  -> Checkin / Diagnosis / GoalStateTransition
  -> LogProjection
  -> MetaCognition evaluation / policy_delta
  -> 下一次 Intervention Planner 消费
```

这意味着 Scheduler 不负责长期学习；它提供干预证据，学习由 ControlLoopEpisode 和 Meta-Cognition 完成。

## 12. 当前增量事实：启动与主动推进体验

用户不应该手动理解或分别启动 `worker:qq`、`worker:scheduler`。

本地开发下，`pnpm dev` 已经改为启动 supervisor：

```text
pnpm dev
  -> Web
  -> QQ Worker
  -> Scheduler Worker
```

生产部署下，systemd 安装脚本会 enable 并 restart：

```text
goal-mate-web.service
goal-mate-qq-worker.service
goal-mate-scheduler-worker.service
```

用户体验应该是：

```text
启动 Goal Mate
  -> 在 Settings 配置模型和 QQ
  -> QQ Worker 自动连接或等待配置
  -> Scheduler Worker 自动读取提醒规则
  -> 到点主动发送早中晚/周复盘消息
```

Scheduler 到点前会自动调用 Today 行动规划，确保早晨/中午/晚上消息不是空提醒，而是带有：

- 今天只做什么
- 完成标准
- 最小启动
- 风险兜底

晚上复盘回复后，QQ Worker 不只写 check-in 和日记，还会触发 `review.generate` 生成日复盘，用于第二天的干预策略。
