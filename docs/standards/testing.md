# 测试与验收规范

## 测试目标

测试不是为了覆盖率数字，而是保证用户的关键路径不会断：看到下一步、理解目标进度、编辑日志、和 Agent 对话、配置模型。

## 必测路径

- Today 能展示下一步行动和 Momentum 热力图。
- Goals 能展示目标树、KR、进度和周期计划，且保持只读。
- Logs 能展开年/季/月/周/日层级，并编辑 Markdown。
- Agent 能显示历史、消息列表和固定输入框。
- Settings 能配置模型、通知、集成、数据隐私等真实设置。

## API 测试

- 未登录访问用户数据返回 `UNAUTHORIZED`。
- 访问他人资源返回 `FORBIDDEN` 或 `NOT_FOUND`。
- Zod 校验失败返回 `VALIDATION_ERROR`。
- mutation 成功后返回统一 `{ data }` 结构。

## 前端验收

- 首屏能看懂页面目的。
- 不需要滚动整个页面才能找到主要操作。
- 设置项不会超出边界或被遮挡。
- 空状态有明确下一步。
- 移动端和桌面端布局都不能破版。

自动化入口：

```bash
cd src
pnpm verify:dashboard-browser
```

该脚本启动本机 Edge/Chrome，打开 Today、Goals、Logs、Agent、Settings，检查关键文本、横向溢出、Agent 固定输入框、Logs 编辑区、Settings 配置控件和 Today 热力图，并把截图写入 `.artifacts/browser-smoke/`。如果提供 `GOAL_MATE_COOKIE`，脚本会使用登录态验证真实数据页面；否则只验证页面骨架和空状态。

登录态真实数据验收入口：

```bash
cd src
pnpm verify:dashboard-browser:auth
```

该命令会创建或登录本地验收用户，生成一套真实 seed 数据，把 session cookie 直接注入浏览器。报告不会写出 cookie。

## Agent 验收

- 输入框始终可见。
- 消息区独立滚动。
- 历史记录可切换。
- Agent 能说明它基于哪些目标或日志做回答。

## 回归要求

每次修改页面布局后，至少人工检查对应页面的首屏、滚动区域和主要操作入口。自动化测试后续补充，但不能替代基本体验检查。
