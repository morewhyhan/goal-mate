# Self-hosted Worker Deployment

## 1. 定位

Goal Mate 的 Web Console 只负责页面和 API。

长期主动推进依赖两个常驻 worker：

```text
QQ Worker
Scheduler Worker
```

如果这两个 worker 不在服务器上长期运行，系统仍然可以作为 Web 应用使用，但不能完成“电脑关闭后也能主动提醒和对话”的产品承诺。

## 2. 当前 worker

| Worker | 启动命令 | 职责 |
| --- | --- | --- |
| QQ Worker | `pnpm worker:qq` | 连接 QQ Gateway，接收 QQ 消息，调用 Agent，发送 QQ 回复 |
| Scheduler Worker | `pnpm worker:scheduler` | 根据提醒规则触发早中晚和周复盘提醒，通过 QQ 发送主动推进消息 |

## 3. 服务器运行要求

| 要求 | 说明 |
| --- | --- |
| Node.js | 与项目依赖兼容 |
| pnpm | 与 `src/package.json` 使用版本兼容 |
| 网络 | 能访问 QQ OpenAPI、QQ Gateway、DeepSeek API |
| 存储 | SQLite 数据库文件必须持久化 |
| 环境变量 | `.env` 只放在服务器本地，不提交 Git |
| 进程守护 | worker 崩溃后必须自动重启 |
| Web 地址 | `BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL`、`NEXT_PUBLIC_APP_URL` 必须指向实际访问地址 |

## 4. 必需环境变量

```text
DATABASE_URL
NEXT_PUBLIC_APP_URL
QQ_BOT_APP_ID
QQ_BOT_TOKEN
```

DeepSeek / model API Key 不再作为服务器全局必填项。模型密钥由用户在 Settings 中按账号配置，服务端加密保存；`.env` 中的 `DEEPSEEK_API_KEY` 只作为本地 live-quality 脚本或显式 `env:KEY` 兼容入口。

默认环境变量：

```text
PORT=3000
HOSTNAME=0.0.0.0
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
QQ_BOT_API_BASE=https://api.sgroup.qq.com
QQ_BOT_INTENTS=33554432
SCHEDULER_TICK_SECONDS=60
SCHEDULER_TIMEZONE=Asia/Shanghai
SCHEDULER_MORNING_TIME=08:30
SCHEDULER_MIDDAY_TIME=12:30
SCHEDULER_EVENING_TIME=21:30
SCHEDULER_WEEKLY_TIME=SUN 21:00
```

这些默认值通常不需要用户改；模型名称、提醒时间、Agent 权限、日志写入和数据导出在 Settings 页面配置。

可选覆盖环境变量：

```text
BETTER_AUTH_URL
NEXT_PUBLIC_BETTER_AUTH_URL
QQ_DEFAULT_USER_EMAIL
QQ_ALLOWED_CONTEXT_IDS
QQ_SCHEDULER_REPLY_WINDOW_HOURS
```

`QQ_DEFAULT_USER_EMAIL` 只在多用户服务器上需要；单用户服务器默认绑定第一个用户。`QQ_ALLOWED_CONTEXT_IDS` 用于限制机器人响应的 QQ 会话范围。`QQ_SCHEDULER_REPLY_WINDOW_HOURS` 用于限制用户回复主动提醒后，系统仍把它识别为 Scheduler 回复的时间窗口。

没有域名时，`NEXT_PUBLIC_APP_URL` 可以使用 `http://服务器IP:3000`。如果后续接入域名和 HTTPS，再同步设置 `BETTER_AUTH_URL` 和 `NEXT_PUBLIC_BETTER_AUTH_URL` 做显式覆盖。

真实密钥只能存在服务器 `.env`，不能写入文档、代码、提交记录或日志。

## 5. 推荐进程结构

```text
goal-mate-web
  -> pnpm start

goal-mate-qq-worker
  -> pnpm worker:qq

goal-mate-scheduler-worker
  -> pnpm worker:scheduler
```

三者可以共享同一个数据库。

## 6. systemd 部署建议

建议为每个进程单独建 service：

```text
goal-mate-web.service
goal-mate-qq-worker.service
goal-mate-scheduler-worker.service
```

关键策略：

```text
Restart=always
RestartSec=5
WorkingDirectory=<repo>/src
EnvironmentFile=<repo>/src/.env
```

仓库已提供模板：

```text
deploy/systemd/goal-mate-web.service
deploy/systemd/goal-mate-qq-worker.service
deploy/systemd/goal-mate-scheduler-worker.service
deploy/systemd/README.md
```

## 7. 启动顺序

```text
1. 安装依赖
2. 配置 .env
3. pnpm db:generate
4. pnpm exec prisma migrate deploy
5. pnpm verify:static
6. pnpm build
7. 启动 Web
8. 启动 QQ Worker
9. 启动 Scheduler Worker
10. 用 `pnpm worker:scheduler:once` 立即验证 Scheduler
11. 用 QQ 发消息验证绑定
12. 用 Settings 查看 QQ 绑定、提醒规则、工具审计
```

## 8. 运行观察

必须能观察：

| 项 | 观察方式 |
| --- | --- |
| QQ Gateway 是否连接 | worker 日志出现 connecting / replied |
| Scheduler 是否触发 | `SchedulerEvent` 出现 sent / failed / responded |
| Agent 工具是否执行 | `AgentToolAction` 出现 drafted / pending / executed / failed |
| QQ 是否被平台限制 | `SchedulerEvent.errorMessage` 和 worker 日志 |
| 模型是否可用 | Settings 模型测试 |
| 整体运行摘要 | Settings Control Center 顶部 runtime status |

## 9. 静态配置验证

仓库提供不连接服务器的静态验证脚本：

```bash
pnpm verify:deployment-config
pnpm verify:deployment-config:write
```

它检查：

- `src/package.json` 是否包含 Web、QQ Worker、Scheduler Worker 脚本。
- `src/package.json` 是否包含一次性 Scheduler 验收脚本。
- `deploy/systemd` service 是否包含必要 systemd 指令。
- `.env.example` 是否列出部署必需变量。
- `.env.example` 是否把可默认变量和可选覆盖变量分开。
- QQ Worker / Scheduler Worker 是否通过 Node 语法检查。
- 部署事实文档是否仍然记录真实部署缺口。

Settings Control Center 还会返回 `runtimeStatus`，用于在页面上快速判断：

```text
web
model
qq
scheduler
tools
deployment
```

## 10. 当前缺口

截至 2026-07-02：

- 项目已有 worker 脚本。
- 项目已有 Settings Control Center 可观察状态。
- Settings 页面已经能显示部署必填项、缺失项、UI 可配置项和默认项。
- 项目已有 systemd service 模板。
- 项目已有 shared executor 和 shared audit writer，Web、QQ、Scheduler 回复路径的工具动作已统一审计。
- 尚未在服务器上完成长期运行验证。
- 尚未完成 worker 崩溃自动重启验证。

## 11. 下一步

- 按 `docs/plans/self-hosted-runtime-verification-plan.md` 在服务器上执行真实部署验证。
- 把验证结果写入 `docs/plans`。
