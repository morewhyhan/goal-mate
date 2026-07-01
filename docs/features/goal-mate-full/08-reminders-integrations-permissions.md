# F7 提醒、集成与权限规格

## 1. 模块定位

本模块定义提醒调度、外部上下文接入、工具动作权限和安全边界。

## 2. 提醒类型

| 类型 | 触发 | 目的 |
| --- | --- | --- |
| Morning Planning | 每日开始 | 确认今天主行动 |
| Focus Prompt | 用户设置时间 | 推动行动发生 |
| Drift Check | 用户长期无响应或偏离 | 判断是否需要调整 |
| Evening Review | 每日晚间 | 记录结果 |
| Weekly Review | 每周 | 复盘目标 |
| Deadline Alert | 截止日前 | 提醒关键期限 |

## 3. 集成类型

| 集成 | 权限层级 | 优先级 |
| --- | --- | --- |
| Calendar | read, draft_event, write_event | P1 |
| Email | read_summary, draft_email, send_email | P1 |
| Telegram / 企业微信 / 微信服务号 | send_reminder, receive_reply | P1 |
| Todo 工具 | read_task, create_task, update_task | P1 |
| MCP Tools | read, draft, execute | P1 |
| Payment / Contract | 禁止自动执行 | P2 受限 |

## 4. 字段清单

### 4.1 reminder_rule

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 提醒规则 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| goal_id | string | 否 | 空 | 可关联目标 |
| reminder_type | enum | 是 | focus_prompt | 提醒类型 |
| channel | enum | 是 | app | app, web, email, telegram, wechat, sms |
| schedule | string | 是 | 无 | cron 或本地时间规则 |
| max_per_day | integer | 是 | 2 | 每日上限 |
| quiet_hours | object | 否 | {} | 免打扰时间 |
| enabled | boolean | 是 | true | 是否启用 |

### 4.2 integration_account

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 集成账号 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| provider | enum | 是 | 无 | calendar, email, telegram, wechat, mcp, todo |
| permission_scope | string[] | 是 | [] | 授权范围 |
| status | enum | 是 | disconnected | connected, disconnected, expired, revoked |
| last_sync_at | datetime | 否 | 空 | 最近同步时间 |

### 4.3 external_action_request

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 动作请求 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| provider | string | 是 | 无 | 外部工具 |
| action_type | enum | 是 | read | read, draft, execute |
| payload | object | 是 | {} | 动作内容 |
| risk_level | enum | 是 | low | low, medium, high |
| requires_confirmation | boolean | 是 | true | 是否需确认 |
| status | enum | 是 | pending | pending, approved, rejected, executed, failed |

## 5. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F7-R1 | 提醒必须服务目标推进，不得变成无上下文催促 | P0 |
| F7-R2 | 连续无响应时不得简单增加提醒频率，必须触发诊断 | P0 |
| F7-R3 | 每个渠道每天提醒次数不得超过 max_per_day | P0 |
| F7-R4 | 所有外部集成都必须按最小权限授权 | P0 |
| F7-R5 | read 权限不能执行写动作 | P0 |
| F7-R6 | send_email、write_event、execute_tool 等动作默认 requires_confirmation | P0 |
| F7-R7 | 高风险动作必须展示 payload 摘要和影响范围 | P0 |
| F7-R8 | 用户可随时撤销集成授权 | P0 |
| F7-R9 | 自部署环境的凭据必须本地保存，不上传云端 | P1 |

## 6. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F7-1 | 用户连续 2 天无响应 | 系统调度提醒 | 不增加频率，触发提醒诊断 |
| AC-F7-2 | 邮箱集成只有 read_summary | AI 请求发送邮件 | 系统拒绝 |
| AC-F7-3 | AI 草拟日历事件 | 用户未确认 | 不写入日历 |
| AC-F7-4 | 用户撤销 Telegram 授权 | 系统发送提醒 | 发送失败并提示重新连接 |

