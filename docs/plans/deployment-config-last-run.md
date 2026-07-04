# Goal Mate Deployment Config Verification

- Time: 2026-07-04T15:05:10.964Z
- Project root: /mnt/c/Users/why/Desktop/goal-mate

| ID | Purpose | Result | Evidence |
| --- | --- | --- | --- |
| DEPLOY-PACKAGE | package scripts expose supervised dev, web, QQ worker, scheduler, one-shot scheduler, local bundle and zero-to-one verification commands | PASS | dev=node scripts/dev-supervisor.mjs; start=next start; worker:qq=node scripts/qq-bot-worker.mjs; worker:scheduler=node scripts/scheduler-worker.mjs; worker:scheduler:once=node scripts/scheduler-worker.mjs --once --force-reminder=morning_planning; deploy:bundle=node scripts/create-deploy-bundle.mjs; deploy:systemd:install=bash ../deploy/install-systemd.sh; verify:zero-to-one=node scripts/verify-zero-to-one-product-flow.mjs; verify:qq-scheduler-reply=node scripts/verify-qq-scheduler-reply-loop.mjs; verify:dashboard-browser:empty-auth=node scripts/verify-dashboard-browser.mjs --prepare-empty-auth --require-auth; verify:live-model-agent=node scripts/verify-live-model-agent-flow.mjs |
| DEPLOY-WEB-EXISTS | Web Console service template exists | PASS | goal-mate-web.service |
| DEPLOY-WEB-CONTENT | Web Console service template contains required systemd directives | PASS | required directives present |
| DEPLOY-QQ-EXISTS | QQ Gateway worker service template exists | PASS | goal-mate-qq-worker.service |
| DEPLOY-QQ-CONTENT | QQ Gateway worker service template contains required systemd directives | PASS | required directives present |
| DEPLOY-SCHEDULER-EXISTS | Scheduler worker service template exists | PASS | goal-mate-scheduler-worker.service |
| DEPLOY-SCHEDULER-CONTENT | Scheduler worker service template contains required systemd directives | PASS | required directives present |
| DEPLOY-DEV-SUPERVISOR-SYNTAX | local dev supervisor script passes Node syntax check | PASS | scripts/dev-supervisor.mjs syntax ok |
| DEPLOY-QQ-WORKER-SYNTAX | QQ worker script passes Node syntax check | PASS | scripts/qq-bot-worker.mjs syntax ok |
| DEPLOY-SCHEDULER-WORKER-SYNTAX | Scheduler worker script passes Node syntax check | PASS | scripts/scheduler-worker.mjs syntax ok |
| DEPLOY-RUNTIME-HEARTBEAT-SYNTAX | runtime heartbeat helper passes Node syntax check | PASS | lib/runtime-heartbeat.mjs syntax ok |
| DEPLOY-DEPLOY-BUNDLE-SYNTAX | Local deployment bundle script passes Node syntax check | PASS | scripts/create-deploy-bundle.mjs syntax ok |
| DEPLOY-ZERO-TO-ONE-VERIFY-SYNTAX | zero-to-one product flow verifier passes Node syntax check | PASS | scripts/verify-zero-to-one-product-flow.mjs syntax ok |
| DEPLOY-QQ-SCHEDULER-REPLY-VERIFY-SYNTAX | QQ scheduler reply loop verifier passes Node syntax check | PASS | scripts/verify-qq-scheduler-reply-loop.mjs syntax ok |
| DEPLOY-LIVE-MODEL-AGENT-VERIFY-SYNTAX | live model Agent flow verifier passes Node syntax check | PASS | scripts/verify-live-model-agent-flow.mjs syntax ok |
| DEPLOY-SYSTEMD-INSTALL-EXISTS | systemd install script exists | PASS | deploy/install-systemd.sh |
| DEPLOY-SYSTEMD-INSTALL-CONTENT | systemd install script installs and enables all systemd services | PASS | install script contains service install commands |
| DEPLOY-README | systemd README documents local bundle, automated install, manual install, status and logs | PASS | README contains deployment commands |
| DEPLOY-README-NO-DEFAULT-USER | systemd README documents QQ binding-code ownership instead of default-user auto binding | PASS | README QQ ownership boundary scanned |
| DEPLOY-LOCAL-ARTIFACTS-IGNORED | local deployment bundles are ignored by git | PASS | .artifacts/ ignore rule present |
| DEPLOY-ENV-EXAMPLE | .env.example documents required deployment variables | PASS | all required variables present |
| DEPLOY-ENV-RECOMMENDED | .env.example documents recommended safety variables | PASS | all recommended variables present |
| DEPLOY-ENV-DEFAULTS | .env.example documents defaulted variables users normally do not need to change | PASS | defaulted variables present |
| DEPLOY-SETTINGS-UI | Settings exposes deployment readiness and separates env-only secrets from UI-managed parameters | PASS | Settings deployment readiness contract scanned |
| DEPLOY-DEV-SUPERVISOR | local pnpm dev starts Web, QQ Worker and Scheduler Worker together | PASS | dev supervisor contract scanned |
| DEPLOY-RUNTIME-HEARTBEAT | Web, QQ Worker and Scheduler Worker write runtime heartbeats visible in Settings | PASS | runtime heartbeat contract scanned |
| DEPLOY-QQ-BINDING-SAFETY | QQ worker requires explicit binding code before assigning an unbound QQ context to a user and has no default-user fallback | PASS | QQ binding-code contract scanned |
| DEPLOY-ENV-PLACEHOLDERS | .env.example does not use token-shaped placeholders | PASS | token-shaped placeholder scan completed |
| DEPLOY-ENV-NO-USER-QQ-SECRETS | .env.example does not expose user-level QQ App ID or Token fields | PASS | QQ App ID and Token must be configured per account in Settings |
| DEPLOY-DESIGN-DOC | self-hosted worker deployment design references systemd templates and remaining gaps | PASS | deployment design updated |
| DEPLOY-QQ-NO-DEFAULT-USER-DOC | QQ integration docs require binding-code ownership instead of default-user auto binding | PASS | QQ docs no longer document default-user binding |
| DEPLOY-RUNTIME-PLAN | self-hosted runtime verification plan documents real long-running checks | PASS | runtime verification plan present |
| DEPLOY-RUNTIME-REPORT | self-hosted runtime verification report template documents sanitized evidence format | PASS | runtime verification report template present |
