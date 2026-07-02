# Goal Mate Markdown Document Store

## 1. 定位

Goal Mate 的最终产物是一套 Markdown 文档，而不是传统 Todo 数据。

这些 Markdown 不要求先存在于硬盘文件系统中。v0.1 的实现方式是：

```text
数据库保存 Markdown 文件的路径、标题、正文、元数据和引用关系。
界面和 Agent 把它当成一套可编辑、可检索、可导出的 MD 文件系统。
```

## 2. 核心表

### MarkdownDocument

表示一个数据库里的 `.md` 文件。

必要字段：

| 字段 | 含义 |
| --- | --- |
| `path` | 文件路径，例如 `logs/2026/Q3/2026-07/W27/2026-07-01.md` |
| `title` | 文件名或显示标题 |
| `type` | 年、季、月、周、日、目标、笔记、系统文档 |
| `content` | Markdown 正文 |
| `frontmatter` | 结构化元数据 |
| `linkedGoalIds` | 关联目标 |
| `linkedActionIds` | 关联行动 |
| `source` | 用户、Agent、系统、seed、导入 |

### MarkdownDocumentLink

表示 MD 文档之间的引用边。

当前支持从 Markdown 正文中的 `[[path/to/doc.md]]` 自动解析引用。

必要字段：

| 字段 | 含义 |
| --- | --- |
| `fromDocumentId` | 发起引用的文档 |
| `toDocumentId` | 如果目标文档存在，则指向它 |
| `targetPath` | 原始引用路径 |
| `linkType` | wiki、goal、action、parent、related |
| `context` | 可选引用上下文 |

## 3. 与旧 LogEntry 的关系

`LogEntry` 暂时保留为兼容层，因为 Today、Review 和旧验收脚本已经使用它。

新的真实主模型是：

```text
MarkdownDocument
MarkdownDocumentLink
```

兼容策略：

| 场景 | 写入 |
| --- | --- |
| seed 日报 | 同时写 `LogEntry` 和 `MarkdownDocument` |
| Today checkin | 同时写 `LogEntry` 和 `MarkdownDocument` |
| Review 生成 | 同时写 `LogEntry` 和 `MarkdownDocument` |
| Logs 页面编辑 | 直接读写 `MarkdownDocument` |
| Agent 对话 | 读取 `MarkdownDocument` |
| 数据导出 | 同时导出 `LogEntry`、`MarkdownDocument`、`MarkdownDocumentLink` |

后续稳定后，可以把 `LogEntry` 降级为视图或删除。

## 4. Agent 读取规则

Agent 不应该一次性读取全部 MD。

当前 v0.1 策略：

```text
先从用户问题中提取关键词，
在 MarkdownDocument 的标题、路径和正文里做简单相关性检索，
命中则读取最多 8 个相关文档；
未命中则退回读取最近更新的 8 个文档。

这些文档会连同当前目标、KR、条件、阶段、今日行动和对话历史一起发送给模型。
```

后续应升级为相关性检索：

```text
用户问题 -> 提取关键词/目标上下文 -> 检索 MarkdownDocument -> 按相关度截断 -> 发送给模型
```

## 5. 用户直觉

用户看到的是：

```text
Logs 里有一套像文件树一样的 MD 文档。
每个文档都可以直接编辑。
Agent 能读取这些文档，并基于它们回答、整理、生成复盘。
```

用户不需要理解数据库表，也不需要管理复杂引用规则。

## 6. v0.1 边界

已实现：

- 数据库 MD 文档表。
- 数据库 MD 引用表。
- Logs API 读写 `MarkdownDocument`。
- Today checkin 同步写 MD 文档。
- Review 同步写 MD 文档。
- Agent 读取最近 MD 文档。
- 数据导出包含 MD 文档和引用。

暂未实现：

- 全文搜索索引。
- 向量检索。
- 文件系统双向同步。
- 可视化反向链接。
- 冲突合并。
- 大文档分块。
