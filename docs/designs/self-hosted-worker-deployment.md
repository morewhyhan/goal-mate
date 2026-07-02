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

## 4. 必需环境变量

```text
DATABASE_URL
DEEPSEEK_API_KEY
DEEPSEEK_API_BASE
DEEPSEEK_MODEL
QQ_BOT_APP_ID
QQ_BOT_TOKEN
QQ_BOT_API_BASE
QQ_BOT_INTENTS
QQ_DEFAULT_USER_EMAIL
SCHEDULER_TICK_SECONDS
SCHEDULER_TIMEZONE
SCHEDULER_MORNING_TIME
SCHEDULER_MIDDAY_TIME
SCHEDULER_EVENING_TIME
SCHEDULER_WEEKLY_TIME
```

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
4. 执行数据库迁移或 reset/seed
5. 启动 Web
6. 启动 QQ Worker
7. 启动 Scheduler Worker
8. 用 QQ 发消息验证绑定
9. 用 Settings 查看 QQ 绑定、提醒规则、工具审计
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

## 9. 当前缺口

截至 2026-07-02：

- 项目已有 worker 脚本。
- 项目已有 Settings Control Center 可观察状态。
- 项目已有 systemd service 模板。
- 尚未在服务器上完成长期运行验证。
- 尚未完成 worker 崩溃自动重启验证。

## 10. 下一步

- 在服务器上执行一次真实部署验证。
- 把验证结果写入 `docs/plans`。
