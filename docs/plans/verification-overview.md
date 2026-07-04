# Goal Mate Verification Overview

## 1. 结论

截至 2026-07-04，项目已经具备多层验收资产，但不能声明整体完成或生产可用。

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
- 2026-07-03 新增服务器 systemd 自动安装入口：`pnpm deploy:systemd:install` 会安装、enable 并 restart Web、QQ Worker、Scheduler Worker；正常部署后不需要用户手动进入目录运行 `pnpm worker:qq`。这只是自动化入口，不等于服务器长期运行验收已完成。
- 本轮新增并执行 Dashboard 浏览器 smoke：`pnpm verify:dashboard-browser` 已覆盖无登录态布局/空状态，`pnpm verify:dashboard-browser:auth` 已覆盖登录态真实 seed 数据；两者都会检查五个页面的关键文本、横向溢出、Agent 输入框、Logs 编辑区、Settings 配置控件和 Today 热力图，且报告不写 cookie。
- 2026-07-03 新增并执行登录注册 UI smoke：`pnpm verify:auth-ui:write` 已覆盖 `/login`、未登录 Dashboard 门禁、真实浏览器注册、退出和再次登录。
- 2026-07-03 新增并执行登录数据隔离 smoke：`pnpm verify:auth-isolation:write` 已覆盖两个真实用户之间的 Goals、Logs、Agent Threads、Models 和 Export 隔离；跨用户直读 ID 返回 404；临时数据已清理。
- 2026-07-03 模型密钥隔离已纳入 `pnpm verify:auth-isolation`：两个用户分别保存自己的 API Key，响应和导出不泄露明文，数据库保存加密引用，运行时按 userId 解析当前用户密钥。
- 2026-07-03 模型密钥隔离改动后重新执行 `pnpm typecheck`、`pnpm verify:static`、`pnpm verify:auth-isolation:write`、`pnpm verify:dashboard-browser:auth:write`、`pnpm build`，最终均通过。
- 2026-07-03 登录注册改动后重新执行 `pnpm typecheck`、`pnpm build`、`pnpm verify:auth-ui:write`、`pnpm verify:dashboard-browser:auth:write`，最终均通过。
- 2026-07-04 新增 QQ 多用户自助绑定码能力：Settings 可为当前登录用户生成 30 分钟有效的“绑定 GM-XXXXXX”，QQ Worker 只有校验该绑定码后才写入 `QqChatBinding`；陌生 QQ 会话不再自动绑定默认用户或第一个用户。
- 2026-07-04 已重新执行 `pnpm typecheck`、`pnpm verify:deployment-config`、`pnpm verify:auth-isolation:write`，均通过；`verify:auth-isolation` 已覆盖两个用户分别保存 QQ Bot token、生成不同绑定码、token 加密保存、绑定码归属正确。
- 2026-07-04 新增并执行 `pnpm verify:first-run-agent:write`：新用户空工作区、模糊目标只追问、具体自然语言目标生成目标草案、确认激活、Today 接住下一步、目标 Markdown 写入均通过。该验证不依赖真实模型调用，用于证明首次目标闭环的本地兜底路径可用。
- 2026-07-04 首次 Agent 闭环改动后重新执行 `pnpm typecheck` 和 `pnpm verify:agent-loop:static`，均通过；同时修正静态契约脚本，使其验证当前 UI/Runtime 的真实能力标记，而不是旧版页面文案。
- 2026-07-04 新增并执行 `pnpm verify:qq-scheduler-reply:write`：本地构造 QQ evening_review 主动提醒事件，模拟用户回复“没完成，太难了”，验证 Check-in、Diagnosis、Markdown 日志、daily Review、SchedulerEvent responded、`AgentToolAction(source=scheduler)` 和 `system/meta-cognition/<goal>.md` 全部写入成功。该验证现在确认 QQ 回复不只是日志记录，还会产生下一次 Planner 可读取的干预假设、AI 下次思考规则、`policy_delta` 和可验证信号。
- 2026-07-04 新增并执行本地从零到一产品闭环验收入口：`pnpm verify:zero-to-one:write` 已通过，组合覆盖类型检查、用户隔离、部署配置、fresh DB 首次建库、Settings 自助配置、Agent 静态契约、AI 回复质量、Agent 运行时上下文注入、首次目标输入、Today Web 反馈入库、干净新用户 Dashboard 空状态和 QQ Scheduler 回复入库验证。该入口用于证明本地 v0.1 主链路被串起来，不等于服务器长期运行或真实 QQ Gateway 已验收。
- 2026-07-04 从零到一产品闭环验收已升级：`pnpm verify:zero-to-one` 现在把 `pnpm verify:intervention-planner` 和 `pnpm verify:control-loop-emergence` 纳入必过项，用来证明反馈、元认知、`policy_delta` 和 AI 自我优化不只是旁路脚本，而是本地 v0.1 主链路的一部分。
- 2026-07-04 主动提醒规则已新增本地运行时验证：`pnpm verify:scheduler-rules` 会创建干净测试用户和用户自有 ReminderRule，证明 Scheduler 消费启用规则、跳过关闭规则、尊重 `maxPerDay` 和 `quietHours`；该验证还覆盖另一个用户更新更晚但 disabled 的 QQ 配置不会阻断当前用户规则；有 QQ 绑定时，它会通过本地 fake QQ API 验证 token + send，并断言发送内容包含今日行动、fallback、Planner 决策、可验证信号、`SchedulerEvent`、`AgentMessage` 和 `AgentToolAction` 审计；该验证已纳入 `pnpm verify:zero-to-one`。
- 2026-07-04 新增并执行真实模型 Agent 链路验收入口：`pnpm verify:live-model-agent:write` 已跑到 DeepSeek。当前用户模型 Key 加密保存和响应脱敏通过，但 Settings 模型测试收到 `reason=insufficient_balance`，因此 Agent live reply 未继续执行，真实模型链路仍不能声明通过。
- 2026-07-04 Settings 模型测试错误已结构化：余额不足、Key 无效、限流、服务不可用、网络错误会返回 `reason` 和用户可理解 `message`；前端测试按钮会通过 toast 和页面内状态直接显示该结果。
- 2026-07-04 新增并执行 Agent 上下文运行时验收入口：`pnpm verify:agent-context:write` 已通过；该脚本用本地 fake model 捕获 Web Agent 实际 chat-completions 请求，证明当前用户 Goal、Markdown、元认知和记忆会进入 runtime prompt，另一个用户的 Markdown 不会泄漏；关闭 Logs 读取权限后 prompt 会移除日志内容并显示权限关闭边界。
- 2026-07-04 新增并执行 Agent 控制动作验收入口：`pnpm verify:agent-control:write` 已通过；该脚本会注册干净用户，通过 Web Agent Tools API 发起 `settings.model.update` 和 `reminder.schedule`，验证它们先进入待确认，确认后分别写入当前用户 `ModelConfig` 和 `ReminderRule`，模型密钥加密且不在读取、导出或 Control Center 中泄漏，Settings Control Center 能看到模型、提醒规则和工具审计。
- 2026-07-04 新增并执行 fresh DB bootstrap 验收入口：`pnpm verify:fresh-db:write` 已通过；该脚本使用临时 SQLite 数据库执行 `prisma migrate deploy`，证明首次建库可迁移、核心业务表存在、业务表初始为空、没有假任务/残留数据，并能完成最小用户读写删除；该验证不 reset 当前开发数据库，已纳入 `pnpm verify:zero-to-one`。
- 2026-07-04 新增并执行 Today Web 反馈闭环验收入口：`pnpm verify:today-feedback:write` 已通过；该脚本会注册干净用户，通过 Agent 创建并激活目标，读取 Today 下一步，提交“没完成”反馈，并验证 DailyAction、Check-in、Diagnosis、Markdown Logs、Momentum、Meta-Cognition、Goals/Logs API 状态被更新；该验证已纳入 `pnpm verify:zero-to-one`。
- 2026-07-04 新增并执行 Settings 自助配置闭环验收入口：`pnpm verify:settings-self-service:write` 已通过；该脚本会注册干净用户，通过 Settings Web/API 保存模型、QQ Bot、提醒节奏和行为控制，使用本地 fake model / fake QQ token server 验证测试按钮按当前用户配置执行，并确认 Control Center 和导出脱敏；该验证已纳入 `pnpm verify:zero-to-one`。
- 2026-07-04 修复 Dashboard 登录态稳定性：Auth Client 默认回到当前页面同源地址，不再隐式退到 `localhost:3000`；Dashboard Layout 增加同源 session probe，避免 `useSession` 长时间 pending 时 Goals 等页面永久停在“正在确认登录状态”。`pnpm verify:dashboard-browser:empty-auth:write` 已重新通过。
- 2026-07-04 最新本地从零到一产品闭环验收重新通过：`pnpm verify:zero-to-one:write` 结果 PASS，覆盖类型检查、用户隔离、部署配置、fresh DB、Agent 静态契约、AI 回复质量、Agent 上下文、Agent 控制动作、Settings 自助配置、Planner、控制闭环涌现、首次目标、Today 反馈、干净 Dashboard 空状态、Scheduler 规则和 QQ 回复入库。该报告仍明确不证明真实 QQ Gateway 长连接、服务器 systemd 长期运行或真实模型长期对话质量。
- 2026-07-04 清理 QQ 接入旧默认用户路径：QQ 集成文档、自部署文档、systemd README、运行验收计划、`.env.example`、Settings 部署状态、Settings 前端提交体、Settings API schema、QQ Worker 配置签名和 `resolveQqBotConfig` 均不再把 `QQ_DEFAULT_USER_EMAIL` 当作用户接入条件；旧 permissions 中的 `defaultUserEmail` 只会被清理，不再参与绑定。当前唯一正确归属路径是 Settings 保存 QQ 配置后生成绑定码，再由 QQ 会话发送绑定命令写入 `QqChatBinding`。`pnpm verify:deployment-config:write` 已新增 `DEPLOY-README-NO-DEFAULT-USER`、`DEPLOY-QQ-NO-DEFAULT-USER-DOC` 和无默认用户 fallback 检查并通过；`pnpm typecheck`、`pnpm verify:settings-self-service:write`、`pnpm verify:auth-isolation:write` 均通过。
- 2026-07-04 Agent runtime 和 Settings 已共享模型失败分类：余额不足、Key 无效、限流、服务不可用、网络错误。Agent 模型调用失败时会保存用户消息，明确说明模型不可用和下一步去 Settings 测试连接，不会把 provider 原始 JSON 当作回复，也不会伪装成已完成思考或改动计划。`pnpm verify:ai-reply-quality` 已新增 `ARQ-MODEL-FAILURE-SHARED-CLASSIFIER` 和 `ARQ-SAMPLE-MODEL-FAILURE` 防回归检查并通过；`pnpm typecheck` 已通过。
- 2026-07-04 QQ Bot App ID / Token 已从服务器 `.env` 和用户可见 fallback 中移除：干净用户 Settings Control Center 初始必须显示 `qq=missing_config`，只有当前用户在 Settings 保存 QQ 凭证后才会进入 configured；`.env.example`、QQ 集成文档、systemd README 和服务器验收模板不再要求或展示用户级 QQ 密钥字段。`pnpm verify:settings-self-service:write` 已新增初始 QQ missing 断言并通过；`pnpm verify:deployment-config:write` 已新增 `DEPLOY-ENV-NO-USER-QQ-SECRETS` 并通过；`pnpm typecheck` 已通过。
- 2026-07-04 Agent 首次目标生成已收紧为“有模型优先，没模型兜底”：当前用户配置可用模型 Key 后，首次具体目标不会再被本地关键词 scaffold 抢先接管，而是先进入 Model JSON router；只有缺少模型 Key 时才使用本地 first-goal scaffold 保证从零到一闭环仍可跑。`pnpm verify:first-run-agent:write` 已新增 `FRA-MODEL-FIRST-GOAL-ROUTER` 并通过，证明 fake model 收到 router 调用且目标/今日行动来自模型返回；`pnpm typecheck` 和 `pnpm verify:agent-loop:static` 均通过。
- 2026-07-04 AI 秘书回复质量门禁已补齐核心样本覆盖：`pnpm verify:ai-reply-quality` 现在覆盖模糊目标、今日行动、没做反馈、复盘、设置读取 5 类用户场景，并继续拒绝 AI 客服腔、泛鼓励、强制羞辱、未确认执行和隐私幻觉；该门禁已通过。真实 DeepSeek 长期对话质量仍按 live model 独立验收。

