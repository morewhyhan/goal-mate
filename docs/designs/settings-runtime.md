# Settings Runtime

## 1. 定位

Settings 是系统控制参数中心，不是静态表单集合。

每个设置项必须对应一个真实运行行为：

- Agent 能不能读取目标和日志。
- 模型用哪个 provider、model、API Base。
- 提醒什么时候触发。
- 日志是否自动写入。
- 数据导出是否脱敏。
- 高风险动作是否需要确认。

如果一个设置不影响实际行为，就不应该作为可操作项展示。

## 2. 数据来源

Settings Runtime 由两层组成：

```text
defaultUserSettings
  -> UserSetting
```

`defaultUserSettings` 给出 v0.1 的安全默认值。`UserSetting` 保存用户覆盖项。

## 3. 设置分类

| 分类 | 真实控制对象 |
| --- | --- |
| General | locale、timezone、week_start 等基础偏好 |
| Goals | 当前 v0.1 单主目标边界、复盘节奏 |
| Logs | Markdown 存储、命名、自动写入、保护用户手写区 |
| Today | 今日行动生成、热力图统计范围 |
| Agent | 读取目标、读取日志、记忆、确认策略 |
| Models | 模型供应商、模型名、API Base、密钥、温度 |
| Notifications | 提醒时间、渠道、每日上限、免打扰 |
| Integrations | QQ 等外部入口 |
| Data & Privacy | 导出、删除、脱敏、本地优先边界 |

## 4. 当前真实配置

### Agent

| 字段 | 影响 |
| --- | --- |
| `can_read_goals` | 关闭后 Agent 不得引用目标结构 |
| `can_read_logs` | 关闭后 Agent 不得引用 Markdown 日志 |
| `memory_enabled` | 关闭后 Agent 不加载历史对话 |
| `require_confirm_goal_changes` | 控制目标修改是否必须确认 |
| `require_confirm_setting_changes` | 控制设置修改是否必须确认 |
| `require_confirm_external_actions` | 控制外部动作是否必须确认 |

### Models

| 字段 | 影响 |
| --- | --- |
| `provider` | 模型供应商 |
| `model` | 默认聊天模型 |
| `apiBase` | 模型 API 地址 |
| `apiKeyRef` | 密钥引用或加密存储字段 |
| `temperature` | 回复稳定性 |
| `isDefault` | Agent Runtime 优先使用的模型 |

### Logs

| 字段 | 影响 |
| --- | --- |
| `auto_write_checkin` | check-in 后是否自动写入 Markdown |
| `auto_write_review` | 复盘后是否自动写入 Markdown |
| `review_cadence` | 默认复盘周期 |
| `preserve_user_edits` | 自动区块不得覆盖用户手写内容 |

### Notifications

真实调度以 `ReminderRule` 为准。

Settings 中的通知字段不能形成第二套不会被 Scheduler 执行的假配置。

Settings 也不能把“提醒规则已开启”误展示成“主动提醒已可送达”。主动提醒可送达至少需要：

```text
ReminderRule enabled
  + QQ Bot 已配置
  + 当前账号已有 enabled QqChatBinding
```

因此干净用户即使默认有早中晚规则，也必须看到 `待配置 QQ` 或 `待绑定 QQ`，直到 QQ 参数和绑定都完成后，才能显示为可发送状态。

### Integrations / QQ

| 字段/动作 | 影响 |
| --- | --- |
| `appId` / `token` / `apiBase` / `intents` | QQ Worker 是否能连接 QQ OpenAPI 和 Gateway |
| `allowedContextIds` | 可选白名单；为空表示不限制上下文，但不决定用户归属 |
| `generate_binding_code` | 生成 30 分钟有效的一次性绑定码 |
| `binding_code` | 用户在 QQ 中发送“绑定 GM-XXXXXX”后，Worker 才写入 `QqChatBinding` |

QQ 用户归属不能靠默认邮箱、第一用户或任意首次消息判断。未绑定 QQ 会话只能收到绑定引导，不能读取任何目标、日志、模型或 Agent 记忆。

## 5. Settings Control Center

Settings 页面还承担运行观测功能。

它应该能解释：

- Web 是否正常。
- 模型是否可用。
- QQ 是否有绑定。
- Scheduler 是否有调度事件。
- Tools 是否有最近审计。
- 数据导出和隐私策略是否生效。

## 6. 禁止项

v0.1 不允许出现这些假设置：

- 可编辑但不会被 Scheduler 使用的提醒字段。
- 可编辑但不会改变 Agent 行为的权限开关。
- 可编辑但不会影响日志路径的自定义路径字段。
- 可编辑但没有实现的本地优先模式。
- 可编辑但不会真正切换模型的模型选项。

未实现能力只能作为说明或 future boundary，不能伪装成可用控件。

## 7. 相关文档

- `docs/features/goal-mate-v0.1/06-settings.md`
- `docs/designs/model-provider.md`
- `docs/designs/privacy-and-permissions.md`
- `docs/designs/runtime-observability.md`
