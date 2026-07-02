# Static Verification Gates

## 1. 定位

静态门禁用于提交前或部署前做低成本检查。

它只检查仓库文件，不启动服务，不访问网络，不要求登录态，不连接 QQ / DeepSeek。

## 2. 当前入口

```bash
pnpm verify:static
```

当前组合：

```text
verify:secrets
verify:deployment-config
```

## 3. 覆盖范围

| 检查 | 作用 |
| --- | --- |
| `verify:secrets` | 扫描仓库中是否出现 API Key、Bot Token、Bearer Token 形状的密钥 |
| `verify:deployment-config` | 检查 package scripts、systemd 模板、env example、部署事实文档和服务器验收计划 |

## 4. 不覆盖

- 不证明 Web 能启动。
- 不证明数据库迁移可执行。
- 不证明 QQ Gateway 可连接。
- 不证明 Scheduler 能真实发消息。
- 不证明 Agent 工具闭环可运行。

这些必须通过运行时验收完成：

```text
docs/plans/self-hosted-runtime-verification-plan.md
docs/plans/v0.1-acceptance-runbook.md
docs/test-cases/agent-action-loop-v0.2-test-cases.md
```

## 5. 失败处理规则

如果 `pnpm verify:static` 失败，按这个顺序处理：

| 失败项 | 处理方式 |
| --- | --- |
| `verify:secrets` | 先停下，不要提交；确认是否误提交真实密钥或 token-shaped placeholder |
| `verify:deployment-config` | 检查 `src/package.json`、`src/.env.example`、`deploy/systemd` 和部署事实文档是否同步 |

处理原则：

- 不要把真实密钥写入报告或修复说明。
- 不要通过放宽正则绕过真实泄露。
- 如果是安全占位符误报，应改成 `replace_with_*` 形式。
- 如果是部署文档缺项，应同步更新测试矩阵和静态检查脚本。

## 6. 当前状态

截至 2026-07-02：

- 静态门禁入口已定义。
- 本轮未执行静态门禁。
