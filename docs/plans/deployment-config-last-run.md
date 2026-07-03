# Goal Mate Deployment Config Verification

- Time: 2026-07-02T20:18:29.860Z
- Project root: /mnt/c/Users/why/Desktop/goal-mate

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| DEPLOY-PACKAGE | package scripts expose web, QQ worker, scheduler, one-shot scheduler and local bundle commands | PASS | start=next start; worker:qq=node scripts/qq-bot-worker.mjs; worker:scheduler=node scripts/scheduler-worker.mjs; worker:scheduler:once=node scripts/scheduler-worker.mjs --once --force-reminder=morning_planning; deploy:bundle=node scripts/create-deploy-bundle.mjs |
| DEPLOY-WEB-EXISTS | Web Console service template exists | PASS | goal-mate-web.service |
| DEPLOY-WEB-CONTENT | Web Console service template contains required systemd directives | PASS | required directives present |
| DEPLOY-QQ-EXISTS | QQ Gateway worker service template exists | PASS | goal-mate-qq-worker.service |
| DEPLOY-QQ-CONTENT | QQ Gateway worker service template contains required systemd directives | PASS | required directives present |
| DEPLOY-SCHEDULER-EXISTS | Scheduler worker service template exists | PASS | goal-mate-scheduler-worker.service |
| DEPLOY-SCHEDULER-CONTENT | Scheduler worker service template contains required systemd directives | PASS | required directives present |
| DEPLOY-QQ-WORKER-SYNTAX | QQ worker script passes Node syntax check | PASS | scripts/qq-bot-worker.mjs syntax ok |
| DEPLOY-SCHEDULER-WORKER-SYNTAX | Scheduler worker script passes Node syntax check | PASS | scripts/scheduler-worker.mjs syntax ok |
| DEPLOY-DEPLOY-BUNDLE-SYNTAX | Local deployment bundle script passes Node syntax check | PASS | scripts/create-deploy-bundle.mjs syntax ok |
| DEPLOY-README | systemd README documents local bundle, install, start, status and logs | PASS | README contains deployment commands |
| DEPLOY-LOCAL-ARTIFACTS-IGNORED | local deployment bundles are ignored by git | PASS | .artifacts/ ignore rule present |
| DEPLOY-ENV-EXAMPLE | .env.example documents required deployment variables | PASS | all required variables present |
| DEPLOY-ENV-RECOMMENDED | .env.example documents recommended safety variables | PASS | all recommended variables present |
| DEPLOY-ENV-DEFAULTS | .env.example documents defaulted variables users normally do not need to change | PASS | defaulted variables present |
| DEPLOY-SETTINGS-UI | Settings exposes deployment readiness and separates env-only secrets from UI-managed parameters | PASS | Settings deployment readiness contract scanned |
| DEPLOY-ENV-PLACEHOLDERS | .env.example does not use token-shaped placeholders | PASS | token-shaped placeholder scan completed |
| DEPLOY-DESIGN-DOC | self-hosted worker deployment design references systemd templates and remaining gaps | PASS | deployment design updated |
| DEPLOY-RUNTIME-PLAN | self-hosted runtime verification plan documents real long-running checks | PASS | runtime verification plan present |
| DEPLOY-RUNTIME-REPORT | self-hosted runtime verification report template documents sanitized evidence format | PASS | runtime verification report template present |
