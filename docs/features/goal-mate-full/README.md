# Goal Mate 完整版需求规格

版本：v1.0  
状态：产品需求规格草案，可用于技术方案拆解  
需求类型：增量需求，全新产品  
当前事实来源：本文档目录  
历史输入：`docs/shit/shit.md`、`docs/shit/团队级 AI Coding 简明手册v0.2.pdf`

## 1. 产品定义

Goal Mate 是一个通用 AI 目标推进系统。它面向所有有自主时间、愿意投资注意力、希望持续推进长期目标的人，把模糊目标转成可验证结果、关键条件、阶段节点、每日行动，并通过提醒、诊断、复盘和工具接入持续推进。

用户不需要理解 OKR、行为模型、充分必要条件或项目管理术语。AI 在后台使用这些方法，前台表现为一个长期在线、主动、克制、有边界的目标推进秘书。

## 2. 完整版目标

完整版不只验证单目标 7 天闭环，而是要提供完整的目标推进操作系统：

```text
多目标管理
目标推理与隐式 OKR
充分必要条件倒推
阶段计划与每日行动
主动提醒与 Check-in
未完成诊断与路径调整
日/周/月/目标周期复盘
目标模板与场景化提问
对话记忆与长期用户画像
任务、项目、日历、邮箱等外部上下文接入
自部署 Agent / MCP Server
云端 App / Web / 小程序形态
权限、安全、数据导出和审计
```

## 3. 产品形态

| 形态 | 面向用户 | 核心价值 | 模块文档 |
| --- | --- | --- | --- |
| Goal Engine Core | 所有形态共用 | 目标推理、计划、诊断、复盘的核心能力 | [03-goal-engine-core.md](03-goal-engine-core.md) |
| Cloud App | 普通用户 | 打开即用、主动提醒、跨设备同步 | [10-cloud-app-and-admin.md](10-cloud-app-and-admin.md) |
| Self-hosted Agent | 程序员、隐私用户 | 数据自控、模型自配、MCP 工具接入 | [09-self-hosted-agent-mcp.md](09-self-hosted-agent-mcp.md) |
| Web Console | 两类用户共用 | 目标工作台、复盘、配置、数据导出 | [04-goal-workspace.md](04-goal-workspace.md) |

核心原则：核心引擎只有一套，部署和入口可以有多种。

## 4. 规格模块

| 编号 | 文档 | 内容 |
| --- | --- | --- |
| F0 | [01-product-scope-and-forms.md](01-product-scope-and-forms.md) | 产品边界、角色、版本能力、优先级 |
| F1 | [02-user-scenarios-and-templates.md](02-user-scenarios-and-templates.md) | 用户画像、目标场景、模板规则 |
| F2 | [03-goal-engine-core.md](03-goal-engine-core.md) | 目标推进引擎、目标推理、隐式 OKR、条件倒推 |
| F3 | [04-goal-workspace.md](04-goal-workspace.md) | 多目标工作台、目标状态、优先级、冲突管理 |
| F4 | [05-planning-and-daily-execution.md](05-planning-and-daily-execution.md) | 阶段计划、今日行动、Check-in、任务项目 |
| F5 | [06-diagnosis-review-insights.md](06-diagnosis-review-insights.md) | 未完成诊断、路径调整、复盘、洞察 |
| F6 | [07-conversation-memory-ai-output.md](07-conversation-memory-ai-output.md) | AI 对话原则、记忆、结构化输出 |
| F7 | [08-reminders-integrations-permissions.md](08-reminders-integrations-permissions.md) | 提醒、日历、邮箱、消息、权限边界 |
| F8 | [09-self-hosted-agent-mcp.md](09-self-hosted-agent-mcp.md) | 自部署 Agent、MCP Server、本地配置 |
| F9 | [10-cloud-app-and-admin.md](10-cloud-app-and-admin.md) | 云端 App、账号、同步、运营后台 |
| F10 | [11-data-model.md](11-data-model.md) | 核心数据模型、字段清单、枚举 |
| F11 | [12-acceptance-test-matrix.md](12-acceptance-test-matrix.md) | 验收场景、测试矩阵、准出规则 |

## 5. 优先级定义

完整版不再按 MVP 表达，但仍需要开发优先级：

| 优先级 | 定义 |
| --- | --- |
| P0 | 完整版主干能力。没有这些，产品不成立 |
| P1 | 完整版重要增强。没有这些，产品可用但不完整 |
| P2 | 完整版扩展能力。可在主干稳定后实现 |

## 6. P0 完整主干

P0 必须形成完整产品，不是 MVP：

```text
用户账号与用户画像
多目标创建、澄清、归档
目标场景模板
目标推理卡
隐式 OKR 与关键条件
阶段计划、周计划、今日行动
每日 Check-in
未完成诊断与路径调整
日复盘、周复盘、目标周期复盘
提醒偏好与提醒调度
对话记忆与结构化 AI 输出
基础 Web Console
基础 Cloud API
数据导出
权限与高风险动作确认
```

## 7. P1/P2 完整增强

P1：

```text
移动 App / 小程序
日历读取
邮箱摘要读取
Telegram / 企业微信 / 微信服务号提醒
任务与项目对象
目标冲突识别
行为模式洞察
自部署 Agent
MCP Server 工具接口
模型 Provider 配置
```

P2：

```text
多人协作
组织版目标管理
复杂自动执行工具链
目标模板市场
第三方知识库接入
高级统计报表
开放插件系统
```

## 8. 页面与原型入口

当前已补齐 MCP 控制台 HTML 原型：

```text
docs/designs/goal-mate-mcp-console.html
```

完整版后续仍建议补齐统一设计规则：

```text
docs/designs/goal-mate-full.html
docs/designs/design.md
```

必需页面：

| 页面 | 目的 |
| --- | --- |
| Today 今日页 | 展示今天最该推进的一件事 |
| Goals 目标页 | 管理多个目标、状态、优先级 |
| Goal Detail 目标详情 | 目标推理卡、条件、阶段、行动 |
| Chat 对话页 | 与 AI 澄清目标、诊断、复盘 |
| Reviews 复盘页 | 日/周/月/目标周期复盘 |
| Inbox 外部上下文页 | 日历、邮箱、消息、任务候选项 |
| Settings 设置页 | 模型、提醒、数据、安全、导出 |
| Self-host Console | 本地服务状态、MCP、连接器、日志 |

## 9. 总体验收标准

| 编号 | 验收标准 |
| --- | --- |
| FULL-AC-1 | 用户可同时管理多个目标，但系统必须要求选择当前主目标 |
| FULL-AC-2 | 每个目标都必须有目标推理卡、成功标准、关键条件和当前缺口 |
| FULL-AC-3 | 今日页必须能解释今天为什么只推进这件事 |
| FULL-AC-4 | 用户未完成行动时，系统必须诊断动机、能力、提示或路径问题 |
| FULL-AC-5 | 系统能生成日复盘、周复盘和目标周期复盘 |
| FULL-AC-6 | 系统可读取外部上下文，但高风险外部动作必须用户确认 |
| FULL-AC-7 | 自部署形态可本地运行，并提供 Web UI、Local API 和 MCP Server |
| FULL-AC-8 | 云端形态支持账号、同步、提醒和数据导出 |
| FULL-AC-9 | 所有 AI 关键输出必须结构化保存，可追溯版本和依据 |
