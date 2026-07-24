# Scheduler Worker

## 1. 定位

Scheduler Worker 是 Goal Mate 的主动推进触发层。

它负责在合适的时间主动联系用户，但不应该把固定模板当作干预策略。真正决定问什么、怎么提示风险、是否降难度或是否建议重审目标的，是 Intervention Planner。

## 2. 当前事实

截至 2026-07-24：

- QQ Bot 已经可以收消息并回复。
- Agent 已经可以读取部分目标和 Markdown 上下文。
- 系统已经新增 `src/scripts/scheduler-worker.mjs`。
- 系统已经新增 `worker:scheduler` 启动脚本。
- 系统已经新增 `ReminderRule` 和 `SchedulerEvent` 数据模型。
- Scheduler 可以把早晨规划、中午检查、晚上复盘和周复盘作为候选联系窗口。
- 干净用户会获得四条默认 `ReminderRule`，但全部 `enabled = false`；默认时间不等于默认授权或默认发送。
- QQ 绑定只建立对话归属，不构成主动联系 consent。
- 开启主动联系必须同时具备全局 `notifications.proactive_contact_enabled = true`、规则启用和规则 metadata 中的已确认 consent。
- Scheduler 先运行 deterministic Contact Policy，得到 `send / skip / defer`；只有 `send` 才调用 Intervention Planner 和消息生成。
- Contact Policy 不再把“时间到了”当成发送理由。它会结合当前主目标状态、目标范围内的今日行动、行动时间窗、最近反馈冷却期、周复盘的新证据，以及免打扰、待回复、连续无响应、每日限流和 QQ 平台上下文决定是否有干预价值。
- 三档节奏对应不同候选窗口：`light = morning + weekly`，`balanced = morning + evening + weekly`，`supportive = all four`。周日会为有价值的周复盘保留触达容量，避免同日普通检查先占满上限。
- 用户主动暂停立即关闭全部 QQ 规则并撤销全局授权；连续无响应达到阈值也会触发真实暂停。普通聊天不会自动恢复。
- Scheduler 已接入 AI-first `Intervention Planner`：通过联系策略后，再让 Planner 判断问什么、为什么问、控制哪个风险点。
- 模型不可用、输出不可解析或质量门禁未通过时，Scheduler 使用 `fallback_rule` 保底，不能中断主动推进。
- SchedulerEvent、AgentMessage 和 AgentToolAction 会记录 `intervention_decision` 与 `planner_source`，用于审计和后续复盘。

尚未完成：

- 长期服务器部署。
- 真实长期运行稳定性验证。
- QQ 平台主动消息限制下的完整降级策略验证。

## 3. P0 提醒类型

| 类型 | 候选时间 | 目的 |
| --- | --- | --- |
| Morning Planning | 08:30 | 确认今天只推进哪一个最小行动 |
| Midday Check | 12:30 | 判断是否偏离、是否需要缩小动作 |
| Evening Review | 21:30 | 记录完成情况、未完成原因和明日调整 |
| Weekly Review | 周日 21:00 | 总结本周推进了哪个条件，下周推进什么 |

时间必须可配置。四个时间只表示系统建议的候选窗口；新建规则默认禁用，不会因为 QQ 已绑定就自行触达。

`defer` 不是丢弃候选窗口。Scheduler 会把同一 `SchedulerEvent.scheduledFor`
更新为 `nextEligibleAt`（缺少精确时间时使用保守退避），tick 到期后 claim 同一事件并重新执行完整 Contact Policy，不新建重复 dueKey。

Settings Control Center 已承载主动联系总开关、节奏、免打扰和这些提醒规则。用户也可以在 Web / QQ 自然对话中把时机判断委托给助手；启用或恢复仍要确认，暂停立即生效。

## 4. 调度流程

