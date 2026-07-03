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

| 入口 | 作用 |
| --- | --- |
| Web Agent | 用户在 Agent 页面主动对话 |
| QQ Worker | 用户通过 QQ 和 Agent 对话 |
| Scheduler Worker | 主动提醒后等待用户回复 |

三个入口最终都应经过同一套 Agent Tool Runtime 和审计逻辑。

## 3. 当前运行链路

```text
User message
  -> save AgentMessage
  -> load runtime settings
  -> load current goal context when allowed
  -> retrieve relevant Markdown documents when allowed
  -> load recent conversation history when memory is enabled
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
| Conversation History | `AgentThread`、`AgentMessage` | 受 `agent.memory_enabled` 控制 |
| Settings | `UserSetting`、`defaultUserSettings` | 只用于控制读取范围和确认边界 |
| Tools | shared tool catalog | 不直接暴露给普通用户 |

Markdown 和用户输入都只能作为数据注入，不能覆盖 system prompt。

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

当前默认模型供应商是 DeepSeek。

Runtime 读取顺序：

```text
user default ModelConfig
  -> 当前用户 ModelConfig.apiKeyRef 的加密密钥
  -> defaultDeepSeekModel 的默认模型名/API Base
```

模型 API Key 属于用户私有配置，不是服务器全局共享配置。Web Agent、QQ Worker、Scheduler Worker 和 Intervention Planner 都必须按 `userId` 解析当前用户自己的模型密钥；缺少用户密钥时只能降级为本地兜底或提示用户去 Settings 配置。

模型调用失败时，不应伪造成功，也不得声称已经改动计划。

## 7. 工具意图

工具意图来源有两类：

| 来源 | 用途 |
| --- | --- |
| Model JSON router | 让模型把自然语言映射成工具名和参数 |
| Conservative fallback | 模型路由失败时，对明确命令做本地兜底 |

本地兜底只覆盖明确意图：

- 查看目标。
- 查看今日行动。
- 查看模型配置。
- 创建目标草稿。
- 写日志。
- 生成复盘。
- 提交完成、部分完成、没做反馈。

兜底不能替用户推断高风险动作。

## 8. 确认和权限

Agent Runtime 必须遵守 Settings 中的确认策略。

| 动作 | 默认策略 |
| --- | --- |
| read | 可直接执行，但受读取权限控制 |
| draft | 可生成草稿 |
| execute | 进入确认流程 |
| 修改目标 | 需要确认 |
| 修改设置 | 需要确认 |
| 外部动作 | 需要强确认 |

真实执行由 shared executor 完成，不由 Agent 直接写散落逻辑。

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
- DeepSeek 调用。
- Prompt builder。
- Goals / Logs / History 读取边界。
- Agent Reply 标准结构化输出。
- 工具意图识别和本地 fallback。
- shared executor。
- AgentToolAction 审计。
- Scheduler 回复路径审计。

仍需后续优化：

- 长对话 compaction。
- 按需 skill loading。
- 更严格的结构化输出 schema enforcement。
- Agent run event stream。
- 多模型路由。

## 11. 相关文档

- `docs/designs/agent-prompt-system.md`
- `docs/designs/agent-tool-runtime.md`
- `docs/designs/agent-memory.md`
- `docs/designs/model-provider.md`
- `docs/designs/privacy-and-permissions.md`
