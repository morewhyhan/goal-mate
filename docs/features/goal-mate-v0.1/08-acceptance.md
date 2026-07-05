# F7 验收规格

## 1. 主链路验收

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E2E-0 | 用户首次打开产品 | 看到登录/注册入口；注册或登录后进入 Today |
| E2E-1 | 用户输入一个模糊目标 | Agent 先澄清成功标准和时间范围 |
| E2E-2 | 用户要求生成目标草稿 | 系统生成目标推理卡、KR、条件、阶段计划、今日启动行动和目标 Markdown |
| E2E-2b | 用户确认目标 | 目标成为当前主目标，推理卡变为 confirmed，并接入 Today |
| E2E-2c | 新用户自然语言说明一个足够具体的目标 | Agent 不要求用户填表 | 系统自动创建目标草案，并生成待确认激活动作 |
| E2E-3 | 用户打开 Today | 只看到一个主行动、完成标准、最小启动和反馈入口 |
| E2E-4 | 用户完成行动 | 系统更新 Checkin、KR/条件证据，并写入当日日志 |
| E2E-5 | 用户未完成行动 | Agent 诊断动机、能力、提示或路径问题 |
| E2E-6 | 用户打开 Goals | 只读看到 O、多条 KR、条件、阶段、Gantt/周期进度 |
| E2E-7 | 用户打开 Logs | 看到年/季/月/周/日文件树和 Markdown 编辑器 |
| E2E-8 | 用户打开 Agent | 看到历史记录、消息区和固定输入框 |
| E2E-9 | 用户打开 Settings | 能配置模型、提醒、日志、数据和隐私 |
| E2E-10 | Scheduler 到达主动提醒时间 | 系统生成干预 | AI 根据目标状态决定问什么、怎么提醒风险点，而不是套固定模板 |
| E2E-11 | 多次干预后有完成或失败反馈 | 系统复盘 | Meta-Cognition 更新用户模型和下一次干预策略 |
| E2E-12 | 多次控制回合连续发生 | 系统学习 | 旧元认知被使用、验证、增强、削弱、修正或过期，并形成下一次 `policy_delta` |
| E2E-13 | 旧干预被后续反馈证伪 | 系统学习 | AI 生成自我优化规则，下一次先改变自己的提问和推理顺序 |
| E2E-14 | 用户在 Settings 配置 QQ Bot | 生成绑定码并在 QQ 发送“绑定 GM-XXXXXX” | QQ 会话绑定到当前登录账号；未绑定会话不能自动读取任何用户数据 |
| E2E-15 | QQ evening_review 主动提醒后用户回复 | 用户回复“没完成，太难了” | 系统写入 Check-in、Diagnosis、Markdown 日志、daily Review、SchedulerEvent responded 和 scheduler 审计 |
| E2E-16 | 本地从零到一产品闭环 | 执行 `pnpm verify:zero-to-one` | 新用户隔离、配置边界、Agent 首次目标、Today 接入、QQ 回复入库和回复质量门禁被组合验收证明 |
| E2E-17 | 干净新用户打开 Dashboard | 执行 `pnpm verify:dashboard-browser:empty-auth` | Today、Goals、Logs、Agent、Settings 展示空状态和配置边界，不出现假任务、假目标、假日志或 demo 数据 |
| E2E-18 | 用户配置 B.AI 后 Agent 真实调用 AI | 执行 `pnpm verify:live-model-agent`，并提供真实模型 Key | 当前用户模型 Key 加密保存且不泄露；Settings 测试成功；Agent 回复来自当前用户模型配置，不是缺 key 或模型错误兜底 |
| E2E-19 | 7 天行动交换商业验证 | 执行 `pnpm verify:seven-day-action-exchange` | 系统模拟 QQ 早中晚触达、7 天低摩擦回复、每天下一承诺、正常日日志、KR 进度和 99 元/月模拟意愿信号；报告必须明确这不等于真实付费 |

## 2. AI 输出验收

| 输出 | 必测字段 |
| --- | --- |
| goal_reasoning_card | purpose_summary, success_signals, key_results, necessary_conditions, sufficient_condition_set, current_gap |
| daily_action | title, linked_condition, done_when, minimum_step, fallback_action |
| diagnosis | category, evidence, adjustment_type, next_question |
| intervention_decision | intervention_type, target_goal_id, risk_point, question_or_message, fallback_action, verification_signal |
| meta_cognition_hypothesis | hypothesis, scope, evidence, causal_explanation, decision_impact, verification_signal |
| ai_self_optimization_update | self_evaluation_result, previous_thinking_rule, reasoning_error, next_thinking_rule, avoid_next_time, verification_signal |
| review | period, progress_summary, condition_changes, next_focus |
| log_patch | target_log, markdown_content, source_context |

## 3. 页面验收