## 2. 验收层级

| 层级 | 入口 | 是否需要运行服务 | 是否访问网络 | 当前状态 |
| --- | --- | --- | --- | --- |
| 静态门禁 | `pnpm verify:static` | 否 | 否 | 2026-07-02 已通过 |
| 密钥扫描 | `pnpm verify:secrets` | 否 | 否 | 2026-07-02 已通过 |
| 部署配置静态检查 | `pnpm verify:deployment-config` | 否 | 否 | 2026-07-04 已通过，覆盖 worker 语法检查、systemd 自动安装入口、Settings 配置边界、模型测试失败展示、QQ 不再使用默认用户自动绑定，以及 `.env.example` 不暴露用户级 QQ App ID / Token |
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
| Dashboard 干净登录态浏览器 smoke | `pnpm verify:dashboard-browser:empty-auth` | 是 | 否 | 2026-07-04 已通过并写入报告；覆盖干净新用户五页空状态、真实配置边界、无横向溢出、Agent 输入区可见和登录守卫不会永久卡住 |
| 登录注册 UI smoke | `pnpm verify:auth-ui` | 是 | 否 | 2026-07-03 已通过，覆盖登录页、未登录门禁、注册、退出和再次登录 |
| 登录数据隔离 smoke | `pnpm verify:auth-isolation` | 是 | 否 | 2026-07-03 已通过，覆盖两用户私有数据隔离、跨用户直读阻断、模型密钥加密和导出脱敏 |
| Fresh DB bootstrap | `pnpm verify:fresh-db` | 否 | 否 | 2026-07-04 已通过，使用临时 SQLite DB 验证首次迁移、零业务数据和最小读写，不触碰当前开发库 |
| 从零到一产品闭环 | `pnpm verify:zero-to-one` | 首次 Agent 子项需要 Web API | 否 | 2026-07-04 已通过并写入报告；已纳入 fresh DB、Settings 自助配置、Today Web 反馈、自主干预 Planner 和控制闭环涌现门禁；沙箱内 Node 访问本地 Web API 会被 `EPERM` 阻止，需在允许本地 HTTP 的环境执行 |
| 真实模型 Agent 链路 | `pnpm verify:live-model-agent` | 是 | 是 | 2026-07-04 已执行但未通过：Key 保存/脱敏通过，DeepSeek 返回 `reason=insufficient_balance`，Agent live reply 未验收 |
| Agent 上下文运行时 | `pnpm verify:agent-context` | 是 | 否 | 2026-07-04 已通过；用本地 fake model 捕获模型请求，覆盖当前用户上下文注入、Logs 权限和跨用户隔离 |
| Agent 控制动作 | `pnpm verify:agent-control` | 是 | 否 | 2026-07-04 已通过；覆盖 Agent 确认后修改模型配置、提醒规则、密钥脱敏和 Settings 审计 |
| Settings 自助配置闭环 | `pnpm verify:settings-self-service` | 是 | 否 | 2026-07-04 已通过，覆盖用户自己保存模型、QQ、提醒和行为控制，模型/QQ 测试按当前用户配置执行，Control Center 可读且不泄密 |
| 首次 Agent 建目标 smoke | `pnpm verify:first-run-agent` | 是 | 否 | 2026-07-04 已通过，覆盖空工作区、模糊目标追问、自然语言目标建草案、确认激活和 Today 接入 |
| Today Web 反馈闭环 | `pnpm verify:today-feedback` | 是 | 否 | 2026-07-04 已通过，覆盖干净用户从 Agent 建目标到 Today 提交反馈，再到行动状态、诊断、日志、热力图、元认知和 Goals/Logs API 可读 |
| QQ Scheduler 回复闭环 | `pnpm verify:qq-scheduler-reply` | 否 | 否 | 2026-07-04 已通过，覆盖主动提醒回复进入 Check-in、Logs、Review、SchedulerEvent、审计和 Meta-Cognition |
| Scheduler 提醒规则 | `pnpm verify:scheduler-rules` | 否 | 否 | 已纳入 `pnpm verify:zero-to-one`，覆盖用户 ReminderRule 被消费、QQ 配置解析按用户隔离、关闭规则不触发、每日上限、免打扰，以及 fake QQ API 下的主动消息内容和审计 |
| 自主干预 Planner | `pnpm verify:intervention-planner` | 否 | 否 | 已纳入 `pnpm verify:zero-to-one`，覆盖降难度、风险预案、无响应处理、AI policy 质量门禁和可验证元认知 |
| 控制闭环涌现 | `pnpm verify:control-loop-emergence` | 否 | 否 | 已纳入 `pnpm verify:zero-to-one`，覆盖反馈统一语义、元认知评估、policy_delta 消费和 AI 自我优化 |
| Scheduler 一次性验证 | `pnpm worker:scheduler:once` | 否 | 仅发送时需要 | 2026-07-02 本地已通过无绑定失败记录场景 |
| 本地部署交付包 | `pnpm deploy:bundle` | 否 | 否 | 2026-07-02 已新增，待随静态门禁复验 |
| systemd 自动安装入口 | `pnpm deploy:systemd:install` | 是，服务器上执行 | 否 | 2026-07-03 已新增；未在服务器执行验收 |
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
| 有 systemd 自动安装脚本 = 已经长期运行 | 必须在服务器执行安装、检查 `systemctl status` 和 `journalctl` |
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
| 首次 Agent 建目标验收记录 | `docs/plans/first-run-agent-flow-last-run.md` |
| QQ Scheduler 回复闭环验收记录 | `docs/plans/qq-scheduler-reply-loop-last-run.md` |
| Scheduler 提醒规则验收记录 | `docs/plans/scheduler-reminder-rules-last-run.md` |
| Agent 上下文运行时验收记录 | `docs/plans/agent-context-runtime-last-run.md` |
| Agent 控制动作验收记录 | `docs/plans/agent-control-actions-last-run.md` |
| Settings 自助配置验收记录 | `docs/plans/settings-self-service-last-run.md` |
| Fresh DB bootstrap 验收记录 | `docs/plans/fresh-db-bootstrap-last-run.md` |
| Today Web 反馈闭环验收记录 | `docs/plans/today-feedback-loop-last-run.md` |
| 从零到一产品闭环验收记录 | `docs/plans/zero-to-one-product-flow-last-run.md` |
| 真实模型 Agent 链路验收记录 | `docs/plans/live-model-agent-flow-last-run.md` |
| 静态门禁说明 | `docs/plans/static-verification-gates.md` |
| 服务器长期运行计划 | `docs/plans/self-hosted-runtime-verification-plan.md` |
| 服务器验收报告模板 | `docs/plans/self-hosted-runtime-verification-report-template.md` |

