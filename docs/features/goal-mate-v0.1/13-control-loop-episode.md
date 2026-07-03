# F12 行动反馈与控制回合领域规格

## 1. 领域定位

行动反馈与控制回合领域负责管理一次完整的目标推进回合。

它不是 Agent 对话，不是日志，不是复盘，也不是元认知本身。它负责把这些已有领域串起来，回答一个核心问题：

```text
一次干预或一次用户反馈发生后，系统如何完成观察、诊断、状态更新、记录、学习，并影响下一次干预？
```

这个领域的核心对象是：

```text
ControlLoopEpisode
```

它表示一次从干预到学习的业务闭环。

## 2. 为什么需要这个领域

Goal Mate 已有多个子领域：

| 领域 | 负责什么 |
| --- | --- |
| 目标推进领域 | Goal、KR、Condition、StagePlan、DailyAction |
| Agent 交互领域 | 对话、工具调用、权限和审计 |
| 日志领域 | Markdown 年/季/月/周/日记录 |
| 干预决策领域 | 本次问什么、怎么问、控制哪个风险点 |
| 元认知领域 | AI 如何更新对用户和自身策略的判断 |
| 记忆质量领域 | 什么判断可以沉淀 |

但缺少一个领域明确：

```text
这些对象如何属于同一次推进回合？
```

如果没有 ControlLoopEpisode，系统会出现以下混乱：

- Today 打卡和 Agent 打卡各自实现一套反馈逻辑。
- InterventionDecision、Checkin、Diagnosis、Log、Meta-Cognition 互相引用但没有统一主线。
- Logs 容易被误当成事实源，而不是人类可读投影。
- 元认知容易变成单次总结，而不是多次回合后的策略进化。
- Review 不清楚是在压缩多个回合，还是重新生成另一套判断。

## 3. 领域一句话

```text
ControlLoopEpisode 是 Goal Mate 的最小控制回合：它把一次 AI 干预或一次用户反馈，转化为目标状态变化、日志投影和下一次策略更新。
```

## 4. ControlLoopEpisode 生命周期

一次完整回合应该按以下顺序发生：

```text
InterventionDecision
  -> Message / Prompt
  -> UserFeedback
  -> Checkin
  -> Diagnosis
  -> GoalStateTransition
  -> LogProjection
  -> MetaCognitionUpdate
  -> NextPolicyDelta
```

不是每一次回合都必须拥有所有节点，但系统必须明确缺失原因。

例如：

| 场景 | 合法缺失 | 原因 |
| --- | --- | --- |
| 用户主动在 Today 打卡 | 可以没有 InterventionDecision | 用户主动反馈，不是被提醒后反馈 |
| 用户只回复“没做” | 可以先没有完整 Diagnosis | 信息不足，需要下一次只问一个诊断问题 |
| 模型不可用 | 可以没有 AI Policy | 必须使用 fallback_rule，并记录原因 |
| 用户完成行动 | 可以不生成新的 Meta-Cognition | 当前策略暂时有效，不必过度学习 |

## 5. 核心领域对象

| 对象 | 含义 | 归属 |
| --- | --- | --- |
| `ControlLoopEpisode` | 一次控制回合 | 本领域 |
| `InterventionDecision` | AI 本次干预决策 | 干预决策领域 |
| `UserFeedback` | 用户自然语言反馈或按钮反馈 | Agent / Today / Channel |
| `Checkin` | 用户反馈事实 | 本领域消费，数据模型保存 |
| `Diagnosis` | 系统对偏差原因的解释 | 本领域生成 |
| `GoalStateTransition` | KR、Condition、StagePlan、DailyAction 的状态变化 | 目标推进领域 |
| `LogProjection` | 写入 Markdown 的人类可读记录 | 日志领域 |
| `MetaCognitionUpdate` | 元认知假设或策略更新 | 元认知领域 |
| `NextPolicyDelta` | 下一次干预策略如何改变 | 元认知领域 / 干预决策领域 |

## 6. 回合来源

ControlLoopEpisode 可以由三类入口触发：

