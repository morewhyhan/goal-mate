# F3 Agent 规格

## 1. 模块定位

Agent 是用户和系统沟通的主要入口。它不是只聊天，也不是替用户自动推进一切；它负责理解目标、追问关键问题、生成结构化计划、诊断未完成原因，并帮助用户控制 Goal Mate。

## 2. Agent 必须知道什么

Agent 可以读取当前用户授权范围内的：

| 上下文 | 用途 |
| --- | --- |
| Goals | 理解当前目标、KR、条件、阶段和进度 |
| Logs | 理解日/周/月/年推进记录 |
| Today | 理解今天行动和反馈 |
| Settings | 理解提醒、模型、日志、隐私配置 |
| Conversation History | 保持同一主题的连续性 |

## 3. 对话能力

| 能力 | 示例 |
| --- | --- |
| 目标澄清 | “如果 30 天后这个目标真的推进了，最明显变化是什么？” |
| 条件倒推 | “要达成这个目的，至少需要补齐这些条件。” |
| 生成 KR | “能证明你推进成功的结果有这几条。” |
| 今日行动 | “今天只做这一步，因为它补齐当前缺口。” |
| 未完成诊断 | “这更像动作太大，还是提醒不合适？” |
| 路径调整 | “连续三天没做，可能不是时间问题，而是目标吸引力不足。” |
| 复盘生成 | “这周真正补齐的是学习节奏，而不是英语能力本身。” |
| 系统控制 | “把提醒改到晚上 8:30，并把日志写入本周周志。” |

## 4. 输出规则

Agent 重要输出必须能结构化保存。

| 输出类型 | 必须字段 |
| --- | --- |
| goal_reasoning_card | purpose_summary, success_signals, key_results, necessary_conditions, current_gap |
| daily_action | title, linked_condition, done_when, minimum_step, fallback_action |
| diagnosis | category, evidence, adjustment_type, next_question |
| review | progress_summary, condition_changes, blocker_summary, next_focus |
| setting_change_draft | setting_key, old_value, new_value, requires_confirmation |
| log_patch | target_log, markdown_content, source_context |

## 5. 确认边界

| 操作 | 是否需要用户确认 |
| --- | --- |
| 生成建议 | 否 |
| 保存普通日志 | 可按设置自动保存 |
| 修改目标推理卡 | 是 |
| 切换主目标 | 是 |
| 修改提醒策略 | 是 |
| 删除日志或目标 | 必须强确认 |
| 调用外部工具执行动作 | 必须强确认 |

## 6. 界面要求

| 区域 | 要求 |
| --- | --- |
| 左侧历史 | 显示最近对话，支持按目标或日期区分 |
| 中间消息 | 专业对话区，不用玩具式气泡堆装饰 |
| 底部输入 | 固定可见，支持普通输入和快捷上下文引用 |
| 滚动 | 只允许消息区滚动，不能整个页面滚动找输入框 |

## 7. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F3-1 | 用户问“这个目标为什么这样拆” | Agent 回答 | 能基于目标推理卡和日志解释 |
| AC-F3-2 | 用户说“今天没做” | Agent 回答 | 必须进入诊断，而不是简单鼓励 |
| AC-F3-3 | Agent 建议改提醒 | 用户未确认 | 设置不得被实际修改 |
| AC-F3-4 | 用户打开 Agent | 页面加载 | 输入框固定可见，历史记录存在 |
