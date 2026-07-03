# F5 Settings 规格

## 1. 模块定位

Settings 是系统行为配置中心，不是 Agent 权限开关集合。它必须让用户理解每项配置会如何影响目标推进、提醒、日志、模型和数据。

## 2. 分类

| 分类 | 目的 |
| --- | --- |
| General | 设置语言、时区、默认周期 |
| Goals | 设置目标推进策略和复盘节奏 |
| Logs | 设置 Markdown 存储、命名、自动写入 |
| Today | 设置今日行动生成和 Momentum 统计 |
| Agent | 设置 Agent 可读取范围、记忆和确认边界 |
| Models | 设置模型供应商、模型、API Key、用途 |
| Notifications | 设置提醒时间、渠道、频率和免打扰 |
| Integrations | 管理后续微信、飞书、Telegram、日历等入口 |
| Data & Privacy | 导出、备份、删除和隐私边界 |

## 3. Models 配置

v0.1 必须支持模型配置，默认加入 DeepSeek。

| 字段 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| provider | 是 | DeepSeek | 模型供应商 |
| model | 是 | deepseek-v4-flash | 默认便宜快速模型 |
| reasoning_model | 否 | deepseek-reasoner | 复杂目标推理可用 |
| api_base | 是 | https://api.deepseek.com | API 地址 |
| api_key | 是 | sk-**** | 当前用户自己的模型密钥，保存后必须加密存储，页面和导出只显示脱敏状态 |
| default_for | 是 | chat / reasoning / summary | 用途 |
| temperature | 否 | 0.3 | 输出稳定性 |
| test_connection | 是 | 按钮 | 测试连接是否可用 |

说明：

```text
模型 API Key 属于用户私有配置，不是服务器全局共享配置。
```

服务器 `.env` 可以保留 DeepSeek 默认 API Base / 默认模型等非密钥参数，但不能把 `DEEPSEEK_API_KEY` 当作所有用户共用的默认密钥。Web Agent、QQ Agent、Scheduler 和模型测试都必须优先使用当前 session 用户保存的模型密钥。

## 4. Notifications 配置

| 字段 | 说明 |
| --- | --- |
| morning_checkin_time | 早上规划提醒时间 |
| evening_review_time | 晚上反馈/复盘提醒时间 |
| quiet_hours | 免打扰时间 |
| channel | Web / Email / 微信 / 飞书 / Telegram，v0.1 可先启用 Web |
| missed_action_strategy | 未完成后是缩小行动、延后提醒还是询问原因 |
| max_daily_prompts | 每日最多提醒次数 |

## 5. Logs 配置

| 字段 | 说明 |
| --- | --- |
| vault_root | Markdown 根目录 |
| naming_pattern | 年/季/月/周/日命名规则 |
| auto_write_checkin | 是否自动写入每日反馈 |
| auto_write_review | 是否自动写入周/月/年复盘 |
| preserve_user_edits | 自动写入是否保护用户手写区 |

## 6. Agent 配置

| 字段 | 说明 |
| --- | --- |
| can_read_goals | 是否读取目标结构 |
| can_read_logs | 是否读取日志 |
| memory_enabled | 是否保留长期记忆 |
| require_confirm_goal_changes | 修改目标是否确认 |
| require_confirm_setting_changes | 修改设置是否确认 |
| require_confirm_external_actions | 外部动作是否强确认 |

## 7. Data & Privacy 配置

| 字段 | 说明 |
| --- | --- |
| export_all | 导出全部目标、日志、对话、设置 |
| backup_location | 备份位置 |
| delete_account_data | 删除用户数据 |
| redact_secrets | 导出时是否隐藏密钥 |
| local_first_mode | 后续自部署/本地优先模式预留 |

## 8. 交互规则

| 规则 | 说明 |
| --- | --- |
| 每个配置必须有影响说明 | 用户要知道开关/输入会改变什么 |
| 密钥必须脱敏 | 不明文展示 API Key |
| 密钥必须按用户隔离 | A 用户配置的模型密钥不能被 B 用户读取、导出或用于调用模型 |
| 测试连接不保存密钥日志 | 不能把敏感信息写入日志 |
| 未实现渠道必须标明后续 | 不能假装可用 |
| 配置面板不能溢出 | 所有控件必须在边界内可读可操作 |

## 9. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F5-1 | 用户打开 Settings | 查看 Models | 能看到 DeepSeek、模型、API Base、API Key 和测试连接 |
| AC-F5-1b | 用户保存 API Key | 再读取 Models 或导出数据 | 只能看到脱敏状态，不能看到明文 key |
| AC-F5-2 | 用户关闭 Agent 读取 Logs | Agent 回答问题 | Agent 不得引用日志内容 |
| AC-F5-3 | 用户设置提醒时间 | 保存 | Today 和 Agent 使用新的提醒时间 |
| AC-F5-4 | 用户导出数据 | 执行 | 导出文件不包含明文 API Key |
| AC-F5-5 | 两个用户分别配置模型密钥 | Agent / QQ / Scheduler 调用模型 | 各自只能使用自己的模型密钥 |
