# Goal Mate Settings Self-service Verification

- Time: 2026-07-04T14:09:53.050Z
- Base URL: http://127.0.0.1:3002
- Test user: set...@goalmate.local
- Test data kept: no
- Result: PASS

## Scope

This report proves a clean user can configure model, QQ Bot, reminder rhythm and behavior controls through the same Web/API surfaces used by Settings. It uses local fake model and QQ endpoints, so it does not prove external DeepSeek balance or real QQ Gateway delivery.

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| SSS-HEALTH | local API is reachable before Settings self-service verification | PASS | GET /api/health status=200 |
| SSS-AUTH | a clean user can register for Settings self-service configuration | PASS | user=set...@goalmate.local |
| SSS-INITIAL-CONTROL-CENTER | Settings Control Center is readable before user-managed configuration and does not inherit global QQ credentials | PASS | model=missing_key; qq=missing_config |
| SSS-MODEL-SAVE | user can save model API configuration from Settings without response leaking raw API key | PASS | status=200; model=settings-self-model-1783174190056; source=user_encrypted |
| SSS-MODEL-TEST | Settings model test uses the current user default model and configured API Base | PASS | ok=true; model=settings-self-model-1783174190056; fakeCalls=1 |
| SSS-MODEL-SECRET-AT-REST | model API key is encrypted at rest under the current user | PASS | apiKeyRef=enc:v1 |
| SSS-QQ-SAVE | user can save QQ Bot config from Settings without response leaking raw token | PASS | status=200; source=settings; configured=true |
| SSS-QQ-TEST | Settings QQ test uses current user config and configured API Base before binding | PASS | status=token_ok_no_binding; fakeTokenCalls=1 |
| SSS-QQ-BINDING-CODE | Settings generates an active QQ binding code that resolves only to the current user account | PASS | code=GM-QWL32A; owner=true |
| SSS-REMINDERS-SAVE | user can configure morning, midday and evening reminder rhythm from Settings | PASS | status=200; rules=3 |
| SSS-BEHAVIOR-SAVE | user can configure behavior controls without creating a second fake scheduler source | PASS | logs=true; agentLogs=true; max=2 |
| SSS-CONTROL-CENTER-READY | Settings Control Center reflects user-managed model, QQ and reminder configuration in one place | PASS | model=configured; qq=configured; reminders=4 |
| SSS-EXPORT-REDACTION | settings export includes configuration metadata but never leaks model or QQ raw secrets | PASS | models=2; reminders=4 |
| SSS-QQ-SECRET-AT-REST | QQ token is encrypted at rest under the current user | PASS | tokenRef=enc:v1 |
| SSS-CLEANUP | temporary Settings self-service user and data are removed | PASS | cleanup completed |
