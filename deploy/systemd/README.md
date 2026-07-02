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

在服务器上：

```bash
cd /opt/goal-mate/src
pnpm install --frozen-lockfile
pnpm db:generate
```

确认 `.env` 已存在：

```bash
test -f /opt/goal-mate/src/.env
```

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
