# Plan: QQ 对话体验、提示词统一与发布准备

## 1. 输入上下文

- Feature：`docs/features/goal-mate-v0.1/04-agent.md`
- Feature：`docs/features/goal-mate-v0.1/06-settings.md`
- Feature：`docs/features/goal-mate-v0.1/10-intervention-planner.md`
- Feature：`docs/features/goal-mate-v0.1/11-meta-cognition.md`
- Feature：`docs/features/goal-mate-v0.1/13-control-loop-episode.md`
- Feature：`docs/features/goal-mate-v0.1/15-behavior-factor-model.md`
- Feature：`docs/features/2026-07-24-single-entry-assistant.md`
- Designs：`docs/designs/agent-prompt-system.md`
- Designs：`docs/designs/agent-runtime.md`
- Designs：`docs/designs/qq-bot-integration.md`
- Designs：`docs/designs/scheduler-worker.md`
- Designs：`docs/designs/runtime-observability.md`
- Designs：`docs/designs/privacy-and-permissions.md`
- Standards：`docs/standards/security.md`
- Standards：`docs/standards/testing.md`
- Standards：`docs/standards/architecture.md`
- Standards：`docs/standards/coding.md`
- Test Cases：`docs/test-cases/2026-07-06-real-qq-two-week-trial.md`
- Test Cases：`docs/test-cases/2026-07-24-single-entry-assistant-experience.md`
- Verification：`docs/plans/dynamic-deepseek-qq-trial-last-run.md`
- Verification：`docs/plans/verification-overview.md`
- External：QQ 机器人官方“发送消息”文档，2026-06-23 更新，`https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html`
- External：OpenAI 官方 Prompt Engineering，`https://developers.openai.com/api/docs/guides/prompt-engineering`
- External：Google Conversation Design - Notifications / Errors / Turn-taking，`https://developers.google.com/assistant/conversation-design/notifications`、`https://developers.google.com/assistant/conversation-design/errors`、`https://developers.google.com/assistant/conversation-design/learn-about-conversation`

## 2. 审计结论

### 2.1 当前产品阶段

当前 v0.1 已具备 Web、Agent、QQ Worker、Scheduler Worker、目标控制闭环和大量本地验证资产，但仍存在四类发布阻塞：

1. 认证密钥和密码重置日志存在安全缺口。
2. 最新动态 DeepSeek QQ-like 试运行总体为 FAIL，分类器改动后没有稳定回归测试和当前 HEAD 复验。
3. 没有标准单元测试入口和 CI，验证主要依赖手工运行的定制脚本。
4. 真实 QQ / systemd 长期运行未验收，且当前 C2C 主动提醒设计与 QQ 官方平台限制冲突。

### 2.2 当前 QQ 对话实际上是三套人格

| 路径 | 当前实现 | 主要问题 |
| --- | --- | --- |
| 用户主动发 QQ 消息 | `qq-bot-worker.mjs` 内独立短 system prompt 和独立模型调用 | 没有复用 Web Agent v0.8 prompt；没有完整权限、Memory、Meta-Cognition、统一错误处理 |
| Scheduler 主动消息 | `Intervention Planner` 生成 `question_or_message`，再由 `formatScheduledMessage` 追加固定话术 | Planner 已问一个问题后，外层又追加问题；可能暴露“动机/能力/提醒/路径”内部标签；消息过长、重复 |
| 用户回复 Scheduler | Regex 分类 + `buildSecretarySchedulerReply` 固定文本 | 能稳定落库，但长期重复会机械；无法使用本轮上下文生成自然、连续的答复 |

附加事实：

- `qq-bot-worker.mjs` 仍保留一整套未使用的旧 Scheduler 分类/回复函数，和 `lib/qq-scheduler-reply.mjs` 重复。
- 普通 QQ 对话会直接读取 Goal 和 Markdown，没有复用 Web Agent 的 Settings 读取权限判断。
- QQ 模型失败会把 provider 原始响应摘要直接发给用户，没有复用共享的安全错误分类。
- `defaultReminderRules` 默认启用早、中、晚、周复盘四条 QQ 规则；`defaultUserSettings.notifications` 却声明默认 channel 为 Web、每日最多 2 次，事实不一致。
- Planner 文档宣称决定“今天要不要问”，但当前输出没有 `send / skip / defer`；Scheduler 到点后一定尝试发送。
- 连续无回复时，Planner 只改变文案，没有真正降频、暂停或延期。
- Scheduler 会复用最近 QQ `msg_id`，但没有判断是否仍在官方被动回复窗口，也没有使用 C2C `is_wakeup` 互动召回语义。

