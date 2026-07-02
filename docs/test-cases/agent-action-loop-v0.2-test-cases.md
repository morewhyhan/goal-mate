# Agent Action Loop v0.2 测试用例矩阵

## 1. 关联范围

- Plan：`docs/plans/agent-tools-and-scheduler-plan.md`
- Design：`docs/designs/agent-tool-runtime.md`
- Design：`docs/designs/scheduler-worker.md`
- Design：`docs/designs/qq-bot-integration.md`
- Page：`src/components/goal-mate/settings-view.tsx`
- Worker：`src/scripts/qq-bot-worker.mjs`
- Worker：`src/scripts/scheduler-worker.mjs`

## 2. 验收目标

证明 Agent Action Loop v0.2 不只是聊天，而是具备可追踪的目标推进闭环：

```text
对话入口
  -> 工具意图
  -> 权限确认
  -> 系统写入
  -> 审计记录
  -> 主动提醒
  -> 用户回复
  -> check-in / log / review
```

## 3. 必测能力

| ID | 能力 | 验收标准 |
| --- | --- | --- |
| AAL-1 | Agent 工具目录 | `GET /api/agent/tools` 返回 P0 工具清单 |
| AAL-2 | read 工具 | `goal.list`、`today.get` 可直接执行，不需要确认 |
| AAL-3 | execute 工具挂起 | 未确认执行 `today.set_next_action` 时创建 `pending_confirmation` |
| AAL-4 | execute 工具确认 | 确认执行后创建真实业务数据，并写入 `AgentToolAction` |
| AAL-5 | check-in 工具 | `checkin.submit` 可更新行动状态并创建 Checkin |
| AAL-6 | log 工具 | `log.write_daily` 可写入 MarkdownDocument / LogEntry |
| AAL-7 | Settings Control Center | 返回模型、提醒、QQ 绑定、工具审计、调度记录 |
| AAL-8 | 提醒规则配置 | `PUT /api/settings/reminders` 可保存早中晚和周复盘规则 |
| AAL-9 | 数据导出 | export 包含 reminderRules、toolActions、schedulerEvents、qqChatBindings |
| AAL-10 | QQ 工具确认 | QQ execute 工具必须先 pending，再由“确认执行”触发执行 |
| AAL-11 | Scheduler 回复闭环 | 最近 sent 事件收到 QQ 回复后写 check-in、log，并标记 `responded` |
| AAL-12 | 安全边界 | API Key 不以明文出现在 settings、models、export 响应中 |

## 4. 自动化验证入口

脚本：

```bash
pnpm verify:agent-loop
pnpm verify:agent-loop:write
```

前置条件：

| 条件 | 说明 |
| --- | --- |
| 服务 | Next.js / Hono API 正在运行 |
| Cookie | `GOAL_MATE_COOKIE` 指向已登录用户 |
| 数据 | 已 seed 或已有目标、今日行动和默认模型 |
| Prisma | 已执行 `pnpm db:generate` |

默认 `verify:agent-loop` 只做读取和契约检查。

`verify:agent-loop:write` 会执行写入型验证，包括工具挂起、确认执行、check-in、log 和提醒保存。

## 5. 人工验收

| 场景 | 操作 | 期望 |
| --- | --- | --- |
| Web Agent 工具 | 在 Agent 页面要求“查看我的目标” | 返回目标摘要，不要求确认 |
| Web Agent 写操作 | 在 Agent 页面要求“把今天下一步改成走路 20 分钟” | 先出现待确认，确认后执行 |
| QQ 工具确认 | 在 QQ 要求“帮我记录今天没完成，原因是太难” | 先待确认，回复“确认执行”后写入 |
| Scheduler 回复 | Scheduler 发晚上复盘后，QQ 回复“今天没做，太难” | 写入 check-in 和今日日志 |
| Settings | 打开 Settings | 一眼看到模型、提醒、QQ、工具审计、调度记录 |

## 6. 当前未覆盖

- 不验证真实 QQ Gateway 网络连接。
- 不验证服务器长期 systemd / pm2 守护。
- 不验证 DeepSeek 真实模型质量，只验证接口和数据闭环。
- 不验证浏览器视觉细节。

