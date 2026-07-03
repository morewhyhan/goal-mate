# Agent Memory

## 1. 定位

Agent Memory 是 Goal Mate 让 Agent 长期理解用户的记忆层。

当前不要把它理解成单独的“知识库”。它由多种持久化数据共同组成：

- Agent 对话历史。
- Markdown 日志。
- Review。
- 当前目标状态。
- 设置和偏好。

更准确地说，Goal Mate 的 Memory 不是保存更多信息，而是维护会影响后续干预的可验证判断。它必须服务于 Intervention Planner 和 Meta-Cognition Layer。

当前实现：

- `src/lib/memory-quality-gate.mjs` 提供核心记忆质量检查。
- `src/lib/meta-cognition-layer.mjs` 提供元认知假设生成、质量检查和保存。
- 第一版元认知不新增数据库表，使用 `MarkdownDocument(type=SYSTEM, path=system/meta-cognition/<goalId>.md)` 保存结构化假设。
- `checkin.submit` 和 `review.generate` 会生成或更新元认知假设。
- 旧元认知被后续反馈证伪时，会生成 `ai_self_optimization`，记录 AI 上一次推理错在哪里以及下一次推理规则。

## 2. 当前记忆来源

| 来源 | 数据模型 | 作用 |
| --- | --- | --- |
| Conversation History | `AgentThread`、`AgentMessage` | 保持同一对话连续性 |
| Markdown Logs | `MarkdownDocument` | 保存年/季/月/周/日推进记录 |
| Goal State | `Goal`、`KeyResult`、`GoalCondition`、`StagePlan`、`DailyAction` | 保存目标系统当前状态 |
| Check-in Evidence | `Checkin`、`Diagnosis` | 保存执行反馈和偏差原因 |
| Review | `Review` | 保存周期性判断 |
| Settings | `UserSetting` | 保存读取权限、提醒和偏好 |

## 3. 对话历史

AgentThread 和 AgentMessage 用于同一个聊天线程内的连续性。

它适合记住：

- 最近用户问了什么。
- Agent 刚刚建议了什么。
- 是否有待确认工具动作。
- 用户对本次建议的反馈。

它不适合作为长期目标事实的唯一来源。

## 4. Markdown 记忆

MarkdownDocument 是长期推进记忆的主要形态。

它适合保存：

- 日报。
- 周报。
- 月报。
- 年报。
- 目标文档。
- 用户手写记录。
- Agent 自动写入的系统区块。

Agent 读取 Markdown 必须受 `can_read_logs` 控制。

## 5. Review 记忆

Review 是压缩后的周期判断。

它比普通日志更适合作为长期摘要，因为它保留：

- 哪个条件变了。
- 哪个路径无效。
- 下周期重点是什么。
- 哪些反馈需要继续观察。

## 6. 当前实现边界

已具备：

- AgentThread / AgentMessage。
- MarkdownDocument / MarkdownDocumentLink。
- Checkin / Diagnosis。
- Review。
- Agent 读取最近或相关 Markdown 文档。
- Settings 控制是否读取 Goals、Logs、History。
- Agent Prompt 会注入基础 Memory Context：最近复盘、最近诊断和已加载对话数量。

尚未独立实现：

- `MemoryItem` 长期记忆表。
- 自动 compaction。
- 向量检索。
- 用户偏好抽取。
- 记忆冲突解决。
- 元认知冲突合并和过期重审。

## 6.1 Memory 质量标准

长期记忆、Review 摘要和元认知假设必须满足：

```text
充分、必要、因果明确、语言清晰、可验证或可证伪。
```

不允许沉淀：

- 空泛鼓励。
- 无依据人格判断。
- 不能影响后续决策的信息。
- 无法证伪的解释。
- 与目标推进无关的知识收藏。

核心记忆应尽量具备：

| 字段 | 说明 |
| --- | --- |
| claim | 清晰判断 |
| evidence | 事实依据 |
| causal_explanation | 因果解释 |
| decision_impact | 会影响哪个后续决策 |
| verification_signal | 后续如何验证或证伪 |

详细规格见 `docs/features/goal-mate-v0.1/12-memory-quality.md`。

## 6.2 与 Meta-Cognition 的关系

普通 Memory 记录可用事实；Meta-Cognition 记录 AI 对自己干预是否有效的判断。

示例：

```text
事实：用户连续三天没有完成核心行动。
元认知：当前假设不是目标不重要，而是行动启动成本高且风险点前缺少预案；下一次应提前提示最低成本版本或替代动作。
```

Meta-Cognition 的详细规格见 `docs/features/goal-mate-v0.1/11-meta-cognition.md`。

## 7. 删除边界

用户清除 Agent memory 后：

- AgentThread 和 AgentMessage 应删除。
- Agent 后续不得引用已删除对话。
- AgentToolAction 可作为审计保留。
- Markdown 日志是否删除取决于 workspace data 删除，而不是 memory 删除。

## 8. 后续方向

后续如果要强化长期记忆，应优先做：

1. Memory 质量门禁。
2. 元认知假设沉淀。
3. 会话摘要。
4. Review 摘要。
5. 用户偏好。
6. 失败模式。
7. 检索排序。

不要先做泛知识库。Goal Mate 的记忆服务于行动推进，不服务于知识收藏。

## 9. 当前增量事实：ControlLoopEpisode 与元认知生命周期

当前实现已把反馈学习收敛到 `src/lib/control-loop-episode.mjs`：

- Today 页面打卡和 Agent `checkin.submit` 都调用 `submitControlLoopFeedback()`。
- 该服务统一生成 Checkin、Diagnosis、GoalStateTransition、LogProjection、Meta-Cognition Update。
- Meta-Cognition 不再只是生成新假设，也会通过 `evaluateMetaCognitionHypotheses()` 评估旧假设。
- 旧假设会进入 `supported / contradicted / inconclusive` 评估，并更新 `lifecycle_status`、`confidence` 和 `policy_delta`。
- 评估同时会写入 `ai_self_optimization`：包括 `self_evaluation_result`、`reasoning_error`、`next_thinking_rule` 和 `avoid_next_time`。
- Agent 普通对话 prompt 已注入 `META_COGNITION_CONTEXT`，让普通聊天也能读取活跃元认知。

当前仍未实体化独立 `MetaCognitionHypothesis` 数据表，v0.1 继续使用 `MarkdownDocument(type=SYSTEM, path=system/meta-cognition/<goalId>.md)` 的 frontmatter 保存结构化假设和评估历史。
