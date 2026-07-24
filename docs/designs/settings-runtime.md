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
UserSetting.notifications.proactive_contact_enabled = true
  + ReminderRule enabled
  + ReminderRule metadata has confirmed contact consent
  + consent metadata has an authorized QQ context
  + QQ Bot 已配置
  + 当前账号已有 enabled QqChatBinding
  + Contact Policy 当前决定 send
```

干净用户会建立早晨规划、中午检查、晚上复盘和周复盘四个推荐候选窗口，但规则全部默认关闭。绑定 QQ 后也保持关闭，直到用户在 Settings 明确开启或在 Web / QQ 对话中确认启用。

当前 Notifications 关键字段：

| 字段 | 影响 |
| --- | --- |
| `proactive_contact_enabled` | 主动联系全局 consent；默认 `false` |
| `proactive_contact_cadence` | `light` / `balanced` / `supportive`，决定全局每日联系上限和启用哪些候选窗口 |
| `proactive_contact_pause_after` | 连续未回复达到该阈值后自动暂停；默认 `3` |
| `proactive_contact_consent_updated_at` | 区分当前授权与更早的拒绝 / 回复证据 |
| `proactive_contact_paused_reason` / `proactive_contact_paused_at` | 解释当前为何暂停 |

暂停或撤销会立即把全局 consent 设为 false，并关闭所有 QQ `ReminderRule`。普通聊天和重新绑定不能恢复；重新启用或恢复必须再次确认。

节奏对应的候选窗口是：

| 节奏 | 候选窗口 |
| --- | --- |
| `light` | 早晨规划、周复盘 |
| `balanced` | 早晨规划、晚上复盘、周复盘 |
| `supportive` | 早晨规划、中午检查、晚上复盘、周复盘 |

候选窗口数量不等于实际发送次数；Contact Policy 仍会逐次判断价值和限流。

### Integrations / QQ

| 字段/动作 | 影响 |
| --- | --- |
| `appId` / `token` / `apiBase` / `intents` | QQ Worker 是否能连接 QQ OpenAPI 和 Gateway |
| `allowedContextIds` | 可选白名单；为空表示不限制上下文，但不决定用户归属 |
| `generate_binding_code` | 生成 30 分钟有效的一次性绑定码 |
| `binding_code` | 用户在 QQ 中发送“绑定 GM-XXXXXX”后，Worker 才写入 `QqChatBinding` |

QQ 用户归属不能靠默认邮箱、第一用户或任意首次消息判断。未绑定 QQ 会话只能收到绑定引导，不能读取任何目标、日志、模型或 Agent 记忆。

QQ 绑定只接通对话入口，不是主动联系授权。Settings 必须把“QQ 已绑定”和“允许 AI 主动联系我”展示为两个独立状态。

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
- 把 QQ 绑定开关复用为主动联系 consent。
- 默认启用早中晚提醒，或在用户普通聊天后自动恢复已暂停提醒。

未实现能力只能作为说明或 future boundary，不能伪装成可用控件。

## 7. 相关文档

- `docs/features/goal-mate-v0.1/06-settings.md`
- `docs/designs/model-provider.md`
- `docs/designs/privacy-and-permissions.md`
- `docs/designs/runtime-observability.md`
