# Long-term Dialogue Trial Verification

- Time: 2026-07-05T19:09:48.098Z
- Result: PASS
- Live model requested: no
- Live model used: no
- Model: gpt-5-nano
- API base: https://api.b.ai
- Test user: lon...@goalmate.local
- Test data kept: no

No API key is written to this report.

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| LTD-SEED | trial creates an isolated long-term dialogue workspace with a real goal, KR, condition and thread | PASS | user=lon...@goalmate.local; goal=让强惰性用户持续推进三个长期目标 |
| LTD-LIVE-MODEL-SKIPPED | trial is running deterministic long-term simulation because live mode is not enabled | PASS | set RUN_REAL_LONG_TERM_AI=1 and a model API key to run live |
| LTD-LIVE-PREFLIGHT-SKIPPED | live model preflight is skipped when deterministic trial is used | PASS | live disabled |
| LTD-DIALOGUE-DAYS | trial runs a compressed fourteen-day long-term dialogue with user and assistant turns | PASS | assistant=14; days=14 |
| LTD-REPLY-QUALITY | every long-term assistant reply passes secretary-style quality audit | PASS | passed=14/14; failures=none |
| LTD-RISK-COVERAGE | trial covers long-term risks: perfunctory feedback, no response, reactance, fake done, not-true goal, too hard, wrong path and reality accident | PASS | 目标过多/任务太难/连续敷衍/装死不回复/目标不真/反感提醒/路径错误/证据不足/现实意外/正常推进/降级不降目标/路径恢复/长期反馈/周复盘 |
| LTD-INTERVENTION-EFFECT | later plan becomes easier while long-term goal and KR remain intact | PASS | earlyMax=90; laterMax=10; kr=14 天内至少 10 天产生可验证行动:0.8/用户更愿意回复且提醒打扰下降:1 |
| LTD-USER-REPLY-WILLINGNESS | trial observes explicit user willingness signals instead of only internal state changes | PASS | willingnessSignals=3 |
| LTD-LOGS | trial writes normal day and week Markdown logs, not a new log type | PASS | days=14; weeks=2 |
| LTD-LIVE-REPLIES | live mode uses real model replies for every day when explicitly enabled | PASS | not live; deterministic trial only |
| LTD-CLEANUP | temporary long-term dialogue trial user and data are removed | PASS | cleanup completed |