### 2.3 QQ 官方平台硬约束

当前官方文档表明：

- C2C 被动回复依赖用户先发消息，回复有效窗口为 60 分钟；更新说明要求按更保守的频次设计。
- C2C 普通主动消息按用户有很低的月度额度，不能支撑每天早中晚三次触达。
- 用户主动对话后存在当天、1-3 天、3-7 天、7-30 天四个互动召回周期，需使用 `is_wakeup`。
- 用户可以在 QQ 客户端关闭主动消息；关闭后发送必然失败。
- 群场景在群主显式开启机器人主动发言后，才适合承载更高频的主动推进。

因此产品必须区分：

```text
C2C = 用户主动对话 + 稀疏互动召回
QQ群 = 用户明确开启后的日常主动推进候选通道
Web = 每日状态与无法通过 QQ 送达时的事实兜底
```

不能继续把 C2C 描述为默认每天早中晚主动提醒通道。

## 3. 本轮目标

### 3.1 发布准备

- 生产环境必须要求独立的 `BETTER_AUTH_SECRET`，Settings 部署检查和 `.env.example` 都能识别缺失。
- 不再把密码重置 URL、验证 URL、token 或 provider 原始敏感响应写入日志或发给 QQ 用户。
- 为关键纯逻辑模块增加标准 `node --test` 单元测试入口。
- 增加本地 GitHub Actions CI 配置，至少覆盖静态门禁、单元测试、类型检查和生产构建。
- 当前状态文档只保留一套清晰结论，区分“当前 HEAD 已验证”“历史通过”“仍需真实外部环境”。

### 3.2 QQ 对话体验

- 先由 Contact Policy 判断“这次要不要说”，再由 Intervention Planner 判断“为什么说、说什么”，最后由 Prompt Renderer 决定“怎么说”。
- Web 与 QQ 共用同一份 Agent 身份、权限、记忆质量、控制闭环和模型失败处理；QQ 只增加通道长度和轮次约束。
- 用户主动发消息、主动召回、Scheduler 反馈、工具确认、绑定欢迎必须有明确的 turn type，不能互相误判。
- 默认不在用户仅完成 QQ 绑定后自动开启四类主动提醒；主动触达必须经过用户明确选择。
- 同一条 QQ 消息最多推进一个关键点、最多一个问号，并明确把发言权交给用户。
- 用户完成今日行动后，抑制当天后续执行催促；用户连续无响应或明确反感时，实际降频或暂停，而不是只改话术。
- 每次主动联系都能说明具体交换价值：用户给最小反馈，系统返还更小、更准或更安全的下一步。

### 3.3 可验证结果

- 动态试验中的分类覆盖不再依赖随机模型碰巧生成某类句子；四类诊断由确定性 fixtures 必须全部通过。
- Prompt 变更具备版本、snapshot、代表性对话 fixtures 和质量门禁。
- 本地验证能证明 C2C 被动窗口、互动召回、群主动模式、用户 opt-in、quiet hours、每日上限、完成后抑制和无响应降频。
- 真实 QQ / systemd 验收仍使用人工真实事件，不把模拟入站冒充真实证据。

## 4. 非目标

- 本轮不伪造真实 QQ Gateway、主动消息额度或服务器 systemd 已通过。
- 未取得服务器、QQ 开放平台权限和人工 QQ 客户端配合前，不执行真实生产部署。
- 未得到单独确认前，不运行会产生模型费用的 14 轮 live DeepSeek / B.AI 试验。
- 不引入新的前端框架、后端框架、数据库或进程管理器。
- 不做 QQ 图片、语音、文件、卡片消息。
- 不把 Prompt 写成一个包办触发、决策、表达和数据库更新的超长字符串。

## 5. 目标用户体验

### 5.1 对话生命周期

