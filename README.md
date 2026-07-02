# Goal Mate

Goal Mate 是一个以 Web Console 为主、QQ 机器人为辅助入口的 AI 目标推进系统。

核心理念：

```text
复杂方法交给 AI，用户只专注下一步行动。
```

系统把 OKR、目标拆解、日志、提醒、复盘和 Agent 工具调用放到后台运行。用户主要通过 Today、Goals、Logs、Agent、Settings 查看状态，并通过 QQ 接收主动提醒和反馈推进情况。

## 当前状态

截至 2026-07-02：

- v0.1 Web Console 开发资产已具备。
- Agent Tool Runtime 已具备 shared catalog、shared executor、shared read/write handlers 和 shared audit writer。
- QQ Worker 与 Scheduler Worker 已具备代码和 systemd 部署模板。
- Telegram 已从当前 active API surface 中移除，只保留历史设计参考。
- 静态验证、密钥扫描、部署配置检查、Agent Loop 验收脚本和服务器长期运行验收计划已具备。
- 本仓库当前不能声明整体已验收通过，因为运行时验收和服务器长期运行验收尚未执行。

不要把“脚本存在”理解成“已经通过”。当前真实状态见：

```text
docs/plans/verification-overview.md
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

当前最关键的下一步不是继续增加功能，而是执行验收：

```text
1. 静态门禁
2. Prisma generate / typecheck
3. v0.1 API / 页面验收
4. Agent Loop 运行时验收
5. 服务器长期运行验收
```

在未执行这些验收前，项目应被描述为“开发资产和验收资产已具备，等待实际验收”，不能描述为“已完成生产验证”。
