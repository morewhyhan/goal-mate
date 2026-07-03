# F10 Meta-Cognition Layer 规格

## 1. 模块定位

Meta-Cognition Layer 是 Goal Mate 的元认知层。

它不是普通记忆，也不是保存更多用户资料。它负责让 AI 持续反思和更新：

```text
我是否真正理解了这个用户
我上一次干预为什么有效或无效
我是否误判了用户的方向、难度、提示或路径问题
这个用户更容易被什么方式推动
什么表达、时间、难度和风险提示更有效
```

最终目标是：

```text
更了解用户
控制更精准
辅助用户完成目标效率更高
```

Meta-Cognition Layer 必须同时干预两个对象：

| 对象 | 解决什么 | 输出到哪里 |
| --- | --- | --- |
| 用户 | 下一次怎么问、怎么提示、怎么降难度、怎么控风险 | Intervention Planner、Scheduler 主动消息 |
| AI 自己 | 下一次 AI 应该先检查什么证据、避免什么误判、调整什么策略权重 | Meta-Cognition Memory、Daily Log、下一次 Policy Prompt |

因此，元认知不是“用户为什么没做”这一件事。它必须同时回答：

```text
用户行动系统哪里失控了
下一次怎么干预用户
AI 这次判断哪里可能错了
下一次 AI 自己应该怎么改变推理顺序
```

## 2. 元认知对象

| 模型 | 含义 | 示例 |
| --- | --- | --- |
| 用户动机模型 | 用户真正想要什么，什么目标只是外部期待 | 用户持续反馈减重结果，但长期回避某个项目目标 |
| 能力模型 | 用户当前能承受多大行动难度 | 用户能完成 15 分钟默写，但抗拒 2 小时整块学习 |
| 风险模型 | 用户在哪些时刻最容易失控 | 某个高风险时段导致默认高风险行为上升 |
| 提示模型 | 哪些时间、渠道、话术更容易触发行动 | 风险点前提醒准备替代动作，比事后复盘更有效 |
| 表达模型 | 用户接受什么语气，反感什么表达 | 用户反感空泛鼓励，接受直接但温和的判断 |
| 路径模型 | 哪些行动真的补齐关键条件 | 某个复合行动同时补齐两个条件，但过长会降低启动率 |

## 3. 运行机制

Meta-Cognition Layer 基于反馈循环更新自身判断：

```text
干预决策
  -> 用户行动或无行动
  -> Check-in / Logs / Review
  -> 判断这次干预是否有效
  -> 生成元认知假设
  -> 更新下一次用户干预策略
  -> 更新下一次 AI 自我推理规则
  -> 影响下一次 Intervention Planner / Policy Prompt
```

它沉淀的不是事实流水账，而是可验证假设。

## 3.1 元认知闭环主流程

元认知闭环不是“写一条总结”，而是一个持续迭代机制：

```text
ControlLoopEpisode 结束
  -> 收集本回合证据
  -> 判断上一次干预是否有效
  -> 生成或更新 MetaCognitionHypothesis
  -> 形成 UserInterventionDelta
  -> 形成 AiSelfReflection
  -> 形成 PolicyDelta
  -> 写入 Meta-Cognition Memory 和 Daily Log System Reflection
  -> 下一次 Intervention Planner / Agent Prompt 读取
  -> 改变下一次提问、提醒、拆小、风险提示和推理顺序
  -> 下一次 Check-in / Review 验证或证伪
```

这个流程必须形成闭环，不能停在“生成假设”。

## 3.2 AI 如何优化对用户的控制

AI 对用户的控制优化不是提高压迫感，也不是简单增加提醒频率。

它优化的是：

```text
更准确地识别当前偏差
更早地发现风险点
更小地设计下一步行动
更合适地选择提醒时机
更自然地选择表达方式
更少地重复无效策略
```

用户控制优化必须落成可执行的 `UserInterventionDelta`：

| 维度 | 可调整内容 | 例子 |
| --- | --- | --- |
| 问题 | 下一次问什么 | 从“今天完成了吗”改成“现在是动作太大，还是时间不对？” |
| 时机 | 什么时候问 | 从事后复盘改成风险点前提示 |
| 难度 | 行动拆多小 | 从完整动作改成当下可承受的最小版本 |
| 风险 | 提前控制哪个点 | 风险点出现前先准备替代动作 |
| 路径 | 是否替换行动 | 如果行动不补齐条件，换成更直接的动作 |
| 语气 | 怎么表达 | 从催促改成直接、温和、具体的判断 |