| Turn Type | 什么时候发生 | 是否说话 | 用户体验目标 |
| --- | --- | --- | --- |
| `binding_welcome` | 绑定码成功一次 | 是，一次 | 告知已经绑定；说明主动触达需要用户选择；不承诺早中晚都会发 |
| `user_initiated` | 用户主动发 QQ | 是 | 先回应这句话的真实意图；必要时只追一个问题；不把所有聊天强行变成打卡 |
| `tool_confirmation` | 用户确认待执行动作 | 是 | 精确说明执行了什么、结果是什么；高风险动作继续遵守确认边界 |
| `scheduled_candidate` | ReminderRule 到达候选窗口 | 由 Contact Policy 决定 | 只有用户 opt-in、平台允许、当前确有价值且未被抑制时才发送 |
| `scheduler_feedback` | 用户回复最近一条有效主动消息 | 是 | 先确认系统如何理解反馈，再返还新的下一承诺；不展示内部分类标签 |
| `c2c_wakeup` | 符合 QQ 互动召回周期 | 可能发送一次 | 说明回来能得到什么；提供“暂停提醒”低摩擦出口 |
| `no_response_repair` | 连续无响应 | 最多两级 | 第一次换一种更短问法；第二次给选项；再无响应就暂停，不继续追 |
| `system_failure` | 模型、QQ 或数据库失败 | 仅一次必要说明 | 透明、简短、有下一步；不泄露 provider JSON、token 或堆栈 |

### 5.2 主动触达规则

```text
ReminderRule 到点
  -> 检查用户是否显式 opt-in
  -> 检查通道类型与 QQ 平台能力
  -> 检查 quiet hours / 产品总上限 / 平台周期额度
  -> 检查今日是否已完成、是否刚对话、是否已有未回复消息
  -> 检查连续无响应和用户反感信号
  -> Contact Policy: send / skip / defer
  -> 若 send，再由 Intervention Planner 生成决策
  -> QQ Prompt Renderer 输出一条消息
  -> 质量门禁
  -> 发送并审计
```

Contact Policy 最小输出：

```json
{
  "delivery_action": "send | skip | defer",
  "reason_code": "user_opt_out | quiet_hours | already_done | awaiting_reply | platform_quota | no_response_pause | useful_intervention",
  "channel_mode": "c2c_passive | c2c_wakeup | group_active | web",
  "next_eligible_at": "ISO-8601 or null",
  "consent_source": "settings | conversation | none"
}
```

### 5.3 无响应与反感阶梯

| 状态 | 行为 |
| --- | --- |
| 第一次没回复 | 不在同一天追加催促；等下一个有价值窗口 |
| 第二次没回复 | 只发一个更低摩擦问题，给 2-3 个可直接回复的选项 |
| 第三次仍没回复 | 暂停该目标主动触达，留下恢复入口 |
| 用户说“别提醒/烦/暂停” | 立即暂停对应 ReminderRule，不再只把它分类成 MOTIVATION |
| 用户重新主动发消息 | 恢复普通对话；是否恢复主动触达必须单独确认 |

### 5.4 完成后的行为

- 用户反馈完成后，不继续发送当天 Midday / Evening 执行催促。
- Evening 可以只在用户明确订阅复盘时发送；否则把完成事实留在 Web/Logs。
- 不因为一次完成立即加码；先验证能否稳定重复。

## 6. Prompt 系统方案

### 6.1 分层

```text
Stable Agent Charter
  身份、真实性、权限、记忆质量、控制闭环

Channel Contract
  Web / QQ C2C / QQ Group 的长度、格式、平台和轮次边界

Turn Contract
  user_initiated / scheduled_candidate / scheduler_feedback / confirmation / failure

Runtime Context
  Goal、Today、Logs、Memory、Meta-Cognition、最近主动消息、用户设置、平台额度

Examples
  代表性正反例，覆盖完成、没做、敷衍、反感、沉默、转移话题、模型失败

Output Quality Gate
  一个问题、一个 CTA、不暴露标签、不重复、不虚构执行、不泄密
```

### 6.2 QQ 表达契约

- 用户主动对话：通常 1-4 句；先回答当前话，再决定是否推进目标。
- 主动消息：优先 60-120 个汉字；只包含一个可回复动作。
- 最多一个问号；问完就停，不在问号后继续解释。
- 不出现 `MOTIVATION / ABILITY / PROMPT / PATH` 或“动机、能力、提示、路径问题”问卷腔。
- 不重复 Today 卡片里已经明确的标题、完成标准、最小启动和 fallback；只取本轮必要信息。
- 高频 turn 使用少量有条件的表达变体，避免固定回复长期重复，但不能靠随机改变事实。
- Prompt 的动态上下文是数据，不是更高优先级指令。

