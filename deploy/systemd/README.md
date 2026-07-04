# Goal Mate systemd Deployment

## 1. 目的

本目录提供自部署运行模板，让 Goal Mate 在服务器上长期运行：

- Web Console
- QQ Worker
- Scheduler Worker

这些模板不会包含任何真实密钥。服务器启动前只需要少量基础配置放在本地：

```text
/opt/goal-mate/src/.env
```

## 2. 文件

| 文件 | 作用 |
| --- | --- |
| `goal-mate-web.service` | Web Console / API |
| `goal-mate-qq-worker.service` | QQ Gateway 常驻 worker |
| `goal-mate-scheduler-worker.service` | 主动提醒调度 worker |
| `../install-systemd.sh` | 在服务器上安装、启用并启动以上三个 service |

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
GOAL_MATE_SECRET
```

没有域名时，`NEXT_PUBLIC_APP_URL` 可以先用：

```text
http://服务器IP:3000
```

`PORT`、`HOSTNAME`、`DEEPSEEK_API_BASE`、`DEEPSEEK_MODEL`、Scheduler tick 和时区都有默认值。QQ Bot App ID、QQ Token、QQ API Base、Gateway intents、模型名称、模型 API Key、提醒时间、Agent 权限、日志写入和数据导出都在 Settings 页面配置。

QQ Bot App ID、QQ Token 和模型 API Key 全部在 Settings 页面配置。`.env` 不保存这些用户级业务密钥；`QQ_ALLOWED_CONTEXT_IDS` 只用于限制机器人响应的 QQ 会话范围。

QQ 会话归属不能依赖全局邮箱、单用户假设或第一个用户。正确流程是：

```text
登录 Web
  -> Settings 保存 QQ 配置
  -> 生成绑定码
  -> 在 QQ 里发送绑定命令
  -> 写入 QqChatBinding
```

未绑定的 QQ 会话只会收到绑定提示，不会自动归属到任何账号。

推荐方式：一键安装 service：

```bash
cd /opt/goal-mate/src
pnpm deploy:systemd:install
```

这个命令会：

```text
1. 确认 /opt/goal-mate/src/.env 存在。
2. 确认 goalmate 系统用户存在。
3. 把 deploy/systemd/goal-mate-*.service 安装到 /etc/systemd/system/。
4. 执行 systemctl daemon-reload。
5. enable 三个服务。
6. restart 三个服务。
```

如果你只想安装并 enable，不立刻启动：

```bash
GOAL_MATE_START_SERVICES=0 pnpm deploy:systemd:install
```

如果服务器路径或用户不同：

```bash
GOAL_MATE_APP_ROOT=/data/goal-mate GOAL_MATE_SERVICE_USER=goalmate pnpm deploy:systemd:install
```

手动方式：

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

正常部署以后，不需要手动进入目录运行 `pnpm worker:qq`。QQ Worker 和 Scheduler Worker 会由 systemd 在后台长期运行；服务器重启后自动启动；进程崩溃后按 `Restart=always` 自动拉起。

如果 Settings 里还没有 QQ Bot 配置，QQ Worker 和 Scheduler Worker 不会退出；它们会常驻等待配置。打开 Web Console 后在 Settings -> QQ 填入 App ID 和 Token，服务会读取数据库中的配置并开始工作。

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
| QQ 无回复 | 检查 Settings -> QQ 的 App ID / Token、Gateway 权限、worker 日志 |
| Scheduler 不发 | 检查提醒规则、时区、QQ 绑定和 `SchedulerEvent.errorMessage` |
| DeepSeek 失败 | 检查 Settings 模型 API Key 和模型测试 |
