# Goal Mate Dashboard Browser Verification

- Time: 2026-07-04T14:45:39.836Z
- Base URL: http://127.0.0.1:3002
- Authenticated: yes
- Require auth: yes
- Empty workspace mode: yes
- Screenshots: /mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| BROWSER-AUTH-PREPARE | empty authenticated browser smoke prepares a clean user without demo seed data | PASS | mode=sign-up; user=das...@goalmate.local; seed skipped for clean empty workspace |
| BROWSER-AUTH-PREFLIGHT | session cookie can read authenticated API before browser navigation | PASS | GET /api/today status=200 |
| BROWSER-FOUND | Edge/Chrome executable is available for dashboard verification | PASS | /mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe |
| BROWSER-COOKIE | empty workspace browser verification signs in through the real browser auth flow | PASS | signIn=200; today=200 |
| DASH-TODAY | /dashboard/today renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; cells=364; square=true; scopes=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413/today.png |
| DASH-GOALS | /dashboard/goals renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; inputs=0; forbiddenOps=false; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413/goals.png |
| DASH-LOGS | /dashboard/logs renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; textareaVisible=true; saveVisible=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413/logs.png |
| DASH-AGENT | /dashboard/agent renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; inputVisible=true; sendVisible=true; pageScroll=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413/agent.png |
| DASH-SETTINGS | /dashboard/settings renders required page structure without horizontal overflow | PASS | overflow=-8; runtimeError=false; modelFields=true; actionButtons=true; overflowingInputs=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260704-144413/settings.png |
