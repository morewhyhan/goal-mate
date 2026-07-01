# F5 诊断、复盘与洞察规格

## 1. 模块定位

本模块负责处理“没有推进”的情况，并在周期结束时形成复盘和长期行为洞察。

## 2. 诊断模型

未完成原因分四层：

| 分类 | 含义 | 典型调整 |
| --- | --- | --- |
| motivation | 目标不真实、不够重要、价值不清 | 重审目标、暂停目标、改写成功标准 |
| ability | 行动太难、太大、太抽象 | 缩小行动、拆步骤、降低耗时 |
| prompt | 提醒时间、渠道、话术不合适 | 调整提醒 |
| path | 目标路径或当前关键条件判断错 | 重建条件、换阶段重点 |

## 3. 复盘类型

| 类型 | 触发 | 内容 |
| --- | --- | --- |
| Daily Review | 每日 Check-in 后 | 今日行动结果、明日调整 |
| Weekly Review | 每周固定时间 | 本周目标进展、阻塞、下周重点 |
| Monthly Review | 每月固定时间 | 多目标状态、投入产出、目标取舍 |
| Goal Cycle Review | 阶段或目标结束 | 条件变化、目标是否成立、下一阶段 |

## 4. 字段清单

### 4.1 diagnosis

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 诊断 ID |
| goal_id | string | 是 | 无 | 目标 ID |
| action_id | string | 否 | 空 | 行动 ID |
| category | enum | 是 | unknown | motivation, ability, prompt, path, unknown |
| severity | enum | 是 | low | low, medium, high |
| question | string | 是 | 无 | 诊断问题 |
| user_answer | string | 否 | 空 | 用户回答 |
| evidence | string | 否 | 空 | 判断依据 |
| adjustment_type | enum | 否 | 空 | keep, simplify, reschedule, reframe_goal, rebuild_path, pause_goal |
| status | enum | 是 | draft | draft, answered, adjusted, skipped |

### 4.2 review

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 复盘 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| goal_id | string | 否 | 空 | 可为空，表示全局复盘 |
| review_type | enum | 是 | weekly | daily, weekly, monthly, goal_cycle |
| period_start | date | 是 | 无 | 周期开始 |
| period_end | date | 是 | 无 | 周期结束 |
| progress_summary | string | 是 | 无 | 进展摘要 |
| condition_changes | object[] | 是 | [] | 条件变化 |
| blocker_summary | object[] | 是 | [] | 阻塞摘要 |
| recommended_decision | enum | 是 | continue | continue, adjust, pause, complete, abandon |
| next_focus | string | 否 | 空 | 下一阶段重点 |
| user_decision | enum | 否 | 空 | 用户最终选择 |

## 5. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F5-R1 | partial、not_done、no_response 都必须触发诊断或记录跳过原因 | P0 |
| F5-R2 | 连续 3 次未完成必须进入 path 级诊断 | P0 |
| F5-R3 | motivation 诊断不能只缩小行动，必须重审目标 | P0 |
| F5-R4 | ability 诊断的新行动必须更小 | P0 |
| F5-R5 | prompt 诊断必须修改提醒时间、渠道或话术 | P0 |
| F5-R6 | 每周必须生成 Weekly Review | P0 |
| F5-R7 | 每月必须生成多目标 Monthly Review | P1 |
| F5-R8 | 复盘不能只统计完成率，必须说明条件变化和路径判断 | P0 |
| F5-R9 | pause、complete、abandon 必须用户确认 | P0 |
| F5-R10 | 长期洞察只能描述模式，不能评价人格 | P0 |

## 6. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F5-1 | 用户未完成行动 | 系统进入诊断 | 展示四类原因选项 |
| AC-F5-2 | 用户连续 3 次未完成 | 系统生成诊断 | 必须包含 path 级问题 |
| AC-F5-3 | 到达周复盘时间 | 系统生成复盘 | 包含进展、条件变化、阻塞、下周重点 |
| AC-F5-4 | 复盘建议放弃目标 | 用户未确认 | 目标状态不变 |
| AC-F5-5 | 系统生成洞察 | 文案检查 | 不出现人格评价或羞辱性表达 |

