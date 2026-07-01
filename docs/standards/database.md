# 数据库规范

## 技术选择

使用 Prisma 管理数据模型、迁移和类型生成。第一版可用 SQLite 或 PostgreSQL，但模型设计必须按可迁移到 PostgreSQL 的标准写。

## 通用字段

每个核心表必须包含：

```prisma
id        String   @id @default(uuid())
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

用户私有数据必须包含：

```prisma
userId String
```

## 核心实体

- User：用户。
- Goal：目标，可以形成父子层级。
- KeyResult：关键结果，一个 Objective 可以有多个 KR。
- GoalPeriod：年度、季度、月度、周度、日度周期。
- PlanItem：落实到具体周期的行动项。
- LogEntry：Markdown 日志文件。
- AgentThread：Agent 对话线程。
- AgentMessage：对话消息。
- ModelConfig：模型供应商、模型名、api base、密钥引用和默认用途。
- UserSetting：用户配置。

## Goal 和 KR

- 一个 Objective 可以对应多个 KeyResult。
- KR 数量不强制限制，但必须满足充分必要：少一个会缺关键判断，多一个会增加无效负担。
- Goal 可以有父子关系，用于年度到日度的拆解。
- 进度可以由子目标、KR 或日志行动共同计算，但展示层必须简单。

## Logs 层级

日志不是知识卡片，而是目标推进记录。建议层级：

```text
logs/
  2026/
    Q3/
      2026-07/
        W27/
          2026-07-01.md
```

数据库中可以保存文件元信息、路径、周期、关联目标和 Markdown 内容；文件系统导出时保持同样结构。

## 关系和删除

- 子数据属于用户时使用级联删除要谨慎，只在父记录删除后子记录无意义时使用。
- 删除 Goal 前必须判断是否有日志、KR、计划项依赖。
- AgentMessage 随 AgentThread 删除可以级联。
- ModelConfig 不应硬删除正在使用的默认模型。

## 迁移流程

1. 修改 `prisma/schema.prisma`。
2. 生成迁移：`pnpm prisma migrate dev --name <change-name>`。
3. 生成 Prisma Client。
4. 同步更新 API 类型、前端 hooks 和文档。

## 数据边界

- 所有查询必须带 userId 限制。
- Agent 可读取用户授权范围内的目标和日志，但不能跨用户读取。
- API Key 只保存加密值或安全引用，不明文展示。
