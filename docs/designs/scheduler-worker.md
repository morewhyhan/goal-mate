# Scheduler Worker

## 1. 定位

Scheduler Worker 是 Goal Mate 的主动推进层。

它负责在合适的时间主动联系用户，不是为了催促，而是为了围绕目标、关键条件和今日行动持续推进。

## 2. 当前事实

截至 2026-07-02：

- QQ Bot 已经可以收消息并回复。
- Agent 已经可以读取部分目标和 Markdown 上下文。
- 系统已经新增 `src/scripts/scheduler-worker.mjs`。
- 系统已经新增 `worker:scheduler` 启动脚本。
- 系统已经新增 `ReminderRule` 和 `SchedulerEvent` 数据模型。
- Scheduler 可以按规则生成早晨规划、中午检查、晚上复盘和周复盘消息。

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
  -> ask Agent Runtime to draft prompt
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

## 6. 发送内容原则

- 一次只问一个关键问题。
- 必须关联当前目标或今日行动。
- 不做无上下文催促。
- 用户连续无响应时，不提高频率，触发诊断。
- 没完成时同时判断行为原因和路径原因。

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

Scheduler 只负责触发，具体内容由 Agent Runtime 基于当前目标、今日行动、日志和记忆生成。

Scheduler 主动发送提醒时会写入内部审计动作 `reminder.send`。该动作不暴露给用户调用，但必须通过 shared audit writer 写入 `AgentToolAction`，便于在 Settings 中看到主动提醒是否实际发送成功。

```text
Scheduler = 什么时候问
Agent Runtime = 问什么、怎么问、如何根据回答推进
Agent Tools = 需要更新系统时执行什么
```
