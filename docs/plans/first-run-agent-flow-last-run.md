# Goal Mate First-run Agent Flow Verification

- Time: 2026-07-04T15:32:45.690Z
- Base URL: http://127.0.0.1:3002
- Test user: fir...@goalmate.local
- Test data kept: no

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| FRA-HEALTH | local API is reachable before first-run verification | PASS | GET /api/health status=200 |
| FRA-AUTH | a clean first-run user can register and get a session | PASS | user=fir...@goalmate.local |
| FRA-CLEAN-WORKSPACE | new user starts without goal or markdown business data | PASS | goals=0; md=0 |
| FRA-THREAD | first-run user can create an Agent thread | PASS | thread=1bc89c7d-ee3d-4426-a9b6-6d3de8ab43ca |
| FRA-VAGUE-CLARIFY | vague first goal input asks one key clarification and does not create fake goal data | PASS | type=first_goal_clarification; goals=0; reply=你最终想看到什么可验证结果？用一句话说清楚“到什么程度算成”。 |
| FRA-NATURAL-DRAFT | specific natural first goal input creates goal scaffold and pending activation | PASS | goal=f2e19a89-440f-4df6-b528-8d46b4c926f1; kr=3; conditions=3; stages=3; action=e97522e8-836f-43bc-b185-6917949b0a67; activation=b492a2c1-8202-4633-a6f4-f6a91391f593 |
| FRA-ACTIVATE | confirming the pending activation makes the drafted goal current and confirms its reasoning card | PASS | status=ACTIVE; focus=true; card=CONFIRMED |
| FRA-TODAY | Today picks up the activated first goal and exposes one next action | PASS | goal=f2e19a89-440f-4df6-b528-8d46b4c926f1; action=推进一个 15 分钟可验证开发小步 |
| FRA-GOAL-MARKDOWN | first goal draft writes a Markdown goal document for Logs/Agent context | PASS | goals/f2e19a89-440f-4df6-b528-8d46b4c926f1.md |
| FRA-MODEL-AUTH | a clean first-run user with a configured model can register and get a session | PASS | user=fir...@goalmate.local |
| FRA-MODEL-THREAD | model-configured first-run user can create an Agent thread | PASS | thread=1fd41ec7-a2bd-493a-a9af-561ad3af8de0 |
| FRA-MODEL-FIRST-GOAL-ROUTER | configured model gets first chance to route a concrete first goal instead of hard-coded local scaffold taking over | PASS | routerCalls=1; goal=模型生成的首个目标 1783179144846; action=模型生成的首个行动 1783179144846 |
| FRA-CLEANUP | temporary first-run user and data are removed | PASS | cleanup completed |