## 6. 当前未证明事项

- 未证明对当前开发数据库执行 destructive reset 的结果；已用临时全新 SQLite 数据库证明首次 `prisma migrate deploy`、零业务数据和最小读写成立。
- 未证明完整人工主观体验验收；页面 HTTP smoke、截图 smoke、无登录态浏览器布局 smoke、登录态真实数据浏览器 smoke 已通过。
- 未证明 QQ Gateway 长期连接稳定。
- 未证明 Scheduler 能在服务器上长期主动发送到真实 QQ；本地回复入库闭环已通过。
- 未证明真实模型在长期自然对话中稳定选择正确工具；当前首次目标闭环已由本地兜底路径证明可跑通，真实模型 Agent 链路已执行到 DeepSeek，但被账号余额不足阻断。

## 7. 下一步

下一步应进入服务器长期运行验收和真实 QQ 主动提醒闭环验收。

在服务器验收完成前，不能宣称“电脑关闭后也能长期主动推进”已经通过生产验证。
## 2026-07-04 Settings 空状态修复与 zero-to-one 复验

- 发现问题：`pnpm verify:zero-to-one:write` 首次失败在 `ZOF-EMPTY-DASHBOARD-BROWSER / DASH-SETTINGS`，干净新用户的 Settings 页面没有明确展示 QQ 绑定状态 `待绑定`。
- 产品影响：用户会把“QQ 参数未配置”和“当前账号未绑定 QQ 会话”混在一起，不符合 Settings 作为控制中心的一眼可懂要求。
- 修复内容：Settings 顶部状态和 QQ 主动助手状态统一拆成 `未配置/已配置` 与 `待绑定/已绑定` 两个维度；未配置 QQ 时也明确显示绑定仍处于 `待绑定`。
- 验证结果：重启本地 `3002` 后，`pnpm verify:dashboard-browser:empty-auth:write` 通过；随后 `pnpm verify:zero-to-one:write` 于 `2026-07-04T14:33:53.806Z` 通过。
- 仍不覆盖：真实 QQ Gateway 长连接送达、服务器 systemd 长期运行、真实 DeepSeek 长期回复质量。这三项仍按独立验收处理。

