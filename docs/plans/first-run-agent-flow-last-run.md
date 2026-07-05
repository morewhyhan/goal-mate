# Goal Mate First-run Agent Flow Verification

- Time: 2026-07-05T19:23:10.746Z
- Base URL: http://127.0.0.1:3005
- Test user: fir...@goalmate.local
- Test data kept: no

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| FRA-HEALTH | local API is reachable before first-run verification | PASS | GET /api/health status=200 |
| FRA-AUTH | a clean first-run user can register and get a session | PASS | user=fir...@goalmate.local |
| FRA-CLEAN-WORKSPACE | new user starts without goal or markdown business data | PASS | goals=0; md=0 |
| FRA-THREAD | first-run user can create an Agent thread | PASS | thread=745397c3-4148-4412-a8ec-06315f43143b |
| FRA-VAGUE-CLARIFY | vague first goal input asks one key clarification and does not create fake goal data | PASS | type=first_goal_clarification; goals=0; reply=你最终想看到什么可验证结果？用一句话说清楚“到什么程度算成”。 |
| FRA-NATURAL-DRAFT | specific natural first goal input creates goal scaffold and pending activation | PASS | goal=09bbaa53-57f2-4399-b265-a5a66bbba088; kr=3; conditions=3; stages=3; action=c0b22d54-9205-4c18-96a0-9de29d11b298; activation=19e3bace-d23d-4d84-bc9b-2033cdd0ea51 |
| FRA-ACTIVATE | confirming the pending activation makes the drafted goal current and confirms its reasoning card | PASS | status=ACTIVE; focus=true; card=CONFIRMED |
| FRA-TODAY | Today picks up the activated first goal and exposes one next action | PASS | goal=09bbaa53-57f2-4399-b265-a5a66bbba088; action=推进一个 15 分钟可验证开发小步 |
| FRA-GOAL-MARKDOWN | first goal draft writes a Markdown goal document for Logs/Agent context | PASS | goals/09bbaa53-57f2-4399-b265-a5a66bbba088.md |
| FRA-MODEL-AUTH | a clean first-run user with a configured model can register and get a session | PASS | user=fir...@goalmate.local |
| FRA-MODEL-THREAD | model-configured first-run user can create an Agent thread | PASS | thread=5ec922e2-dc83-46ae-af17-1cc3a100886d |
| FRA-MODEL-FIRST-GOAL-ROUTER | configured model gets first chance to route a concrete first goal instead of hard-coded local scaffold taking over | PASS | routerCalls=1; goal=模型生成的首个目标 1783279371576; action=模型生成的首个行动 1783279371576 |
| FRA-CLEANUP | temporary first-run user and data are removed | PASS | cleanup completed |
