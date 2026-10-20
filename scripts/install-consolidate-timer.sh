#!/bin/bash
# install-consolidate-timer.sh — Agenda a consolidacao noturna via systemd timer.
#
# Uso:  sudo bash install-consolidate-timer.sh <config.sh> [HH:MM]
# Default: 04:00. Cria teraclaw-<slug>-consolidate.{service,timer}.

set -euo pipefail

CONFIG="${1:?Uso: install-consolidate-timer.sh <config.sh> [HH:MM]}"
WHEN="${2:-04:00}"
[ -f "$CONFIG" ] || { echo "config nao encontrada: $CONFIG" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090
source "$CONFIG"
: "${TERACLAW_SLUG:?config sem TERACLAW_SLUG}"

RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"; [ -n "$RUN_HOME" ] || RUN_HOME="$HOME"

cat > "/etc/systemd/system/teraclaw-${TERACLAW_SLUG}-consolidate.service" <<EOF
[Unit]
Description=Tera Claw consolidacao de memoria: ${TERACLAW_SLUG}

[Service]
Type=oneshot
User=${RUN_USER}
Environment=HOME=${RUN_HOME}
WorkingDirectory=${TERACLAW_WORKSPACE}
ExecStart=/bin/bash ${SCRIPT_DIR}/consolidate.sh ${CONFIG}
EOF

cat > "/etc/systemd/system/teraclaw-${TERACLAW_SLUG}-consolidate.timer" <<EOF
[Unit]
Description=Tera Claw consolidacao noturna: ${TERACLAW_SLUG} (${WHEN})

[Timer]
OnCalendar=*-*-* ${WHEN}:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "teraclaw-${TERACLAW_SLUG}-consolidate.timer"
echo "Timer de consolidacao agendado pra ${WHEN} todo dia."
echo "Rodar agora (teste):  sudo systemctl start teraclaw-${TERACLAW_SLUG}-consolidate.service"
echo "Ver log:              cat ${TERACLAW_WORKSPACE}/.teraclaw/logs/consolidate.log"
