# Archived: Goal Mate Telegram Bot Integration

Status: archived reference.

Decision date: 2026-07-02.

Current product decision:

```text
Goal Mate v0.1 uses Web Console first and QQ Bot as the first auxiliary runtime channel.
Telegram is not an active v0.1 channel and should not be mounted in the current API surface.
```

This document is kept only as historical design reference. Do not use it as implementation guidance unless the product explicitly reopens Telegram later.

If Telegram is reintroduced, it must be handled as a new increment with fresh requirements, security review, environment variables, API route registration, deployment plan, and acceptance tests.

---

## 1. 目的

Telegram Bot 曾被设计为 Goal Mate 的外部对话入口。

它不是一个独立功能，而是 Agent 的外部通道：

```text
Telegram 消息 -> Goal Mate webhook -> Agent thread -> B.AI -> Telegram 回复
```

用户在 Telegram 里像和真人助手聊天一样输入，系统读取当前目标、KR、条件、今日行动、MD 文档和对话历史，然后给出可行动回复。

## 2. 为什么使用 webhook

Telegram Bot API 支持两种接收消息方式：

| 方式 | 结论 |
| --- | --- |
| `getUpdates` 轮询 | 适合本地调试，不适合产品化 |
| `setWebhook` | 适合产品化，Telegram 主动推送 update 到 Goal Mate |

该方案已经被 QQ Gateway Worker 方案替代；v0.1 不再使用 Telegram webhook。

## 3. 环境变量

| 变量 | 用途 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather 生成的 bot token |
| `TELEGRAM_BOT_API_BASE` | 默认 `https://api.telegram.org` |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token，用来校验请求来源 |
| `TELEGRAM_DEFAULT_USER_EMAIL` | 默认绑定到哪个 Goal Mate 用户 |
| `TELEGRAM_ALLOWED_CHAT_IDS` | 可选白名单，逗号分隔；为空表示不限制 |

真实 token 只能放在 `.env`，不能写入代码、文档或 seed。当前 `.env.example` 不再暴露 Telegram 配置项。

## 4. API 路由

| 路由 | 作用 |
| --- | --- |
| `GET /api/integrations/telegram/status` | 已归档，不挂载 |
| `POST /api/integrations/telegram/webhook` | 已归档，不挂载 |
| `POST /api/integrations/telegram/webhook/setup` | 已归档，不挂载 |
| `POST /api/integrations/telegram/webhook/delete` | 已归档，不挂载 |

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

当前 v0.1 状态：

- Telegram API 路由不挂载。
- Telegram 环境变量不出现在 active `.env.example`。
- Telegram smoke script 不作为 active package script。
- 旧数据模型可作为历史迁移保留，是否移除需要单独数据库迁移计划。

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
