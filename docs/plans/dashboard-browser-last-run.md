# Goal Mate Dashboard Browser Verification

- Time: 2026-07-03T01:33:29.215Z
- Base URL: http://localhost:3000
- Authenticated: yes
- Require auth: yes
- Screenshots: /mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| BROWSER-AUTH-PREPARE | authenticated browser smoke prepares a real seeded user without writing the cookie to reports | PASS | mode=sign-in; user=das...@goalmate.local; Seeded Goal Mate demo data for dashboard-browser@goalmate.local |
| BROWSER-AUTH-PREFLIGHT | session cookie can read authenticated API before browser navigation | PASS | GET /api/today status=200 |
| BROWSER-FOUND | Edge/Chrome executable is available for dashboard verification | PASS | /mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe |
| BROWSER-COOKIE | browser verification signs in through the real browser auth flow | PASS | signIn=200; today=200 |
| DASH-TODAY | /dashboard/today renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; cells=371; square=true; scopes=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246/today.png |
| DASH-GOALS | /dashboard/goals renders required page structure without horizontal overflow | PASS | overflow=-8; runtimeError=false; inputs=0; forbiddenOps=false; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246/goals.png |
| DASH-LOGS | /dashboard/logs renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; textareaVisible=true; saveVisible=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246/logs.png |
| DASH-AGENT | /dashboard/agent renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; inputVisible=true; sendVisible=true; pageScroll=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246/agent.png |
| DASH-SETTINGS | /dashboard/settings renders required page structure without horizontal overflow | PASS | overflow=-8; runtimeError=false; modelFields=true; actionButtons=true; overflowingInputs=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260703-013246/settings.png |
