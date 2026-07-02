# Goal Mate Verification Overview

## 1. 结论

截至 2026-07-02，项目已经具备多层验收资产，但不能声明整体完成或生产可用。

当前确定事实：

- 静态门禁入口已存在。
- v0.1 主链路验收资产已存在。
- Agent Action Loop v0.2 验收资产已存在。
- 自部署长期运行验收计划和报告模板已存在。
- 本轮没有执行任何验证命令。

## 2. 验收层级

| 层级 | 入口 | 是否需要运行服务 | 是否访问网络 | 当前状态 |
| --- | --- | --- | --- | --- |
| 静态门禁 | `pnpm verify:static` | 否 | 否 | 已定义，未执行 |
| 密钥扫描 | `pnpm verify:secrets` | 否 | 否 | 已定义，未执行 |
| 部署配置静态检查 | `pnpm verify:deployment-config` | 否 | 否 | 已定义，未执行 |
| v0.1 类型/生成检查 | `pnpm verify:v01` | 否 | 否 | 已定义，未执行 |
| v0.1 API 验收 | `pnpm verify:v01:api` | 是 | 否 | 已定义，未执行 |
| v0.1 业务流验收 | `pnpm verify:v01:business` | 视脚本前置条件而定 | 否 | 已定义，未执行 |
| Agent Loop 读取验收 | `pnpm verify:agent-loop` | 是 | 否 | 已定义，未执行 |
| Agent Loop 写入验收 | `pnpm verify:agent-loop:write` | 是 | 否 | 已定义，未执行 |
| 服务器长期运行验收 | `docs/plans/self-hosted-runtime-verification-plan.md` | 是 | 是 | 已规划，未执行 |

## 3. 当前推荐顺序

如果用户授权验证，建议按这个顺序执行：

```text
1. pnpm verify:static
2. cd src && pnpm db:generate
3. cd src && pnpm typecheck
4. 启动本地 Web
5. 执行 v0.1 API / Agent Loop 验收
6. 部署服务器并执行 self-hosted runtime verification
```

原因：

- 静态门禁成本最低，先发现密钥和部署资产问题。
- `db:generate` 和 `typecheck` 能暴露 Prisma / TypeScript 基础问题。
- API / Agent Loop 需要服务和登录态，放在基础检查之后。
- 服务器长期运行验收依赖真实 QQ / DeepSeek / systemd，最后执行。

## 4. 不能混淆的边界

| 不要这么判断 | 正确判断 |
| --- | --- |
| 有脚本 = 已通过 | 只有脚本执行成功并记录证据，才算通过 |
| 有 systemd 模板 = 服务器可用 | 必须在服务器上启动并观察日志 |
| QQ Worker 代码存在 = QQ 可长期可用 | 必须验证 Gateway 连接、消息接收和平台限制 |
| Scheduler 代码存在 = 主动提醒可用 | 必须验证 SchedulerEvent、QQ 发送结果和回复闭环 |
| Settings 有 runtime status = 运行状态正确 | 必须结合真实服务状态和数据库记录判断 |

## 5. 证据文件

| 类型 | 文件 |
| --- | --- |
| v0.1 静态完成审计 | `docs/plans/v0.1-static-completion-audit.md` |
| v0.1 验收 runbook | `docs/plans/v0.1-acceptance-runbook.md` |
| Agent Loop 测试矩阵 | `docs/test-cases/agent-action-loop-v0.2-test-cases.md` |
| 静态门禁说明 | `docs/plans/static-verification-gates.md` |
| 服务器长期运行计划 | `docs/plans/self-hosted-runtime-verification-plan.md` |
| 服务器验收报告模板 | `docs/plans/self-hosted-runtime-verification-report-template.md` |

## 6. 当前未证明事项

- 未证明当前代码能 typecheck。
- 未证明 Prisma Client 能生成。
- 未证明数据库迁移或 reset 能成功。
- 未证明 Web 页面真实可操作。
- 未证明 Agent Loop API 在运行态可通过。
- 未证明 QQ Gateway 长期连接稳定。
- 未证明 Scheduler 能在服务器上长期主动推进。

## 7. 下一步

需要用户明确授权后，才能进入实际验证。

在没有授权运行命令前，后续增量只能继续完善计划、文档、静态资产和代码结构，不能宣称验收通过。