| 来源 | 说明 |
| --- | --- |
| Scheduler 主动干预 | 系统到点主动问用户 |
| Agent 对话反馈 | 用户在对话里说完成、没完成、部分完成、遇到阻塞 |
| Today 页面打卡 | 用户在 Today 直接提交完成情况 |

无论入口来自哪里，都必须进入同一套控制回合语义。

也就是说：

```text
Today 里点“没做”
```

和：

```text
在 Agent 里说“我今天没做”
```

在业务含义上应该进入同一个领域服务，而不是两套并行逻辑。

## 7. 和已有领域的关系

### 7.1 和 Goal / OKR 领域

ControlLoopEpisode 不定义目标结构。

它只消费和更新目标结构：

```text
DailyAction.status
GoalCondition.status
KeyResult.progress
StagePlan.status
GoalReasoningCard.current_gap
```

### 7.2 和 Intervention Planner 领域

Intervention Planner 负责生成本次干预决策。

ControlLoopEpisode 负责记录这次决策后发生了什么，并判断它是否有效。

```text
Intervention Planner：这次怎么问
ControlLoopEpisode：问完之后发生了什么
```

### 7.3 和 Meta-Cognition 领域

Meta-Cognition 负责多次回合之后的认知进化。

ControlLoopEpisode 提供元认知所需的证据。

```text
ControlLoopEpisode 产生证据
Meta-Cognition 形成假设、验证假设、修正策略
```

二者之间必须有明确交接契约。

ControlLoopEpisode 结束时，至少向 Meta-Cognition 提供：

| 字段 | 说明 |
| --- | --- |
| `episode_source` | Scheduler / Agent / Today / Channel |
| `intervention_decision` | 本次干预问了什么、为什么问、控制哪个风险点 |
| `user_feedback` | 用户原始反馈 |
| `checkin_result` | done / partial / not_done / no_response |
| `diagnosis` | 本次更接近方向、难度、提示、路径中的哪一类 |
| `state_transition` | DailyAction、Condition、KR、StagePlan 发生了什么变化 |
| `log_projection` | 本次写入了哪份 Markdown |
| `previous_meta_cognition_used` | 本次是否使用了既有元认知 |
| `verification_signal_result` | 上一次 verification_signal 是否被支持、削弱或无法判断 |

Meta-Cognition 必须返回：

| 字段 | 说明 |
| --- | --- |
| `meta_cognition_update` | 新增、增强、削弱、修正或过期的假设 |
| `user_intervention_delta` | 下一次怎么干预用户 |
| `ai_self_reflection` | 下一次 AI 自己怎么调整推理顺序 |
| `policy_delta` | 哪类干预策略升权或降权 |
| `next_verification_signal` | 下一次用什么事实验证这次调整 |

这两个方向构成真正的元认知闭环：

```text
ControlLoopEpisode 提供事实证据
  -> Meta-Cognition 更新用户模型和 AI 自我模型
  -> Intervention Planner 消费这些更新
  -> 下一次 ControlLoopEpisode 验证这些更新
```

### 7.4 和 Logs 领域

Logs 是 ControlLoopEpisode 的人类可读投影。

日志可以保存：

```text
今日事实
偏差判断
下一步调整
System Reflection
```

但日志不是唯一事实源。系统不能把散落的 Markdown 文本当成唯一业务状态。

### 7.5 和 Review 领域

Review 是多个 ControlLoopEpisode 的周期性压缩。

Review 必须回答：

```text
这一周期哪些回合有效？
哪些回合无效？
哪个条件被补齐？
下周期最该改变什么？
哪些元认知假设应增强、削弱或重审？
```

## 8. 领域状态

ControlLoopEpisode 至少应区分以下状态：

| 状态 | 含义 |
| --- | --- |
| `planned` | 已准备干预，但尚未触达 |
| `sent` | 已触达用户 |
| `observed` | 已收到用户反馈 |
| `diagnosed` | 已完成偏差诊断 |
| `updated` | 已更新目标状态 |
| `logged` | 已写入日志投影 |
| `learned` | 已产生或更新元认知 |
| `closed` | 本回合关闭，等待后续验证 |

v0.1 可以不立即新增数据库枚举，但需求语义必须按这些状态理解。

## 9. 领域不变量

