# Pi Agent Harness 参考计划

## 1. 定位

本文只作为参考计划。

它不是当前必须执行的开发任务，也不是 v0.1 的验收范围。

Pi Agent Harness 的价值在于提供一种 Agent Runtime 设计思路：

- 常驻提示词尽量小。
- 固定上下文保持稳定，便于 prompt cache。
- 复杂能力按需加载。
- 长对话进行压缩。
- 会话状态可持久化。
- 工具调用和权限边界清晰。

这些思路值得后续参考，但当前不直接落地。

## 2. 当前决策

不引入 Pi。

不复制 Pi 代码。

不把 Goal Mate 改造成 coding agent。

不把 Pi 机制写入当前系统事实文档。

原因：

- Goal Mate 当前核心是目标推进闭环，不是通用 coding agent。
- 当前已有 Agent Runtime、Tools、Logs、Scheduler、QQ Bot。
- 过早引入新 harness 会增加复杂度。
- Pi 的核心启发可以先作为架构参考保留。

## 3. 可参考的机制

| 机制 | 对 Goal Mate 的参考价值 | 当前是否执行 |
| --- | --- | --- |
| minimal core prompt | 避免每次请求加载过长 system prompt | 否 |
| stable prompt prefix | 让模型供应商 prompt cache 更容易命中 | 否 |
| progressive disclosure | skill 只按需加载完整规则 | 否 |
| skills on demand | 目标澄清、诊断、复盘等能力可模块化 | 否 |
| context compaction | 长对话压缩成目标推进摘要 | 否 |
| session tree | 目标路径变更时保留版本和分支 | 否 |
| event stream | Web、QQ、Scheduler 共用 Agent 事件 | 否 |
| project trust | 用户日志和外部内容不能成为 system instruction | 否 |

## 4. 后续可能的使用方式

只有在以下情况出现时，才重新评估这份计划：

- Agent prompt 成本明显过高。
- 长对话上下文开始失控。
- 工具调用数量继续增加，当前 Runtime 难维护。
- Web、QQ、Scheduler 需要统一 Agent event stream。
- 需要更正式的 skill registry。
- 需要做跨会话 memory compaction。

## 5. 如果未来要执行，推荐顺序

1. 先做 stable prompt prefix。
2. 再做 skill registry。
3. 再做 context compaction。
4. 再做 prompt templates。
5. 最后做 event stream。

任何阶段都必须先证明它解决了真实问题，而不是因为框架看起来高级就引入。

## 6. 当前不纳入验收

以下内容不进入当前验收：

- Pi dependency。
- Pi SDK。
- coding agent tools。
- TUI。
- session tree。
- event stream。
- compaction。
- skill registry。

当前 Goal Mate 仍以现有需求规格、PRD、Agent Tools、Scheduler、Logs、QQ Bot 和 Prompt System 为准。