任何 `UserInterventionDelta` 都必须说明：

```text
为什么这样改
它基于哪些证据
下次用什么信号验证
```

## 3.3 AI 如何优化自己的思考

AI 自我优化不是让模型“变聪明”的抽象说法，而是让下一次推理顺序发生变化。

它必须落成 `AiSelfReflection`：

| 维度 | 含义 |
| --- | --- |
| `reasoning_adjustment` | 这次之后要避免什么误判 |
| `next_thinking_rule` | 下次生成干预前先检查什么 |
| `intervention_policy_delta` | 哪类策略升权、哪类策略降权 |
| `verification_signal` | 如何验证这次自我修正是否有效 |

示例：

```text
reasoning_adjustment:
不要先把没做归因为动机不足；先检查行动仓位和启动成本。

next_thinking_rule:
下次先问“这一步能不能缩到用户当下可承受的最小版本”，再判断方向问题。

intervention_policy_delta:
提高降低难度和最小启动动作的优先级，降低空泛催办的优先级。

verification_signal:
如果缩小动作后完成率上升，说明该推理修正有效；否则改查提示或方向。
```

## 3.3.1 AiSelfOptimizationUpdate

`AiSelfReflection` 是本回合产生的自我修正建议。

`AiSelfOptimizationUpdate` 是后续反馈对这条自我修正的评估结果。

二者区别：

| 对象 | 回答什么问题 | 什么时候产生 |
| --- | --- | --- |
| `AiSelfReflection` | AI 下一次应该怎么想 | 产生新元认知假设时 |
| `AiSelfOptimizationUpdate` | AI 上一次这样想对不对，下一次要不要改 | 后续 ControlLoopEpisode 验证旧假设时 |

`AiSelfOptimizationUpdate` 必须包含：

| 字段 | 说明 |
| --- | --- |
| `self_evaluation_result` | supported / contradicted / inconclusive |
| `previous_thinking_rule` | 上一次 AI 用的推理规则 |
| `reasoning_error` | AI 这次具体错在哪里，或为什么暂不能判断 |
| `next_thinking_rule` | 下一次生成干预前必须先执行什么检查 |
| `avoid_next_time` | 下一次不能重复什么无效策略 |
| `policy_delta` | 哪类策略升权或降权 |
| `verification_signal` | 下次如何证明这个自我修正有效 |

可证伪标准：

```text
如果 AI 上一次干预失败后，系统只记录“用户没做”，但没有记录“AI 上一次哪里判断错、下一次怎么改推理顺序”，则 AI 自我优化闭环不存在。
```

## 3.4 Hypothesis -> Evaluation -> PolicyDelta 生命周期

每条元认知假设必须经历生命周期，而不是永久有效。

```text
created
  -> active
  -> used_by_planner
  -> evaluated
  -> strengthened / weakened / revised / expired
```

| 状态 | 含义 |
| --- | --- |
| `created` | 新假设刚生成，证据有限 |
| `active` | 可被下一次 Planner 使用 |
| `used_by_planner` | 已影响某次干预 |
| `evaluated` | 已根据后续反馈评估 |
| `strengthened` | 后续证据支持，应提高权重 |
| `weakened` | 后续证据不支持，应降低权重 |
| `revised` | 假设方向部分错误，需要改写 |
| `expired` | 场景已变化，不应继续使用 |

一次评估必须输出：

| 输出 | 说明 |
| --- | --- |
| `evaluation_result` | supported / contradicted / inconclusive |
| `evidence_used` | 哪些 Check-in、Review、Log 或对话支持这个判断 |
| `policy_delta` | 下一次策略如何变化 |
| `confidence_delta` | 置信度上升、下降或保持 |
| `recheck_rule` | 何时重新检查 |

## 3.5 下一次 Planner 如何消费元认知

Intervention Planner 不能只读取目标和最近反馈，还必须读取活跃元认知。

消费顺序为：