### 6.3 工程边界

- 生产 Prompt 继续放在代码里，使用 typed/schema context、版本、snapshot 和测试。
- 普通 QQ 回复必须复用共享 Prompt Builder 与共享运行时上下文加载逻辑。
- `qq-bot-worker.mjs` 只负责 QQ 事件解析、绑定、消息发送和通道审计，不再维护独立人格 Prompt。
- Scheduler 不再用 `formatScheduledMessage` 追加第二套问题；Renderer 直接消费结构化干预决策和必要行动字段。
- Scheduler feedback 可以保留确定性落库，但用户可见回复由共享 turn renderer 生成；模型不可用时使用经过 fixture 验证的简短 fallback 变体。
- 删除 QQ Worker 内未使用的旧 Scheduler 分类/回复代码。

## 7. 影响范围

- 代码：
  - `src/lib/auth.ts`
  - `src/lib/agent-prompts/index.ts` 或拆出的 shared `.mjs` prompt builder
  - `src/lib/agent-runtime.ts`
  - `src/lib/intervention-policy.mjs`
  - `src/lib/intervention-planner.mjs`
  - `src/lib/qq-scheduler-reply.mjs`
  - 新增 `src/lib/qq-contact-policy.mjs`
  - 新增 `src/lib/qq-message-renderer.mjs`
  - `src/scripts/qq-bot-worker.mjs`
  - `src/scripts/scheduler-worker.mjs`
  - `src/server/api/routes/settings/index.ts`
  - `src/components/goal-mate/settings-view.tsx`
  - `src/scripts/verify-deployment-config.mjs`
  - 相关 verification scripts
- 数据库：优先复用 `ReminderRule.enabled/metadata`、`SchedulerEvent.payload/status` 和 `QqMessageEvent.payload`，预计不新增迁移；如实现时发现无法可靠记录 consent/平台周期额度，再单独提交 schema 变更说明。
- API：保持现有 Settings 路由，必要时扩展提醒规则返回的 channel capability / consent 状态；若契约变化必须同步 `docs/designs/openapi.yaml` 和 `api-contract.md`。
- 前端：Settings 明确展示 C2C、群、Web 三种触达能力；默认规则显示为建议但未启用；用户能暂停/恢复主动触达。
- 文档：更新 Agent、Settings、Intervention Planner、Prompt System、QQ Integration、Scheduler、Verification Strategy 和 README 当前状态。
- CI：新增 `.github/workflows/ci.yml`，不执行真实外部 QQ 或付费模型调用。

## 8. 任务拆分

| 状态 | 任务 | 验收方式 |
| --- | --- | --- |
| Done | 审计当前认证、Prompt、QQ Worker、Scheduler、Planner、Settings 和验证记录 | 本 Plan 记录事实与文件位置 |
| Done | 核对 QQ 官方主动/被动消息与互动召回限制 | 官方文档链接和本 Plan 2.3 |
| Done | 从用户体验定义 turn type、主动触达和无响应阶梯 | 本 Plan 第 5 节 |
| Done | 先补 QQ / 单一入口对话体验测试用例规格 | 新增 `docs/test-cases/2026-07-24-single-entry-assistant-experience.md` |
| Done | 修复 Better Auth secret 和重置链接日志安全 | 生产缺 secret 时明确失败；日志不含 reset URL/token |
| Done | 增加标准 `pnpm test` 与分类器/Contact Policy/Renderer fixtures | `pnpm test` 覆盖 consent、暂停、完成抑制、无响应、上下文授权、反馈和人话渲染 |
| Done | 增加 CI | `.github/workflows/ci.yml` 固化 test、typecheck、build 和静态门禁 |
| Done | 实现 QQ Contact Policy | opt-in、quiet hours、完成抑制、awaiting reply、平台额度、无响应暂停和干预价值测试 |
| Done | 将 QQ 普通对话接入共享 Agent Prompt / Settings 权限 / 安全错误处理 | Web / QQ 共用 `agent-runtime-shared.mjs`、跨渠道记忆和错误分类 |
| Done | 重做 Scheduler 消息渲染，删除重复问题与标签问卷 | 每条消息最多一个问题；不显示内部诊断标签 |
| Done | 重做 Scheduler feedback 用户可见回复并移除 Worker 死代码 | 回复与真实 Check-in / nextCommitment 结果关联 |
| Done | 默认主动提醒改为显式 opt-in，并在 Settings 展示真实 QQ 通道能力 | 绑定不等于 consent；全局授权、节奏和具体 QQ context 可见 |
| Done | 区分 C2C passive、C2C wakeup、group active 的消息参数 | 纯策略测试验证 `msg_id` / `is_wakeup` 与场景匹配 |
| Done | 更新 prompt version、snapshot、设计事实和 README | Prompt、设计事实和 README 收束到单入口、价值门禁和外部验收边界 |
| Done | 复跑当前 HEAD 本地确定性链路 | static、test、typecheck、build、Prompt、Planner 和质量门禁 PASS |
| Optional | 经用户单独确认后执行 live model 对话评测 | 脱敏报告；不把随机类别覆盖作为唯一硬门禁 |
| External | 有真实 QQ/服务器条件后执行人工 Gateway + systemd 验收 | 真实 QqMessageEvent、SchedulerEvent、systemd 日志和脱敏报告 |

