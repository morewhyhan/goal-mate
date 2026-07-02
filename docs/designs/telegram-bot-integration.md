# Goal Mate Telegram Bot Integration

## 1. 目的

Telegram Bot 是 Goal Mate 的外部对话入口。

它不是一个独立功能，而是 Agent 的外部通道：

```text
Telegram 消息 -> Goal Mate webhook -> Agent thread -> DeepSeek -> Telegram 回复
```

用户在 Telegram 里像和真人助手聊天一样输入，系统读取当前目标、KR、条件、今日行动、MD 文档和对话历史，然后给出可行动回复。

## 2. 为什么使用 webhook

Telegram Bot API 支持两种接收消息方式：

| 方式 | 结论 |
| --- | --- |
| `getUpdates` 轮询 | 适合本地调试，不适合产品化 |
| `setWebhook` | 适合产品化，Telegram 主动推送 update 到 Goal Mate |

v0.1 使用 webhook。

## 3. 环境变量

| 变量 | 用途 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather 生成的 bot token |
| `TELEGRAM_BOT_API_BASE` | 默认 `https://api.telegram.org` |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token，用来校验请求来源 |
| `TELEGRAM_DEFAULT_USER_EMAIL` | 默认绑定到哪个 Goal Mate 用户 |
| `TELEGRAM_ALLOWED_CHAT_IDS` | 可选白名单，逗号分隔；为空表示不限制 |

真实 token 只能放在 `.env`，不能写入代码、文档或 seed。

## 4. API 路由

| 路由 | 作用 |
| --- | --- |
| `GET /api/integrations/telegram/status` | 登录用户查看 Telegram 配置和绑定状态 |
| `POST /api/integrations/telegram/webhook` | Telegram 推送 update 的 webhook |
| `POST /api/integrations/telegram/webhook/setup` | 登录用户设置 webhook |
| `POST /api/integrations/telegram/webhook/delete` | 登录用户删除 webhook |

## 5. 数据模型

### TelegramChatBinding

表示一个 Telegram chat 和一个 Goal Mate 用户的绑定关系。

| 字段 | 含义 |
| --- | --- |
| `userId` | Goal Mate 用户 |
| `chatId` | Telegram chat id |
| `username` / `firstName` / `lastName` / `title` | Telegram 用户或群信息 |
| `status` | enabled / disabled / error |

### TelegramUpdateEvent

记录每个 Telegram update 的处理结果。

| 字段 | 含义 |
| --- | --- |
| `updateId` | Telegram update id，唯一 |
| `chatId` | 来源 chat |
| `messageText` | 文本消息 |
| `payload` | 原始 Telegram update |
| `status` | received / replied / ignored / failed |
| `agentThreadId` | 对应 Agent thread |
| `agentMessageId` | 回复消息 id |
| `replyMessageId` | Telegram 发出的回复 message id |

## 6. 消息处理流程

```text
1. Telegram 推送 update 到 /api/integrations/telegram/webhook
2. Goal Mate 校验 X-Telegram-Bot-Api-Secret-Token
3. 过滤非文本消息
4. 检查 TELEGRAM_ALLOWED_CHAT_IDS
5. 根据 chatId 找 TelegramChatBinding
6. 若没有绑定，则绑定到 TELEGRAM_DEFAULT_USER_EMAIL
7. 找到或创建 AgentThread: Telegram <chatId>
8. 写入 USER AgentMessage
9. 调用 generateAssistantReply
10. 写入 ASSISTANT AgentMessage
11. 调用 Telegram sendMessage 回发
12. 记录 TelegramUpdateEvent
```

## 7. 权限边界

Telegram Bot 可以：

- 接收用户文字消息。
- 读取该用户的目标、KR、条件、今日行动、最近相关 MD 文档和 Agent 历史。
- 调用模型生成回复。
- 把回复发回 Telegram。

Telegram Bot 不可以：

- 自动修改目标。
- 自动改设置。
- 自动发送第三方平台消息。
- 自动执行高风险动作。

高风险动作必须走 `ExternalActionRequest` 和用户确认流程。

## 8. 当前 v0.1 边界

已实现：

- Telegram webhook 路由。
- webhook secret token 校验。
- chat 白名单。
- chat 与 Goal Mate 用户绑定。
- Telegram update 记录。
- Telegram 消息进入 Agent thread。
- Agent 读取目标和 MD 文档。
- DeepSeek 回复后回发 Telegram。

暂未实现：

- BotFather 自动创建 bot。
- 多用户自助绑定流程。
- `/link` 短码绑定。
- Telegram 菜单命令。
- 图片、语音、文件消息。
- Telegram 主动定时提醒。
- 外部动作确认卡片。

## 9. 上线步骤

1. 在 BotFather 创建 bot，拿到 token。
2. 设置 `.env`：

```bash
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_WEBHOOK_SECRET="a-long-random-secret"
TELEGRAM_DEFAULT_USER_EMAIL="demo@goalmate.local"
TELEGRAM_ALLOWED_CHAT_IDS=""
```

3. 部署 Web 服务，确保公网 HTTPS 可访问。
4. 登录 Goal Mate 后调用：

```bash
POST /api/integrations/telegram/webhook/setup
{
  "url": "https://your-domain.com/api/integrations/telegram/webhook"
}
```

5. 在 Telegram 给 bot 发消息。

## 10. 官方依据

- Telegram Bot API 使用 `https://api.telegram.org/bot<token>/METHOD_NAME` 调用方法。
- `setWebhook` 用于设置 webhook。
- `sendMessage` 用于发送文本消息。
- `secret_token` 会通过 `X-Telegram-Bot-Api-Secret-Token` 请求头发送给 webhook，用于校验来源。
