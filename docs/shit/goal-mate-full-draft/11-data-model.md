# F10 核心数据模型规格

## 1. 模块定位

本文件汇总完整版核心数据模型。技术规格阶段应基于本文继续生成 DBML/SQL DDL、OpenAPI Schema 和领域模型图。

## 2. 核心枚举

| 枚举 | 可选值 |
| --- | --- |
| scenario_type | learning_exam, job_transition, business_side_project, content_work, skill_growth, health_habit, custom |
| goal_status | draft, clarifying, confirmed, active, paused, completed, abandoned, archived |
| priority | high, medium, low |
| risk_status | normal, at_risk, blocked, stale |
| condition_type | hard, assumed, supporting |
| condition_status | missing, partial, satisfied, invalidated |
| action_status | planned, done, partial, not_done, skipped, replaced |
| checkin_result | done, partial, not_done, no_response |
| diagnosis_category | motivation, ability, prompt, path, unknown |
| adjustment_type | keep, simplify, reschedule, reframe_goal, rebuild_path, pause_goal |
| review_type | daily, weekly, monthly, goal_cycle |
| review_decision | continue, adjust, pause, complete, abandon |
| permission_action | read, draft, execute |

## 3. 实体清单

| 实体 | 说明 | 优先级 |
| --- | --- | --- |
| users | 用户 | P0 |
| user_profiles | 用户画像与偏好 | P0 |
| goals | 目标 | P0 |
| goal_reasoning_cards | 目标推理卡 | P0 |
| key_results | 关键结果 | P0 |
| goal_conditions | 关键条件 | P0 |
| stage_plans | 阶段计划 | P0 |
| daily_actions | 今日行动 | P0 |
| checkins | 每日反馈 | P0 |
| diagnoses | 诊断 | P0 |
| reviews | 复盘 | P0 |
| memory_items | 长期记忆 | P0 |
| ai_interactions | AI 输出记录 | P0 |
| reminder_rules | 提醒规则 | P0 |
| integration_accounts | 集成账号 | P1 |
| external_action_requests | 外部动作请求 | P1 |
| projects | 项目 | P1 |
| tasks | 任务 | P1 |

## 4. 关键字段摘要

### 4.1 goals

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 目标 ID |
| user_id | string | 是 | 无 | 用户 ID |
| title | string | 是 | 无 | 目标标题 |
| raw_input | string | 是 | 无 | 原始输入 |
| scenario_type | enum | 是 | custom | 场景 |
| interpreted_goal | string | 否 | 空 | AI 理解后的目标 |
| why | string | 否 | 空 | 目标原因 |
| status | enum | 是 | draft | 目标状态 |
| priority | enum | 是 | medium | 优先级 |
| risk_status | enum | 是 | normal | 风险状态 |
| current_reasoning_card_id | string | 否 | 空 | 当前推理卡 |
| created_at | datetime | 是 | 当前时间 | 创建时间 |
| updated_at | datetime | 是 | 当前时间 | 更新时间 |

### 4.2 goal_reasoning_cards

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 推理卡 ID |
| goal_id | string | 是 | 无 | 目标 ID |
| version | integer | 是 | 1 | 版本 |
| purpose_summary | string | 是 | 无 | 目的摘要 |
| success_signals | string[] | 是 | [] | 成功信号 |
| sufficient_condition_set | string | 是 | 无 | 充分条件组合 |
| current_gap_condition_id | string | 是 | 无 | 当前缺口 |
| confidence_score | number | 是 | 0.6 | 置信度 |
| status | enum | 是 | draft | draft, pending_user_confirmation, confirmed, rejected, stale |

### 4.3 daily_actions

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 行动 ID |
| goal_id | string | 是 | 无 | 目标 ID |
| plan_id | string | 是 | 无 | 阶段计划 |
| action_date | date | 是 | 无 | 日期 |
| title | string | 是 | 无 | 标题 |
| reason | string | 是 | 无 | 理由 |
| linked_condition_id | string | 是 | 无 | 关联条件 |
| done_when | string | 是 | 无 | 完成标准 |
| minimum_step | string | 是 | 无 | 最小启动 |
| estimated_minutes | integer | 是 | 20 | 预计耗时 |
| fallback_action | string | 是 | 无 | 备选行动 |
| status | enum | 是 | planned | 状态 |

## 5. 数据规则

| 编号 | 规则 |
| --- | --- |
| D-R1 | 所有业务实体必须有 created_at 和 updated_at |
| D-R2 | 关键 AI 生成实体必须有 version 或 ai_interaction_id |
| D-R3 | 删除用户数据必须覆盖 goals、memory、ai_interactions、integrations |
| D-R4 | 外部动作必须可审计 |
| D-R5 | 自部署与云端使用同一逻辑模型，允许数据库实现不同 |

