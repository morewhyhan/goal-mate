# Current Architecture

## Architecture Positioning

Goal Mate first version is a Web Console backed by a goal engine and an Agent runtime. The Web UI is the primary product surface. Future message bots reuse the same Agent and goal engine instead of creating a second product.

## Logical Components

```text
Web Console
  -> Today UI
  -> Goals UI
  -> Logs UI
  -> Agent UI
  -> Settings UI

Application API
  -> Goal Engine
  -> Agent Runtime
  -> Logs Service
  -> Settings Service
  -> Model Provider Adapter

Storage
  -> Goal data
  -> OKR / KR data
  -> Daily actions
  -> Markdown log records
  -> Agent messages
  -> User settings
  -> Model configuration
```

## Component Responsibilities

| Component | Responsibility |
| --- | --- |
| Web Console | Renders the five first-version pages and handles user interaction. |
| Goal Engine | Maintains goals, implicit OKR, KR progress, WBS items, milestones, and current focus. |
| Agent Runtime | Handles conversation, goal clarification, plan adjustment, diagnosis, and log drafting. |
| Logs Service | Reads and writes Markdown-style year, quarter, month, week, and day records. |
| Settings Service | Stores product configuration, permissions, reminders, model config, and data preferences. |
| Model Provider Adapter | Routes Agent requests to configured models such as DeepSeek V4 Flash or reasoning models. |

## First-version Page Architecture

| Page | Source data | Writes data? |
| --- | --- | --- |
| Today | Current focus, daily action, momentum events | Starts actions and may trigger Agent feedback later. |
| Goals | Goals, KR, WBS, Gantt items | No direct writes in first version. |
| Logs | Markdown log records | User and Agent can edit/write logs. |
| Agent | Messages, goals, logs, today state, settings | Can draft changes and write confirmed logs/actions. |
| Settings | Settings, model configs, integration configs | Writes configuration. |

## Key Design Decisions

- Goals page is read-only. Explanations such as "why this goal was set" should be answered by Agent, not rendered in the Goals overview.
- Today stays low-entropy: one next action plus lightweight momentum feedback.
- Logs are product output, not a knowledge-management system.
- Agent is the main conversational interface and should not become a permanent approval dashboard.
- Settings must include concrete configuration controls, not only switches.

## Future Extension Points

| Extension | How it connects |
| --- | --- |
| WeChat / Feishu Bot | Calls Agent Runtime and Logs Service. |
| Self-hosted runtime | Reuses Web Console, API, storage, and model adapter with local deployment. |
| MCP Server | Exposes controlled tools backed by Goal Engine and Logs Service. |
| Obsidian export | Exports Logs records as a compatible Markdown vault. |
