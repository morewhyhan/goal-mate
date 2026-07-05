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
Agent 读取目标 + MD 文档 -> B.AI 回复
Worker 调 QQ OpenAPI sendMessage -> 回 QQ
```

这个方案不需要：

- 域名
- HTTPS webhook
- 暴露 80/443

只要求：

- 服务器长期在线
- 服务器可以访问 QQ OpenAPI
- 服务器可以访问 B.AI API

## 3. 配置来源

| 配置项 | 来源 | 用途 |
| --- | --- |
| App ID | Settings | QQ 机器人 AppID |
| Token / Secret | Settings | QQ 机器人 Token，按当前用户加密保存 |
| API Base | Settings，默认 `https://api.sgroup.qq.com` | QQ OpenAPI 地址 |
| Gateway Intents | Settings，默认 `33554432` | Gateway 事件订阅位 |
| 允许会话 | Settings，可留空 | 可选白名单，逗号分隔；为空表示不限制 |

v0.1 的用户路径不是让用户编辑 `.env`。QQ Bot App ID / Token 只能在 Settings 页面填写，并按当前登录用户加密保存。`.env` 只保留默认 API Base / intents 等非用户级参数。真实 token 不能写进代码、文档、`.env.example` 或提交记录。

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

绑定规则：

```text
未绑定 QQ 会话
  -> 不允许自动归属到第一个用户
  -> 用户必须在 Settings 生成一次性绑定码
  -> 在 QQ 中发送“绑定 GM-XXXXXX”
  -> Worker 校验绑定码有效且未过期
  -> 写入 QqChatBinding
  -> 清空绑定码
```

绑定码默认 30 分钟有效。绑定码不是长期凭证，只用于证明“当前登录 Web 账号”和“当前 QQ 会话”属于同一个用户。

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

Worker 是后台进程，不是普通用户要手动执行的操作。本地开发或排错时可以直接运行：

```bash
pnpm worker:qq
```

正式部署时应由 `goal-mate-qq-worker.service` 常驻运行，并随服务器启动。用户只需要在 Settings 保存 QQ Bot 配置并生成绑定码。

Worker 做这些事：

1. 请求 QQ `/gateway` 获取 WebSocket 地址。
2. 连接 Gateway。
3. 发送 Identify。
4. 维护 heartbeat。
5. 接收消息事件。
6. 根据 `contextType + contextId` 绑定用户。
7. 写入 Agent 消息。
8. 调 B.AI。
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
- 调 B.AI 生成回复。
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
- B.AI 回复。
- QQ sendMessage 回发。
- QQ 工具意图识别。
- QQ read/draft 工具执行。
- QQ execute 工具待确认。
- QQ 文本“确认执行”后执行工具动作。
- Agent 工具审计。
- Settings 生成 QQ 一次性绑定码。
- QQ Worker 只通过有效绑定码绑定当前账号，不再把陌生 QQ 会话自动归属到全局账号或第一个用户。
- 未绑定 QQ 会话会收到明确提示：先去 Settings 生成绑定码，再发送绑定命令。

暂未实现：

- QQ 开放平台参数自动配置。
- QQ 图片/语音/文件消息。
- QQ 卡片消息。
- 权限审批 UI。

尚未完成验收：

- 真实 QQ Gateway 长连接稳定性。
- 服务器 systemd 长期运行。
- 真实平台主动消息送达。

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

QQ 机器人参数已经作为 Settings 配置项接入：

- App ID
- Token / Secret
- API Base
- Gateway Intents
- 允许会话

下一步不是继续找参数，也不是重新切换到 Telegram，而是完成服务器常驻运行验证：

- Web 进程长期运行。
- QQ Worker 长期连接 Gateway。
- Scheduler Worker 按规则触发早中晚和周复盘。
- Settings 中能看到 `SchedulerEvent` 和 `AgentToolAction` 的成功/失败记录。

## 12. 当前增量事实：QQ 不是用户手动启动项

QQ Bot 和 Scheduler 都是后台能力，不是用户要理解的命令。

本地启动：

```text
pnpm dev
  -> 启动 Web
  -> 启动 QQ Worker
  -> 启动 Scheduler Worker
```

服务器部署：

```text
systemd
  -> goal-mate-web.service
  -> goal-mate-qq-worker.service
  -> goal-mate-scheduler-worker.service
```

如果 Settings 里还没有 QQ 配置，worker 不退出，保持等待；用户在页面填好 App ID / Token 后，worker 会在下一轮读取配置并连接。

后台进程必须写入运行心跳：

```text
QQ Worker -> RuntimeHeartbeat(service=qq-worker)
Scheduler Worker -> RuntimeHeartbeat(service=scheduler-worker)
Web/API -> RuntimeHeartbeat(service=web)
```

Settings 不能只展示“QQ 已配置”或“提醒规则已开启”。它还必须让用户看到后台进程最近是否在线。配置状态、绑定状态、提醒规则和进程在线状态是四件不同的事：

```text
QQ 配置存在 != QQ 会话已绑定
QQ 会话已绑定 != Scheduler 会主动触发
Scheduler 有规则 != 后台 worker 在线
worker 在线 != 真实 QQ 平台一定送达
```

真实送达仍要看 `SchedulerEvent` 和 QQ 平台返回结果。

用户绑定 QQ 的前台流程：

```text
Settings 保存 QQ App ID / Token
  -> 点击“生成绑定码”
  -> 复制“绑定 GM-XXXXXX”
  -> 发给 QQ 机器人
  -> Settings 出现已绑定会话
```

这个流程替代旧的“给机器人发任意一条消息即可无绑定码归属账号”。旧流程不满足多用户数据隔离要求，已经废弃。

晚上复盘场景已经接入日复盘生成：

```text
Scheduler evening_review
  -> QQ 主动询问
  -> 用户回复
  -> checkin.submit
  -> log.write_daily
  -> review.generate daily
  -> 下一次 Scheduler/Intervention Planner 消费这些反馈
```

当前增量事实：

- QQ Worker 调用 `src/lib/qq-scheduler-reply.mjs` 处理 Scheduler 回复，不在 Worker 内单独维护一套回复闭环。
- `pnpm verify:qq-scheduler-reply` 已证明本地 evening_review 回复链路可用：用户回复会进入 Check-in、Markdown、daily Review、SchedulerEvent responded 和 AgentToolAction 审计。
- 该验证不访问 QQ 网络，因此不能替代真实 QQ Gateway、真实主动发送和服务器长期运行验收。

旧的“写入 `.env` 后自动归属到某个邮箱账号”流程已经废弃。它不满足多用户隔离，也会让新用户误以为 QQ 会话可以自动归属。当前唯一正确前台流程是：登录 Web -> Settings 保存 QQ 配置 -> 生成绑定码 -> 在 QQ 发送绑定命令。
