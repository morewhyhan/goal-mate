# Architecture Standard

## 分层原则

- Controller/API 层只处理协议适配、鉴权上下文、请求校验和响应映射。
- Application Service 编排用例流程，不承载复杂领域规则。
- Domain Service/Domain Model 承载可复用业务规则。
- Repository 只处理持久化读写，不泄漏数据库细节到上层。
- Query 模型可为复杂查询单独建模，避免污染领域写模型。

## CRUD 工序

- 简单 CRUD：Controller + Command -> AppService -> Repository -> Response。
- 复杂 CRUD：Controller + Command -> AppService -> DomainService -> Repository -> Response。
- 复杂查询：Controller + Query -> AppService -> QueryPO/DTO -> Response。

## 依赖方向

- 外层依赖内层，内层不得依赖外层。
- 领域层不得依赖 HTTP、数据库驱动、UI 框架。
- 跨模块调用优先通过公开 Application Service 或 API 契约。

## 变更要求

- 新增模块必须先补充需求规格和 Plan。
- 影响数据库/API 的变更必须同步 `docs/designs`。
- 重要架构决策必须写入 ADR。
