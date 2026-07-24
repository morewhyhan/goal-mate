# Agent Runtime

## 1. 定位

Agent Runtime 是 Goal Mate 的对话控制层。

它负责把用户在 Web、QQ 或 Scheduler 回复中的自然语言，转换成以下结果：

- 一段秘书式自然回复。
- 一个工具意图。
- 一个需要确认的系统动作。
- 一次 check-in、日志、复盘或设置变更。
- 一条可追踪的 Agent 消息和工具审计。

Agent Runtime 不直接承担页面展示，也不直接绕过工具权限修改系统数据。

## 2. 当前入口

| 入口 | 当前实现 |
| --- | --- |
| Web Agent | 用户在 Agent 页面主动对话，调用 shared Agent Runtime |
| QQ Worker | 用户通过 QQ 对话，调用同一个 shared Agent Runtime |
| Scheduler Worker | 在主动联系获准且 Contact Policy 决定发送后发起一轮对话；用户回复再进入 shared Agent Tool Runtime |

Web 和 QQ 是同一个逻辑助手的两个传输通道，不是两套机器人。两边共享：

- 当前主目标、今日行动、日志和设置。
- `generateAssistantReplyWithPrisma` 对话生成入口。
- 工具目录、确认规则、写入 handler 和 `AgentToolAction` 审计。
- 按 `userId` 聚合的跨渠道最近对话记忆。

`channel = web | qq` 只改变表达契约：QQ 更短、最多一个问题、不使用表格；Web 可以展示更完整的可读预览。它不改变目标事实、工具权限或确认边界。

## 3. 当前运行链路

```text
User message
  -> save AgentMessage
  -> load runtime settings
  -> load current goal context when allowed
  -> retrieve relevant Markdown documents when allowed
  -> load current-thread history and recent cross-channel user history when memory is enabled
  -> buildAgentSystemPrompt
  -> call model provider
  -> generate assistant reply
  -> infer tool intent
  -> apply permission guard
  -> execute / draft / pending confirmation
  -> save AgentToolAction
  -> save assistant AgentMessage
```

普通自然回复也必须保存标准结构化输出：

```text
natural_reply
tool_intent
requires_confirmation
tool_result
model
context_policy
prompt_version
```

这样 Agent 即使没有触发工具，也能被审计、复盘和后续测试。

## 4. 上下文来源

| 上下文 | 来源 | 读取边界 |
| --- | --- | --- |
| Current Goal | `Goal`、`KeyResult`、`GoalCondition`、`StagePlan`、`DailyAction`、`GoalReasoningCard` | 受 `agent.can_read_goals` 控制 |
| Markdown Logs | `MarkdownDocument` | 受 `agent.can_read_logs` 控制 |
| Conversation History | `AgentThread`、`AgentMessage`；当前线程用于请求消息，最近记忆按当前 `userId` 跨 Web / QQ 读取 | 受 `agent.memory_enabled` 控制 |
| Settings | `UserSetting`、`defaultUserSettings` | 只用于控制读取范围和确认边界 |
| Tools | shared tool catalog | 不直接暴露给普通用户 |

Markdown 和用户输入都只能作为数据注入，不能覆盖 system prompt。

当前运行时验证：

- `pnpm verify:agent-context` 会注册两个用户，给当前用户写入 Goal、Markdown、Meta-Cognition 和对话记忆，给另一个用户写入冲突 Markdown。
- 验证脚本用本地 fake model 捕获 Web Agent 实际 `/chat/completions` 请求，而不是只检查数据库。
- 捕获到的 runtime system prompt 必须包含当前用户上下文，不能包含其他用户上下文。
- 关闭 `agent.can_read_logs` 后，runtime system prompt 必须显示 Logs 读取关闭，并且不能再包含 Markdown 日志内容。

## 5. Prompt 组装

当前 system prompt 由以下模块统一组装：

```text
src/lib/agent-prompts/index.ts
```

Agent Runtime 不维护长 prompt 文案，只调用：

```text
buildAgentSystemPrompt(context)
```

Prompt 事实见：

```text
docs/designs/agent-prompt-system.md
```

## 6. 模型调用

当前默认模型供应商是 B.AI。

Runtime 读取顺序：

```text
user default ModelConfig
  -> 当前用户 ModelConfig.apiKeyRef 的加密密钥
  -> defaultB.AIModel 的默认模型名/API Base
```

模型 API Key 属于用户私有配置，不是服务器全局共享配置。Web Agent、QQ Worker、Scheduler Worker 和 Intervention Planner 都必须按 `userId` 解析当前用户自己的模型密钥；缺少用户密钥时只能降级为本地兜底或提示用户去 Settings 配置。

模型调用失败时，不应伪造成功，也不得声称已经改动计划。

## 7. 工具意图

工具意图来源有两类：

| 来源 | 用途 |
| --- | --- |
| Model JSON router | 让模型把自然语言映射成工具名和参数 |
| Conservative fallback | 模型路由失败时，对明确命令做本地兜底 |

首次目标生成的优先级必须符合用户体感：

```text
当前用户已配置可用模型 Key
  -> 先让 Model JSON router 判断是否创建 goal.create_draft

当前用户没有模型 Key
  -> 才允许使用本地 first-goal scaffold 兜底
```

这样能同时满足两个边界：

