# Goal Mate

Goal Mate 是一个以 AI 对话为唯一逻辑入口、同时可从 Web 和 QQ 使用的目标推进助手。

核心理念：

```text
复杂方法交给 AI，用户只专注下一步行动。
```

系统把目标拆解、行动、日志、诊断、提醒和复盘放到后台维护。用户只需要向 Agent 说明目的、执行当前任务，再用自然语言反馈实际情况；Today、Goals、Logs 和 Settings 是按需查看与纠错界面，不要求用户手工维护内部结构。

## 当前状态

截至 2026-07-24：

- Web 与 QQ 已接入同一份 Agent Prompt、跨渠道上下文和 shared Tool Runtime。
- 自然目标可形成可确认的目标结构；明确反馈会直接写入 Check-in，并生成持久化的下一行动。
- QQ 绑定与主动联系授权已经分离；默认候选规则关闭，开启 / 恢复须确认，暂停立即生效。
- Scheduler 会在候选窗口先做 Contact Policy 的 send / skip / defer 判断，并受目标状态、行动窗口、近期反馈、免打扰、待回复、无响应阈值、额度和具体 QQ 会话授权约束。
- QQ Worker 与 Scheduler Worker 已具备代码和 systemd 部署模板。
- Telegram 已从当前 active API surface 中移除，只保留历史设计参考。
- 纯逻辑测试、静态契约、类型检查、生产构建和 Prompt 质量门禁已具备；真实 QQ 平台送达、服务器长期运行和真实用户连续使用价值仍是外部验收边界。

不要把“本地逻辑成立”理解成“真实 QQ 已送达”。当前实现计划与外部边界见：

```text
docs/plans/2026-07-20-qq-conversation-prompt-readiness-plan.md
```

## 主要入口

| 入口 | 说明 |
| --- | --- |
| `src/` | Next.js / Hono / Prisma 应用代码 |
| `docs/designs/` | 当前系统事实，后续开发的 Source of Truth |
| `docs/plans/` | 增量计划、验收计划、执行记录 |
| `docs/test-cases/` | 测试矩阵和人工验收标准 |
| `docs/standards/` | 工程、安全、测试、设计规范 |
| `deploy/systemd/` | Web、QQ Worker、Scheduler Worker 的 systemd 模板 |

## 常用命令

在 `src/` 目录下执行：

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm start
pnpm db:generate
pnpm worker:qq
pnpm worker:scheduler
```

轻量静态门禁：

```bash
pnpm verify:static
```

单独静态检查：

```bash
pnpm verify:secrets
pnpm verify:deployment-config
```

运行时验收需要额外前置条件，例如已启动 Web、已登录 Cookie、数据库 seed、QQ / DeepSeek 配置。不要在未满足条件时把失败结果当成业务缺陷。

## 验收分层

| 层级 | 文档 |
| --- | --- |
| 静态门禁 | `docs/plans/static-verification-gates.md` |
| 总体验收状态 | `docs/plans/verification-overview.md` |
| v0.1 主链路 | `docs/plans/v0.1-acceptance-runbook.md` |
| Agent Action Loop | `docs/test-cases/agent-action-loop-v0.2-test-cases.md` |
| 服务器长期运行 | `docs/plans/self-hosted-runtime-verification-plan.md` |
| 服务器验收报告模板 | `docs/plans/self-hosted-runtime-verification-report-template.md` |

## 安全边界

- 不要提交 `.env`。
- 不要把 API Key、Bot Token、SSH 密码、Cookie、Session 写入文档、日志或提交记录。
- `src/.env.example` 只能使用 `replace_with_*` 形式的占位符。
- 提交前建议执行 `pnpm verify:secrets` 或等价检查。

安全规范见：

```text
docs/standards/security.md
```

## 产品边界

P0 不做：

- 自动付款。
- 自动发送邮件。
- 自动改外部日历。
- 自动删除外部数据。
- 未确认的高风险外部动作。

Agent 可以读取和整理用户授权的数据，可以生成草稿和低风险系统动作。execute 类工具默认需要确认，并写入 `AgentToolAction` 审计记录。

## 下一步

当前剩余验收分为两层：

```text
1. 本地确定性验证：test / typecheck / build / Prompt 与 Agent Loop 静态门禁
2. 外部验证：真实 QQ Gateway、平台主动消息权限、systemd 长期运行和连续用户体验
```

在真实 QQ 与服务器验收完成前，项目可以描述为“核心逻辑闭环已实现并通过本地确定性验证”，不能描述为“已完成生产送达验证”。
