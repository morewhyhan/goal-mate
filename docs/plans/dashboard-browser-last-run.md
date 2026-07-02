# Goal Mate Dashboard Browser Verification

- Time: 2026-07-02T11:52:23.404Z
- Base URL: http://127.0.0.1:3000
- Authenticated: no
- Screenshots: /mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| BROWSER-FOUND | Edge/Chrome executable is available for dashboard verification | PASS | /mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe |
| BROWSER-COOKIE | browser verification can use authenticated session when supplied | PASS | no cookie supplied; running layout/empty-state smoke |
| DASH-TODAY | /dashboard/today renders required page structure without horizontal overflow | PASS | overflow=-8; runtimeError=false; cells=371; square=true; scopes=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210/today.png |
| DASH-GOALS | /dashboard/goals renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; inputs=0; forbiddenOps=false; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210/goals.png |
| DASH-LOGS | /dashboard/logs renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; textareaVisible=true; saveVisible=true; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210/logs.png |
| DASH-AGENT | /dashboard/agent renders required page structure without horizontal overflow | PASS | overflow=0; runtimeError=false; textarea=true; inputVisible=true; sendVisible=true; pageScroll=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210/agent.png |
| DASH-SETTINGS | /dashboard/settings renders required page structure without horizontal overflow | PASS | overflow=-8; runtimeError=false; modelFields=true; actionButtons=true; overflowingInputs=0; missingText=none; screenshot=/mnt/c/Users/why/Desktop/goal-mate/.artifacts/browser-smoke/20260702-115210/settings.png |
