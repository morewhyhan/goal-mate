# Goal Mate Auth Isolation Verification

- Time: 2026-07-04T13:47:25.941Z
- Base URL: http://127.0.0.1:3002
- Test users: iso...@goalmate.local, iso...@goalmate.local
- Test data kept: no

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| ISO-HEALTH | local API is reachable before isolation verification | PASS | GET /api/health status=200 |
| ISO-AUTH-USERS | two independent authenticated users can be created | PASS | a=iso...@goalmate.local; b=iso...@goalmate.local |
| ISO-SEED | test data is seeded under separate userIds | PASS | aGoal=d229adc5-56fa-4459-bb88-d069d743299b; bGoal=91bd01c9-82f0-445b-914a-54553b9bd71d |
| ISO-MODEL-KEY-A | user A can save own model API key without response leaking it | PASS | status=200; source=user_encrypted |
| ISO-MODEL-KEY-B | user B can save own model API key without response leaking it | PASS | status=200; source=user_encrypted |
| ISO-MODEL-KEY-AT-REST | per-user model API keys are encrypted at rest and differ by user | PASS | aRef=enc:v1; bRef=enc:v1 |
| ISO-QQ-CONFIG | two users can save separate QQ bot configs without leaking raw tokens | PASS | a=200; b=200 |
| ISO-QQ-BINDING-CODE | QQ binding codes are generated per current user and are not shared across accounts | PASS | a=GM-MW9M4A; b=GM-48Y85J |
| ISO-QQ-SECRET-AT-REST | QQ tokens are encrypted and binding codes are stored under the correct user account | PASS | aRef=enc:v1; bRef=enc:v1 |
| ISO-UNAUTH-GUARD | private goals API rejects unauthenticated access | PASS | GET /api/goals status=401 |
| ISO-GOALS-A | user A goals list contains A data and not B data | PASS | status=200; count=1 |
| ISO-GOALS-B | user B goals list contains B data and not A data | PASS | status=200; count=1 |
| ISO-GOAL-ID-BLOCK | user B cannot read user A goal by direct id | PASS | GET /api/goals/:aGoal status=404 |
| ISO-LOGS-A | user A logs tree contains A log and not B log | PASS | status=200; count=1 |
| ISO-LOGS-B | user B logs tree contains B log and not A log | PASS | status=200; count=1 |
| ISO-LOG-ID-BLOCK | user B cannot read user A log by direct id | PASS | GET /api/logs/:aLog status=404 |
| ISO-THREADS-A | user A agent threads contain A thread and not B thread | PASS | status=200; count=1 |
| ISO-THREADS-B | user B agent threads contain B thread and not A thread | PASS | status=200; count=1 |
| ISO-THREAD-ID-BLOCK | user B cannot read user A thread messages by direct id | PASS | GET /api/agent/threads/:aThread/messages status=404 |
| ISO-MODELS-A | user A models contain A provider and not B provider | PASS | status=200 |
| ISO-MODELS-B | user B models contain B provider and not A provider | PASS | status=200 |
| ISO-EXPORT-A | user A export contains only A workspace markers and no raw model key | PASS | status=200 |
| ISO-EXPORT-B | user B export contains only B workspace markers and no raw model key | PASS | status=200 |
| ISO-CLEANUP | temporary isolation users and data are removed | PASS | cleanup completed |
