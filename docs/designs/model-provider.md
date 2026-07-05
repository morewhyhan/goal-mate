# Model Provider

## 1. 定位

Model Provider 负责让 Agent Runtime 连接真实大模型。

它不是一个前端配置展示项，而是影响以下行为的运行时依赖：

- Agent 对话回复。
- 工具意图识别。
- 目标推理。
- 复盘生成。
- 设置页模型连接测试。

## 2. 当前默认

v0.1 默认使用 B.AI。

默认配置形态：

| 字段 | 当前含义 |
| --- | --- |
| provider | B.AI |
| apiBase | `https://api.b.ai` |
| model | `gpt-5-nano` |
| temperature | 默认低温，保证目标推进回复稳定 |
| default_for | chat / reasoning / summary |

真实 API Key 只能来自安全配置或用户设置，不得写入文档、代码、日志或导出文件。

## 3. 数据模型

模型配置保存在：

```text
ModelConfig
```

关键字段：

| 字段 | 说明 |
| --- | --- |
| `provider` | 模型供应商 |
| `model` | 模型名 |
| `apiBase` | API 地址 |
| `apiKeyRef` | 密钥引用或受保护值 |
| `temperature` | 输出随机性 |
| `usage` | chat、reasoning、summary、embedding |
| `isDefault` | 是否默认使用 |

## 4. Runtime 读取顺序

Agent Runtime 应按以下顺序读取模型配置：

```text
用户默认 ModelConfig
  -> defaultB.AIModel
  -> 环境变量兜底
```

如果没有可用 API Key：

- 保存用户消息。
- 不调用模型。
- 明确告诉用户模型未配置。
- 不产生虚假的工具执行结果。

## 5. 连接测试

Settings 必须提供模型连接测试。

测试要求：

- 不泄露 API Key。
- 不把密钥写入日志。
- 返回 provider、model、是否可用、错误摘要。
- 失败时只返回短错误摘要。

## 6. 失败处理

模型调用失败时：

| 场景 | 行为 |
| --- | --- |
| API Key 缺失 | 提示去 Settings 配置模型 |
| HTTP 非 2xx | 返回状态码和短错误摘要 |
| 网络错误 | 返回连接失败说明 |
| 返回空内容 | 保存消息，但说明本次无可用回复 |
| 工具路由失败 | 尝试 conservative fallback |

失败不能修改目标、日志、设置或提醒。

## 7. 后续边界

后续可以做：

- 多 provider。
- reasoning model 专用路由。
- summary model 专用路由。
- prompt cache 命中统计。
- token 成本统计。
- 模型可用性健康检查。

当前不做：

- 自动选择未知模型。
- 用户看不到影响的模型切换。
- 在日志或导出中包含明文密钥。
