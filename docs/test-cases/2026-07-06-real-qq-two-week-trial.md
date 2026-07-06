# E2E Case: Real QQ Two-week Strong-inertia Trial

## 1. 关联需求

- Feature：`docs/features/goal-mate-v0.1/04-agent.md`
- Feature：`docs/features/goal-mate-v0.1/10-intervention-planner.md`
- Feature：`docs/features/goal-mate-v0.1/11-meta-cognition.md`
- Feature：`docs/features/goal-mate-v0.1/13-control-loop-episode.md`
- Plan：`docs/plans/2026-07-06-real-qq-two-week-trial-plan.md`

## 2. 用户路径

- 用户角色：强惰性测试用户，主要在 QQ 中回复 Agent。
- 入口页面：`/dashboard/settings`、`/dashboard/agent`、QQ 客户端。
- 目标结果：用户非常不想行动，但 Agent 通过真实 QQ 对话、主动提醒、诊断和低阻力下一步，把用户持续拉回目标推进闭环。

## 3. 前置条件

- Web/API、QQ Worker、Scheduler Worker 已启动。
- 当前测试账号可以登录 Web。
- 当前测试账号在 Settings 中配置了可用真实模型。
- 当前测试账号在 Settings 中保存 QQ Bot App ID / Token。
- QQ 客户端已能向机器人发送消息。
- 测试账号通过“绑定 GM-XXXXXX”完成 `QqChatBinding`。
- 不在文档、日志或截图中暴露模型 API Key、QQ Token、Cookie 或 Session。

## 4. 步骤与断言

| 步骤 | 操作 | 期望结果 | Playwright 建议定位 |
| --- | --- | --- | --- |
| 1 | 执行静态门禁 | `verify:static` 通过；密钥扫描不报真实泄露 | N/A |
| 2 | 在 Settings 测试模型连接 | 返回连接成功，provider/model 为本轮真实配置 | `getByText(/连接成功|模型/)` |
| 3 | 在 Settings 保存 QQ 配置 | QQ 状态显示已配置，绑定状态仍是待绑定 | `getByText(/已配置|待绑定/)` |
| 4 | 生成绑定码 | 页面出现 `GM-XXXXXX` 形式绑定码 | `getByText(/GM-/)` |
| 5 | 用户在 QQ 发“绑定 GM-XXXXXX” | QQ Worker 写入 `QqChatBinding`，QQ 回复绑定成功 | 人工 QQ 客户端 |
| 6 | 打开 Settings | 显示 QQ 已绑定，Web / QQ Worker / Scheduler Worker 最近心跳可见 | `getByText(/已绑定|QQ Worker|Scheduler/)` |
| 7 | 创建三类长期目标 | 身体、英语、项目目标进入 active/draft 可读状态 | `/dashboard/goals` |
| 8 | 强制触发 morning planning | `SchedulerEvent` created，真实 QQ 收到主动消息或记录明确失败原因 | N/A |
| 9 | 用户按 Day 1 剧本回复 QQ | 真实 `QqMessageEvent` 写入，Agent 回复不是泛鼓励 | 人工 QQ 客户端 |
| 10 | 强制触发 midday/evening/weekly | `SchedulerEvent`、`AgentMessage`、`AgentToolAction(reminder.send)` 持续写入 | N/A |
| 11 | 重复执行 14 天压缩剧本 | 每天至少一个真实 QQ 入站事件和一个系统处理结果 | N/A |
| 12 | 检查 Logs / Reviews | 至少 14 篇 day log、2 篇 week log，包含事实、偏差、下一步、System Reflection | `/dashboard/logs` |
| 13 | 检查目标状态 | DailyAction、KR、Condition 有真实状态变化，不只是聊天记录增加 | `/dashboard/goals` |
| 14 | 检查 Settings 审计 | 最近 SchedulerEvent 和 AgentToolAction 能解释主动提醒和回复处理 | `/dashboard/settings` |

## 5. 强惰性 QQ 剧本

