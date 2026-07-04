# Prompt System 工程化计划

## 1. 目标

把 Goal Mate 的提示词系统从“运行时代码里的长字符串”升级成可维护、可验证、可演进的工程模块。

## 2. 范围

本计划处理：

- Agent system prompt 的模块化。
- prompt 版本号。
- prompt section 职责边界。
- runtime 组装入口。
- 文档事实同步。
- 静态门禁。

本计划不处理：

- UI 页面。
- 模型供应商配置。
- QQ Bot 部署。
- 真实模型批量评测。

## 3. 当前问题

| 问题 | 影响 |
| --- | --- |
| system prompt 内联在 `agent-runtime.ts` | 代码和提示词耦合，后续难维护 |
| 没有 prompt 版本号 | 无法判断线上 Agent 使用的是哪一版能力 |
| 没有 section 边界 | 身份、控制闭环、权限、表达风格混在一起 |
| 门禁扫描 runtime 文案 | prompt 模块化后会误判 |
| 缺少设计文档 | 后续容易继续把提示词写散 |

## 4. 改造结果

| 项目 | 状态 | 结果 |
| --- | --- | --- |
| 新建 prompt system 入口 | done | `src/lib/agent-prompts/index.ts` |
| 增加 prompt 版本 | done | `AGENT_SYSTEM_PROMPT_VERSION` |
| 拆分 prompt section | done | `ANTI_AI_TONE_CHARTER`、`ANTI_AI_AUDIT_PROTOCOL`、`ROLE`、`CONTROL_LOOP`、`INTERVENTION_POLICY`、`META_COGNITION_POLICY`、`MEMORY_QUALITY_POLICY`、`SYSTEM_FACT_USAGE`、`TOOL_AND_PERMISSION_POLICY`、`SECRETARY_TONE` |
| 增加去 AI 味总纲 | done | 顶层约束 Agent 不像 AI 客服、问答机器人或写作助手 |
| 增加 AI 味审稿协议 | done | 回复前检查太完整、太礼貌、太抽象、太平滑等痕迹并重写 |
| 删除 prompt 表层理论名词 | done | 不在 system prompt 中显式强调后台理论术语，只保留行为规则 |
| runtime 改为 builder 组装 | done | `agent-runtime.ts` 调用 `buildAgentSystemPrompt` |
| 增加设计事实文档 | done | `docs/designs/agent-prompt-system.md` |
| 更新静态门禁 | done | `AAL-PROMPT-SYSTEM-MODULAR-CONTRACT` |
| 真实对话样本评测 | pending | 后续用真实模型跑 5 类样本 |
| prompt snapshot | done | `docs/designs/agent-prompt-snapshot.json` 固定当前 prompt 版本、section、源码 hash 和关键规则短语；`pnpm verify:agent-prompt-snapshot` 防止未记录漂移 |
| 首次目标模型优先 | done | 有用户模型 Key 时，首次目标创建由模型路由优先判断；本地首目标 scaffold 只作为无 Key 兜底 |

## 5. 工程规则

- 运行时代码不直接维护长 prompt。
- 新增 prompt 能力必须先进入 prompt module。
- 新增 prompt section 必须有清晰职责和优先级。
- 用户可编辑内容只能进入 runtime context，不能进入 system rules。
- prompt 修改必须同步设计文档和静态门禁。
- prompt 修改必须同步 `docs/designs/agent-prompt-snapshot.json`；未更新 snapshot 的 prompt 漂移视为验收失败。
- system prompt 不主动灌输后台理论名词，除非用户明确问产品原理或文档说明。
- 去 AI 味必须包含内部审稿协议，不能只写“少寒暄、少废话”。

## 6. 验收

本次验收依赖：

- `pnpm verify:agent-loop:static`
- `pnpm verify:agent-prompt-snapshot`
- `pnpm typecheck`

通过后说明：

- prompt 模块存在。
- runtime 已使用 builder。
- 核心控制闭环和秘书式表达规则仍然存在。
- prompt snapshot 与当前 system prompt 一致。
- TypeScript 编译没有破坏。
