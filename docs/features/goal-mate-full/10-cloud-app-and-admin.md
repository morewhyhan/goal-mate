# F9 Cloud App 与运营后台规格

## 1. 模块定位

Cloud App 是面向普通用户的开箱即用形态，提供账号、同步、提醒、模型服务和多端入口。运营后台负责模板、系统配置、用户支持和审计。

## 2. 用户端入口

| 入口 | 优先级 | 说明 |
| --- | --- | --- |
| Web App | P0 | 最先实现的完整功能入口 |
| Mobile App | P1 | iOS / Android |
| 微信小程序 | P1 | 中国大陆普通用户轻量入口 |
| 微信服务号/企业微信/Telegram | P1 | 提醒和回复渠道 |

## 3. 账号与同步

| 能力 | 优先级 |
| --- | --- |
| 邮箱登录 | P0 |
| 手机号登录 | P1 |
| Apple / Google 登录 | P1 |
| 多设备同步 | P0 |
| 数据导出 | P0 |
| 账号注销 | P0 |
| 用户支持授权 | P1 |

## 4. 字段清单

### 4.1 cloud_user

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 用户 ID |
| email | string | 否 | 空 | 邮箱 |
| phone | string | 否 | 空 | 手机 |
| display_name | string | 否 | 空 | 昵称 |
| status | enum | 是 | active | active, suspended, deleted |
| timezone | string | 是 | Asia/Shanghai | 时区 |
| locale | string | 是 | zh-CN | 语言 |
| created_at | datetime | 是 | 当前时间 | 创建时间 |

### 4.2 admin_audit_log

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 系统生成 | 审计 ID |
| admin_id | string | 是 | 无 | 管理员 |
| action | string | 是 | 无 | 操作 |
| target_type | string | 是 | 无 | 目标类型 |
| target_id | string | 否 | 空 | 目标 ID |
| reason | string | 是 | 无 | 操作原因 |
| created_at | datetime | 是 | 当前时间 | 创建时间 |

## 5. 运营后台范围

| 模块 | 能力 | 优先级 |
| --- | --- | --- |
| Template Admin | 管理目标场景模板 | P1 |
| User Support | 查看用户基础状态、处理工单 | P1 |
| System Prompt Admin | 管理系统级 Prompt 版本 | P1 |
| Model Routing | 模型 Provider 和降级策略 | P1 |
| Audit | 管理员操作审计 | P1 |
| Billing | 订阅、套餐、账单 | P2 |

## 6. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F9-R1 | 用户必须能导出和注销账号 | P0 |
| F9-R2 | 多设备同步不得覆盖较新的用户编辑 | P0 |
| F9-R3 | 管理员操作必须写审计日志 | P1 |
| F9-R4 | 管理员默认不得读取用户私密对话明文 | P1 |
| F9-R5 | 用户授权支持访问必须有过期时间 | P1 |
| F9-R6 | 模型故障时应有降级或重试策略 | P1 |
| F9-R7 | 订阅付费不影响用户导出自有数据 | P2 |

## 7. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F9-1 | 用户在 Web 创建目标 | 手机端登录 | 可看到同步后的目标 |
| AC-F9-2 | 两端同时编辑同一目标 | 保存同步 | 系统按版本或更新时间解决冲突，并提示用户 |
| AC-F9-3 | 管理员修改模板 | 保存 | 生成 admin_audit_log |
| AC-F9-4 | 用户请求注销 | 确认后 | 账号进入 deleted 或删除流程，并提供导出提示 |