## 9. 测试策略

### 9.1 单元测试

使用 Node 内置 test runner，避免为纯逻辑测试新增测试框架依赖：

- `classifyQqSchedulerReply`：完成、部分完成、没做、沉默；MOTIVATION / ABILITY / PROMPT / PATH / UNKNOWN。
- Contact Policy：opt-out、quiet hours、已完成、等待回复、C2C quota、wakeup 周期、群主动模式、三次无响应暂停。
- Message Renderer：最多一个问号、没有内部标签、没有重复行动信息、字符预算、模型失败脱敏。
- Prompt Builder：Web / QQ 共享稳定 charter；turn contract 与 runtime context 分层；用户数据不能覆盖系统规则。

### 9.2 API / 运行时测试

- Settings 默认提醒未启用，保存后才能进入主动触达候选。
- 当前用户权限关闭 Goals / Logs / Memory 后，QQ Prompt 不再读取对应内容。
- 两个用户的模型、QQ token、提醒规则、会话和日志保持隔离。
- Scheduler skip / defer 也写入可审计原因，但不创建虚假发送成功记录。
- QQ provider / 平台失败返回用户可理解的脱敏信息。

### 9.3 E2E

- 绑定成功后只发一次欢迎，不自动开启四条规则。
- 用户在 Settings 选择触达模式后，顶部状态清楚区分 C2C、群、Web 能力。
- 用户完成今日行动后，不再收到同日催执行消息。
- 用户连续无响应后，系统真实暂停，不只是文案说“少打扰”。
- 用户说“别提醒”后规则立即暂停，主动发消息需要再次确认。

### 9.4 准出命令

```bash
pnpm verify:secrets
pnpm verify:deployment-config
pnpm test
pnpm typecheck
pnpm verify:agent-prompt-snapshot
pnpm verify:ai-reply-quality
pnpm verify:agent-loop:static
pnpm verify:intervention-planner
pnpm verify:scheduler-rules
pnpm verify:qq-scheduler-reply
pnpm build
```

需要 Web/数据库写入的组合验收按现有 runbook 执行，不 reset 用户当前数据库。

## 10. 风险与回滚

- 风险：把四条默认提醒改为 opt-in 后，旧用户会感觉主动性下降。
  - 回滚：保留已有用户明确保存的 enabled 规则；只对从未确认过的 `settings_default/scheduler_default` 规则迁移为 disabled，并在 Settings 给出推荐预设。
- 风险：QQ 官方文档不同更新时间的频次描述存在细节差异。
  - 回滚：按更保守额度实现；平台返回超频时记录结构化 reason，并自动 defer，不重试轰炸。
- 风险：共享 Web/QQ Prompt Runtime 涉及较多旧代码。
  - 回滚：先抽共享 builder/context，再逐路径切换；保留现有 deterministic fallback，任何一步不通过均可切回上一 prompt version。
- 风险：模型化 Scheduler feedback 增加不确定性。
  - 回滚：业务落库继续确定性执行；模型只渲染用户可见文本，质量门禁失败即使用经过测试的 fallback。