```text
当前目标状态
  -> 最近 ControlLoopEpisode 反馈
  -> 活跃 MetaCognitionHypothesis
  -> 上一次 PolicyDelta
  -> AiSelfReflection.next_thinking_rule
  -> 生成新的 InterventionDecision
```

Planner 使用元认知时必须做到：

| 要求 | 含义 |
| --- | --- |
| 显式引用 | 能说明用了哪条元认知判断 |
| 不盲信 | 低置信度假设只能作为当前判断，不能当成事实 |
| 可验证 | 本次干预仍必须生成新的 `verification_signal` |
| 可回写 | 本次干预结果会反过来评估旧假设 |

如果元认知之间冲突，优先级为：

```text
最新强证据 > 多次重复证据 > 用户明确表达 > 低置信度推测
```

## 3.6 元认知涌现的充分必要条件

元认知领域要产生“AI 越来越懂用户、越来越会推动用户”的效果，不能只依赖更多记忆或更长 Prompt。

它必须满足以下必要条件：

| 必要条件 | 含义 | 缺失后的结果 |
| --- | --- | --- |
| 可归因证据 | 每条判断必须能追溯到具体 Episode、Check-in、Review、Log 或对话 | AI 会凭感觉总结，形成伪学习 |
| 可证伪假设 | 每条元认知必须能被后续反馈支持或推翻 | 判断会永久有效，系统越来越固执 |
| 因果解释 | 必须说明为什么这个因素影响行动发生 | 只能看到相关性，不能指导干预 |
| 决策影响 | 必须说明下一次具体改变什么 | 元认知会变成日志摘要 |
| 策略差量 | 必须形成 `policy_delta`，说明哪类策略升权或降权 | 下一次 Planner 无法消费 |
| AI 自我修正 | 必须形成 `ai_self_reflection.next_thinking_rule` | AI 只分析用户，不优化自己的推理 |
| 后续评估 | 被使用过的元认知必须在后续回合中被评估 | 无法知道这次学习是否有效 |
| 过期和修正 | 假设必须能 weakened、revised、expired | 旧判断会污染新决策 |
| 边界约束 | 高风险判断必须谨慎，不能把推测当事实 | AI 会过度控制、误伤用户 |

充分组合不是“拥有这些字段”，而是这些字段连续运转：

```text
证据足够清楚
  -> 形成可证伪假设
  -> 产生 policy_delta
  -> Planner 真实消费
  -> 下一次回合验证
  -> 假设被增强、削弱、修正或过期
  -> 新策略继续进入下一次干预
```

只有这条链连续运行多次，才会出现涌现效果。

不能被当作充分条件的东西：

| 误区 | 为什么不充分 |
| --- | --- |
| 保存更多聊天记录 | 聊天记录不等于可决策判断 |
| 写更长日报 | 日报如果不改变下一次策略，只是流水账 |
| 更复杂的 OKR 展示 | 用户看懂结构不等于系统会学习 |
| 更频繁提醒 | 频率增加不等于控制更精准，可能造成打扰 |
| 更强模型 | 没有证据链和反馈评估，强模型也会胡乱解释 |

## 4. 假设格式

每条重要元认知假设必须包含：

| 字段 | 说明 |
| --- | --- |
| `hypothesis` | 当前判断是什么 |
| `scope` | 适用于哪个用户、目标、条件或场景 |
| `evidence` | 支撑判断的事实来源 |
| `causal_explanation` | 为什么这个因素会影响行动 |
| `decision_impact` | 它会改变下一次什么决策 |
| `verification_signal` | 后续用什么反馈验证或证伪 |
| `confidence` | 当前置信度 |
| `expires_or_recheck_at` | 何时需要重新检查 |
| `ai_self_reflection` | AI 对自己推理方式的修正 |
| `policy_delta` | 下一次干预策略权重如何变化 |
| `lifecycle_status` | 当前假设处于 created / active / used_by_planner / evaluated 等状态 |

`ai_self_reflection` 至少包含：

| 字段 | 说明 |
| --- | --- |
| `reasoning_adjustment` | AI 这次之后要避免什么误判 |
| `next_thinking_rule` | AI 下一次生成干预前要先检查什么 |
| `intervention_policy_delta` | 哪类策略应升权或降权 |
| `verification_signal` | 如何验证这次自我修正是否有效 |

## 4.1 Daily Log 反馈区块

