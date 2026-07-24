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
shared Agent Runtime 读取目标 + 跨渠道最近对话 + MD 文档 -> B.AI 回复
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

Web Agent 和 QQ Bot 是同一个逻辑助手的两个入口。QQ Worker 调用
`generateAssistantReplyWithPrisma(..., channel: "qq")`；Web 调用同一 shared runtime
并传入 `channel: "web"`。两边共享用户目标、日志、工具、确认策略和按 `userId`
聚合的最近对话记忆。`channel` 只控制回复长度和展示形式，不创建第二套用户状态。

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

绑定的授权范围仅限“允许这个 QQ 会话作为当前用户的对话入口”。它不代表：

- 用户允许机器人在自己没有先发消息时主动联系。
- 默认早中晚 / 周复盘规则应该启用。
- 已暂停的主动联系可以因为再次聊天而恢复。

主动联系 consent 由 `UserSetting.notifications.proactive_contact_enabled` 和
`ReminderRule.metadata.contactConsent` 单独记录。规则 metadata 还会固定本次授权对应的
QQ `contextType + contextId`；Scheduler 只查找这个已授权会话，不存在“回退到最近绑定”。缺少授权、授权歧义或实际 binding 与授权不一致时记为 `context_not_authorized`；已授权 context 当前没有 enabled binding 时记为 `no_enabled_binding`。系统不会把私人目标提醒发送到另一个更晚绑定的群或频道。

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
8. 调 shared Agent Runtime；需要模型时使用当前用户自己的模型配置。
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

- 绕过 shared Agent Tool Runtime 修改目标或设置。
- 把绑定行为当成主动联系授权。
- 因用户普通聊天而自动恢复已经暂停的提醒。
- 自动执行高风险外部动作。

高风险动作后续必须进入 `ExternalActionRequest`，由用户确认。

主动联系的特殊确认边界：

- 开启或恢复：创建 `pending_confirmation`，用户确认后才启用候选规则。
- 暂停或撤销：立即生效，不要求二次确认。

明确的“做完了 / 做了一点 / 没做”是用户对已发生事实的反馈，也不要求二次确认。
它会直接进入 `checkin.submit`；目标重定义和高风险外部动作仍按原权限确认。

## 8. 当前 v0.1 边界

已实现：

- QQ 数据模型。
- QQ Gateway worker。
- QQ HTTP OpenAPI 请求封装。
- C2C / 群 / 频道事件解析。
- QQ 对话绑定 Goal Mate 用户。
- QQ 消息进入 AgentThread。
- Web / QQ 共用 `agent-runtime-shared.mjs` 和 shared Agent Tool Runtime。
- Agent 最近记忆按当前用户跨渠道加载，不要求用户理解内部线程。
- Agent 读取目标和 MD 文档。
- B.AI 回复。
- QQ sendMessage 回发。
- QQ 工具意图识别。
- QQ read/draft 工具执行。
- QQ execute 工具待确认。
- QQ 文本“确认执行”后执行工具动作。
- Agent 工具审计。
- Settings 生成 QQ 一次性绑定码。
- QQ 绑定欢迎语明确说明“绑定本身不会自动开启提醒”。
- QQ 自然语言可以请求由助手判断提醒时机；启用进入确认流程。
- QQ “暂停 / 别提醒 / 停止主动联系”会立即撤销全局主动联系并关闭 QQ 规则。
- QQ “恢复提醒”必须再次确认，确认前保持暂停。
- QQ 普通消息不会因为存在一条 18 小时内的提醒而自动被当成反馈；只有消息引用或明确反馈信号才进入 Scheduler Reply。
- 普通对话和 Scheduler 回复中的明确进度反馈都会持久化 `nextCommitment`；QQ 只有拿到实际落库结果才说“下一步已经写入”。
- PROMPT 反馈只会调整已有、enabled、consented 的 QQ 规则时间，不创建、不启用、不提高每日频率；成功结果会显示原时间和新时间。
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

QQ Bot 可以触发 read、draft 和 execute 工具。execute 的确认边界由 shared executor
统一决定，不由 QQ Worker 自己猜测；修改目标、设置和开启 / 恢复主动联系需要用户回复
“确认执行”，明确 Check-in 与暂停主动联系立即执行。

当前 QQ 确认流程：

```text
用户 QQ 消息
  -> 工具意图识别
  -> read/draft 直接执行
  -> 需要确认的 execute 创建 pending_confirmation
  -> 用户回复“确认执行”
  -> 执行工具动作
  -> 写入 AgentToolAction 审计
```

QQ Worker 会先识别回合类型，再决定是否进入普通模型对话：

```text
binding_welcome
  -> reminder_control
  -> tool_confirmation
  -> scheduler_feedback
  -> first_goal_clarification / tool_execution
  -> ordinary shared Agent reply
```

该顺序保证“确认执行”不会被误记成打卡，“暂停提醒”不会被当成普通闲聊，普通短句也不会仅因为最近发过提醒就被强行归类为 Scheduler 反馈。

## 10. 与 Scheduler Worker 的关系

主动提醒由 Scheduler Worker 触发，QQ Bot 负责发送。

```text
Scheduler Worker
  -> Contact Policy decides send / skip / defer
  -> Intervention Planner and renderer build a valuable message only for send
  -> QQ OpenAPI send message
  -> SchedulerEvent records result
  -> AgentToolAction records reminder.evaluate / reminder.send audit
```

QQ 平台可能限制完全主动的 C2C 消息。系统会区分
`c2c_passive`、`c2c_wakeup` 和 `group_active`；缺少最近消息上下文、召回窗口过期或平台额度不足时选择 defer，不伪造已经送达。发送失败必须记录原因。

defer 会复用同一 `SchedulerEvent` 在 `scheduledFor` 到期后重跑完整联系策略；它不是把当前消息标成成功，也不会绕过后续 consent 和价值检查。

## 11. 下一步

QQ 机器人参数已经作为 Settings 配置项接入：

- App ID
- Token / Secret
- API Base
- Gateway Intents
- 允许会话

下一步不是继续找参数，也不是重新切换到 Telegram，而是完成外部运行验证：

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
QQ 会话已绑定 != 用户已同意主动联系
用户已同意主动联系 != 当前候选窗口值得发送
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
- 本地纯策略测试可以证明绑定 / consent 分离、暂停 / 恢复确认、send / skip / defer 和反馈识别边界；这些逻辑结论无需 live QQ。

旧的“写入 `.env` 后自动归属到某个邮箱账号”流程已经废弃。它不满足多用户隔离，也会让新用户误以为 QQ 会话可以自动归属。当前唯一正确前台流程是：登录 Web -> Settings 保存 QQ 配置 -> 生成绑定码 -> 在 QQ 发送绑定命令。
