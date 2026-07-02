# Self-hosted Runtime Verification Report

## 1. 基本信息

| 项 | 内容 |
| --- | --- |
| 执行日期 | 待填写 |
| 执行人 | 待填写 |
| 服务器 | 只填写主机别名或脱敏 IP，不填写密码 |
| Git commit | 待填写 |
| 数据库 | SQLite / Postgres / 其他，脱敏填写 |
| 结论 | Pending / Pass / Fail |

## 2. 密钥与安全声明

- 本报告不得记录任何 API Key、Bot Token、SSH 密码、Cookie、Session。
- 日志摘录必须先脱敏。
- 只记录环境变量名是否配置，不记录变量值。

## 3. 环境变量检查

| 变量名 | 是否配置 | 备注 |
| --- | --- | --- |
| `DATABASE_URL` | 待填写 | 不记录值 |
| `DEEPSEEK_API_KEY` | 待填写 | 不记录值 |
| `DEEPSEEK_API_BASE` | 待填写 | 不记录值 |
| `DEEPSEEK_MODEL` | 待填写 | 不记录值 |
| `QQ_BOT_APP_ID` | 待填写 | 不记录值 |
| `QQ_BOT_TOKEN` | 待填写 | 不记录值 |
| `QQ_BOT_API_BASE` | 待填写 | 不记录值 |
| `QQ_BOT_INTENTS` | 待填写 | 不记录值 |
| `QQ_DEFAULT_USER_EMAIL` | 待填写 | 可脱敏 |
| `QQ_ALLOWED_CONTEXT_IDS` | 待填写 | 可脱敏 |
| `SCHEDULER_TICK_SECONDS` | 待填写 | 可记录 |
| `SCHEDULER_TIMEZONE` | 待填写 | 可记录 |
| `SCHEDULER_MORNING_TIME` | 待填写 | 可记录 |
| `SCHEDULER_MIDDAY_TIME` | 待填写 | 可记录 |
| `SCHEDULER_EVENING_TIME` | 待填写 | 可记录 |
| `SCHEDULER_WEEKLY_TIME` | 待填写 | 可记录 |

## 4. Service 状态

| Service | 期望 | 实际 | 证据 |
| --- | --- | --- | --- |
| `goal-mate-web` | active | 待填写 | `systemctl status` 脱敏摘录 |
| `goal-mate-qq-worker` | active | 待填写 | `journalctl` 脱敏摘录 |
| `goal-mate-scheduler-worker` | active | 待填写 | `journalctl` 脱敏摘录 |

## 5. 闭环验收

| ID | 验收项 | 期望 | 实际 | 证据 |
| --- | --- | --- | --- | --- |
| RUNTIME-WEB | Web 可访问 | 返回 Goal Mate 页面/API | 待填写 | URL / status |
| RUNTIME-QQ-IN | QQ 普通消息 | 写入 AgentThread / AgentMessage | 待填写 | 数据库脱敏记录 |
| RUNTIME-QQ-TOOL | QQ 工具确认 | pending 后确认执行 | 待填写 | AgentToolAction 脱敏记录 |
| RUNTIME-SCHEDULER-TICK | Scheduler tick | 创建 SchedulerEvent | 待填写 | SchedulerEvent 脱敏记录 |
| RUNTIME-SCHEDULER-SEND | 主动提醒发送 | sent 或 failed 且有原因 | 待填写 | SchedulerEvent / errorMessage |
| RUNTIME-SCHEDULER-REPLY | 回复主动提醒 | responded 且 source=scheduler | 待填写 | AgentToolAction 脱敏记录 |
| RUNTIME-SETTINGS | Settings 可观察 | runtime status 可解释状态 | 待填写 | 页面截图或 API 摘要 |
| RUNTIME-RESTART | worker 自动恢复 | systemd 自动重启 | 待填写 | journalctl 脱敏摘录 |

## 6. 失败记录

| ID | 时间 | 服务 | 现象 | 影响 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

## 7. 结论

选择一个：

- Pass：服务器长期运行闭环已通过。
- Fail：存在阻断问题，不能声明长期主动推进能力可用。
- Pending：尚未完成全部验收。

最终结论：

```text
待填写
```
