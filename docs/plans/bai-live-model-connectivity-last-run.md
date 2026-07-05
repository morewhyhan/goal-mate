# B.AI Live Model Connectivity Check

- Time: 2026-07-05
- Provider: B.AI
- Model: gpt-5-nano
- API Base: https://api.b.ai
- API key in report: no
- Result: PASS

## Checks

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| BAI-DIRECT-CURL | Direct top-level curl request through local proxy reaches B.AI | PASS | `https://api.b.ai/v1/chat/completions` returned HTTP 200 and assistant content `OK` with model `gpt-5-nano-2025-08-07`. |
| BAI-NODE-HELPER | Goal Mate Node model helper reaches B.AI through `GOAL_MATE_MODEL_PROXY` fallback | PASS | `fetchModelProvider(chatCompletionsUrl('https://api.b.ai'))` returned HTTP 200 and assistant content `OK`. |
| BAI-WEB-LIVE-FLOW | Full Web Agent live model flow reaches B.AI through Settings and Agent runtime | PASS | `pnpm verify:live-model-agent:write` passed against `http://127.0.0.1:3003`; Settings model test returned `B.AI 连接成功。`; Agent returned a secretary-style live reply. |

## Runtime notes

The local WSL/Node runtime cannot directly reach `api.b.ai` without proxy. For this environment, run the Web server with:

```bash
GOAL_MATE_MODEL_PROXY="http://127.0.0.1:7890"
GOAL_MATE_MODEL_FORCE_CURL="1"
```

The API key is still configured per account through Settings or temporary live-verification environment variables. It must not be committed.
