# F6 对话、记忆与 AI 输出规格

## 1. 模块定位

本模块定义 AI 对话风格、上下文记忆、结构化输出和可追溯要求。Goal Mate 可以像聊天，但不能只是聊天机器人。

## 2. 对话原则

| 编号 | 原则 |
| --- | --- |
| C1 | 一次只推进一个关键点 |
| C2 | 不教育用户术语 |
| C3 | 不把失败归因于意志力 |
| C4 | 必须敢于做取舍 |
| C5 | 每次输出尽量落到一个可行动结果 |
| C6 | 重要推理必须表达为“当前判断” |
| C7 | 关键建议必须说明依据 |
| C8 | 高风险目标必须提示边界 |

## 3. 记忆类型

| 类型 | 说明 | 保存周期 |
| --- | --- | --- |
| User Profile | 用户偏好、沟通风格、提醒偏好 | 长期 |
| Goal Memory | 目标、条件、计划、复盘 | 长期 |
| Behavior Pattern | 常见阻塞、有效提醒时间、行动难度偏好 | 长期，可撤销 |
| Conversation Summary | 对话摘要和结构化事实 | 中长期 |
| Ephemeral Context | 当前会话临时上下文 | 会话内 |

## 4. 结构化输出要求

AI 对以下动作必须输出 JSON 或等价结构化对象：

```text
目标澄清问题
目标推理卡
条件列表
阶段计划
今日行动
Check-in 提示
诊断问题
调整建议
复盘
外部工具动作草稿
```

## 5. 字段清单

### 5.1 ai_interaction

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 交互 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| goal_id | string | 否 | 空 | 关联目标 |
| interaction_type | enum | 是 | chat | chat, reasoning, planning, diagnosis, review, tool_draft |
| input_summary | string | 是 | 无 | 输入摘要 |
| output_text | string | 是 | 无 | 前台自然语言输出 |
| structured_output | object | 否 | {} | 结构化输出 |
| schema_name | string | 否 | 空 | 使用的 schema |
| schema_valid | boolean | 是 | false | 是否校验通过 |
| model_provider | string | 否 | 空 | 模型提供商 |
| created_at | datetime | 是 | 当前时间 | 创建时间 |

### 5.2 memory_item

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 记忆 ID |
| user_id | string | 是 | 当前用户 | 用户 ID |
| goal_id | string | 否 | 空 | 可关联目标 |
| memory_type | enum | 是 | goal | user_profile, goal, behavior_pattern, conversation_summary |
| content | string | 是 | 无 | 记忆内容 |
| evidence_refs | string[] | 否 | [] | 来源引用 |
| confidence_score | number | 是 | 0.6 | 置信度 |
| user_editable | boolean | 是 | true | 用户是否可编辑 |
| status | enum | 是 | active | active, archived, deleted |

## 6. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F6-R1 | 关键 AI 输出必须同时保存自然语言和结构化结果 | P0 |
| F6-R2 | schema_valid 为 false 的结构化结果不得驱动业务状态变更 | P0 |
| F6-R3 | 用户可以查看、编辑、删除长期记忆 | P0 |
| F6-R4 | AI 不得伪造外部上下文来源 | P0 |
| F6-R5 | 行为模式记忆必须带 evidence_refs | P0 |
| F6-R6 | 用户删除记忆后，后续 AI 不得继续引用 | P0 |
| F6-R7 | Power User 可配置 prompt 模板和模型 Provider | P1 |

## 7. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F6-1 | AI 生成计划 | 系统保存 | ai_interaction 包含 structured_output 且 schema_valid 为 true |
| AC-F6-2 | 结构化输出校验失败 | 系统处理 | 不更新计划状态，并要求重试 |
| AC-F6-3 | 用户删除行为记忆 | 后续对话 | AI 不再引用该记忆 |
| AC-F6-4 | AI 提到外部日历事件 | 查看依据 | 能看到来源引用 |

