#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${GOAL_MATE_APP_ROOT:-/opt/goal-mate}"
APP_DIR="${GOAL_MATE_APP_DIR:-$APP_ROOT/src}"
SERVICE_USER="${GOAL_MATE_SERVICE_USER:-goalmate}"
SERVICE_GROUP="${GOAL_MATE_SERVICE_GROUP:-$SERVICE_USER}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
START_SERVICES="${GOAL_MATE_START_SERVICES:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$PROJECT_ROOT/deploy/systemd"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "systemd templates not found: $TEMPLATE_DIR" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "app directory not found: $APP_DIR" >&2
  echo "Deploy or extract the project to $APP_ROOT first." >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "missing environment file: $APP_DIR/.env" >&2
  echo "Create it from src/.env.example and fill DATABASE_URL, NEXT_PUBLIC_APP_URL, QQ_BOT_APP_ID, QQ_BOT_TOKEN." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  "${SUDO[@]}" useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

"${SUDO[@]}" mkdir -p "$APP_ROOT"
"${SUDO[@]}" chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_ROOT"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for template in "$TEMPLATE_DIR"/goal-mate-*.service; do
  service_name="$(basename "$template")"
  sed \
    -e "s|User=goalmate|User=$SERVICE_USER|g" \
    -e "s|Group=goalmate|Group=$SERVICE_GROUP|g" \
    -e "s|WorkingDirectory=/opt/goal-mate/src|WorkingDirectory=$APP_DIR|g" \
    -e "s|EnvironmentFile=/opt/goal-mate/src/.env|EnvironmentFile=$APP_DIR/.env|g" \
    "$template" > "$tmp_dir/$service_name"
done

"${SUDO[@]}" cp "$tmp_dir"/goal-mate-*.service "$SYSTEMD_DIR/"
"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable goal-mate-web.service goal-mate-qq-worker.service goal-mate-scheduler-worker.service

if [[ "$START_SERVICES" == "1" ]]; then
  "${SUDO[@]}" systemctl restart goal-mate-web.service goal-mate-qq-worker.service goal-mate-scheduler-worker.service
fi

echo "Goal Mate systemd services installed."
echo
echo "Status:"
systemctl --no-pager --full status goal-mate-web.service goal-mate-qq-worker.service goal-mate-scheduler-worker.service || true
echo
echo "Logs:"
echo "  journalctl -u goal-mate-web.service -f"
echo "  journalctl -u goal-mate-qq-worker.service -f"
echo "  journalctl -u goal-mate-scheduler-worker.service -f"
