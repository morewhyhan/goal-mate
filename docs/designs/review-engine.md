# Review Engine

## 1. 定位

Review Engine 负责周期性更新目标推进判断。

它不是打卡统计器，也不是简单生成周报。

复盘必须回答：

```text
目标是否更清楚了？
哪个条件被补齐了？
哪个 KR 有进展？
哪个行动无效？
下一周期最该推进什么？
这次干预策略是否有效？
需要更新什么用户模型或风险假设？
```

## 2. Review 类型

| 类型 | 用途 |
| --- | --- |
| daily | 当日执行反馈和明日调整 |
| weekly | 本周条件变化和下周重点 |
| monthly | 月度目标进展和路径调整 |
| quarterly | 季度层面的阶段判断 |
| yearly | 年度目标推进沉淀 |
| goal_cycle | 一个目标周期结束后的复盘 |

## 3. 触发入口

| 入口 | 行为 |
| --- | --- |
| Agent | 用户要求复盘 |
| Scheduler | 晚间或周末主动触发 |
| Logs | 用户在日志页查看或编辑 |
| Check-in | 完成或未完成反馈后形成复盘素材 |

## 4. 输出内容

Review 至少包含：

| 字段 | 说明 |
| --- | --- |
| `period` | 复盘周期 |
| `progress_summary` | 推进摘要 |
| `condition_changes` | 条件状态变化 |
| `blocker_summary` | 阻塞和偏差 |
| `next_focus` | 下一周期重点 |
| `intervention_effectiveness` | 本周期干预是否有效 |
| `meta_cognition_updates` | 需要沉淀或修正的元认知假设 |
| `verification_plan` | 下周期如何验证这些判断 |
| `markdown_content` | 写入 Logs 的 Markdown |

## 5. 写入规则

复盘默认写入 MarkdownDocument。

当前兼容层也可能同步写入 LogEntry。

写入必须遵守：

- 不覆盖用户手写区。
- 使用系统区块。
- 维护年、季、月、周、日 rollup。
- 自动写入受 Settings 控制。

## 6. 和目标状态的关系

Review 不是只保存文本。

它应该为这些判断提供证据：

- KR progress 是否变化。
- GoalCondition 是否从 missing 到 partial 或 satisfied。
- 当前阶段是否需要调整。
- 今日行动是否继续有效。
- 是否需要换路径或暂停目标。
- Intervention Planner 下一次应该怎么问、怎么提示风险点。
- Meta-Cognition 是否需要更新用户动机、能力、风险点、提示时机或表达偏好判断。

## 6.1 Review 质量标准

Review 不能写成泛泛总结。重要判断必须满足：

```text
充分、必要、因果明确、语言清晰、可验证或可证伪。
```

Review 中的长期判断必须说明：

| 字段 | 说明 |
| --- | --- |
| evidence | 来自哪些 Check-in、Logs、KR 或条件变化 |
| causal_explanation | 为什么这个因素影响目标推进 |
| decision_impact | 它会改变下一周期什么行动或提醒 |
| verification_signal | 下周期用什么反馈验证 |

详细标准见 `docs/features/goal-mate-v0.1/12-memory-quality.md`。

## 7. 当前边界

已具备：

- `review.generate` 工具。
- Review 数据模型。
- Review Markdown 生成。
- 自动写入 MarkdownDocument。
- 日/周/月/季/年 rollup 辅助逻辑。
- Review 生成时会回写目标状态判断，包括 KR progress、当前推理卡 recommendedFocus、currentGapConditionId 和阶段状态。
- Review 生成时会评估最近一次干预效果，并尝试生成 Meta-Cognition 假设。
- Review 写入的 Markdown frontmatter 会包含 `interventionEffectiveness` 和 `metaCognitionHypothesis`。

仍需补强：

- Review 质量样本评测。
- Meta-Cognition 假设冲突合并、过期重审和可视化。
- Intervention Planner 决策效果评估。
- 周期结束时的自动触发稳定性验证。

## 8. 相关文档

- `docs/features/goal-mate-v0.1/02-core-goal-loop.md`
- `docs/designs/markdown-document-store.md`
- `docs/designs/scheduler-worker.md`
- `docs/designs/agent-tool-runtime.md`

## 9. 当前增量事实：Review 压缩控制回合

Review 当前不应只总结 Markdown 文本。

当前实现要求 Review 在生成时同时压缩控制回合有效性：

- 读取最近 Checkin / Diagnosis / Scheduler intervention decision。
- 读取活跃 Meta-Cognition hypotheses。
- 调用 `evaluateMetaCognitionHypotheses()` 判断旧假设是否被 supported、contradicted 或 inconclusive。
- 将 `metaCognitionEvaluations` 写入 Review Markdown frontmatter。
- 如果旧假设被证伪，评估结果必须包含 `ai_self_optimization`，说明 AI 上一次推理错误和下一次推理规则。
- Review Markdown 增加 `控制回合有效性` 区块，展示最近干预效果和元认知评估统计。

这让 Review 成为多个 ControlLoopEpisode 的周期性压缩，而不是孤立总结。
