# Deployment Config Test Cases

## 1. 目的

本测试用例用于验证自部署配置资产是否一致。

它不连接服务器、不启动 systemd、不访问网络，只检查仓库里的部署模板、环境变量样例、package scripts 和部署事实文档是否匹配。

## 2. 自动化入口

```bash
pnpm verify:deployment-config
pnpm verify:deployment-config:write
```

## 3. 检查项

| ID | 检查 | 期望 |
| --- | --- | --- |
| DEPLOY-PACKAGE | `src/package.json` scripts | 包含 `start`、`worker:qq`、`worker:scheduler` |
| DEPLOY-WEB-EXISTS | Web service | `deploy/systemd/goal-mate-web.service` 存在 |
| DEPLOY-WEB-CONTENT | Web service 内容 | 包含 WorkingDirectory、EnvironmentFile、ExecStart、Restart |
| DEPLOY-QQ-EXISTS | QQ worker service | `deploy/systemd/goal-mate-qq-worker.service` 存在 |
| DEPLOY-QQ-CONTENT | QQ worker service 内容 | 包含 `pnpm worker:qq` 和自动重启策略 |
| DEPLOY-SCHEDULER-EXISTS | Scheduler service | `deploy/systemd/goal-mate-scheduler-worker.service` 存在 |
| DEPLOY-SCHEDULER-CONTENT | Scheduler service 内容 | 包含 `pnpm worker:scheduler` 和自动重启策略 |
| DEPLOY-README | systemd README | 包含安装、启动、状态、日志查看命令 |
| DEPLOY-ENV-EXAMPLE | `.env.example` | 包含部署所需环境变量 |
| DEPLOY-DESIGN-DOC | 部署事实文档 | 引用 `deploy/systemd` 并保留真实部署缺口 |
| DEPLOY-RUNTIME-PLAN | 服务器运行验收计划 | `docs/plans/self-hosted-runtime-verification-plan.md` 说明真实长期运行验证步骤 |

## 4. 不覆盖

- 不验证服务器上的真实路径。
- 不验证 systemd 是否可用。
- 不验证 QQ / DeepSeek 网络。
- 不验证 worker 长期运行。
