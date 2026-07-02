# Agent Tool Runtime

## 1. 定位

Agent Tool Runtime 是 Goal Mate 里让 Agent 从“会聊天”变成“会办事”的能力层。

它负责把 Agent 的自然语言判断转换成受控系统动作，例如创建目标草稿、调整今日行动、提交 check-in、写入日志、生成复盘和设置提醒。

## 2. 当前事实

截至 2026-07-02，系统已经具备：

- Agent Web 对话。
- QQ Bot 收消息和回消息。
- DeepSeek 模型调用。
- 读取目标上下文和 Markdown 文档。

截至 2026-07-02，系统已经新增：

- `src/lib/agent-tools.ts`：统一 Agent 工具注册表。
- `/api/agent/tools`：查看工具清单。
- `/api/agent/tools/execute`：显式执行工具。
- `/api/agent/tools/actions`：查看工具调用记录。
- `/api/agent/tools/actions/:id/confirm`：确认待执行工具动作。
- `/api/agent/tools/actions/:id/reject`：取消待执行工具动作。
- `AgentToolAction`：工具调用审计记录。
- Web Agent 工具意图识别：明确的系统操作请求会进入工具流程。
- Web Agent 文本确认：用户回复“确认执行”后执行最近的待确认工具动作。
- Web Agent 工具确认 UI：待确认动作显示为卡片，可点击确认或取消。
- QQ Agent 工具意图识别：明确的 QQ 系统操作请求会进入工具流程。
- QQ Agent 文本确认：用户在 QQ 回复“确认执行”后执行当前 QQ 线程最近的待确认工具动作。
- Settings Control Center：用户可以查看最近的 `AgentToolAction`，理解 Agent 做过什么、是否成功、是否等待确认。
- Shared business handlers：Web Agent 和 QQ Agent 已共用读取、草稿、写入类工具的业务逻辑。
- Shared executor：Web Agent 和 QQ Agent 已共用确认拦截、业务执行、失败处理和 `AgentToolAction` 审计写入；通道层只负责识别消息、确认动作和回消息。
- Scheduler reply audit：用户回复 Scheduler 主动提醒后，QQ 通道负责接收消息，但工具动作以 `source = scheduler` 写入审计，避免和普通 QQ 对话混在一起。

## 3. 设计原则

| 原则 | 说明 |
| --- | --- |
| 用户不需要懂工具 | 工具名不直接暴露给普通用户 |
| 所有写操作可追踪 | Agent 改了什么必须能回看 |
| 高风险默认不执行 | 外部高风险动作只能草拟，不能自动执行 |
| 工具少而闭环完整 | P0 只服务目标推进，不做泛自动化 |
| Web、QQ、Scheduler 共用 | 不为每个入口重复写业务逻辑 |

## 4. 工具权限层级

| 权限 | 含义 | 示例 |
| --- | --- | --- |
| read | 读取系统状态 | 读取目标、读取今日行动、读取日志 |
| draft | 生成草稿，不改变正式状态 | 生成目标草案、生成复盘草稿 |
| execute | 改变正式状态 | 更新目标、写日志、设置提醒 |

`execute` 默认需要确认。Scheduler 只能执行明确授权过的低风险提醒动作。

## 5. P0 工具范围

| 工具 | 说明 | 权限 |
| --- | --- | --- |
| `goal.list` | 读取目标摘要 | read |
| `goal.get` | 读取目标详情、KR、条件、阶段计划 | read |
| `goal.create_draft` | 创建目标草案和目标推理卡 | draft |
| `goal.update` | 更新目标、KR、条件、阶段计划 | execute |
| `today.get` | 读取今天下一步行动 | read |
| `today.set_next_action` | 设置今天下一步行动 | execute |
| `checkin.submit` | 提交今日完成情况和阻塞原因 | execute |
| `log.write_daily` | 写入或更新 Markdown 日志 | execute |
| `review.generate` | 生成日复盘或周复盘草稿 | draft |
| `reminder.schedule` | 创建或调整提醒规则 | execute |
| `settings.model.get` | 读取模型配置 | read |
| `settings.model.update` | 修改模型配置 | execute |

## 6. 调用流程

```text
User / QQ / Scheduler
  -> Agent Runtime
  -> Build Context
  -> Model Reply
  -> Tool Intent
  -> Validate Input
  -> Permission Guard
  -> Execute or Draft
  -> Audit Log
  -> Final Reply
```

## 7. 审计字段

每次工具调用至少记录：

| 字段 | 含义 |
| --- | --- |
| `userId` | 所属用户 |
| `source` | web、qq、scheduler |
| `toolName` | 工具名称 |
| `permission` | read、draft、execute |
| `inputSummary` | 输入摘要 |
| `targetType` | goal、today、log、review、reminder、settings |
| `targetId` | 影响对象 ID |
| `riskLevel` | low、medium、high |
| `requiresConfirmation` | 是否需要确认 |
| `status` | drafted、approved、executed、failed、rejected |
| `errorMessage` | 失败原因 |

## 8. 与页面的关系

| 页面 | 与 Agent 工具的关系 |
| --- | --- |
| Today | 展示工具执行后的下一步行动，但不承载复杂工具操作 |
| Goals | 主要只读，Agent 可以在确认后更新目标数据 |
| Logs | 用户和 Agent 都可以写入 Markdown 记录 |
| Agent | 主要入口，通过自然语言触发工具草稿或执行 |
| Settings | 配置模型、提醒、查看 QQ 绑定、查看工具权限策略和审计 |

## 9. 边界

P0 不做：

- 自动付款。
- 自动发送邮件。
- 自动改外部日历。
- 自动删除外部数据。
- 未确认的高风险 MCP 执行。

## 10. 当前实现边界

当前实现是显式工具 API + Web Agent 工具意图识别，不是模型原生 function calling。

也就是说：

- 系统已经有工具注册、工具执行、权限确认和审计底座。
- Agent 页面可以把“模型判断出的工具意图”转成工具调用。
- execute 工具会先进入 `pending_confirmation`。
- 用户可以通过确认卡片或“确认执行”文本确认最近一条 pending 工具。
- QQ Bot 可以把“模型判断出的工具意图”转成 QQ 侧工具调用。
- QQ Bot 的 execute 工具同样需要用户回复“确认执行”。

下一步应把 Agent Runtime 的回复结构升级为：

```text
natural_reply
tool_intent
requires_confirmation
tool_result
```

当前前端已经有基础确认组件。后续应继续增强为更清晰的影响范围预览和可撤回说明。

## 11. 技术债务

当前 Web Agent 和 QQ Worker 已共享：

```text
src/lib/agent-tool-shared.mjs
```

已共享内容：

- 工具目录。
- “确认执行”文本识别。
- 工具结果回复文案。
- 参数读取辅助函数。
- 日期路径生成。
- check-in / action 状态归一化。
- 工具意图 JSON 解析。

仍未共享：

- 具体业务 handler。
- 工具审计写入封装。

Web Agent 仍使用 `src/lib/agent-tools.ts`，QQ Worker 仍在 `src/scripts/qq-bot-worker.mjs` 中保留业务 handler。

这是为了让 QQ 常驻 worker 不依赖 Next.js TypeScript alias 启动链路。后续应抽出 runtime-neutral 的工具服务，避免 Web 和 QQ 两套工具逻辑长期分叉。

对应重构计划：

```text
docs/plans/shared-agent-tool-runtime-refactor-plan.md
```