```text
worker:scheduler
  -> load enabled reminder rules
  -> skip duplicate events
  -> collect consent, current goal/action, action window, recent feedback, rate-limit and QQ context
  -> Contact Policy decides send / skip / defer
  -> if skip: persist decision and stop
  -> if defer: persist nextEligibleAt; retry the same event later
  -> if send: build goal and today context
  -> ask Intervention Planner to decide intervention
  -> render one concise intervention
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

QQ Worker 会查找最近一次状态为 `sent` 的 QQ SchedulerEvent，但不会把窗口内的任意普通聊天都当成提醒反馈。只有引用了提醒消息，或文本包含明确的完成、部分完成、未完成等反馈信号时，才进入 Scheduler 回复闭环。

默认窗口是 18 小时。用户回复后：

```text
QQ reply
  -> classify done / partial / not_done
  -> classify motivation / ability / prompt / path / unknown
  -> write check-in when relevant
  -> persist nextCommitment DailyAction
  -> conservatively adjust an existing consented reminder time when reason is PROMPT
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
  -> nextCommitment / reminderAdjustment
  -> log.write_daily
  -> review.generate when evening_review / weekly_review
  -> SchedulerEvent.status = responded
  -> AgentToolAction audit
```

`src/lib/qq-scheduler-reply.mjs` 是 QQ Worker 和本地验证共用的回复处理模块。  
`pnpm verify:qq-scheduler-reply` 已覆盖 evening_review 回复场景：用户回复“没完成，太难了”后，会产生 `Checkin(NOT_DONE)`、`Diagnosis(ABILITY)`、当日 Markdown、daily Review、`AgentToolAction(source=scheduler)`，把原 `SchedulerEvent` 标记为 `responded`，并写入 `system/meta-cognition/<goal>.md`，使下一次 Planner 能读取新的干预假设、AI 下次思考规则和 `policy_delta`。

Scheduler 消息会把当前 `goalId / currentActionId` 写入 payload；回复处理优先使用这个
target，避免把反馈记到别的目标。`checkin.submit` 返回实际落库的
`nextCommitment`，QQ 只有看到 `persisted: true` 才会说“下一步已经写入”。PROMPT
诊断如果确实更新了已有授权规则，还会返回 `reminderAdjustment` 并明确展示前后候选时间；没有落库就不会声称已调整。

`pnpm verify:scheduler-rules` 覆盖提醒规则消费和本地 fake QQ 发送链路。主动联系边界另由纯策略测试覆盖：规则关闭、缺少 consent、已完成、免打扰、待回复、连续无响应、每日限流、缺少绑定和 QQ C2C 上下文不足都不能进入实际发送；skip / defer 原因会写入 `SchedulerEvent` 和 `reminder.evaluate` 审计。

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
- 用户连续无响应时，不提高频率；达到阈值后关闭主动联系。
- 没完成时同时判断行为原因和路径原因。
- 必须识别当前风险点，并在必要时给出提前提示或止损动作。
- 不能使用强制、羞辱或机械施压表达。
- 主动消息必须能被后续反馈验证其有效性。

## 6.1 与 Intervention Planner 的关系

```text
Scheduler = 哪些候选窗口到期
Contact Policy = 此刻是否值得且允许联系
Intervention Planner = 为什么此刻干预、问什么、控什么风险
Agent Runtime = 用真人秘书式语言表达
Agent Tools = 用户反馈后更新系统状态
Meta-Cognition = 根据干预效果更新下一次策略
```

Scheduler 不应该硬编码每类提醒的完整话术。固定提醒类型只提供候选窗口；Contact Policy 先决定此刻是否允许联系，具体内容再由目标状态、风险点、最近反馈和元认知判断生成。

用户反馈后的下一承诺和提示调时属于 Agent Tools / Control Loop 的写入结果。Scheduler
下一轮读取这些新事实，不使用上一轮回复里的文字承诺代替系统状态。

## 7. QQ 主动消息边界

QQ 主动消息能力依赖平台权限和最近会话上下文。

系统策略：

- `QqChatBinding` 只证明发给谁，不能替代主动联系 consent。
- consent metadata 必须绑定一个明确的 QQ `contextType + contextId`；Scheduler 不能把私人目标提醒随意发到“最近绑定”的群或频道。
- C2C 最近有用户消息且仍在被动回复窗口时，使用 `c2c_passive` 和来源消息 ID。
- 超出被动回复窗口、但仍满足平台唤醒条件和额度时，使用 `c2c_wakeup`。
- 缺少最近用户上下文、召回窗口过期或达到平台额度时，选择 defer，不伪造送达。
- 群和频道使用 `group_active` 模式。
- 发送失败时记录失败原因，不丢失调度事件。

Contact Policy 的固定判定顺序是：

```text
rule enabled
  -> no explicit opt-out
  -> global consent + rule consent
  -> not quiet
  -> no-response threshold not reached
  -> not awaiting a reply
  -> below daily limits
  -> authorized QQ context exists and is unambiguous
  -> intervention value gate passes
  -> QQ channel mode eligible
  -> send
