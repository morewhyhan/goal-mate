# F3 多目标工作台规格

## 1. 模块定位

目标工作台负责让用户管理多个目标，同时保持系统的推进焦点。它不是项目看板，而是目标状态、优先级、条件和阶段的集中视图。

## 2. 页面范围

| 页面 | 功能 |
| --- | --- |
| Goals 列表 | 查看所有目标、状态、风险、下一步 |
| Goal Detail | 查看目标推理卡、条件、KR、阶段计划、行动历史 |
| Focus 设置 | 设置当前主目标和本周重点 |
| Conflict View | 展示目标冲突、时间冲突、注意力冲突 |
| Archive | 查看完成、暂停、放弃目标 |

## 3. 字段清单

### 3.1 goal_workspace_state

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| user_id | string | 是 | 当前用户 | 用户 ID |
| current_focus_goal_id | string | 否 | 空 | 当前主目标 |
| weekly_focus_goal_ids | string[] | 否 | [] | 本周重点目标，建议最多 3 个 |
| max_active_goals | integer | 是 | 3 | 同时 active 目标上限 |
| attention_budget_hours | number | 否 | 空 | 用户每周可投入时间 |
| updated_at | datetime | 是 | 当前时间 | 更新时间 |

### 3.2 goal_summary

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| goal_id | string | 是 | 无 | 目标 ID |
| title | string | 是 | 无 | 目标标题 |
| scenario_type | enum | 是 | custom | 场景 |
| status | enum | 是 | draft | 状态 |
| priority | enum | 是 | medium | high, medium, low |
| risk_status | enum | 是 | normal | normal, at_risk, blocked, stale |
| current_gap | string | 否 | 空 | 当前缺口 |
| next_action_title | string | 否 | 空 | 下一行动 |
| last_checkin_at | datetime | 否 | 空 | 最近反馈时间 |

## 4. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F3-R1 | 用户可以创建多个目标，但 active 目标默认最多 3 个 | P0 |
| F3-R2 | 今日页必须始终有且只有一个 current_focus_goal，除非用户没有 active 目标 | P0 |
| F3-R3 | 当 active 目标超过 max_active_goals 时，系统必须要求暂停或归档一个目标 | P0 |
| F3-R4 | 目标超过 7 天无 Check-in，应标记 stale | P0 |
| F3-R5 | 多目标时间预算超过用户 attention_budget_hours 时，系统必须提示冲突 | P1 |
| F3-R6 | 系统不得把所有 active 目标平均安排到每天 | P0 |
| F3-R7 | 用户可以手动置顶目标，但 AI 可以提醒优先级与目标真实重要性不一致 | P1 |

## 5. 目标冲突判断

冲突类型：

| 类型 | 判断条件 |
| --- | --- |
| time_conflict | 目标计划总耗时超过用户可投入时间 |
| attention_conflict | 同一周期 high priority 目标超过 2 个 |
| resource_conflict | 多个目标依赖同一稀缺资源 |
| motivation_conflict | 用户反馈目标重要性下降但仍占用主焦点 |
| path_conflict | 一个目标的行动会阻碍另一个目标 |

## 6. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F3-1 | 用户有 3 个 active 目标 | 用户尝试激活第 4 个目标 | 系统要求暂停或归档一个目标 |
| AC-F3-2 | 用户打开 Today 页 | 有多个 active 目标 | 页面只展示一个 current_focus_goal 的主行动 |
| AC-F3-3 | 目标 7 天无反馈 | 系统刷新工作台 | 目标 risk_status 变为 stale |
| AC-F3-4 | 目标计划总耗时超过时间预算 | 系统计算计划 | 展示 time_conflict 和取舍建议 |
