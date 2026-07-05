# Long-term Dialogue Trial Verification

- Time: 2026-07-05T12:41:02.447Z
- Result: FAIL
- Live model requested: yes
- Live model used: yes
- Model: gpt-5-nano
- API base: https://api.b.ai
- Test user: lon...@goalmate.local
- Test data kept: no

No API key is written to this report.

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| LTD-SEED | trial creates an isolated long-term dialogue workspace with a real goal, KR, condition and thread | PASS | user=lon...@goalmate.local; goal=让强惰性用户持续推进三个长期目标 |
| LTD-LIVE-MODEL-ENABLED | trial will call the configured live model for every assistant turn | PASS | model=gpt-5-nano; apiBase=https://api.b.ai; key=configured |
| LTD-LIVE-PREFLIGHT | live model must answer one preflight message before the 14-day trial starts | FAIL | fetch failed |
| LTD-CLEANUP | temporary long-term dialogue trial user and data are removed | PASS | cleanup completed |
