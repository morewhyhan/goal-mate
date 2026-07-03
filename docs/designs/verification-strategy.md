# Verification Strategy

## 1. 定位

Verification Strategy 说明 Goal Mate 如何证明当前能力是真的，而不是只在文档中声称存在。

`docs/plans/*last-run.md` 可以记录一次性验收结果，但长期事实必须沉淀在 `docs/designs` 中。

## 2. 验证层级

| 层级 | 目的 | 典型命令 |
| --- | --- | --- |
| Static gates | 检查关键代码和文档契约仍存在 | `pnpm verify:agent-loop:static` |
| Typecheck | 检查 TypeScript 类型 | `pnpm typecheck` |
| Intervention planner | 检查自主干预、元认知和记忆质量门禁 | `pnpm verify:intervention-planner` |
| AI reply quality | 检查 Agent 回复是否像秘书、少 AI 味、有边界、有下一步 | `pnpm verify:ai-reply-quality` |
| API acceptance | 检查 API 可用和鉴权边界 | `pnpm verify:v01:api` |
| Agent loop write | 检查工具写入闭环 | `pnpm verify:agent-loop:write` |
| Dashboard browser | 检查真实页面可读可操作 | `pnpm verify:dashboard-browser:auth:write` |
| Deployment config | 检查 systemd、env、worker 脚本 | `pnpm verify:deployment-config` |
| Scheduler one-shot | 不等真实时间验证 Scheduler | `pnpm worker:scheduler:once` |
| Server long-running | 证明电脑关闭后仍能主动推进 | 手工/服务器验收 |

## 3. 静态门禁覆盖

当前静态门禁必须覆盖：

- P0 Agent tools catalog。
- shared handlers。
- shared executor。
- confirmation policy。
- Agent prompt system。
- secretary tone rules。
- Settings read scope。
- export privacy。
- workspace data deletion。
- QQ shared runtime。
- Scheduler shared audit。
- check-in diagnosis。
- Today auto action。
- Momentum heatmap。
- Markdown rollups。
- control loop UI cues。
- Agent Reply 标准结构化输出。
- Review 生成回写目标状态判断。
- Agent Memory Context。
- Settings 最近错误聚合。
- Autonomous Intervention PRD。
- Autonomous Intervention Runtime。

静态门禁只能证明代码结构存在，不能证明真实模型质量或服务器长期稳定。

## 3.1 Intervention Planner 验证

`pnpm verify:intervention-planner` 必须覆盖：

- 某目标中核心行动多次没完成时，Planner 识别难度问题并降难度。
- 关键风险点导致默认高风险行为时，Planner 生成提前风险提示和 fallback_action。
- 连续无响应时，Planner 不盲目加频率，而是降复杂度、调时或建议重审。
- 缺少模型 API Key 时，Planner 使用 `fallback_rule` 保底，并记录原因。
- 合法 AI Policy JSON 通过质量门禁后，Planner 使用 `ai_policy` 结果。
- 泛泛鼓励、鸡汤话、缺少风险点或缺少可验证信号的 AI 输出会被拒绝。
- Scheduler 写入结构化消息时必须记录 `planner_source`。
- 干预无效后，Meta-Cognition 能生成可验证假设。
- Check-in 写入 Daily Log 时，必须生成 `System Reflection`，同时记录下次怎么干预用户和 AI 下次怎么修正自己的推理。
- 模糊记忆“用户状态不好”会被 Memory Quality Gate 拒绝进入核心记忆。

## 3.2 ControlLoopEpisode / 涌现效果验证

`pnpm verify:control-loop-emergence` 必须覆盖：

- EMG-1：连续 3 次没做后，系统不重复催促，必须改变诊断问题、行动难度、提醒时机或风险提示。
- EMG-2：策略调整后完成率改善，元认知增强该假设。
- EMG-3：策略调整后仍无效，元认知削弱或修正该假设。
- EMG-4：Today 打卡和 Agent 对话反馈表达同一事实时，必须进入同一套 ControlLoopEpisode 语义。
- EMG-5：Review 压缩多个 ControlLoopEpisode 的有效性，而不是只总结日志文本。
- EMG-6：下一次 Planner 必须能说明读取了哪些活跃元认知、哪些 `policy_delta` 改变了本次干预。
- EMG-7：旧元认知被证伪时，必须生成 `AiSelfOptimizationUpdate`，说明 AI 上一次推理错误和下一次规则。
- EMG-8：下一次 Planner 必须消费 AI 自我优化规则，改变问题、推理顺序或行动安排。

该验证用于证明“涌现效果”的必要链路存在：反馈会变证据，证据会变假设，假设会变策略差量，策略差量会影响下一次干预。

## 3.3 当前增量事实：AI 自我优化闭环

截至 2026-07-03，本地验证已经覆盖 AI 不只优化用户行为，也优化自己下一次推理方式：