每次 Check-in 自动写入日报时，如果产生元认知，日报必须追加一个轻量的 `System Reflection` 区块。

这个区块不是给用户增加管理负担，而是让日志成为 AI 迭代自己的证据链：

```md
### System Reflection

- 对用户的判断：当前假设是什么
- 下次怎么干预用户：下一次提醒或提问要怎么变
- AI 下次怎么思考：下一次推理前要先检查什么
- AI 策略权重：哪类策略升权或降权
- 下次验证信号：用什么反馈证明这次判断对不对
```

这一区块必须满足：

| 要求 | 含义 |
| --- | --- |
| 充分 | 能解释为什么下一次要这样干预 |
| 必要 | 不写和行动推进无关的用户画像 |
| 因果 | 说明反馈如何导致策略变化 |
| 可验证 | 下一次 Check-in 或 Review 能支持或证伪 |
| 可回灌 | 下一次 Planner 能读取并改变干预策略 |

## 5. 更新边界

AI 可以自动更新低风险元认知：

| 可自动更新 | 说明 |
| --- | --- |
| 用户偏好短消息 | 影响表达长度 |
| 某时间段响应率更高 | 影响提醒时机 |
| 某行动过大 | 影响下一次拆小 |
| 某风险点反复出现 | 影响提前提示 |

高风险元认知必须等待用户确认或通过多次证据支撑：

| 需谨慎处理 | 原因 |
| --- | --- |
| 目标不是真想要 | 会影响是否暂停目标 |
| 用户缺乏动机 | 容易误伤用户，需要证据 |
| 目标路径整体错误 | 会改变阶段和条件 |
| 提高干预频率 | 可能造成打扰 |

## 6. 与普通 Memory 的区别

| 普通记忆 | 元认知 |
| --- | --- |
| 用户说了什么 | 这说明用户行动系统有什么模式 |
| 用户喜欢什么 | 这个偏好如何影响下一步干预 |
| 用户做没做 | 为什么做或没做，下一次怎么验证 |
| 保存信息 | 更新判断模型 |

## 7. UI 边界

普通用户界面不展示“元认知”术语。

用户应该感受到：

```text
它越来越懂我。
它问的问题越来越准。
它不会重复无效提醒。
它会根据我的反馈调整下一步。
```

## 8. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F10-1 | 某类干预多次无效 | Review 或 Agent 总结 | 必须形成可验证的策略调整假设 |
| AC-F10-2 | 用户对某语气或提醒方式反感 | 后续干预生成 | 系统必须改变表达或频率，而不是继续原样提醒 |
| AC-F10-3 | 用户完成率因降难度提升 | Meta-Cognition 更新 | 系统应记录“该用户适合小切片启动”的假设及证据 |
| AC-F10-4 | AI 判断目标可能不真 | Agent 输出 | 必须标记为当前假设，等待用户确认或后续证据 |
| AC-F10-5 | 元认知进入 Memory | 后续 Planner 使用 | 必须能说明它影响了哪个干预决策 |
| AC-F10-6 | Check-in 生成元认知 | 自动写入 Daily Log | 必须同时写入“下次怎么干预用户”和“AI 下次怎么思考” |
| AC-F10-7 | 下一次 Planner 读取元认知 | 生成主动干预 | 必须把 `ai_self_reflection.next_thinking_rule` 纳入 Policy Prompt 上下文 |
| AC-F10-8 | 某条元认知被下一次干预使用 | 后续 Check-in 发生 | 必须评估该假设是 supported、contradicted 还是 inconclusive |
| AC-F10-9 | 某策略连续无效 | Meta-Cognition 更新 | 必须降低该策略权重或生成新的替代推理规则 |
| AC-F10-10 | 多条元认知冲突 | Planner 生成干预 | 必须优先采用最新强证据或多次重复证据，而不是盲信旧假设 |
| AC-F10-11 | 旧元认知被后续反馈证伪 | Meta-Cognition 评估 | 必须生成 `AiSelfOptimizationUpdate`，说明 AI 上一次推理错在哪里 |
| AC-F10-12 | `AiSelfOptimizationUpdate` 存在 | 下一次 Planner 生成干预 | 必须先消费 `next_thinking_rule`，让下一次提问或计划发生变化 |