以下规则必须成立：

| 编号 | 不变量 |
| --- | --- |
| CLE-R1 | 一次主动提醒必须有 `InterventionDecision` 或明确的 fallback 原因 |
| CLE-R2 | 一次用户完成情况反馈必须形成 `Checkin` |
| CLE-R3 | `NOT_DONE`、`PARTIAL`、`NO_RESPONSE` 必须进入 Diagnosis，或明确标记为信息不足 |
| CLE-R4 | Diagnosis 必须能说明更接近方向、难度、提示、路径中的哪一种 |
| CLE-R5 | Checkin 必须尝试更新 DailyAction、Condition、KR 或 StagePlan 状态 |
| CLE-R6 | 自动写日志时，日志只能作为投影，不得替代结构化状态更新 |
| CLE-R7 | 如果产生 Meta-Cognition，必须包含证据、因果解释、决策影响和验证信号 |
| CLE-R8 | Meta-Cognition 必须能影响下一次 Intervention Planner 或 Agent Prompt |
| CLE-R9 | Today 和 Agent 提交反馈必须使用同一个领域语义，不能各自解释一套业务规则 |
| CLE-R10 | Review 必须被视为多个 ControlLoopEpisode 的压缩，而不是孤立总结 |
| CLE-R11 | ControlLoopEpisode 结束时必须向 Meta-Cognition 提供可验证证据，或明确说明没有足够证据 |
| CLE-R12 | Meta-Cognition 返回的 `policy_delta` 必须能被下一次 Intervention Planner 消费 |
| CLE-R13 | 如果某条元认知被本次回合使用，本次回合必须尝试评估它是否被支持或削弱 |
| CLE-R14 | AI 自我修正不能停留在文字总结，必须转化为下一次推理前的检查规则 |
| CLE-R15 | 本次回合如果证伪了旧干预，必须生成 `AiSelfOptimizationUpdate`，说明 AI 上一次判断错在哪里 |
| CLE-R16 | 下一次 Planner 必须消费 `AiSelfOptimizationUpdate.next_thinking_rule`，否则自我优化不算闭环 |

## 9.1 涌现效果的充分必要条件

Goal Mate 想要涌现出“用户只输入目标和完成情况，AI 持续推动结果落地”的效果，ControlLoopEpisode 必须满足以下必要条件。

| 必要条件 | 说明 | 归属 |
| --- | --- | --- |
| 回合身份 | 每次干预、反馈、诊断、学习必须能归入同一次回合 | ControlLoopEpisode |
| 统一入口 | Today、Agent、QQ、Scheduler 回复必须进入同一套反馈语义 | ControlLoopEpisode |
| 结构化观察 | 用户反馈必须转成 Checkin / Observation，而不是只留自然语言 | Checkin |
| 偏差诊断 | 非完成反馈必须判断方向、难度、提示、路径或信息不足 | Diagnosis |
| 状态转移 | 反馈必须尝试更新 DailyAction、Condition、KR、StagePlan | Goal Structure |
| 日志投影 | 日报、周报、月报只是投影，不能替代结构化状态 | Log Projection |
| 元认知交接 | 回合结束必须把证据交给 Meta-Cognition，或说明证据不足 | Meta-Cognition |
| 策略差量 | Meta-Cognition 必须返回 `policy_delta` 或明确无需更新 | Meta-Cognition |
| 下一次消费 | Intervention Planner / Agent Prompt 必须消费上一轮学习结果 | Intervention Planner / Agent |
| 反馈验证 | 下一次回合必须验证上一轮干预和元认知是否有效 | ControlLoopEpisode |
| 长期连续 | 回合必须跨天、跨周保存，不依赖一次对话上下文 | Memory / Logs / DB |
| 安全边界 | 控制对象是目标推进过程，不是用户人格或全部生活 | System Control Model |

这些条件是必要的：缺任何一个，系统都会退化成提醒器、打卡器、聊天机器人或日志工具。

充分组合是：

```text
统一回合
  + 结构化事实
  + 可证伪诊断
  + 真实状态更新
  + 日志投影
  + 元认知策略差量
  + 下一次真实消费
  + 后续反馈验证
  + 多轮长期连续运行
```