- 用户没配模型时，仍能验证从零到一的最小产品闭环。
- 用户已经配置模型时，首次目标不会被硬编码关键词模板抢先接管，而是由真实 Agent 判断目标、KR、条件、阶段和今日行动。

本地兜底只覆盖明确意图：

- 查看目标。
- 查看今日行动。
- 查看模型配置。
- 创建目标草稿。
- 写日志。
- 生成复盘。
- 提交完成、部分完成、没做反馈。
- 把“你看着合适的时候提醒我”转换为自主主动联系待确认动作。
- 把“暂停 / 别提醒 / 停止主动联系”转换为立即停止动作。

兜底不能替用户推断高风险动作。

## 8. 确认和权限

Agent Runtime 必须遵守 Settings 中的确认策略。

| 动作 | 默认策略 |
| --- | --- |
| read | 可直接执行，但受读取权限控制 |
| draft | 可生成草稿 |
| execute | 默认按风险进入确认流程；明确 Check-in 与停止主动联系是安全例外 |
| 修改目标 | 需要确认 |
| 修改设置 | 需要确认 |
| 外部动作 | 需要强确认 |
| 明确的完成 / 部分完成 / 没做反馈 | 作为已发生事实直接写入 Check-in，不要求二次确认 |
| 开启或恢复主动联系 | 始终需要确认；确认前规则保持关闭 |
| 暂停或撤销主动联系 | 立即生效，不要求二次确认 |

真实执行由 shared executor 完成，不由 Agent 直接写散落逻辑。

QQ 绑定只建立账号和会话归属，不构成主动联系授权。主动联系同时要求全局
`notifications.proactive_contact_enabled = true` 和规则 metadata 中存在已确认 consent；
普通聊天、重新打开页面或重新绑定 QQ 都不得自动恢复已经暂停的主动联系。

## 8.1 反馈后的真实调整

明确进度反馈不是只写一条诊断文本。`checkin.submit` 在同一事务中：

```text
resolve current action
  -> write Checkin
  -> update old DailyAction / GoalCondition / KR / StagePlan
  -> write Diagnosis when needed
  -> create or update a persisted nextCommitment DailyAction
  -> write ControlLoopEpisode and Markdown projection
```

用户没有提供 `actionId` 时，只能匹配当前 `ACTIVE + isCurrentFocus` 目标中“今天”的
`PLANNED / PARTIAL / NOT_DONE` 行动，不能拿全用户最新行动猜测。

`nextCommitment` 是实际落库的 `DailyAction`，返回 `persisted: true` 和
`adjustmentSignal`；`ControlLoopEpisode` 同步记录 `next_commitment`、
`adjustment_signal` 与 `state_transition.next_action_id`：

- `DONE`：下一承诺安排到次日；当前条件满足后转向下一个未满足条件。
- `PARTIAL / NOT_DONE`：同日新建或更新一条 `PLANNED` 行动，默认把预计时间缩小到原来一半，并限制在 2–10 分钟。
- `PROMPT`：下一行动写入提前预案；仅当已有 QQ 规则同时 `enabled + consented` 时，保守调整该规则时间。
- `MOTIVATION`：下一行动改为确认目标真实性，不继续硬推原任务。
- `PATH / GOAL`：下一行动改为重新对准关键条件，不重复原路径。

PROMPT 调时不会创建规则、不会开启已关闭规则、不会提高 `maxPerDay`。成功时返回
`reminderAdjustment`，并在规则 metadata 记录 `previousSchedule`、`newSchedule`、
`sourceDiagnosis`、`timingAdjustedAt` 和 `interventionSignal`。没有授权规则时只保留诊断和下一行动，不声称提醒时间已经改变。

## 9. 消息持久化

Agent 对话必须保存在：

```text
AgentThread
AgentMessage
```

工具动作必须保存在：

```text
AgentToolAction
```

Scheduler 主动提醒也必须写入审计，不能只存在 worker 日志里。

## 10. 当前边界

已具备：

- Web Agent 对话。
- QQ Agent 对话。
- Web / QQ 共用一套对话生成、工具和审计逻辑。
- 最近对话按用户跨渠道加载，用户不需要理解内部线程如何拆分。
- B.AI 调用。
- Prompt builder。
- Goals / Logs / History 读取边界。
- Agent Reply 标准结构化输出。
- 工具意图识别和本地 fallback。
- shared executor。
- AgentToolAction 审计。
- Scheduler 回复路径审计。
- 主动联系启用确认、立即暂停和不会因普通聊天自动恢复的控制边界。
- 明确 Check-in 无二次确认，并且反馈会持久化新的下一承诺。
- PROMPT 反馈只在已有授权范围内保守调时，不增频、不越权。

仍需后续优化：

- 长对话 compaction。
- 按需 skill loading。
- 更严格的结构化输出 schema enforcement。
- Agent run event stream。
- 多模型路由。
- 真实 QQ Gateway 长连、平台主动消息权限和长期送达稳定性属于部署验收边界；当前逻辑闭环不依赖 live QQ 验证结论。

## 11. 相关文档

- `docs/designs/agent-prompt-system.md`
- `docs/designs/agent-tool-runtime.md`
- `docs/designs/agent-memory.md`
- `docs/designs/model-provider.md`
- `docs/designs/privacy-and-permissions.md`
