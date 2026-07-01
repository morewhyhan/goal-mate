# API 规范

## 技术选择

接口层使用 Hono。前端通过 Hono RPC client 调用接口，避免手写 URL 和重复类型。

## 路由组织

- API 入口放在 `server/api`。
- 每个资源一个目录：`server/api/routes/goals/index.ts`。
- 资源路由只处理请求、校验、鉴权和调用服务逻辑。
- 复杂业务规则应拆到 service 或 domain 层。

## 请求校验

- 所有 body、query、param 必须用 Zod 校验。
- 不信任前端传入的 userId，用户身份只能来自 session。
- 更新和删除必须校验资源归属。

## 响应结构

成功响应统一返回：

```ts
{
  data: unknown
}
```

列表响应可以返回：

```ts
{
  data: unknown[],
  meta: {
    total?: number,
    cursor?: string | null
  }
}
```

错误响应统一返回：

```ts
{
  error: {
    code: string,
    message: string
  }
}
```

## 错误规范

- 使用统一 `ApiError` 或等价错误类。
- 常见 code：`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_ERROR`、`CONFLICT`、`INTERNAL_ERROR`。
- 不把数据库错误、密钥、堆栈直接返回给前端。

## 推荐接口

- `GET /goals`：目标树和进度概览。
- `GET /goals/:id`：目标详情、KR 和周期计划。
- `GET /logs/tree`：日志文件树。
- `GET /logs/:id`：日志 Markdown 内容。
- `PUT /logs/:id`：保存日志内容。
- `GET /agent/threads`：对话历史。
- `POST /agent/threads`：创建对话。
- `POST /agent/threads/:id/messages`：发送消息。
- `GET /settings`：读取配置。
- `PUT /settings`：保存配置。
- `POST /settings/models/test`：测试模型连接。

## 前端调用

- 每个资源必须有对应 hook：`useGoals`、`useLogTree`、`useAgentThreads`。
- mutation 必须处理 loading、success、error 三种状态。
- 不允许页面直接依赖接口返回的临时字段。