当这个组合连续运行时，才会出现：

```text
AI 不再只是记录你做没做，
而是能逐步学会你在哪些条件下会行动、
在哪些风险点会失控、
它自己上次哪里判断错了、
下一次应该怎样更低成本地推动你。
```

## 9.2 当前实现缺口必须被视为 P0

从需求角度看，以下缺口会直接阻断涌现效果：

| 缺口 | 为什么是 P0 |
| --- | --- |
| 没有实体化或服务化的 ControlLoopEpisode | 回合无法成为统一主线 |
| Today 和 Agent 反馈逻辑没有完全统一 | 相同反馈可能产生不同诊断 |
| `policy_delta` 还不是 Planner 的稳定输入 | 元认知无法稳定改变下一次干预 |
| 被使用的旧元认知没有稳定评估 | 系统不知道自己是否学对了 |
| 普通 Agent 对话没有稳定加载元认知 | 用户聊天时体感不到“越来越懂我” |
| Review 还没有明确压缩多个 Episode | 周期复盘容易变成泛泛总结 |

这些不是未来增强项，而是达成产品核心涌现效果所需的主链路能力。

## 10. 用户感知

用户不需要看到 ControlLoopEpisode 这个词。

用户应该感受到：

```text
我反馈了完成情况以后，系统真的理解发生了什么。
它不是只记录打卡，而是会调整明天怎么问我。
它不会重复无效提醒。
它会越来越知道我为什么卡住，以及下一步怎样更容易推进。
```

## 11. v0.1 实现边界

v0.1 可以先不新增完整 `ControlLoopEpisode` 数据表。

短期实现可以通过现有对象串联：

```text
SchedulerEvent.payload.intervention_decision
AgentMessage.structuredOutput
AgentToolAction.result
Checkin
Diagnosis
Review
MarkdownDocument.frontmatter
system/meta-cognition/*.md
```

但需求层必须明确：这些只是当前实现载体，不是业务语义本身。

后续如果继续增强，优先考虑把 `ControlLoopEpisode` 实体化，统一记录：

```text
source
trigger
intervention_decision_id / payload
feedback
checkin_id
diagnosis_id
state_transition
log_document_id
meta_cognition_update_id
next_policy_delta
status
```

## 12. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F12-1 | Scheduler 主动提醒用户 | 消息发送前 | 必须存在 InterventionDecision 或 fallback_reason |
| AC-F12-2 | 用户在 Today 提交没做 | 系统处理反馈 | 必须生成 Checkin，并进入 Diagnosis 或信息不足状态 |
| AC-F12-3 | 用户在 Agent 里说没做 | 系统识别为反馈 | 必须进入和 Today 相同的反馈处理语义 |
| AC-F12-4 | 用户反馈部分完成 | 系统更新状态 | 必须更新 DailyAction，并尝试推进 Condition / KR / StagePlan |
| AC-F12-5 | 自动写入日报 | 写入 Markdown | 必须包含事实、偏差判断、下一步调整；如有元认知，必须包含 System Reflection |
| AC-F12-6 | 产生元认知更新 | 下一次干预生成 | Intervention Planner 必须能读取该更新并改变干预策略 |
| AC-F12-7 | 周期复盘生成 | Review 执行 | 必须压缩多个回合的结果，而不是只写泛泛总结 |
| AC-F12-8 | 任一入口提交反馈 | Today / Agent / Channel | 不允许出现三套互相不一致的反馈解释逻辑 |
| AC-F12-9 | 某次回合使用了旧元认知 | 回合结束 | 必须记录旧元认知是否被本次反馈支持、削弱或无法判断 |
| AC-F12-10 | Meta-Cognition 产生 `policy_delta` | 下一次 Planner 运行 | Planner 必须把该策略变化作为输入，而不是只读取最近 Check-in |
| AC-F12-11 | 旧干预被本次反馈证伪 | 回合结束 | 必须记录 AI 自己上一轮推理失败点和下一次推理规则 |
| AC-F12-12 | 下一次 Planner 运行 | 存在活跃 AI 自我优化规则 | 必须让本次问题、风险判断或行动安排体现该规则 |
