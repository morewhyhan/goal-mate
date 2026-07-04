# Plan: Self-hosted Runtime Verification

## 1. 背景

Goal Mate 已经具备：

- Web 进程。
- QQ Worker。
- Scheduler Worker。
- systemd service 模板。
- Settings Control Center runtime status。
- Agent Tool shared executor 和审计记录。

但截至 2026-07-02，还没有完成“服务器上长期运行”的实证验收。

这意味着当前只能证明代码和配置资产存在，不能证明产品承诺已经成立：

```text
电脑关闭后，系统仍能通过 QQ 主动提醒、接收回复、写入日志和审计。
```

## 2. 目标

在服务器上证明三个进程能长期运行并形成闭环：

```text
Web
QQ Worker
Scheduler Worker
```

最终证据必须能回答：

- Web 是否可访问。
- QQ Worker 是否能长期连接 Gateway。
- Scheduler Worker 是否能按规则创建 `SchedulerEvent`。
- 主动提醒是否能通过 QQ 发出。
- 用户回复提醒后是否能写入 `checkin.submit` / `log.write_daily` / `review.generate` 对应审计。
- Settings 是否能看到 runtime status、SchedulerEvent、AgentToolAction。

## 3. 非目标

- 不在文档中保存任何密钥。
- 不验证 QQ 平台所有消息场景。
- 不做多用户压力测试。
- 不切换数据库方案。
- 不引入 Docker 或新的进程管理器。

## 4. 前置条件

| 条件 | 要求 |
| --- | --- |
| 服务器 | 可 SSH 登录，具备长期运行能力 |
| 代码 | 已部署当前仓库版本 |
| 环境变量 | `.env` 只在服务器本地保存 |
| 数据库 | `DATABASE_URL` 指向持久化数据库文件 |
| Web 地址 | `BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL`、`NEXT_PUBLIC_APP_URL` 指向实际访问地址 |
| QQ | 当前登录用户已在 Settings 保存 QQ Bot App ID / Token，并在 QQ 中完成绑定码绑定 |
| 模型 | DeepSeek 配置可用 |
| 用户 | Web 账号和 QQ 会话通过 `QqChatBinding` 绑定，不能依赖全局邮箱或第一个用户 |

## 5. 验收步骤

| 状态 | 步骤 | 证据 |
| --- | --- | --- |
| Todo | 安装依赖并生成 Prisma Client | 命令输出成功 |
| Todo | 执行静态门禁 | `pnpm verify:static` 通过，包含 QQ/Scheduler worker 语法检查 |
| Todo | 配置服务器 `.env` | 不提交密钥，只记录变量名已配置 |
| Todo | 启动 Web systemd service | `systemctl status goal-mate-web` active |
| Todo | 启动 QQ Worker systemd service | 日志出现 Gateway 连接或心跳 |
| Todo | 启动 Scheduler Worker systemd service | 日志出现 tick started |
| Todo | 打开 Settings 部署状态 | `RuntimeHeartbeat` 显示 Web、QQ Worker、Scheduler Worker 最近心跳 |
| Todo | QQ 发一条普通消息 | AgentThread / AgentMessage 有新增 |
| Todo | 执行一次性 Scheduler 验证 | `pnpm worker:scheduler:once` 创建 SchedulerEvent，状态为 `sent` 或 `failed` 且失败有原因 |
| Todo | 触发一次真实提醒规则 | SchedulerEvent 出现 `sent` 或 `failed` |
| Todo | 回复 Scheduler 提醒 | SchedulerEvent 变为 `responded`，AgentToolAction source 为 `scheduler` |
| Todo | 打开 Settings | runtime status 能解释 Web、模型、QQ、Scheduler、Tools 状态 |
| Todo | 停止再重启 worker | systemd 自动恢复，日志可追踪 |

## 6. 通过标准

必须同时满足：

- 三个 systemd service 都能启动。
- Settings 能看到 Web、QQ Worker、Scheduler Worker 的最近心跳；心跳过期时必须显示为待确认或过期，不能伪装在线。
- QQ Worker 不因 token、intent、网络或 Gateway 鉴权立即退出。
- Scheduler Worker 能创建 `SchedulerEvent`。
- `pnpm worker:scheduler:once` 能立即创建一条 `SchedulerEvent`，不用等待真实提醒时间。
- 至少一次主动提醒能成功发送，或失败原因被写入 `SchedulerEvent.errorMessage`。
- 至少一次 Scheduler 回复能进入 shared executor，并写入 `AgentToolAction.source = scheduler`。
- Settings 能看到最近的工具动作和调度记录。

## 7. 失败记录格式

如果验收失败，按以下格式记录：

```text
ID:
时间:
服务:
现象:
日志摘录:
影响:
下一步:
```

## 8. 验收报告

执行真实服务器验收时，复制并填写：

```text
docs/plans/self-hosted-runtime-verification-report-template.md
```

报告必须脱敏，不能写入 API Key、Bot Token、SSH 密码、Cookie 或 Session。

## 9. 当前状态

截至 2026-07-02：

- 计划已创建。
- 报告模板已创建。
- 尚未执行服务器运行验收。
- 不能声明“长期主动推进能力已通过生产验证”。
