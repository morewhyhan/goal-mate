# F4 计划与每日执行规格

## 1. 模块定位

计划与每日执行模块负责把目标推理结果转化为阶段计划、周计划、今日行动、任务项目和 Check-in。它是用户每天实际使用最多的部分。

## 2. 计划层级

```text
Goal
  -> StagePlan 目标阶段
  -> WeeklyPlan 周计划
  -> DailyAction 今日行动
  -> Task / Project 可选任务项目
```

## 3. 字段清单

### 3.1 stage_plan

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 阶段计划 ID |
| goal_id | string | 是 | 无 | 关联目标 |
| title | string | 是 | 无 | 阶段标题 |
| stage_goal | string | 是 | 无 | 阶段目标 |
| start_date | date | 是 | 当前日期 | 开始日期 |
| end_date | date | 否 | 空 | 结束日期 |
| linked_condition_ids | string[] | 是 | [] | 本阶段补齐的条件 |
| success_signals | string[] | 是 | [] | 阶段完成信号 |
| status | enum | 是 | draft | draft, active, completed, adjusted, cancelled |

### 3.2 daily_action

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 行动 ID |
| goal_id | string | 是 | 无 | 关联目标 |
| plan_id | string | 是 | 无 | 关联计划 |
| action_date | date | 是 | 当前日期 | 行动日期 |
| title | string | 是 | 无 | 行动标题 |
| reason | string | 是 | 无 | 为什么做 |
| linked_condition_id | string | 是 | 无 | 对应关键条件 |
| done_when | string | 是 | 无 | 完成标准 |
| minimum_step | string | 是 | 无 | 最小启动动作 |
| estimated_minutes | integer | 是 | 20 | 预计耗时 |
| fallback_action | string | 是 | 无 | 低精力备选 |
| status | enum | 是 | planned | planned, done, partial, not_done, skipped, replaced |

### 3.3 task

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 任务 ID |
| goal_id | string | 是 | 无 | 关联目标 |
| project_id | string | 否 | 空 | 关联项目 |
| title | string | 是 | 无 | 任务标题 |
| source | enum | 是 | user | user, ai, calendar, email, integration |
| due_at | datetime | 否 | 空 | 截止时间 |
| status | enum | 是 | open | open, scheduled, done, cancelled |
| promoted_to_daily_action | boolean | 是 | false | 是否成为今日行动 |

## 4. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F4-R1 | 每个 active goal 必须有 active StagePlan | P0 |
| F4-R2 | Today 页对 current_focus_goal 只展示一个 primary DailyAction | P0 |
| F4-R3 | DailyAction 必须有 linked_condition_id、done_when、minimum_step | P0 |
| F4-R4 | estimated_minutes 超过 60 时必须拆小 | P0 |
| F4-R5 | fallback_action 必须比主行动更容易 | P0 |
| F4-R6 | Task 不等于 DailyAction，只有被提升后才进入今日推进 | P0 |
| F4-R7 | AI 可建议任务排序，但不得默认塞满用户一天 | P0 |
| F4-R8 | 用户完成 DailyAction 后，必须更新关联条件或 KR 的进展依据 | P0 |
| F4-R9 | 计划调整时必须保留历史版本 | P0 |

## 5. Today 页展示规则

Today 页必须包含：

| 元素 | 要求 |
| --- | --- |
| 当前主目标 | 明确今天服务哪个目标 |
| 今日行动 | 主视觉，只展示一个 primary action |
| 为什么做它 | 指向关键条件 |
| 完成标准 | 用户能判断是否完成 |
| 最小启动动作 | 降低启动门槛 |
| 低精力备选 | 支持用户状态不好时仍推进 |
| 快捷反馈 | 完成、部分完成、没做、改小 |
| 次要任务 | 可折叠，不抢主行动 |

## 6. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F4-1 | current_focus_goal 存在 | 用户打开 Today | 只显示一个 primary DailyAction |
| AC-F4-2 | DailyAction 缺少 done_when | 系统保存 | 保存失败 |
| AC-F4-3 | 用户完成行动 | 系统保存 Check-in | 关联条件 evidence 更新 |
| AC-F4-4 | AI 从邮箱提取任务 | 任务进入系统 | source 为 email，且不会自动成为 DailyAction |
| AC-F4-5 | 用户调整计划 | 系统保存 | 旧计划版本保留，新计划版本生效 |

