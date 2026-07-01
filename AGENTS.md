# AGENTS.md

本文件是项目内 AI Coding 的协作宪法。所有 AI 助手在修改本仓库前，必须先读取本文件，并优先遵守这里定义的上下文、流程和准出规则。

## 1. 项目协作原则

- 规格优先：需求、计划、设计事实、测试用例必须进入 `docs/`，不要只停留在聊天记录中。
- 事实与过程分离：`docs/designs` 记录系统当前事实；`docs/plans` 记录某一轮任务的过程方案。
- 小步可验收：每轮开发必须有明确验收方式，优先以自动化测试、API 契约、E2E 用例表达。
- 不隐式重构：除非 Plan 明确要求，不做大范围重构、目录迁移或依赖替换。
- 不覆盖人工修改：发现未预期的变更时停止并询问。

## 2. 目录职责

- `docs/standards`：长期有效的工程标准，例如架构、API、数据库、前端、测试、安全规范。
- `docs/features`：产品/BA 维护的需求规格，一个业务模块或增量需求一个文档。
- `docs/plans`：每轮任务的实现计划、拆分、状态和风险，属于过程方案。
- `docs/designs`：当前系统事实，包含领域模型、数据库、OpenAPI、架构设计等。
- `docs/test-cases`：测试用例规格，尤其是 API 和 E2E 验收路径。
- `docs/others`：ADR、发布记录、Bug 报告等辅助工程文档。
- `.ai`：AI 工具配置、Skills、MCP 示例和团队约定。

## 3. 标准工作流

### 3.1 Plan 阶段

1. 读取相关 `docs/features`、`docs/designs`、`docs/standards`。
2. 在 `docs/plans` 基于模板创建本轮 Plan。
3. 明确任务边界、涉及文件、测试策略、准出标准和风险。
4. 等待人类确认后再进入实现。

### 3.2 实现阶段

1. 优先补测试或测试用例规格，再实现代码。
2. 按 Plan 修改，不扩大范围。
3. API 改动必须同步 OpenAPI 或相关接口事实文档。
4. 数据库改动必须同步 DDL/迁移说明和领域模型。
5. 前端改动必须遵守 `docs/standards/frontend.md` 和 `docs/designs/design-system.md`。

### 3.3 验收阶段

1. 单元测试覆盖核心规则和边界条件。
2. API 测试覆盖契约、鉴权、错误码和业务规则。
3. E2E 测试覆盖关键用户路径。
4. 如本地未执行测试，必须明确说明未执行原因和建议命令。

## 4. Loop 规则

- API Loop：Plan -> API 测试或契约 -> 实现 -> 单元测试 -> API 测试 -> 修复。
- E2E Loop：Plan -> 测试用例规格 -> 实现 -> 浏览器调试 -> Playwright 固化 -> 修复。
- 长任务必须在 Plan 中维护状态，便于中断后恢复。

## 5. 文档更新规则

- `docs/features`：增量需求以新模块/新流程为中心写完整字段、规则、验收；存量修改必须先写当前行为，再写目标行为和变更清单。新增需求追加新文件；存量需求在原文档标注变更点。
- `docs/plans`：每轮追加新文件，原则上不作为长期事实来源。
- `docs/designs`：持续更新为最终态，是下一次 Plan 的主要事实依据。
- `docs/standards`：变更必须谨慎，并说明影响范围。

## 6. 命名约定

- 需求规格：`docs/features/YYYY-MM-DD-feature-name.md`
- 实现计划：`docs/plans/YYYY-MM-DD-plan-name.md`
- 测试用例：`docs/test-cases/YYYY-MM-DD-case-name.md`
- ADR：`docs/others/adr-NNNN-title.md`

## 7. 默认技术约束

当前仓库尚未固定应用技术栈。创建业务代码前，必须先在 Plan 中确认：

- 前端框架和构建工具。
- 后端语言、框架和运行方式。
- 数据库和迁移工具。
- 测试工具链。
- 部署目标。