| 页面 | 准出标准 |
| --- | --- |
| Login | 用户能注册、登录；未登录不能进入 Dashboard；无假第三方入口 |
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
| T-R8 | Scheduler 主动消息 | 必须通过 Intervention Planner 或等价决策过程生成 |
| T-R9 | 核心记忆写入 | 必须有依据、因果解释、决策影响和验证方式 |
| T-R10 | Meta-Cognition 更新 | 必须能说明这次反馈如何影响下一次干预 |
| T-R11 | Today / Agent / Channel 反馈 | 必须进入同一套 ControlLoopEpisode 语义 |
| T-R12 | 元认知被 Planner 使用 | 后续反馈发生时必须评估该判断是否被支持、削弱或无法判断 |
| T-R13 | Meta-Cognition 产生 `policy_delta` | 下一次 Intervention Planner / Agent Prompt 必须能消费该策略变化 |
| T-R14 | AI 自我优化规则存在 | 下一次 Planner 必须先消费该规则，不能重复同一套无效推理 |
| T-R15 | 私有页面访问 | 未登录用户不能进入 Dashboard 私有页面 |
| T-R16 | 私有数据归属 | 业务 API 只能从 session 获取 userId，不能信任前端 userId |
| T-R17 | 模型密钥归属 | 模型 API Key 必须按当前用户保存、加密、脱敏返回，不能作为服务器全局共享密钥 |
| T-R18 | QQ 会话归属 | 陌生 QQ 会话必须通过当前用户生成的一次性绑定码绑定，不能自动归属到全局账号或第一个用户 |
| T-R19 | 首次目标输入 | 模糊目标只允许追问，不允许伪造目标；具体目标必须能生成目标草案、KR、条件、阶段、今日行动和目标 Markdown |
| T-R20 | 模型测试失败 | B.AI 余额不足、Key 无效、限流或网络错误必须显示明确原因，不能让用户看到原始错误 JSON |

## 4.1 涌现效果验收

涌现效果不能通过单次截图或单次对话验收，必须通过连续回合证明。

| 编号 | 必测链路 | 预期 |
| --- | --- | --- |
| EMG-1 | 用户连续 3 次反馈没做 | 系统不能重复同一句催促，必须改变诊断问题、行动难度、提醒时机或风险提示 |
| EMG-2 | 某次策略调整后用户完成率改善 | 元认知必须增强该假设，并说明下一次如何继续使用 |
| EMG-3 | 某次策略调整后仍无效 | 元认知必须削弱或修正该假设，不能继续盲信旧判断 |
| EMG-4 | 用户主动打卡和 Agent 对话反馈表达同一事实 | 两个入口必须产生一致的 Checkin / Diagnosis / Meta-Cognition 语义 |
| EMG-5 | Review 生成 | 必须压缩多个 ControlLoopEpisode 的有效性，而不是只总结日志文本 |
| EMG-6 | 下一次 Planner 生成干预 | 必须能说明读取了哪些活跃元认知、哪些 `policy_delta` 改变了本次干预 |
| EMG-7 | 旧元认知被证伪 | 必须生成 `AiSelfOptimizationUpdate`，说明 AI 上一次推理错误和下一次规则 |
| EMG-8 | 下一次 Planner 消费自我优化 | 必须改变问题、推理顺序或行动安排，而不是复用旧策略 |

## 4.2 行动交换与模拟付费意愿验收

行动交换不是“提醒用户打卡”。它的含义是：用户每次给系统一个最小反馈，系统必须返还一个更低摩擦、更明确、更安全的下一步承诺。

| 编号 | 必测链路 | 预期 |
| --- | --- | --- |
| PAY-1 | 用户连续 7 天用短句回复 | 每次回复长度低、语义明确，不要求长篇复盘 |
| PAY-2 | 用户回复“没做，太难/忘了/不想做/路径不对” | 系统产生不同诊断和控制策略，不能统一鼓励 |
| PAY-3 | 每天晚上复盘 | 当日日志必须写入下一承诺：什么时候、做什么、做到什么算完成、为什么更容易发生 |
| PAY-4 | 7 天结束 | 系统统计连续回复天数、可验证行动天数、决策成本降低信号和 99 元/月意愿信号 |
| PAY-5 | 生成付费判断 | 只能说“达到模拟付费意愿最低条件”，不能把本地模拟说成真实付费 |

## 5. v0.1 准出标准

```text
1. 用户能登录、注册、退出；未登录不能进入私有 Dashboard。
2. 单主目标完整链路可跑通。
3. Today、Goals、Logs、Agent、Settings 五页可用。
4. AI 关键输出结构化保存。
5. Markdown 日志可读、可编辑、可导出。
6. 模型配置和提醒配置真实可配置，模型 API Key 按用户隔离且不泄露明文。
7. 未完成时能诊断，而不是只鼓励或催促。
8. 主动提醒能体现 AI 自主干预，不是固定模板。
9. 长期记忆和复盘判断符合充分、必要、因果明确、语言清晰、可验证或可证伪的质量标准。
10. ControlLoopEpisode 和 Meta-Cognition 闭环可连续运行，能证明系统不是只记录反馈，而是在持续修正下一次干预策略。
11. AI 自我优化闭环可运行：系统能判断自己上一次干预为什么失败，并让下一次 Planner 改变推理顺序。
12. 本地从零到一产品闭环可被 `pnpm verify:zero-to-one` 一次性组合验证，且包含干净新用户页面空状态浏览器 smoke；真实 QQ Gateway 长连接、服务器 systemd 长期运行和真实模型长期质量仍按独立验收执行。
13. 真实模型链路必须由 `pnpm verify:live-model-agent` 单独证明；默认本地验收不能替代真实 B.AI Key、网络和 Agent live reply 验收。
14. 7 天行动交换闭环必须由 `pnpm verify:seven-day-action-exchange` 单独证明；该验证只能证明本地模拟的持续回复、推进证据和付费意愿条件，不能替代真实用户付费实验。
```
