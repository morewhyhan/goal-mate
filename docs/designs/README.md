# Designs

本目录记录当前系统事实，是后续 Plan 的 Source of Truth。

建议维护：

- `system-context.md`：系统目标、用户、边界和外部依赖。
- `architecture.md`：最终态架构说明。
- `design-system.md`：前端视觉和组件规范。
- `domain-model.puml`：领域模型。
- `database.sql`：数据库事实或 DDL 草案。
- `openapi.yaml`：API 契约。
- `agent-tool-runtime.md`：Agent 工具运行时事实。
- `agent-prompt-system.md`：Agent 提示词系统工程事实。
- `agent-runtime.md`：Agent 对话运行时总流程事实。
- `agent-memory.md`：Agent 对话、日志、复盘和目标状态记忆事实。
- `model-provider.md`：B.AI 等 OpenAI-compatible模型供应商配置和调用事实。
- `settings-runtime.md`：Settings 如何影响真实系统行为。
- `privacy-and-permissions.md`：Agent 读取、写入、密钥、导出和删除边界。
- `verification-strategy.md`：静态、API、浏览器、部署和真实运行验收策略。
- `runtime-observability.md`：AgentToolAction、SchedulerEvent、QQ 事件和 runtime status 观测事实。
- `review-engine.md`：日/周/月/年复盘如何生成、写入和影响目标判断。
- `scheduler-worker.md`：主动提醒调度事实。
- `qq-bot-integration.md`：QQ Bot 集成事实。
- `self-hosted-worker-deployment.md`：自部署 worker 长期运行事实。
