# Goal Mate systemd Deployment

## 1. 目的

本目录提供自部署运行模板，让 Goal Mate 在服务器上长期运行：

- Web Console
- QQ Worker
- Scheduler Worker

这些模板不会包含任何真实密钥。真实配置必须放在服务器本地：

```text
/opt/goal-mate/src/.env
```

## 2. 文件

| 文件 | 作用 |
| --- | --- |
| `goal-mate-web.service` | Web Console / API |
| `goal-mate-qq-worker.service` | QQ Gateway 常驻 worker |
| `goal-mate-scheduler-worker.service` | 主动提醒调度 worker |

## 3. 默认假设

模板默认：

```text
Repo path: /opt/goal-mate
App path: /opt/goal-mate/src
Linux user: goalmate
EnvironmentFile: /opt/goal-mate/src/.env
```

如果服务器路径或用户不同，先修改 service 文件。

## 4. 安装步骤

先在本地完成提交，不要直接把半成品传到服务器。

本地先生成交付包：

```bash
cd src
pnpm deploy:bundle
```

这个命令只会在本机生成：

```text
.artifacts/deploy/goal-mate-时间戳.tar.gz
```

它不会上传服务器，也不会打包 `.git`、`node_modules`、`.next`、真实 `.env`、本地数据库或日志。服务器上的真实 `.env` 必须单独创建，不能从本机打包进去。

服务器首次准备：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin goalmate || true
sudo mkdir -p /opt/goal-mate
sudo chown -R goalmate:goalmate /opt/goal-mate
```

确认要部署时，再把交付包解压到 `/opt/goal-mate`。之后在服务器上：

在服务器上：

```bash
cd /opt/goal-mate/src
pnpm install --frozen-lockfile
pnpm db:generate
pnpm exec prisma migrate deploy
pnpm verify:static
pnpm build
```

确认 `.env` 已存在：

```bash
test -f /opt/goal-mate/src/.env
```

`.env` 至少要配置：

```text
DATABASE_URL
NEXT_PUBLIC_APP_URL
DEEPSEEK_API_KEY
QQ_BOT_APP_ID
QQ_BOT_TOKEN
```

没有域名时，`BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL` 和 `NEXT_PUBLIC_APP_URL` 可以先用：
没有域名时，`NEXT_PUBLIC_APP_URL` 可以先用：

```text
http://服务器IP:3000
```

`PORT`、`HOSTNAME`、`DEEPSEEK_API_BASE`、`DEEPSEEK_MODEL`、`QQ_BOT_API_BASE`、`QQ_BOT_INTENTS`、Scheduler 时间和时区都有默认值。模型名称、提醒时间、Agent 权限、日志写入和数据导出在 Settings 页面配置。

如果服务器只有一个 Goal Mate 用户，QQ Worker 会自动绑定第一个用户；多用户场景再设置 `QQ_DEFAULT_USER_EMAIL`。

复制 service：

```bash
sudo cp /opt/goal-mate/deploy/systemd/goal-mate-*.service /etc/systemd/system/
sudo systemctl daemon-reload
```

启动并设置开机自启：

```bash
sudo systemctl enable --now goal-mate-web.service
sudo systemctl enable --now goal-mate-qq-worker.service
sudo systemctl enable --now goal-mate-scheduler-worker.service
```

## 5. 查看状态

```bash
systemctl status goal-mate-web.service
systemctl status goal-mate-qq-worker.service
systemctl status goal-mate-scheduler-worker.service
```

查看日志：

```bash
journalctl -u goal-mate-web.service -f
journalctl -u goal-mate-qq-worker.service -f
journalctl -u goal-mate-scheduler-worker.service -f
```

## 6. 重启

```bash
sudo systemctl restart goal-mate-web.service
sudo systemctl restart goal-mate-qq-worker.service
sudo systemctl restart goal-mate-scheduler-worker.service
```

## 7. 验证顺序

1. `goal-mate-web.service` 状态为 active。
2. Web API `/api/health` 返回 Goal Mate。
3. `goal-mate-qq-worker.service` 日志出现 QQ Gateway 连接信息。
4. 给 QQ Bot 发消息，Settings 里出现 QQ 绑定。
5. 先执行一次性 Scheduler 验证：

```bash
cd /opt/goal-mate/src
pnpm worker:scheduler:once
```

该命令会强制触发 `morning_planning`，不用等待真实整点。期望结果是出现一条 `SchedulerEvent`：有 QQ 绑定时为 `sent`，没有绑定或平台拒绝时为 `failed` 且包含 `errorMessage`。

6. `goal-mate-scheduler-worker.service` 按提醒规则持续创建 `SchedulerEvent`。
7. Settings Control Center 能看到工具审计和调度记录。

## 8. 常见问题

| 问题 | 检查 |
| --- | --- |
| `pnpm` 找不到 | 确认 systemd 环境下 `/usr/bin/env pnpm` 可用 |
| `.env` 未加载 | 检查 `EnvironmentFile` 路径 |
| QQ 无回复 | 检查 QQ token、Gateway 权限、worker 日志 |
| Scheduler 不发 | 检查提醒规则、时区、QQ 绑定和 `SchedulerEvent.errorMessage` |
| DeepSeek 失败 | 检查 `DEEPSEEK_API_KEY` 和 Settings 模型测试 |