## 2026-07-04 Settings 主动提醒送达状态修复

- 发现问题：干净用户默认存在早中晚提醒规则，Settings 顶部会显示 `提醒 4/4 开启`，但此时 QQ 未配置、未绑定，真实主动消息无法送达。
- 产品影响：用户会误以为“提醒规则开启”等于“AI 可以主动发 QQ 消息”，不符合配置中心必须说明当前能力缺口的要求。
- 修复内容：Settings 将提醒状态改为送达视角：无规则显示 `未开启`；QQ 未配置显示 `待配置 QQ`；QQ 已配置但未绑定显示 `待绑定 QQ`；只有规则启用且 QQ 已配置、已绑定时才显示 `可发送`。
- 防回归：`pnpm verify:dashboard-browser:empty-auth:write` 已把 `待配置 QQ` 纳入干净用户 Settings 必需文案。
- 验证结果：`pnpm typecheck` 通过；`pnpm verify:dashboard-browser:empty-auth:write` 通过；`pnpm verify:zero-to-one:write` 于 `2026-07-04T14:50:55.491Z` 通过。

## 2026-07-04 RuntimeHeartbeat 后台进程在线状态

- 发现问题：Settings 能显示配置、最近调度事件和工具审计，但不能直接证明 Web、QQ Worker、Scheduler Worker 当前是否还活着。
- 产品影响：用户可能看到 QQ 已配置、提醒规则已开启，却不知道后台进程是否在线；这会削弱“关闭电脑后仍能主动推进”的可验证性。
- 修复内容：新增 `RuntimeHeartbeat` 表和 `lib/runtime-heartbeat.mjs`；Web Control Center、QQ Worker、Scheduler Worker 会写入最近心跳、PID、状态和简短 detail；Settings 部署状态区域显示 Web、QQ Worker、Scheduler 的在线/待确认状态。
- 防回归：`pnpm verify:deployment-config:write` 已新增 dev supervisor、runtime heartbeat helper、worker 心跳写入和 Settings 展示的静态检查；`pnpm dev` 仍要求通过 `scripts/dev-supervisor.mjs` 同时启动 Web、QQ Worker、Scheduler Worker。
- 验证结果：`pnpm db:generate` 通过；`pnpm exec prisma migrate deploy` 已应用 `20260704000600_runtime_heartbeat`；`pnpm typecheck` 通过；`pnpm verify:deployment-config:write` 通过。
- 仍不覆盖：真实服务器上的 systemd 长期运行、真实 QQ Gateway 长连接和平台主动消息送达仍需单独验收。