| 模拟日 | 用户 QQ 回复 | 期望 Agent 控制行为 |
| --- | --- | --- |
| Day 1 | 不想学英语，感觉没意义，先别让我背。 | 先重审目标真实性，不继续硬推背诵。 |
| Day 2 | 太难了，今天时间不够，走路两个小时不现实。 | 降低行动仓位，保留目标，不把失败归因为人格。 |
| Day 3 | 忘了，提醒太晚，我上午已经被打断。 | 把提示提前到风险点前，不在失败后机械催。 |
| Day 4 | 做了一点，走路 12 分钟，但是项目还是没动。 | 承认部分完成，把项目缩成打开文件或写一句卡点。 |
| Day 5 | 方向不对，我不知道为什么要学这个，感觉只是应该学。 | 进入目标真实性审计，暂停无效英语任务。 |
| Day 6 | 我想先玩一会儿，项目晚点再说。 | 不讲大道理，给一个 15 分钟以内可交付动作。 |
| Day 7 | 没做，今天临时出门，反馈就这样。 | 识别低质量反馈，只追一个最小原因，不连环提问。 |
| Day 8 | 今天走了十分钟，项目还没打开。 | 保留健康有效策略，项目继续降到最小启动。 |
| Day 9 | 太累了，今天不想碰代码。 | 疲惫时不要求执行，只保留上下文不断线。 |
| Day 10 | 忘了午饭前提醒，我差点点外卖。 | 验证提示时机问题，把健康提醒前置。 |
| Day 11 | 代码我不知道从哪里改，路径可能不对。 | 先问当前动作补哪个必要条件，再安排执行。 |
| Day 12 | 做了一点，确定了今天只修一个最小问题。 | 识别路径恢复，小幅提高项目权重但不加压。 |
| Day 13 | 今天有现实意外，家里有事，别安排太多。 | 止损，不补偿、不重排整周，只保留连续性。 |
| Day 14 | 两周下来我没有变自律，但确实每天都被拉回了一点。 | 周复盘保留有效策略：小动作、少打扰、风险前置、路径校验。 |

## 6. 异常场景

- DeepSeek 或其他真实模型余额不足：模型测试失败必须返回结构化 reason，不继续伪造 live 通过。
- QQ 主动消息发送失败：`SchedulerEvent.status=failed` 且有 `errorMessage`，不静默丢失。
- 用户 QQ 消息未进入 Gateway：没有 `QqMessageEvent` 时不能算真实 QQ 验收通过。
- 用户回复“做了”但无证据：不能直接标记完整完成，应进入待确认或最小证据追问。
- 用户反感提醒：系统应降频或减少打扰，不得提高频率。
- 模型输出鸡汤、羞辱、客服腔：记录质量失败样本，不算本轮通过。

## 7. 视觉检查

- Settings 顶部能同时区分模型、QQ 配置、绑定状态、提醒送达状态和后台进程心跳。
- Agent / Logs / Goals 页面能看到压缩两周后的状态变化。
- 不需要把 QQ Token、API Key、Cookie 或完整 OpenID 展示在截图中。

## 8. 准出标准

本用例通过必须同时满足：

- 真实模型 smoke 通过。
- 真实 QQ 绑定通过。
- 至少 14 条真实 QQ 入站 `QqMessageEvent` 进入数据库。
- 至少一次 Scheduler 主动消息真实发送成功，或失败原因被清楚记录并完成用户主动 QQ 对话降级验证。
- 至少 10 次用户回复进入 `Checkin` 或明确的信息不足状态。
- 至少 6 次非完成反馈生成 `Diagnosis`，覆盖方向、难度、提示、路径中的至少 3 类。
- 至少 14 篇 day log 和 2 篇 week log 写入普通 Markdown 层级。
- 存在 `AgentToolAction.source=scheduler` 的 checkin/log/review 或 reminder 审计。
- 后半程行动明显小于前半程，且目标没有被偷偷缩水。
- 报告脱敏，不包含任何真实密钥。
