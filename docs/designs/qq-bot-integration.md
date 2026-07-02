# Goal Mate QQ Bot Integration

## 1. 结论

Goal Mate 第一版主机器人通道改为 QQ Bot。

原因：

- 用户使用门槛比 Telegram 低。
- 不要求用户安装飞书。
- 技术上可以使用 Gateway long-running worker，不需要公网域名。
- 适合部署在用户已有服务器上长期运行。

## 2. 接入形态

不用 webhook。

使用 QQ Bot Gateway 常驻 Worker：

```text
Goal Mate 服务器 -> 连接 QQ Gateway WebSocket
QQ 消息事件 -> Worker 收到 -> 写入 AgentThread
Agent 读取目标 + MD 文档 -> DeepSeek 回复
Worker 调 QQ OpenAPI sendMessage -> 回 QQ
```

这个方案不需要：

- 域名
- HTTPS webhook
- 暴露 80/443

只要求：

- 服务器长期在线
- 服务器可以访问 QQ OpenAPI
- 服务器可以访问 DeepSeek API

## 3. 环境变量

| 变量 | 用途 |
| --- | --- |
| `QQ_BOT_APP_ID` | QQ 机器人 AppID |
| `QQ_BOT_TOKEN` | QQ 机器人 Token |
| `QQ_BOT_API_BASE` | 默认 `https://api.sgroup.qq.com` |
| `QQ_BOT_INTENTS` | Gateway 事件订阅位，默认 `33554432` |
| `QQ_DEFAULT_USER_EMAIL` | 默认绑定到哪个 Goal Mate 用户 |
| `QQ_ALLOWED_CONTEXT_IDS` | 可选白名单，逗号分隔；为空表示不限制 |

真实 token 只允许放 `.env`，不能写进代码或文档。

## 4. 数据模型

### QqChatBinding

用于把 QQ 的对话上下文绑定到 Goal Mate 用户。

| 字段 | 含义 |
| --- | --- |
| `userId` | Goal Mate 用户 |
| `contextType` | `c2c` / `group` / `channel` |
| `contextId` | QQ OpenID、群 OpenID 或频道 ID |
| `username` / `nickname` | QQ 侧展示信息 |
| `status` | enabled / disabled / error |

### QqMessageEvent

用于记录每条 QQ 事件的处理结果，避免重复处理。

| 字段 | 含义 |
| --- | --- |
| `eventId` | QQ 消息事件 ID |
| `eventType` | 例如 `C2C_MESSAGE_CREATE`、`GROUP_AT_MESSAGE_CREATE` |
| `contextType` | `c2c` / `group` / `channel` |
| `contextId` | 对话上下文 |
| `messageText` | 用户文本 |
| `payload` | 原始 QQ 事件 |
| `status` | received / replied / ignored / failed |
| `agentThreadId` | 对应 Agent 线程 |
| `agentMessageId` | Agent 回复消息 |
| `replyMessageId` | QQ 发出的回复消息 ID |

## 5. Worker

启动命令：

```bash
pnpm worker:qq
```

Worker 做这些事：

1. 请求 QQ `/gateway` 获取 WebSocket 地址。
2. 连接 Gateway。
3. 发送 Identify。
4. 维护 heartbeat。
5. 接收消息事件。
6. 根据 `contextType + contextId` 绑定用户。
7. 写入 Agent 消息。
8. 调 DeepSeek。
9. 回发 QQ。
10. 记录 `QqMessageEvent`。

## 6. 支持的事件

当前 worker 预留支持：

| 事件 | 场景 |
| --- | --- |
| `C2C_MESSAGE_CREATE` | 单聊 |
| `GROUP_AT_MESSAGE_CREATE` | 群里 @机器人 |
| `GROUP_MESSAGE_CREATE` | 群消息 |
| `AT_MESSAGE_CREATE` | 频道 @机器人 |
| `DIRECT_MESSAGE_CREATE` | 频道私信 |

实际能收到哪些事件取决于 QQ 开放平台给你的机器人权限和 `QQ_BOT_INTENTS`。

## 7. 权限边界

QQ Bot 可以：

- 接收 QQ 文本消息。
- 调用 Agent 读取目标、KR、条件、今日行动、MD 文档。
- 调 DeepSeek 生成回复。
- 把回复发回 QQ。

QQ Bot 不可以：

- 自动修改目标。
- 自动修改设置。
- 自动执行高风险外部动作。

高风险动作后续必须进入 `ExternalActionRequest`，由用户确认。

## 8. 当前 v0.1 边界

已实现：

- QQ 数据模型。
- QQ Gateway worker。
- QQ HTTP OpenAPI 请求封装。
- C2C / 群 / 频道事件解析。
- QQ 对话绑定 Goal Mate 用户。
- QQ 消息进入 AgentThread。
- Agent 读取目标和 MD 文档。
- DeepSeek 回复。
- QQ sendMessage 回发。
- QQ 工具意图识别。
- QQ read/draft 工具执行。
- QQ execute 工具待确认。
- QQ 文本“确认执行”后执行工具动作。
- Agent 工具审计。

暂未实现：

- QQ 开放平台参数自动配置。
- 多用户自助绑定码。
- QQ 图片/语音/文件消息。
- QQ 主动定时提醒代码路径和 Scheduler Worker 资产已具备，但服务器长期运行验收未完成。
- QQ 卡片消息。
- 权限审批 UI。

## 9. 与 Agent Tool Runtime 的关系

QQ Bot 是 Agent 的消息入口，不是独立业务系统。

```text
QQ Message
  -> QQ Worker
  -> Agent Runtime
  -> Agent Tool Runtime
  -> Goal / Today / Logs / Reminder / Settings
  -> QQ Reply
```

QQ Bot 可以触发 read 和 draft 工具。execute 工具默认需要用户回复“确认执行”。

当前 QQ 确认流程：

```text
用户 QQ 消息
  -> 工具意图识别
  -> read/draft 直接执行
  -> execute 创建 pending_confirmation
  -> 用户回复“确认执行”
  -> 执行工具动作
  -> 写入 AgentToolAction 审计
```

## 10. 与 Scheduler Worker 的关系

主动提醒由 Scheduler Worker 触发，QQ Bot 负责发送。

```text
Scheduler Worker
  -> Agent Runtime builds prompt
  -> QQ OpenAPI send message
  -> SchedulerEvent records result
  -> AgentToolAction records internal reminder.send audit
```

QQ 平台可能限制完全主动的 C2C 消息。系统必须记录发送失败原因，并允许降级到 Web 内提醒。

## 11. 下一步

QQ 机器人参数已经作为运行环境配置项接入：

- `QQ_BOT_APP_ID`
- `QQ_BOT_TOKEN`
- `QQ_BOT_API_BASE`
- `QQ_DEFAULT_USER_EMAIL`
- `QQ_ALLOWED_CONTEXT_IDS`

下一步不是继续找参数，也不是重新切换到 Telegram，而是完成服务器常驻运行验证：

- Web 进程长期运行。
- QQ Worker 长期连接 Gateway。
- Scheduler Worker 按规则触发早中晚和周复盘。
- Settings 中能看到 `SchedulerEvent` 和 `AgentToolAction` 的成功/失败记录。

然后写入 `.env`：

```bash
QQ_BOT_APP_ID="..."
QQ_BOT_TOKEN="..."
QQ_BOT_INTENTS="33554432"
QQ_DEFAULT_USER_EMAIL="demo@goalmate.local"
```

之后部署到服务器并运行：

```bash
pnpm worker:qq
```
