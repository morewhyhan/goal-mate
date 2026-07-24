# 单一入口助手体验测试用例

关联需求：`docs/features/2026-07-24-single-entry-assistant.md`

## 1. 逻辑闭环

| ID | 场景 | 预期 |
| --- | --- | --- |
| SEA-01 | 新用户在 Agent/QQ 自然说出目标 | 不要求使用“创建目标”等命令；信息不足时只追问一个问题 |
| SEA-02 | 信息足够形成目标 | 生成 draft，并在人话预览中展示目的、成功证据、当前缺口、阶段和第一行动 |
| SEA-03 | 用户尚未确认 | 目标不能成为 current focus；Today 不能把草稿当正式行动 |
| SEA-04 | 用户确认目标 | 同一工具运行时激活目标，Today 可读取当前行动 |
| SEA-05 | 用户问“为什么做这一步” | 基于目标、当前缺口和证据解释，不暴露内部 JSON/工具名 |
| SEA-06 | 用户在 QQ 与 Web 表达同一反馈 | 进入同一 Check-in / Diagnosis / Log / ControlLoopEpisode 语义 |
| SEA-07 | 用户尚未配置模型但说“暂停提醒”或明确反馈完成情况 | 确定性控制仍可执行；不能因缺模型而把安全停止入口锁死 |

## 2. 反馈交换

| ID | 场景 | 预期 |
| --- | --- | --- |
| SEA-10 | 用户反馈完成 | 记录证据，抑制同日执行催促，返还保持或下一周期安排 |
| SEA-10A | 用户明确说“做完了 / 没做 / 今天不想做” | 将已发生事实立即写入 Check-in，不再要求二次确认 |
| SEA-11 | 用户反馈部分完成 | 记录已完成部分，返还不扩大负担的下一承诺 |
| SEA-12 | 用户反馈没做并给出原因 | 产生有证据的诊断和调整，不只显示“反馈已记录” |
| SEA-13 | 用户选择“改小” | 不得记录成 NO_RESPONSE；生成更小但不降低最终目标的行动 |
| SEA-14 | 用户说明现实情况变化 | 更新相关条件、风险或行动，说明本次具体改变 |
| SEA-15 | API 返回 4xx/5xx | 前端显示真实错误，不出现成功 toast 或伪空状态 |

## 3. 主动干预

| ID | 场景 | 预期 |
| --- | --- | --- |
| SEA-20 | 用户只绑定 QQ | 不自动获得早中晚和周复盘四条高频提醒 |
| SEA-21 | 用户明确允许 AI 主动联系 | 创建或启用建议候选窗口；用户不必逐条设置具体时间 |
| SEA-22 | 候选窗口到达且存在有价值干预 | Contact Policy 先结合当前目标、行动窗口和近期反馈返回 send，再由 Planner 生成内容 |
| SEA-23 | 今日行动已完成 | Contact Policy 返回 skip，不再发送执行催促 |
| SEA-24 | 已有未回复主动消息 | 同日不追加；返回 defer 或 skip |
| SEA-25 | 连续三次主动消息无响应 | 实际暂停主动联系，而不只是文案降低频率 |
| SEA-26 | 用户说“暂停/别提醒/停止” | 对应 ReminderRule 立即 disabled，并回复已暂停 |
| SEA-27 | 用户重新主动聊天 | 正常回答，但不自动恢复主动联系 |
| SEA-28 | 用户处于 quiet hours | 返回 defer，记录 next eligible time，并保证该候选不会被当作已经消费 |
| SEA-29 | QQ C2C 不在被动窗口 | 不复用过期 msg_id；仅在合法召回场景使用 is_wakeup |
| SEA-29A | 用户同时绑定 QQ 单聊和群聊 | 每条主动联系只发送到明确授权的具体会话；Web 开启时不得把私人提醒默认投到群聊 |

## 4. 消息体验

| ID | 场景 | 预期 |
| --- | --- | --- |
| SEA-30 | QQ 普通对话 | 与 Web 共用稳定 Agent Charter、权限、记忆和模型错误处理 |
| SEA-31 | QQ 主动消息 | 最多一个问题、一个可回复动作，不重复完整 Today 卡片 |
| SEA-32 | 用户回复主动消息 | 先确认理解，再返还下一承诺，不展示 MOTIVATION/ABILITY/PROMPT/PATH |
| SEA-33 | 模型或 QQ provider 失败 | 返回脱敏、可行动的说明，不暴露原始 JSON、token 或堆栈 |
| SEA-34 | 用户问非打卡问题 | 即使最近 18 小时有提醒，也不能强制当成 Check-in |
| SEA-35 | Web 显示工具结果 | 使用“记录反馈 / 调整任务”等人话，不显示 `checkin.submit`、`ABILITY` 或日志内部路径 |

## 5. 确定性准出

```bash
pnpm test
pnpm typecheck
pnpm verify:agent-prompt-snapshot
pnpm verify:ai-reply-quality
pnpm verify:intervention-planner
pnpm verify:scheduler-rules
pnpm verify:qq-scheduler-reply
pnpm build
```

确定性验证证明逻辑和本地运行时成立，不声明真实 QQ Gateway、平台主动消息权限或真实用户 7 天价值已通过。
