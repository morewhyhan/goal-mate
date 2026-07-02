# F6 数据模型规格

## 1. 模块定位

v0.1 数据模型服务单主目标完整推进闭环，同时为后续多目标、机器人、自部署预留扩展空间。

## 2. 核心实体

| 实体 | 说明 | v0.1 |
| --- | --- | --- |
| User | 用户 | 必须 |
| Goal | 目标 | 必须 |
| GoalReasoningCard | 目标推理卡 | 必须 |
| KeyResult | 关键结果 | 必须 |
| GoalCondition | 关键条件 | 必须 |
| StagePlan | 阶段计划 | 必须 |
| DailyAction | 今日行动 | 必须 |
| Checkin | 每日反馈 | 必须 |
| Diagnosis | 未完成诊断 | 必须 |
| Review | 复盘 | 必须 |
| LogEntry | Markdown 日志 | 必须 |
| AgentThread | 对话线程 | 必须 |
| AgentMessage | 对话消息 | 必须 |
| ModelConfig | 模型配置 | 必须 |
| UserSetting | 用户设置 | 必须 |
| IntegrationAccount | 外部集成账号 | 预留 |
| ExternalActionRequest | 外部动作请求 | 预留 |

## 3. 枚举

| 枚举 | 值 |
| --- | --- |
| goal_status | draft, clarifying, confirmed, active, paused, completed, abandoned, archived |
| condition_type | hard, assumed, supporting |
| condition_status | missing, partial, satisfied, invalidated |
| action_status | planned, done, partial, not_done, skipped, replaced |
| diagnosis_category | motivation, ability, prompt, path, condition, goal, unknown |
| review_type | daily, weekly, monthly, quarterly, yearly, goal_cycle |
| log_period_type | year, quarter, month, week, day |
| model_usage | chat, reasoning, summary, embedding |

## 4. 关键字段

### 4.1 Goal

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 目标 ID |
| user_id | string | 是 | 用户 ID |
| title | string | 是 | 目标标题 |
| raw_input | text | 是 | 用户原始表达 |
| interpreted_goal | text | 否 | AI 理解后的目标 |
| horizon_start | date | 否 | 开始时间 |
| horizon_end | date | 否 | 结束时间 |
| status | enum | 是 | 状态 |
| is_current_focus | boolean | 是 | 是否当前主目标 |
| current_reasoning_card_id | string | 否 | 当前推理卡 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

### 4.2 GoalReasoningCard

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 推理卡 ID |
| goal_id | string | 是 | 目标 ID |
| version | integer | 是 | 版本 |
| purpose_summary | text | 是 | 目的摘要 |
| success_signals | json | 是 | 成功标准 |
| sufficient_condition_set | text | 是 | 充分条件组合 |
| current_gap_condition_id | string | 是 | 当前缺口 |
| recommended_focus | text | 是 | 当前推进重点 |
| confidence_score | number | 是 | 置信度 |
| evidence | json | 是 | 依据 |
| status | enum | 是 | draft, pending_user_confirmation, confirmed, stale |

### 4.3 KeyResult

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | KR ID |
| goal_id | string | 是 | 目标 ID |
| title | string | 是 | 关键结果 |
| metric_type | enum | 是 | boolean, count, percent, weight, text |
| current_value | string | 否 | 当前值 |
| target_value | string | 否 | 目标值 |
| progress | number | 是 | 0 到 1 |
| status | enum | 是 | active, achieved, at_risk, abandoned |

### 4.4 LogEntry

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 日志 ID |
| user_id | string | 是 | 用户 ID |
| period_type | enum | 是 | year, quarter, month, week, day |
| title | string | 是 | 标题 |
| path | string | 是 | Markdown 路径 |
| content | text | 是 | Markdown 内容 |
| linked_goal_ids | string[] | 否 | 关联目标 |
| linked_action_ids | string[] | 否 | 关联行动 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

### 4.5 ModelConfig

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 配置 ID |
| user_id | string | 是 | 用户 ID |
| provider | string | 是 | DeepSeek 等 |
| model | string | 是 | deepseek-v4-flash 等 |
| api_base | string | 是 | API 地址 |
| api_key_ref | string | 是 | 密钥安全引用 |
| usage | enum | 是 | chat, reasoning, summary |
| is_default | boolean | 是 | 是否默认 |

## 5. 数据规则

| 编号 | 规则 |
| --- | --- |
| D-R1 | 所有用户数据必须有 user_id 或能通过父级关联到 user_id |
| D-R2 | 一个用户 v0.1 可以有多个目标，但只能有一个 is_current_focus=true |
| D-R3 | active goal 必须有 confirmed GoalReasoningCard |
| D-R4 | DailyAction 必须关联 GoalCondition |
| D-R5 | AgentMessage 必须归属 AgentThread |
| D-R6 | LogEntry 的 path 必须防止路径穿越 |
| D-R7 | API Key 不保存明文，只保存加密值或安全引用 |
| D-R8 | AI 关键输出必须保存版本和依据 |