```

干预价值门禁会继续检查：

- 目标存在、仍处于可推进状态并且是当前焦点。
- “今天已完成”的行动确实属于当前目标，不能用另一个目标的完成记录误抑制。
- 当前目标有相关行动，且行动处于今天或有效风险窗口。
- 刚收到反馈时先进入冷却期，不马上再追问。
- 中午联系只用于启动风险或恢复窗口，晚上联系只用于收集必要反馈。
- 周复盘必须有新活动或仍有未闭合条件，不能无证据重复复盘。

其中免打扰、待回复、行动尚未进入窗口、最近刚反馈和部分平台条件返回 `defer`；未授权、目标已暂停 / 完成、当前行动已完成、无干预价值、超限、无绑定等返回 `skip`；明确拒绝和连续无响应还会设置 `shouldPauseAll` 并真正关闭规则。

`defer` 会保留当前事件、写入 `nextEligibleAt` 和历史判定，并在到期后重跑授权、目标、行动、限流与平台条件。到期重试不保证最终发送：条件变化后仍可再次 defer 或 skip。

## 8. 数据需求

P0 需要新增或复用：

| 数据 | 用途 |
| --- | --- |
| Reminder Rule | 候选时间、渠道、每日上限、enabled、已确认 consent 和授权 QQ context metadata |
| UserSetting.notifications | 主动联系总授权、节奏、连续无响应暂停阈值 |
| Scheduler Event | 防止重复发送，记录 sent / skipped / deferred / failed 及 Contact Policy 证据 |
| Tool Audit Log | 记录调度触发的 Agent 工具动作 |
| QqChatBinding | 找到 QQ 推送目标 |
| AgentThread | 保存主动提醒和用户回复 |

## 9. 与 Agent 工具的关系

Scheduler 不直接生成业务结论。

Scheduler 负责扫描候选窗口并执行 Contact Policy；通过发送门禁后，具体内容由 Intervention Planner 和 Agent Runtime 基于当前目标、今日行动、日志、记忆和元认知生成。

Scheduler 主动发送提醒时会写入内部审计动作 `reminder.send`。该动作不暴露给用户调用，但必须通过 shared audit writer 写入 `AgentToolAction`，便于在 Settings 中看到主动提醒是否实际发送成功。

每次候选窗口的联系判定还会写入 `reminder.evaluate`。因此“到点但不该打扰”也是可解释、可审计的结果，不会被误记为发送失败。

```text
Scheduler = 候选时机
Contact Policy = 要不要问
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
pnpm test
```

`verify:intervention-planner` 用纯本地场景证明 Planner 不是固定模板：它能识别难度问题、关键风险点、连续无响应；能优先接受合法 AI Policy 输出；能在缺少 API Key、模型输出鸡汤话或缺少可验证信号时降级到 fallback；还能生成元认知假设和拒绝模糊记忆。

`verify:scheduler-rules` 用本地 fake QQ API 证明 Scheduler 发送出去的主动消息不是空提醒：它必须指向当前 DailyAction，包含 fallback 行动，持久化 `intervention_decision`，并写入 `AgentMessage` 与 `AgentToolAction(reminder.send)`。

纯策略测试证明 consent 和 send / skip / defer 的逻辑边界，不需要访问真实 QQ。真实 Gateway 长连、平台主动消息权限和长期送达只属于外部运行验收，本轮不据此声明已经通过。

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
  -> 用户明确允许主动联系
  -> Scheduler Worker 自动读取已确认的候选规则
  -> 到点先判断是否值得打扰，再发送、跳过或暂不发送
```

Scheduler 到点前会自动调用 Today 行动规划，确保早晨/中午/晚上消息不是空提醒，而是带有：

- 今天只做什么
- 完成标准
- 最小启动
- 风险兜底

晚上复盘回复后，QQ Worker 不只写 check-in 和日记，还会触发 `review.generate` 生成日复盘，用于第二天的干预策略。