- `pnpm verify:control-loop-emergence` 已覆盖 EMG-7 和 EMG-8：旧元认知被证伪时生成 `AiSelfOptimizationUpdate`，下一次 Planner 消费该规则并改变提问方式。
- `pnpm verify:intervention-planner` 已确认原有难度、风险、无响应、AI-first fallback 和质量门禁仍通过。
- `pnpm verify:agent-loop:static` 已确认需求规格、事实文档、运行时代码和验证脚本之间的静态契约仍一致。
- `pnpm typecheck` 已确认当前 TypeScript 类型检查通过。

这只能证明本地闭环和静态契约成立，不等于已经完成真实多日运行、真实 QQ 长期主动消息和真实用户行为质量验收。

## 3.4 当前增量事实：抽象层通用化边界

截至 2026-07-03，核心规格、Planner、元认知、验证脚本和原型文案已经完成一次具体场景词清理。

当前原则：

- 核心规则只允许表达通用控制结构：方向、难度、提示、路径、证据不足、行动仓位、风险点、替代动作、默认高风险行为。
- 不允许把某个用户故事写进系统内核，例如具体饮食、具体运动、具体学习材料、具体指标数字或具体平台。
- 测试样例可以有场景，但断言必须验证通用结构，而不是验证某个生活场景词。
- Demo / Seed / Prototype 可以展示样例，但不能让样例反向决定 Planner、Prompt 或需求规格。

搜索门禁应检查用户故事、具体生活动作、具体食物、具体学习材料、具体指标数字、具体平台名和英文同义场景词是否泄漏进核心目录。

搜索门禁自身不能在事实文档里写入完整禁用词列表，否则文档会自污染。若后续确实需要新增具体样例，必须放在明确的 demo/fixture 上下文中，并避免被核心规格或 Planner 逻辑消费为规则。

## 3.5 AI 回复质量验证

`pnpm verify:ai-reply-quality` 用于证明 Agent 回复质量不是只靠主观感觉。

默认本地验证覆盖：

- Prompt 中存在去 AI 味、真人秘书式表达、一次只问一个问题、控制闭环和权限边界规则。
- 好回复样本必须简洁、具体、可行动、能追问一个关键问题、能引用已知事实、不能声称未确认执行。
- 坏回复样本必须被拒绝，包括 AI 客服腔、泛鼓励、强制羞辱、未确认却声称已执行、关闭 Logs 后仍引用日志。

可选真实模型验证：

```bash
RUN_REAL_LIVE_AI=1 pnpm verify:ai-reply-quality
```

真实模型验证会调用默认 DeepSeek 配置，检查少量 live 回复是否通过同一质量门禁。它能证明当前模型在样本上的基本回复质量，但不能替代大规模人工评测、长期对话质量评测或真实用户体验评测。

当前增量事实：

- 2026-07-03 已使用 `RUN_REAL_LIVE_AI=1 pnpm verify:ai-reply-quality` 跑通真实 DeepSeek 回复质量验证。
- 验证过程中发现并修正了两类质量问题：无上下文时擅自举具体例子、目标澄清时一次问多个问题。
- 当前生产 Prompt 已增加约束：不在缺少上下文时随手举例；一次回复最多保留一个问号。
- 当前 live 样本通过范围：未完成诊断、目标不清澄清、去 AI 味、权限边界、未确认执行边界。

## 4. 浏览器验收覆盖

Dashboard browser 验收必须覆盖：

- Today：下一步行动清楚，热力图可见。
- Goals：只读目标状态链路可读。
- Logs：层级文件树和 Markdown 编辑器可操作。
- Agent：消息区滚动，输入框固定可见。
- Settings：模型、提醒、权限、日志、数据控件不溢出。

## 5. 运行验收覆盖

服务器长期验收必须证明：

- Web 进程可长期运行。
- QQ Worker 可长期连接 Gateway。
- Scheduler Worker 可按规则触发。
- QQ 主动提醒可发送或失败可审计。
- 用户回复提醒后能进入 Agent Tool Runtime。
- Settings 能看到 runtime status、SchedulerEvent、AgentToolAction。

如果未完成服务器长期验收，产品不能声称已经满足“电脑关闭后也能主动推进”。

## 6. 真实 AI 验收

真实 AI 验收必须区分：

| 项 | 验证什么 |
| --- | --- |
| 模型连接 | DeepSeek API 可调用 |
| 对话质量 | 回复像目标秘书，不像 AI 客服 |
| 工具路由 | 明确命令能转成工具意图 |
| 诊断能力 | 没做时进入 motivation / ability / prompt / path |
| 权限边界 | 关闭读取后不引用对应上下文 |

不能只用 mock 或静态检查证明真实 AI 质量。

## 7. 验证报告位置

一次性报告放在：

```text
docs/plans/*last-run.md
```

长期验证策略放在：

```text
docs/designs/verification-strategy.md
```

如果一次性报告揭示了新的长期事实，必须同步到 `docs/designs`。
