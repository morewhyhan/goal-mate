# Plan: Shared Agent Tool Runtime Refactor

## 1. 输入上下文

- Design：`docs/designs/agent-tool-runtime.md`
- Design：`docs/designs/qq-bot-integration.md`
- Design：`docs/designs/scheduler-worker.md`
- Plan：`docs/plans/agent-tools-and-scheduler-plan.md`
- Script：`src/scripts/qq-bot-worker.mjs`
- Runtime：`src/lib/agent-tools.ts`

## 2. 问题

当前 Web Agent 和 QQ Worker 都具备 Agent 工具能力，但实现分叉：

```text
Web Agent -> src/lib/agent-tools.ts
QQ Worker -> src/scripts/qq-bot-worker.mjs 内部重复实现
```

这带来三个风险：

- 工具行为可能不一致。
- 后续新增工具需要改两处。
- 验收脚本只能较好覆盖 Web API，不能直接证明 QQ 内部工具逻辑完全一致。

## 3. 目标

- 把工具定义、权限判断、业务 handler、审计写入抽成共享 runtime。
- Web API、QQ Worker、Scheduler Worker 复用同一套工具执行入口。
- 保留 worker 的 `.mjs` 启动稳定性，不让它依赖 Next.js 路由或浏览器环境。
- 不改变用户体验和 API 契约。

## 4. 非目标

- 不重写 Agent 页面。
- 不改 Prisma 数据模型。
- 不改 DeepSeek 调用策略。
- 不引入新的 worker 框架。
- 不在本轮切换到 MCP Server。

## 5. 推荐技术方案

### 5.1 新增 runtime-neutral 模块

新增：

```text
src/lib/agent-tool-runtime-core.ts
```

该模块只依赖：

```text
@prisma/client
纯 TypeScript/JavaScript 函数
```

不依赖：

```text
Hono
Next.js
React
路径别名之外的服务端上下文
```

### 5.2 暴露统一入口

目标 API：

```ts
listAgentToolDefinitions()
executeAgentToolWithPrisma(prisma, context, toolName, input)
formatAgentToolReply(toolName, execution)
detectConfirmToolMessage(text)
```

### 5.3 Web 适配层

`src/lib/agent-tools.ts` 变成薄适配：

```text
导入 prisma
调用 core runtime
保持现有导出不变
```

这样现有 Hono API 不需要大改。

### 5.4 QQ Worker 适配层

`src/scripts/qq-bot-worker.mjs` 改为：

```text
导入或动态加载共享 runtime
删除重复 tool catalog
删除重复 handler
保留 QQ Gateway、QQ API、消息解析
```

如果 `.ts` 直接导入对 Node 启动不稳定，则采用过渡方案：

```text
新增 scripts 侧 runtime .mjs
由 TS 文件和 worker 共同复用同一份纯 JS 实现
```

优先保证 worker 能长期运行。

## 6. 任务拆分

| 状态 | 任务 | 验收方式 |
| --- | --- | --- |
| Done | 抽出 shared tool catalog | Web 和 QQ 读取同一个工具列表 |
| Todo | 抽出 shared handlers | Web 和 QQ 执行同一个业务 handler |
| Done | 抽出 shared reply formatter | Web 和 QQ 对工具结果的描述一致 |
| Partial | Web API 迁移到 shared runtime | Web 已复用 shared catalog、confirm detector、reply formatter；handler 待迁移 |
| Partial | QQ Worker 迁移到 shared runtime | QQ 已复用 shared catalog、confirm detector、reply formatter；handler 待迁移 |
| Todo | 更新 `verify:agent-loop` | 验证共享 runtime 后的 read/write/confirm |
| Todo | 删除重复代码 | `qq-bot-worker.mjs` 只保留 QQ 通道逻辑 |

## 7. 验收标准

- `goal.list` 在 Web 和 QQ 返回一致摘要。
- `today.set_next_action` 在 Web 和 QQ 都先 pending，再确认执行。
- `checkin.submit` 在 Web 和 Scheduler 回复路径都写入 Checkin。
- 所有工具动作都写入 `AgentToolAction`。
- `verify:agent-loop:write` 覆盖共享 runtime 的写入路径。
- QQ worker 启动命令仍然是：

```bash
pnpm worker:qq
```

## 8. 风险与回滚

- 风险：worker 直接加载 TS/alias 失败。
- 回滚：保留当前 QQ worker 内部实现，先只抽 Web runtime。
- 风险：抽象过度导致工具行为难理解。
- 回滚：只抽纯 handler 和 formatter，不抽通道逻辑。

## 9. 执行记录

- 2026-07-02：确认 Web / QQ 工具逻辑存在重复；新增本重构计划，暂不直接拆 worker。
- 2026-07-02：新增 `src/lib/agent-tool-shared.mjs`，Web 和 QQ 已共享工具目录、确认语识别和工具结果文案；业务 handler 仍待后续抽取。
