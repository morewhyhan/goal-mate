# Goal Mate v0.1 API 契约

## 1. 规范

API 使用 Hono RPC。成功响应统一返回 `{ data }`，列表可附带 `{ meta }`，错误统一返回 `{ error: { code, message } }`。

所有用户私有资源必须从 session 获取 userId，不信任前端传入 userId。

## 2. Settings API

### GET /api/settings

返回当前用户设置。

```json
{
  "data": {
    "general": { "locale": "zh-CN", "timezone": "Asia/Shanghai", "week_start": "monday" },
    "goals": { "max_active_goals": 1, "review_cadence": "weekly" },
    "logs": { "vault_root": "logs/", "auto_write_checkin": true, "preserve_user_edits": true },
    "today": { "generate_time": "08:30", "heatmap_scope": "year" },
    "agent": { "can_read_goals": true, "can_read_logs": true, "memory_enabled": true },
    "notifications": { "morning_checkin_time": "08:30", "evening_review_time": "21:30" }
  }
}
```

### PUT /api/settings

保存设置。修改目标、Agent 权限、模型或提醒策略时，若由 Agent 发起必须先确认。

### POST /api/settings/models/test

测试模型连接，不记录完整 API Key。

## 3. Models API

### GET /api/models

返回模型配置，API Key 只能脱敏。

### PUT /api/models/:id

保存模型配置。默认包含 DeepSeek：provider、model、reasoning_model、api_base、api_key_ref、default_for。

## 4. Logs API

### GET /api/logs/tree

返回年/季/月/周/日层级树。

### GET /api/logs/:id

返回 Markdown 内容。

### PUT /api/logs/:id

保存用户编辑内容。

### POST /api/logs/patch

根据 log_patch schema 追加或创建日志内容。默认不能覆盖用户手写内容。

## 5. Goals API

### GET /api/goals

返回目标摘要列表。v0.1 可有多个目标，但 Today 只使用 current_focus_goal。

列表项必须包含目标页能解释推进状态的最小只读上下文：KR、条件、阶段、最近今日行动、最近 Check-in、最近 Diagnosis 和 confirmed ReasoningCard。否则 Today 反馈虽然已经入库，Goals 页面也无法解释“为什么进度变成这样”。

### GET /api/goals/:id

返回目标详情：Goal、ReasoningCard、KR、Condition、StagePlan、DailyAction、进度。

### POST /api/goals/reasoning-card/draft

根据 Agent 输出创建目标推理卡草案。

### POST /api/goals/reasoning-card/:id/confirm

用户确认后，推理卡变为 confirmed，并允许目标进入 active。

## 6. Today API

### GET /api/today

返回 current_focus_goal 的唯一主行动。

必须包含：目标、今日行动、绑定条件、完成标准、最小启动、低精力备选、热力图摘要。

### POST /api/today/checkin

提交 done、partial、not_done、skipped。not_done 时触发诊断流程。

## 7. Agent API

### GET /api/agent/threads

返回对话历史。

### POST /api/agent/threads

创建对话线程。

### GET /api/agent/threads/:id/messages

返回消息列表。

### POST /api/agent/threads/:id/messages

发送用户消息，返回 assistant 消息和可选 structured_output。

### POST /api/agent/structured-output/confirm

确认 Agent 草案，并根据类型写入 Goal、DailyAction、Review、Log 或 Setting。

## 8. 错误码

| code | 说明 |
| --- | --- |
| UNAUTHORIZED | 未登录 |
| FORBIDDEN | 无权访问资源 |
| NOT_FOUND | 资源不存在 |
| VALIDATION_ERROR | 请求或 AI 输出校验失败 |
| CONFIRMATION_REQUIRED | 操作需要用户确认 |
| STALE_REASONING_CARD | 推理卡已过期 |
| ACTIVE_GOAL_REQUIRED | Today 没有 current_focus_goal |
| MODEL_CONNECTION_FAILED | 模型连接测试失败 |
| INTERNAL_ERROR | 未预期错误 |
