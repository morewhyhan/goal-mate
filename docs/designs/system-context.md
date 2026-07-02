# System Context

## Product Positioning

Goal Mate is a Web-first AI goal advancement console. It helps individual users turn long-term goals into concrete next actions, keep Markdown-based progress logs, and talk with an Agent that understands their goals, logs, and current plan.

The first version is a Web Console with QQ Bot as the first auxiliary runtime channel. Telegram is no longer an active first-version channel.

## Primary Users

| User | Need |
| --- | --- |
| Student / self-learner | Keep study, English, exam, or habit goals moving every day. |
| Indie developer | Push product and code projects without losing the main thread. |
| Content creator | Maintain writing and publishing rhythm. |
| Freelancer / personal productivity user | Keep long-term goals visible and actionable. |

## Core Promise

```text
AI handles planning complexity. The user only needs to understand the next action and talk to the Agent when confused.
```

## First-version Surfaces

| Surface | Role |
| --- | --- |
| Today | Shows the next action and recent momentum. |
| Goals | Read-only goal, OKR, WBS, and Gantt overview. |
| Logs | Editable Markdown files for year, quarter, month, week, and day records. |
| Agent | Main conversational interface. The Agent can read allowed Goals, Logs, Today, and memory. |
| Settings | Product configuration for model, reminders, QQ channel, Agent tool permissions, runtime status, data export and privacy. |

## Boundaries

First version includes:

```text
Web Console
AI Agent conversation
Implicit OKR
Today next action
Editable Markdown logs
Momentum heatmap
Model configuration
Basic settings
QQ Bot worker assets
Scheduler worker assets
```

First version excludes:

```text
Enterprise OKR
Team collaboration
Knowledge management
Idea archive
Complex project boards
Mobile app
Native desktop app
Bot as primary surface
Telegram as active v0.1 channel
Automatic high-risk external actions
```

## External Dependencies

| Dependency | Purpose | Notes |
| --- | --- | --- |
| Model provider | Agent reasoning, planning, summarization | Default planned provider: DeepSeek. |
| Markdown storage | Logs output | Web version may store in DB first and export as Markdown. |
| QQ Bot | Daily reminders, check-in, and conversational entry | First auxiliary channel; requires long-running worker. |
| Future bot channels | Daily reminders and check-in | WeChat / Feishu / Email are future entry points. |
| Future MCP tools | Power-user automation | Requires explicit permission and confirmation. |

## Current Agent Capability Boundary

As of 2026-07-02, the Agent can chat through the Web Agent page and QQ Bot, call DeepSeek, and read allowed goal/log context.

The system now has an explicit Agent Tool Runtime foundation for creating goal drafts, updating today's action, submitting check-ins, writing logs, generating review drafts, scheduling reminders, updating model settings, and recording audit logs.

Web Agent conversations can route explicit system-operation requests into tool intent handling. Execute tools are held for confirmation and can be executed after the user confirms.

QQ conversations can trigger read/draft tools and confirm pending execute tools through text confirmation.

The remaining proven gap is not more planning documentation. It is runtime evidence:

- Current HEAD has not been re-verified after the latest UI and channel corrections.
- Server long-running verification for Web, QQ Worker, and Scheduler Worker has not been executed.

The next product increment is:

```text
Server deployment for QQ worker and Scheduler
Static / type / API / browser verification
Self-hosted runtime verification
```
