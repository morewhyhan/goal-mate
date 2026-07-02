# Goal Mate v0.1 AI 输出 Schema

## 1. 定位

AI 不能只输出自然语言。所有会影响目标、行动、诊断、复盘、日志或设置的关键结果，都必须产出结构化对象，并通过 schema 校验后才能进入确认或保存流程。

代码位置：`src/lib/goal-mate-ai-schemas.ts`

## 2. 输出类型

| 类型 | 用途 | 是否可直接落库 |
| --- | --- | --- |
| goal_reasoning_card | 目标推理卡，包含目标理解、KR、条件、当前缺口 | 需用户确认 |
| daily_action | 今日行动，必须绑定关键条件 | 可保存草案，进入 Today 前需目标有效 |
| diagnosis | 未完成诊断，判断行为问题或路径问题 | 可保存 |
| review | 日/周/月/年/目标周期复盘 | 可写入日志草案 |
| setting_change_draft | 设置修改草案 | 必须用户确认 |
| log_patch | Markdown 日志写入补丁 | 普通日志可按设置自动写入，覆盖用户内容需确认 |

## 3. goal_reasoning_card

必须包含：

| 字段 | 说明 |
| --- | --- |
| purpose_summary | 用户真正想达成的目的 |
| horizon | 开始时间、结束时间和可读周期 |
| objective | 隐式 Objective，不强迫用户学习术语 |
| success_signals | 可验证成功信号 |
| key_results | 充分必要的 KR，不限制数量，但每条必须必要 |
| necessary_conditions | 必要条件、假设条件、支撑条件 |
| sufficient_condition_set | 多个条件如何共同证明目标可达 |
| current_gap | 当前最关键缺口 |
| recommended_focus | 当前推进重点 |
| confidence_score | AI 推理置信度 |
| evidence | 推理依据，来自用户输入、日志或历史对话 |

## 4. daily_action

今日行动不是普通任务。它必须包含：

| 字段 | 说明 |
| --- | --- |
| title | 今天要做的具体动作 |
| linked_condition | 它补齐哪个关键条件 |
| done_when | 做到什么算完成 |
| minimum_step | 最小启动动作 |
| fallback_action | 状态差时的替代动作 |
| estimated_minutes | 预计耗时 |
| checkin_question | 完成后如何反馈 |

## 5. diagnosis

未完成时必须诊断，而不是鼓励或催促。

| 分类 | 含义 |
| --- | --- |
| motivation | 目标吸引力或真实动机不足 |
| ability | 动作太大、太难、太抽象 |
| prompt | 提醒时间、渠道或话术不合适 |
| path | 行动没有补齐关键条件 |
| condition | 当前缺口判断错误 |
| goal | 目标本身仍未澄清 |
| unknown | 信息不足，需要继续问 |

## 6. review

复盘必须回答：

```text
目标是否更清楚了？
哪个条件被补齐了？
哪个 KR 有变化？
哪个行动无效？
下周期推进什么？
```

复盘结果默认生成 Markdown 内容，写入 Logs。

## 7. setting_change_draft

Agent 可以建议修改设置，但不能静默修改。所有设置变更必须包含影响说明，并要求确认。

## 8. log_patch

日志写入必须明确目标文件、写入方式、Markdown 内容和来源上下文。系统自动写入不能覆盖用户手写内容。
