# Full-chain Backtest Last Run

- Date: 2026-07-05
- Result: PASS for local deterministic full-chain backtest
- Scope: Web Agent tool runtime, QQ scheduler event records, simulated QQ inbound replies, assistant outbound replies, check-ins, diagnosis, Logs, Reviews, Meta-Cognition, goal state updates, KR progress, and Year / Quarter / Month / Week / Day Markdown log hierarchy.
- Boundary: This run does not prove live QQ gateway uptime, does not operate the user's QQ client directly, and does not prove live model-provider availability.

## Commands Run

```bash
pnpm verify:secretary-dialogue-quality
pnpm verify:long-term-dialogue-trial
pnpm verify:qq-scheduler-reply
timeout 420s pnpm verify:two-week-control-loop
```

## Passed Checks

- Secretary dialogue quality: PASS. The assistant replies are concise, non-coercive, diagnostic, and operational across normal progress, not done, perfunctory feedback, no response, topic shift, fake completion, false goal, excessive difficulty, wrong path, real-world accident, and reminder reactance.
- Long-term dialogue trial: PASS. The simulation compressed fourteen days of user-agent interaction and verified reply quality, risk coverage, intervention effect, willingness signals, and normal day/week Markdown logs.
- QQ scheduler reply loop: PASS. A scheduler reply is classified, persisted, linked to check-in, diagnosis, daily log, review, meta-cognition, AgentToolAction audit, and goal execution state.
- Two-week complex control loop: PASS. The simulation created three goals, generated real QQ scheduler event records, simulated inbound QQ replies, produced outbound assistant messages, controlled load across goals, adjusted plans after deviations, linked daily logs to week/month/quarter/year logs, and updated both user model and Agent strategy.

## Evidence Summary

- 14-day long-term dialogue: 14 assistant turns passed quality audit.
- Two-week QQ scheduler simulation: 44 scheduler events, 30 responded events, 30 simulated inbound QQ events, and 30 linked outbound replies.
- Assistant reply quality in two-week loop: 75 / 75 passed.
- P0/P1 risk control in two-week loop: 17 / 17 passed.
- Log hierarchy in two-week loop: 14 day logs, 2 week logs, 1 month log, 1 quarter log, 1 year log, 106 links.
- Goal state changed through check-ins and KR progress, not only chat history.

## Remaining Boundaries

- Live model backtest is not proven in this run because the local deterministic mode was used.
- Live QQ gateway uptime is not proven because the test simulates QQ inbound events instead of controlling the user's QQ client.
- Provider connectivity remains a deployment/environment concern; previous B.AI live attempts failed at network/TLS connection from this machine, and DeepSeek failed because provider balance was insufficient.

## Product Meaning

This backtest proves the current local chain can simulate the intended product loop:

1. The user states goals or reports progress.
2. Agent diagnoses the execution situation instead of only chatting.
3. Agent writes facts, deviations, risk control, next plan, user model updates, and Agent strategy updates into normal logs.
4. The next day's plan becomes easier, safer, or more precise without shrinking the long-term goal.
5. Goal state and KR progress change through the shared runtime.