## 2026-07-05 Agent Prompt Snapshot 与当前推进状态

- 发现问题：Agent system prompt 已经承载秘书语气、控制闭环、权限边界等核心能力，但缺少 snapshot；后续任意改动都可能无意削弱去 AI 味、元认知、自主干预或系统事实边界。
- 修复内容：新增 `pnpm verify:agent-prompt-snapshot` 和 `docs/designs/agent-prompt-snapshot.json`，固定当前 prompt version、section、源码 hash 和关键规则短语；同时把自主干预、元认知迭代、记忆质量边界补入 prompt section。
- 防回归：`pnpm verify:zero-to-one` 已新增 `ZOF-AGENT-PROMPT-SNAPSHOT`，组合验收会阻止 Agent system prompt 发生未记录漂移。
- 验证结果：`pnpm verify:agent-prompt-snapshot:write` 通过并生成 snapshot；`pnpm verify:agent-prompt-snapshot` 通过；`pnpm verify:agent-loop:static` 通过；`pnpm typecheck` 通过。本次未重新执行完整 `pnpm verify:zero-to-one:write`，因为该组合验收依赖运行中的 Web/API 环境，后续服务器/真实 QQ 验收前应再跑一次。
- 当前完成度：本地 v0.1 主链路已经覆盖注册登录、用户隔离、干净空状态、Settings 自助配置、Agent 上下文读取、Agent 确认式控制动作、首次目标创建、Today 反馈、Logs/Goals 状态回写、Scheduler 规则和 QQ 回复入库。
- 当前未完成或未被强证据证明的 P0/P1：真实服务器 systemd 长期运行、真实 QQ Gateway 长连接和主动消息送达、真实 DeepSeek 长期自然对话质量、完整人工主观体验验收。
- 判断边界：现在可以说“本地产品闭环基本成型且有脚本证据”；不能说“生产可用”或“电脑关闭后真实长期主动推进已验证”。
