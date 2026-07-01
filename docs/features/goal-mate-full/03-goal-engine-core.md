# F2 Goal Engine Core 规格

## 1. 模块定位

Goal Engine Core 是 Goal Mate 的核心引擎，独立于 UI、部署形态和消息渠道。它负责把目标转成结构化推进模型，并持续根据反馈调整。

## 2. 核心链路

```text
自然语言目标
  -> 目标澄清
  -> 目标推理卡
  -> 隐式 OKR
  -> 充分必要条件
  -> 阶段节点
  -> 今日行动
  -> Check-in 反馈
  -> 未完成诊断
  -> 路径调整
  -> 复盘洞察
```

## 3. 核心对象

| 对象 | 说明 |
| --- | --- |
| Goal | 用户想推进的目标 |
| GoalReasoningCard | AI 对目标的推理结果 |
| ObjectiveState | 后台隐式 Objective |
| KeyResult | 能证明目标推进的结果 |
| GoalCondition | 必要条件、假设条件、支持条件 |
| StagePlan | 阶段推进计划 |
| DailyAction | 今日行动 |
| Checkin | 执行反馈 |
| Diagnosis | 未完成诊断 |
| Review | 复盘 |

字段全集见 [11-data-model.md](11-data-model.md)。

## 4. 目标推理卡

目标推理卡必须包含：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| purpose_summary | 是 | 用户真正想达成的目的 |
| success_signals | 是 | 可验证的成功标准 |
| objective_title | 是 | 后台隐式目标 |
| key_results | 是 | 可衡量或可判断的关键结果 |
| necessary_conditions | 是 | 目标成立的必要条件 |
| sufficient_condition_set | 是 | 条件组合如何证明目标推进 |
| current_gap | 是 | 当前最关键缺口 |
| recommended_focus | 是 | 当前推进重点 |
| confidence_score | 是 | AI 推理置信度 |
| evidence | 是 | 推理依据 |

## 5. 业务规则

| 编号 | 规则 | 优先级 |
| --- | --- | --- |
| F2-R1 | 每个 active goal 必须有 confirmed 目标推理卡 | P0 |
| F2-R2 | 每个目标至少有 1 个 ObjectiveState 和 1 到 5 个 KeyResult | P0 |
| F2-R3 | 每个目标至少有 3 个 GoalCondition | P0 |
| F2-R4 | current_gap 必须引用 missing 或 partial 条件 | P0 |
| F2-R5 | 每个 DailyAction 必须关联 GoalCondition | P0 |
| F2-R6 | AI 修改推理卡时必须创建新版本，不能覆盖历史 | P0 |
| F2-R7 | AI 输出必须通过结构化 schema 校验后才能入库 | P0 |
| F2-R8 | 目标完成、暂停、放弃必须由用户确认 | P0 |
| F2-R9 | 多目标冲突时，Engine 必须给出取舍建议，而不是平均分配注意力 | P1 |

## 6. AI 输出结构

```json
{
  "goal_reasoning_card": {
    "purpose_summary": "用户想把一个长期卡住的副业产品推到可验证阶段。",
    "success_signals": [
      "明确目标客户",
      "完成可演示版本",
      "获得 5 个真实用户反馈"
    ],
    "objective_title": "完成副业产品第一轮真实验证",
    "key_results": [
      {
        "title": "获得 5 个真实用户反馈",
        "metric_type": "count",
        "target_value": 5
      }
    ],
    "necessary_conditions": [
      {
        "title": "目标客户明确",
        "condition_type": "hard",
        "status": "partial"
      },
      {
        "title": "可演示版本存在",
        "condition_type": "hard",
        "status": "missing"
      }
    ],
    "current_gap": "可演示版本存在",
    "recommended_focus": "先做一个可以让用户体验核心价值的最小演示版本",
    "confidence_score": 0.72,
    "evidence": "用户已经有产品方向，但还没有可给真实用户试用的版本。"
  }
}
```

## 7. 状态流

### 7.1 Goal 状态

```text
draft -> clarifying -> confirmed -> active -> paused
                                  -> completed
                                  -> abandoned
```

### 7.2 ReasoningCard 状态

```text
draft -> pending_user_confirmation -> confirmed
                                    -> rejected
                                    -> stale
```

### 7.3 GoalCondition 状态

```text
missing -> partial -> satisfied
missing -> invalidated
partial -> invalidated
```

## 8. 验收标准

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| AC-F2-1 | 用户确认目标 | Engine 生成推理卡 | 推理卡包含成功标准、KR、条件、当前缺口 |
| AC-F2-2 | 推理卡缺少 current_gap | 系统校验 | 校验失败，不得进入计划 |
| AC-F2-3 | 用户编辑目标 | 保存更改 | 当前推理卡状态变为 stale |
| AC-F2-4 | 多个目标争用同一时间块 | Engine 计算今日建议 | 必须给出主目标优先建议 |

