# Goal Mate 规范总览

本目录定义 Goal Mate 从原型走向真实产品时必须遵守的工程规范。`Ignite/` 只作为本地开发模板参考，不是业务代码来源；可以借鉴它的分层、技术栈和开发流程，但不能直接把模板结构无判断地搬进产品。

## 第一版产品形态

第一版以 Web Console 为主，消息机器人作为后续接入层。用户主要通过 Web 查看今日下一步、目标进度、日志和设置；AI Agent 通过对话读取日志与目标，并帮助用户把想法转成可执行计划。

## 推荐技术路线

- 前端：Next.js App Router、React、Tailwind CSS、shadcn/ui、lucide-react。
- 接口：Hono RPC，统一输入校验、统一错误结构、类型从后端推导到前端。
- 数据：Prisma，先保证模型清晰，再做接口和页面。
- 状态：TanStack React Query，用自定义 hooks 封装每个资源的数据读写。
- 鉴权：Better Auth 或同等能力，所有用户数据必须按 userId 隔离。

## 开发顺序

1. 先写清楚页面目的和充分必要信息，不做装饰性功能。
2. 先定数据模型，再定 API，再写 hooks，最后写页面。
3. 页面只承载用户此刻必须看到和必须操作的东西。
4. 所有复杂方法论由系统和 Agent 消化，不能把复杂度直接丢给用户。
5. 每新增一个模块，必须同步更新架构、接口、数据库、前端和安全规范。

## 规范文件

- `architecture.md`：产品和工程分层。
- `coding.md`：功能开发流程、命名、提交前自检。
- `design.md`：页面设计原则和交互边界。
- `frontend.md`：Next.js、组件、状态、页面实现约束。
- `api.md`：Hono RPC、响应结构、校验和错误规范。
- `database.md`：Prisma 模型、关系、迁移和数据边界。
- `security.md`：鉴权、权限、密钥和隐私边界。
- `testing.md`：必要测试范围和验收标准。

提交前轻量静态门禁见 `docs/plans/static-verification-gates.md`。完整验收状态见 `docs/plans/verification-overview.md`。
