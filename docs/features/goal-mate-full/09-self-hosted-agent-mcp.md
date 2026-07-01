# F8 Self-hosted Agent 与 MCP Server 规格

## 1. 模块定位

Self-hosted Agent 是给技术用户和隐私敏感用户的本地部署形态。它不是简单 CLI，而是本地常驻目标推进服务，提供 Web UI、Local API、MCP Server、本地数据库、调度器和连接器。

原型入口：

```text
docs/designs/goal-mate-mcp-console.html
```

## 2. 组成

```text
self-hosted-agent
  -> Local Web UI
  -> Local API
  -> MCP Server
  -> Goal Engine Core
  -> Scheduler
  -> SQLite Storage
  -> Model Provider Adapter
  -> Connector Manager
  -> Backup / Export
  -> Logs / Audit
```

## 3. 启动与配置

推荐启动方式：

```bash
docker compose up -d
```

启动后：

```text
http://localhost:<port>       Web UI
http://localhost:<port>/api   Local API
stdio/http                    MCP Server transport
```

## 4. 字段清单

### 4.1 local_instance_config

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| instance_id | string | 是 | 系统生成 | 本地实例 ID |
| data_dir | string | 是 | ./data | 数据目录 |
| database_url | string | 是 | sqlite | 数据库连接 |
| web_port | integer | 是 | 3000 | Web 端口 |
| api_port | integer | 是 | 3000 | API 端口 |
| mcp_transport | enum | 是 | stdio | stdio, http |
| model_provider | string | 是 | openai_compatible | 模型提供商 |
| backup_enabled | boolean | 是 | true | 是否启用备份 |

### 4.2 mcp_tool

| 字段名 | 类型 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- | --- |
| name | string | 是 | 无 | MCP 工具名 |
| description | string | 是 | 无 | 工具说明 |
| permission_scope | string[] | 是 | [] | 权限范围 |
| input_schema | object | 是 | {} | 输入结构 |
| output_schema | object | 是 | {} | 输出结构 |
| enabled | boolean | 是 | true | 是否启用 |

## 5. MCP 工具范围

| 工具 | 说明 | 权限 |
| --- | --- | --- |
| goal.list | 列出目标摘要 | read |
| goal.get | 查看目标详情 | read |
| goal.create_draft | 创建目标草案 | draft |
| goal.update | 更新目标 | draft/execute |
| action.get_today | 获取今日行动 | read |
| checkin.submit | 提交 Check-in | execute |
| review.generate | 生成复盘草稿 | draft |
| memory.search | 搜索用户记忆 | read |
| export.create | 创建数据导出 | execute |

## 6. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F8-R1 | Self-hosted 必须能离线查看已有目标数据 | P1 |
| F8-R2 | 模型调用可配置，系统不得硬编码单一 Provider | P1 |
| F8-R3 | MCP 写操作必须经过权限校验 | P1 |
| F8-R4 | 本地 Web UI 必须展示服务状态、模型状态、调度状态、最近错误 | P1 |
| F8-R5 | 本地数据必须可备份和导出 | P1 |
| F8-R6 | 凭据不得写入日志 | P1 |
| F8-R7 | Local API 和 MCP 必须共用权限模型 | P1 |

## 7. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F8-1 | 用户启动 docker compose | 服务启动完成 | Web UI 可访问并显示状态正常 |
| AC-F8-2 | MCP Client 调用 goal.list | 权限为 read | 返回目标摘要 |
| AC-F8-3 | MCP Client 调用 checkin.submit | 无 execute 权限 | 请求被拒绝 |
| AC-F8-4 | 用户点击导出 | 导出完成 | 生成包含目标、行动、复盘、记忆的文件 |
