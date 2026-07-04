# Goal Mate Scheduler Reminder Rules Verification

- Time: 2026-07-04T11:22:51.951Z
- Test user: sch...@goalmate.local
- Test data kept: no

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| SRR-SEED | test user has QQ config and user-owned reminder rules without relying on env defaults | PASS | user=sch...@goalmate.local; disabledUser=sch...@goalmate.local; morning=bca0023c-bdcc-4741-a1ac-5dc1e2c2e2d4; disabled=d4837989-123d-4197-9535-2f22d62ed817 |
| SRR-QQ-CONFIG-ISOLATION | QQ config resolution is user-scoped and global resolution ignores newer disabled accounts | PASS | own=settings/verify-app-1783164166711; disabledConfigured=false; globalUser=enabled-user |
| SRR-ENABLED-FORCED-DUE | enabled user reminder rule is consumed by Scheduler even when another user has a newer disabled QQ config | PASS | status=failed; rule=bca0023c-bdcc-4741-a1ac-5dc1e2c2e2d4; schedule=08:30; error=No enabled QQ binding. |
| SRR-DISABLED-NOT-CONSUMED | disabled reminder rule is not consumed even when another rule is forced | PASS | middayEvents=0 |
| SRR-MAX-PER-DAY | Scheduler respects maxPerDay and does not create another event after today already has a sent event | PASS | eveningEvents=1; maxPerDay=1 |
| SRR-QUIET-HOURS | Scheduler respects quietHours and skips a due rule inside the quiet window | PASS | weeklyEvents=0; schedule=SAT 19:22; quiet=19:21-19:23 |
| SRR-FAKE-QQ-SENT | Scheduler can use the user-configured QQ API base to get token and send a bound QQ message | PASS | status=sent; tokenCalls=1; sends=1; url=/v2/users/fake-c2c-1783164166711/messages |
| SRR-PLANNER-MESSAGE-CONTENT | sent Scheduler message points to today action, fallback action and an auditable intervention decision instead of a blank fixed reminder | PASS | planner=fallback_rule; type=risk_warning; message=中午检查一下：今天这一步是「完成主动提醒内容验收 1783164166711」。 现在是：已开始、已完成、还没开始，还是需要缩小？ 做不动的话就执行：如果状态差，只回复完成/没完成 1783164166711 先控风险：如果等会儿想偏离「验证主动推进目标 1783164166711」，不要重新规划，先执行预案里的最小替代动作。现在能把替代方案准备好吗？ |
| SRR-SCHEDULER-AUDIT | Scheduler sent reminder is persisted as AgentMessage and AgentToolAction with planner_source for later review | PASS | assistant=9c2cb40a-921f-470c-a0ec-842630f761b0; audit=executed; planner=fallback_rule |
| SRR-CLEANUP | temporary scheduler rules user and data are removed | PASS | cleanup completed |
