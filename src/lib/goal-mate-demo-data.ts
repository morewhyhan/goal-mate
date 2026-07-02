export const demoGoal = {
  title: '2026 暑假主目标推进',
  horizon: '2026-07-01 至 2026-09-01',
  objective: '在暑假结束前，把身体、英语、内容和项目四条主线推进到可验证状态。',
  currentGap: '稳定执行节奏还没有被验证。',
  currentCondition: '每天能形成可持续的运动、学习、写作和开发窗口。',
  todayAction: {
    title: '走路 2 小时，并同步背单词',
    linkedCondition: '建立身体管理和英语输入的稳定日常窗口',
    doneWhen: '完成 120 分钟步行，并记录今天背过的单词范围。',
    minimumStep: '先出门走 10 分钟，同时打开单词音频。',
    fallbackAction: '如果状态差，只走 20 分钟并背 10 个词。',
    estimatedMinutes: 120,
    checkinQuestion: '今天完成后告诉我：完成、部分完成、没做，以及主要原因。',
  },
  keyResults: [
    {
      title: '体重从 165 斤降到接近 130 斤',
      progress: 0.18,
      current: '饮食和走路节奏刚开始建立',
    },
    {
      title: '新概念英语二完成默写并达到熟练',
      progress: 0.12,
      current: '正在建立每日背诵和默写节奏',
    },
    {
      title: '形成稳定日更 3000 字内容输出',
      progress: 0.22,
      current: '已有主题池，仍需要稳定发布闭环',
    },
    {
      title: '软件杯和 Goal Mate 项目产出可演示结果',
      progress: 0.34,
      current: 'PRD 和工程框架已开始收敛',
    },
  ],
  conditions: [
    { title: '简单饮食可持续', status: 'partial', type: '必要条件' },
    { title: '每天两小时走路窗口稳定', status: 'missing', type: '必要条件' },
    { title: '英语输入和走路绑定', status: 'partial', type: '假设条件' },
    { title: '每日 3000 字输出能沉淀到公开渠道', status: 'missing', type: '必要条件' },
    { title: '项目每天至少推进一个可见增量', status: 'partial', type: '支撑条件' },
  ],
  stages: [
    { name: '第 1 周', start: '07-01', end: '07-07', focus: '建立最小节奏', progress: 0.32 },
    { name: '第 2-4 周', start: '07-08', end: '07-31', focus: '稳定执行和记录', progress: 0.08 },
    { name: '第 5-7 周', start: '08-01', end: '08-21', focus: '提高强度和产出', progress: 0 },
    { name: '最后 10 天', start: '08-22', end: '09-01', focus: '复盘、修正和验收', progress: 0 },
  ],
}

export const logTree = [
  {
    label: '2026',
    children: [
      {
        label: 'Q3',
        children: [
          {
            label: '2026-07',
            children: [
              {
                label: 'W27',
                children: [
                  { label: '2026-07-01.md', active: true },
                  { label: '2026-07-02.md' },
                ],
              },
              { label: 'W28' },
            ],
          },
          { label: '2026-08' },
        ],
      },
    ],
  },
]

export const currentMarkdown = `# 2026-07-01

## 今日主目标

- 目标：2026 暑假主目标推进
- 当前 KR：体重、英语、内容、项目四条主线开始形成节奏
- 当前关键条件：每天能形成可持续的运动、学习、写作和开发窗口

## 今日行动

- 行动：走路 2 小时，并同步背单词
- 完成标准：完成 120 分钟步行，并记录今天背过的单词范围
- 最小启动：先出门走 10 分钟，同时打开单词音频

## 执行反馈

- 结果：待反馈
- 原因：
- 调整：

## 自由记录

今天重点不是追求完美，而是验证这个节奏能不能真的发生。
`

export const agentThreads = [
  { title: '暑假主目标拆解', time: '今天', active: true },
  { title: '为什么先建立节奏', time: '昨天' },
  { title: 'Goal Mate PRD 收敛', time: '周一' },
]

export const agentMessages = [
  {
    role: 'assistant',
    content: '我已经读取当前主目标、KR 和最近日志。今天最重要的不是把四条线都做满，而是验证一个稳定节奏能不能发生。',
  },
  {
    role: 'user',
    content: '如果今天没有完成两小时走路，应该怎么调整？',
  },
  {
    role: 'assistant',
    content: '我会先判断原因：是动作太大、提醒不合适，还是今天这个目标吸引力不足。如果只是能力问题，明天把动作缩小到 20 分钟，并保留背 10 个词作为最小推进。',
  },
]

export const settingsGroups = [
  {
    name: 'Models',
    description: '决定 Agent 使用哪个模型理解目标、生成计划和总结日志。',
    fields: [
      ['Provider', 'DeepSeek'],
      ['Chat Model', 'deepseek-v4-flash'],
      ['Reasoning Model', 'deepseek-reasoner'],
      ['API Base', 'https://api.deepseek.com'],
      ['API Key', 'sk-••••••••••••'],
    ],
  },
  {
    name: 'Logs',
    description: '决定 Markdown 日志如何命名、保存，以及哪些内容自动写入。',
    fields: [
      ['Root', 'logs/'],
      ['Pattern', 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md'],
      ['Auto write check-in', 'On'],
      ['Preserve user edits', 'On'],
    ],
  },
  {
    name: 'Agent',
    description: '决定 Agent 能读取什么上下文，以及哪些修改必须先确认。',
    fields: [
      ['Read Goals', 'On'],
      ['Read Logs', 'On'],
      ['Memory', 'On'],
      ['Confirm goal changes', 'Required'],
    ],
  },
  {
    name: 'Notifications',
    description: '决定系统什么时候推动你行动，什么时候保持安静。',
    fields: [
      ['Morning check-in', '08:30'],
      ['Evening review', '21:30'],
      ['Quiet hours', '23:00 - 07:30'],
      ['Max prompts/day', '2'],
    ],
  },
]

export const heatmapWeeks = Array.from({ length: 53 }, (_, week) =>
  Array.from({ length: 7 }, (_, day) => {
    const value = (week * 3 + day * 5 + (week % 4)) % 5
    return value
  }),
)
