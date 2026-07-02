# Goal Mate Verification Overview

## 1. 结论

截至 2026-07-02，项目已经具备多层验收资产，但不能声明整体完成或生产可用。

当前确定事实：

- 静态门禁入口已存在。
- v0.1 主链路验收资产已存在。
- Agent Action Loop v0.2 验收资产已存在。
- 自部署长期运行验收计划和报告模板已存在。
- 当前活跃消息通道已收敛为 QQ；Telegram 只保留历史设计参考，不再挂载 active API。
- 页面层已去除 demo fallback，空状态不再伪造目标、日志、对话或热力图活动。
- 本轮已执行低成本验证：`pnpm verify:static`、`pnpm db:generate`、`pnpm typecheck`，均通过。
- 本轮已执行本地运行时验证：`pnpm exec prisma migrate deploy`、`pnpm db:seed`、`pnpm verify:v01:api`、登录态 API smoke、`pnpm verify:v01:business`、`pnpm verify:agent-loop:write`、`pnpm build`、Dashboard 页面 HTTP smoke，均通过。
- 本轮已执行 Dashboard 截图 smoke，发现并修复 Today 热力图横向滚动/灰条问题；修复后 `pnpm typecheck` 和 `pnpm build` 均通过。
- 本轮发现并修复 QQ Worker 语法失败问题；`pnpm verify:static` 已新增 QQ Worker / Scheduler Worker `node --check` 防回归检查并通过。
- 本轮新增并验证 `pnpm worker:scheduler:once`，可在服务器上立即触发 Scheduler 验证；本地无 QQ 绑定场景已产生 `SchedulerEvent.status=failed` 和明确失败原因。
- 本轮只做本地部署准备，没有继续上传服务器；部署文档和 `.env.example` 已补齐生产 Web URL、端口、systemd 用户权限、migrate/build/static-gate 顺序。
- 本轮新增本地交付包能力：`pnpm deploy:bundle` 会生成 `.artifacts/deploy/goal-mate-*.tar.gz`，并排除真实 `.env`、Git 历史、依赖、构建产物、本地数据库和日志。
- 本轮新增并执行 Dashboard 浏览器 smoke：`pnpm verify:dashboard-browser` 已覆盖无登录态布局/空状态，`pnpm verify:dashboard-browser:auth` 已覆盖登录态真实 seed 数据；两者都会检查五个页面的关键文本、横向溢出、Agent 输入框、Logs 编辑区、Settings 配置控件和 Today 热力图，且报告不写 cookie。

## 2. 验收层级

| 层级 | 入口 | 是否需要运行服务 | 是否访问网络 | 当前状态 |
| --- | --- | --- | --- | --- |
| 静态门禁 | `pnpm verify:static` | 否 | 否 | 2026-07-02 已通过 |
| 密钥扫描 | `pnpm verify:secrets` | 否 | 否 | 2026-07-02 已通过 |
| 部署配置静态检查 | `pnpm verify:deployment-config` | 否 | 否 | 2026-07-02 已通过，包含 worker 语法检查 |
| v0.1 类型/生成检查 | `pnpm verify:v01` | 否 | 否 | 2026-07-02 已通过等价步骤：`db:generate` + `typecheck` |
| v0.1 API 验收 | `pnpm verify:v01:api` | 是 | 否 | 2026-07-02 未登录和登录态 smoke 已通过 |
| v0.1 业务流验收 | `pnpm verify:v01:business` | 视脚本前置条件而定 | 否 | 2026-07-02 已通过 |
| Agent Loop 读取验收 | `pnpm verify:agent-loop` | 是 | 否 | 2026-07-02 静态契约部分已通过；无 Cookie 时正确失败 |
| Agent Loop 写入验收 | `pnpm verify:agent-loop:write` | 是 | 否 | 2026-07-02 已通过 |
| Next 生产构建 | `pnpm build` | 否 | 否 | 2026-07-02 已通过 |
| Dashboard 页面 HTTP smoke | `/dashboard/today` 等页面路由 | 是 | 否 | 2026-07-02 五个页面均返回 200 |
| Dashboard 截图 smoke | Edge headless screenshots | 是 | 否 | 2026-07-02 已执行，Today heatmap 问题已修复 |
| Dashboard 浏览器 smoke | `pnpm verify:dashboard-browser` | 是 | 否 | 2026-07-02 已通过无登录态布局/空状态 smoke |
| Dashboard 登录态浏览器 smoke | `pnpm verify:dashboard-browser:auth` | 是 | 否 | 2026-07-02 已通过，会自动准备登录态和真实 seed 数据 |
| Scheduler 一次性验证 | `pnpm worker:scheduler:once` | 否 | 仅发送时需要 | 2026-07-02 本地已通过无绑定失败记录场景 |
| 本地部署交付包 | `pnpm deploy:bundle` | 否 | 否 | 2026-07-02 已新增，待随静态门禁复验 |
| 服务器长期运行验收 | `docs/plans/self-hosted-runtime-verification-plan.md` | 是 | 是 | 已规划，未执行 |

## 3. 当前推荐顺序

如果用户授权验证，建议按这个顺序执行：

```text
1. 执行真实浏览器人工交互验收
2. 部署服务器并执行 self-hosted runtime verification
3. 验证 QQ Gateway 长期连接、Scheduler 主动提醒和回复闭环
```

原因：

- 静态门禁、`db:generate`、`typecheck`、本地 API、业务流、Agent Loop 写入、生产构建、页面 HTTP smoke 和截图 smoke 已在 2026-07-02 通过。
- 本地交付包已具备安全边界，但不等同于服务器已部署。
- 仍未证明服务器长期运行和真实 QQ 长连接闭环。
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
| Agent Loop 最近运行报告 | `docs/plans/agent-action-loop-v0.2-last-run.md` |
| v0.1 本地运行时验收记录 | `docs/plans/v0.1-runtime-verification-last-run.md` |
| 静态门禁说明 | `docs/plans/static-verification-gates.md` |
| 服务器长期运行计划 | `docs/plans/self-hosted-runtime-verification-plan.md` |
| 服务器验收报告模板 | `docs/plans/self-hosted-runtime-verification-report-template.md` |

## 6. 当前未证明事项

- 未证明数据库 reset 能成功；已有数据库的 `prisma migrate deploy` 已通过。
- 未证明完整人工主观体验验收；页面 HTTP smoke、截图 smoke、无登录态浏览器布局 smoke、登录态真实数据浏览器 smoke 已通过。
- 未证明 QQ Gateway 长期连接稳定。
- 未证明 Scheduler 能在服务器上长期主动推进。
- 未证明去除 demo fallback 后的空状态和真实数据状态在浏览器中符合预期。

## 7. 下一步

下一步应进入服务器长期运行验收和真实 QQ 主动提醒闭环验收。

在服务器验收完成前，不能宣称“电脑关闭后也能长期主动推进”已经通过生产验证。
