# F7 验收规格

## 1. 主链路验收

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E2E-1 | 用户输入一个模糊目标 | Agent 先澄清成功标准和时间范围 |
| E2E-2 | 用户确认目标 | 系统生成目标推理卡、KR、条件、阶段计划 |
| E2E-3 | 用户打开 Today | 只看到一个主行动、完成标准、最小启动和反馈入口 |
| E2E-4 | 用户完成行动 | 系统更新 Checkin、KR/条件证据，并写入当日日志 |
| E2E-5 | 用户未完成行动 | Agent 诊断动机、能力、提示或路径问题 |
| E2E-6 | 用户打开 Goals | 只读看到 O、多条 KR、条件、阶段、Gantt/周期进度 |
| E2E-7 | 用户打开 Logs | 看到年/季/月/周/日文件树和 Markdown 编辑器 |
| E2E-8 | 用户打开 Agent | 看到历史记录、消息区和固定输入框 |
| E2E-9 | 用户打开 Settings | 能配置模型、提醒、日志、数据和隐私 |

## 2. AI 输出验收

| 输出 | 必测字段 |
| --- | --- |
| goal_reasoning_card | purpose_summary, success_signals, key_results, necessary_conditions, sufficient_condition_set, current_gap |
| daily_action | title, linked_condition, done_when, minimum_step, fallback_action |
| diagnosis | category, evidence, adjustment_type, next_question |
| review | period, progress_summary, condition_changes, next_focus |
| log_patch | target_log, markdown_content, source_context |

## 3. 页面验收

| 页面 | 准出标准 |
| --- | --- |
| Today | 用户 3 秒内知道下一步做什么 |
| Goals | 用户能看懂目标如何从 O 拆到 KR、条件、阶段和进度 |
| Logs | 层级关系清楚，Markdown 可直接编辑 |
| Agent | 不需要滚动整个页面找输入框 |
| Settings | 每个设置项都知道开启/关闭/填写后的影响 |

## 4. 业务规则验收

| 编号 | 规则 | 预期 |
| --- | --- | --- |
| T-R1 | active goal 缺少推理卡 | 不允许进入每日推进 |
| T-R2 | DailyAction 缺少 linked_condition | 保存失败 |
| T-R3 | 用户连续 3 次未完成 | 必须触发路径层诊断 |
| T-R4 | Agent 修改目标 | 必须用户确认 |
| T-R5 | Agent 修改设置 | 必须用户确认 |
| T-R6 | 导出数据 | 不包含明文 API Key |
| T-R7 | 用户删除记忆 | Agent 后续不得继续引用 |

## 5. v0.1 准出标准

```text
1. 单主目标完整链路可跑通。
2. Today、Goals、Logs、Agent、Settings 五页可用。
3. AI 关键输出结构化保存。
4. Markdown 日志可读、可编辑、可导出。
5. 模型配置和提醒配置真实可配置。
6. 未完成时能诊断，而不是只鼓励或催促。
```
