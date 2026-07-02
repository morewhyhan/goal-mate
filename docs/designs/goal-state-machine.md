# Goal Mate v0.1 状态机与确认边界

## 1. Goal 状态

```text
draft -> clarifying -> confirmed -> active
                              -> paused
                              -> completed
                              -> abandoned
                              -> archived
```

## 2. Goal 状态规则

| 状态 | 含义 | 可进入条件 |
| --- | --- | --- |
| draft | 用户刚输入目的 | 有 raw_input |
| clarifying | Agent 正在追问成功标准和边界 | 至少缺少成功标准、周期或当前条件之一 |
| confirmed | 用户确认目标推理卡 | 有 confirmed GoalReasoningCard |
| active | 进入每日推进 | 有 confirmed GoalReasoningCard、KR、Condition、StagePlan、DailyAction |
| paused | 暂停推进 | 用户确认暂停 |
| completed | 目标完成 | 用户确认完成，且 KR/成功标准有证据 |
| abandoned | 放弃目标 | 用户强确认 |
| archived | 不再显示在主流程 | completed、abandoned 或 paused 后可归档 |

## 3. ReasoningCard 状态

```text
draft -> pending_user_confirmation -> confirmed
                                    -> rejected
confirmed -> stale
```

| 状态 | 规则 |
| --- | --- |
| draft | AI 初步生成，不影响正式目标 |
| pending_user_confirmation | 等待用户确认 |
| confirmed | 当前有效推理卡 |
| rejected | 用户拒绝，不能进入推进 |
| stale | 目标、KR、条件或路径被修改后，旧卡失效 |

## 4. DailyAction 状态

```text
planned -> done
planned -> partial
planned -> not_done
planned -> skipped
planned -> replaced
not_done -> replaced
partial -> replaced
```

规则：DailyAction 必须绑定 GoalCondition；没有 linked_condition 不允许保存。

## 5. 诊断触发

| 条件 | 触发 |
| --- | --- |
| 单次 not_done | 行为层诊断：motivation / ability / prompt |
| 连续 3 次 not_done 或 partial | 路径层诊断：path / condition / goal |
| 用户明确说目标不想做 | motivation 或 goal 诊断 |
| 行动超过 60 分钟且多次未完成 | ability 诊断，建议缩小 |
| 用户反馈提醒时间不对 | prompt 诊断，建议改提醒 |

## 6. 确认边界

| 操作 | 是否需要确认 | 说明 |
| --- | --- | --- |
| Agent 生成建议 | 否 | 只展示，不落入正式状态 |
| 保存普通 Check-in | 否 | 用户主动反馈可直接保存 |
| 自动写入普通日志 | 按设置 | 默认允许追加，不覆盖用户内容 |
| 修改目标推理卡 | 是 | 会改变后续路径 |
| 切换 current_focus_goal | 是 | 会改变 Today |
| 修改 KR 或关键条件 | 是 | 会改变进度判断 |
| 修改提醒策略 | 是 | 会影响用户触达 |
| 修改模型配置 | 是 | 会影响 AI 行为和成本 |
| 删除目标、日志、记忆 | 强确认 | 不可静默执行 |
| 外部工具 execute | 强确认 | v0.1 仅预留 |

## 7. 核心不变量

| 编号 | 不变量 |
| --- | --- |
| INV-1 | 一个用户同一时间只能有一个 current_focus_goal 进入 Today |
| INV-2 | active goal 必须有 confirmed GoalReasoningCard |
| INV-3 | DailyAction 必须有 linked_condition |
| INV-4 | Agent 不能在用户未确认时修改目标、KR、关键条件或设置 |
| INV-5 | API Key 不能明文返回前端或写入日志 |
| INV-6 | Logs 自动写入不能覆盖用户手写内容 |
| INV-7 | 用户关闭 Agent 读取 Logs 后，Agent 不得引用日志内容 |