- 风险：生产强制 secret 会让未配置环境无法 build/start。
  - 回滚：开发/测试使用明确的非生产测试 secret；生产继续 fail closed，不恢复默认 secret。
- 风险：真实 QQ / systemd 依赖外部权限，当前轮次不能独立证明。
  - 回滚：保持状态为 External，不用模拟报告替代真实证据。

## 11. 准出标准

本轮实现完成必须同时满足：

- 认证不再使用生产默认 secret，重置/验证 URL 不进入日志。
- Git 工作区只包含本 Plan 明确范围内的变更。
- 标准单元测试、静态门禁、类型检查、构建和 Prompt snapshot 全部通过。
- 普通 QQ 对话与 Web Agent 共用身份、权限、记忆质量和错误处理。
- Scheduler 具备真实 send / skip / defer 决策，不再“到点必发”。
- C2C 不再默认每天早中晚主动消息；绑定不等于主动触达 consent。
- 连续无响应和“别提醒”会改变实际调度状态。
- 主动消息最多一个问题、一个 CTA，不暴露内部诊断标签。
- 当前 HEAD 的本地验证结果被写入新的 last-run/overview；历史记录不再冒充当前事实。
- 真实 QQ / 服务器未执行时，文档继续明确标记为未验证。

## 12. 执行记录

- 2026-07-20：完成只读项目体检；当前 HEAD 静态门禁、typecheck、build、Agent static contract、AI reply quality 和 prompt snapshot 通过。
- 2026-07-20：发现当前本地 build 使用 Better Auth 默认 secret，`.env.example` 未声明 `BETTER_AUTH_SECRET`，认证回调会把重置 URL 输出到日志。
- 2026-07-20：完成 QQ 三条对话路径审计，确认普通 QQ、Scheduler 主动消息和 Scheduler feedback 未共享同一 Prompt/turn policy。
- 2026-07-20：核对 QQ 官方文档，确认 C2C 每日早中晚主动推送不符合当前平台能力边界，必须改为用户主动对话、稀疏互动召回或显式启用的群主动模式。
- 2026-07-20：本 Plan 已创建，等待人类确认后进入实现。
- 2026-07-24：用户确认进入实现，并将北极星收束为“单一对话入口管理目的、行动、反馈和动态调整；AI 在总授权下自主选择有价值的干预时机”。
- 2026-07-24：完成单一逻辑入口。Web 与 QQ 共用 Agent runtime、Prompt、权限、记忆和工具执行；Dashboard 默认进入 Agent，Today / Goals / Logs / Settings 作为状态与控制台，不再要求用户理解内部组织方式。
- 2026-07-24：完成反馈闭环。显式完成、部分完成和未完成反馈无需二次确认；同一事务会记录 Check-in、诊断与证据，并持久化下一承诺。部分完成或未完成会缩小动作；提示时机反馈只会保守调整已有、已启用且已授权的 QQ 规则，不会自动开通或提高频率。
- 2026-07-24：完成主动干预闭环。绑定不等于授权；用户总授权后，ReminderRule 只产生候选窗口，Contact Policy 会按当前主目标、当前行动、行动窗口、近期反馈、完成状态、静默时段、联系节奏、QQ context 授权和平台额度决定 `send / skip / defer`。延期事件到期后复用同一事件重新执行完整策略。
- 2026-07-24：完成暂停与隐私边界。用户说“暂停提醒/别催”会立即撤销全局主动联系授权并停用规则；恢复需要重新确认。Scheduler 不再回退到“最近一个 QQ 绑定”，只能投递到明确授权的 C2C context。
- 2026-07-24：当前 HEAD 本地确定性验证通过：`node --test lib/*.test.mjs test/*.test.mjs` 53/53；`pnpm verify:agent-loop:static` 全部 PASS；`pnpm typecheck` PASS；`pnpm build` PASS；Prompt snapshot `goal-mate-agent-system-v0.9.1` / hash `4986380659ed17ea1300532213e5950a4976a5d1de0bb94ea64fd1411d8b727c` PASS；AI reply quality、secretary dialogue quality、Intervention Planner、secret hygiene（0 findings）、deployment config 均 PASS。
- 2026-07-24：未运行真实 QQ Gateway、真实主动消息额度、付费模型对话或服务器 systemd 长期运行；这些仍属于 External 验收，不能由本地 fixture 冒充。
