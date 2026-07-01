# 前端规范

## 技术选择

- 使用 Next.js App Router。
- Server Component 默认优先；只有状态、事件、浏览器 API、React Query、表单交互需要 Client Component。
- 使用 Tailwind CSS 做布局和视觉约束。
- 使用 shadcn/ui 作为基础组件源码，不把它当黑盒库。
- 图标优先使用 lucide-react。

## 页面结构

- `app/layout.tsx`：全局字体、主题、metadata。
- `app/(dashboard)/layout.tsx`：主应用侧边栏和页面框架。
- `app/(dashboard)/today/page.tsx`：今日行动。
- `app/(dashboard)/goals/page.tsx`：目标只读视图。
- `app/(dashboard)/logs/page.tsx`：Markdown 日志。
- `app/(dashboard)/agent/page.tsx`：Agent 对话。
- `app/(dashboard)/settings/page.tsx`：配置中心。

## 组件边界

- 页面组件负责布局，业务组件负责表达一个完整功能块。
- UI 原子组件放 `components/ui/`。
- 业务组件按模块放：`components/goals/`、`components/logs/`、`components/agent/`。
- 组件不能依赖全局假数据；原型数据也要集中在模块 mock 文件里。

## 状态和数据

- 所有远程数据通过 hooks 获取，不在页面里直接 `fetch`。
- `useQuery` 只负责读，`useMutation` 负责写。
- mutation 成功后必须 invalidate 对应 query key。
- 表单本地状态和远程缓存状态分开。

## Agent 页面要求

- 布局是专业对话工作台：左侧历史，中间消息，底部输入。
- 输入框固定在底部，用户不需要翻页寻找输入入口。
- 消息区单独滚动。
- 右侧不放解释性废话面板；如果需要上下文，只显示可被点击或可被引用的简短对象。
- 历史记录必须存在，因为 Agent 会围绕不同目标和日志连续对话。

## Today 页面要求

- 只强调下一步行动。
- 右下或右侧可以放 Momentum 热力图，但必须是独立小面板。
- 热力图参考 GitHub contribution graph：小方块、横向月份、颜色表达完成强度。
- 默认年度视图，可切换季度、月度、周度。

## Settings 页面要求

- 设置不是按钮陈列，而是配置中心。
- 每项设置必须包含名称、用途、当前值和影响说明。
- 有些设置需要输入框、下拉框、密钥框、测试连接、默认模型选择，而不是一个开关解决。
- 模型配置必须包含 provider、model、api base、api key、默认用途。
