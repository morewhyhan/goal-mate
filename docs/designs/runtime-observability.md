# Runtime Observability

## 1. 定位

Runtime Observability 说明 Goal Mate 如何让用户和开发者知道系统是否真的在运行。

这个产品不能只“看起来有 Agent”。它必须能解释：

- 消息有没有收到。
- 模型有没有调用成功。
- 工具有没有执行。
- 提醒有没有发送。
- 失败原因是什么。
- 用户回复有没有进入闭环。

## 2. 观测对象

| 对象 | 表 / 来源 | 说明 |
| --- | --- | --- |
| Agent messages | `AgentThread`、`AgentMessage` | 对话是否保存 |
| Tool actions | `AgentToolAction` | Agent 做过什么、是否确认、是否失败 |
| Scheduler events | `SchedulerEvent` | 主动提醒是否触发、发送、回应 |
| QQ messages | `QqMessageEvent` | QQ 事件是否收到、回复、失败 |
| QQ bindings | `QqChatBinding` | QQ 会话是否绑定用户 |
| Model status | Settings model test | 模型是否可用 |
| Runtime status | Settings Control Center | Web、model、qq、scheduler、tools 摘要 |

## 3. AgentToolAction

每次工具动作必须能回答：

- 谁触发。
- 从哪个入口触发。
- 触发了什么工具。
- 输入摘要是什么。
- 是否需要确认。
- 影响哪个对象。
- 执行成功还是失败。
- 失败原因是什么。

这比普通日志更重要，因为它是 Agent 行为审计。

## 4. SchedulerEvent

SchedulerEvent 必须能回答：

- 哪条 ReminderRule 触发。
- 计划什么时候触发。
- 实际什么时候触发。
- 发送渠道是什么。
- 状态是 sent、failed、responded 还是 skipped。
- 失败原因是什么。
- 用户回复是否被识别。

主动提醒失败不能静默失败。

## 5. QqMessageEvent

QQ Worker 必须记录每条消息事件的处理结果。

用途：

- 防止重复处理。
- 排查 QQ Gateway 或 OpenAPI 问题。
- 关联 AgentThread 和 AgentMessage。
- 解释为什么某条 QQ 消息没有被回复。

## 6. Settings Control Center

Settings 页面应展示简明运行状态。

推荐状态：

| 状态 | 说明 |
| --- | --- |
| Web | API 是否可用 |
| Model | 默认模型是否配置和可测 |
| QQ | 是否存在 enabled binding |
| Scheduler | 是否有最近调度事件 |
| Tools | 是否有最近 AgentToolAction |

用户不需要看数据库，但必须能知道系统卡在哪里。

## 7. 当前缺口

已具备：

- AgentToolAction 审计。
- SchedulerEvent。
- QqMessageEvent。
- Settings runtime status。
- Prompt version runtime status。
- 最近错误聚合，包括工具失败、Scheduler 失败和最近 QQ 失败事件。
- 部署静态验证。

仍需补强：

- 长期运行 dashboard。
- token 成本和 prompt cache 观测。
- worker 心跳。
- 最近错误聚合。
- 真实服务器运行报告。
