# F11 验收与测试矩阵

## 1. 验收策略

完整版验收要覆盖完整产品主链路，而不是只看单点功能。测试应包含：

```text
领域模型校验
API 契约测试
AI 结构化输出校验
关键业务规则测试
Web E2E 测试
提醒调度测试
权限与集成测试
自部署启动测试
数据导出测试
```

## 2. 主链路验收场景

| 编号 | 场景 | 覆盖模块 |
| --- | --- | --- |
| E2E-1 | 新用户创建学习目标并进入今日推进 | F1, F2, F3, F4 |
| E2E-2 | 用户同时有 3 个目标，系统选择主目标 | F3, F4 |
| E2E-3 | 用户未完成行动，系统诊断 ability 并缩小行动 | F5 |
| E2E-4 | 用户连续 3 次未完成，系统触发 path 诊断 | F5 |
| E2E-5 | 用户完成一周推进，系统生成周复盘 | F5 |
| E2E-6 | 用户接入日历，只读日程并生成时间建议 | F7 |
| E2E-7 | AI 草拟邮件但未确认，不得发送 | F7 |
| E2E-8 | 自部署服务启动并通过 MCP 提交 Check-in | F8 |
| E2E-9 | 云端多设备同步目标数据 | F9 |
| E2E-10 | 用户导出全部数据 | F9, F10 |

## 3. 关键业务规则测试

| 编号 | 规则 | 预期 |
| --- | --- | --- |
| T-R1 | active 目标超过上限 | 阻止激活并要求取舍 |
| T-R2 | 目标缺少推理卡 | 不得进入 active |
| T-R3 | DailyAction 缺少 linked_condition_id | 保存失败 |
| T-R4 | AI 输出 schema_invalid | 不更新业务状态 |
| T-R5 | 连续无响应 | 触发诊断，不提高提醒频率 |
| T-R6 | 外部 execute 无确认 | 阻止执行 |
| T-R7 | 用户删除记忆 | 后续 AI 不得引用 |
| T-R8 | 复盘建议 abandon 未确认 | 目标状态不变 |

## 4. AI 输出测试

每个 AI 结构化输出必须测试：

| 输出类型 | 必测字段 |
| --- | --- |
| goal_reasoning_card | purpose_summary, success_signals, key_results, necessary_conditions, current_gap |
| stage_plan | stage_goal, linked_condition_ids, success_signals |
| daily_action | title, reason, linked_condition_id, done_when, minimum_step, fallback_action |
| diagnosis | question, category, evidence, adjustment_type |
| review | progress_summary, condition_changes, blocker_summary, recommended_decision |
| tool_draft | provider, action_type, payload, risk_level, requires_confirmation |

## 5. 准出标准

| 类型 | 准出 |
| --- | --- |
| 领域测试 | P0 业务规则全部通过 |
| API 测试 | 核心 API schema 和权限通过 |
| E2E 测试 | E2E-1 到 E2E-5 必过，P1 上线时 E2E-6 到 E2E-10 必过 |
| AI 输出 | 所有 P0 输出 schema 校验通过 |
| 权限测试 | 高风险动作无确认不能执行 |
| 数据测试 | 导出、删除、版本追溯可用 |
