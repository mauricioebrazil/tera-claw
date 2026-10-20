#!/bin/bash
# detect-teraclaw.sh — Acha assistentes Tera Claw instalados nesta maquina.
#
# Uso:
#   bash detect-teraclaw.sh            # lista todos (uma linha por agente: slug|workspace|config)
#   bash detect-teraclaw.sh <slug>     # imprime o config.sh path daquele slug (rc!=0 se nao achar)
#
# Cobre os dois layouts de instalacao do Tera Claw:
#   - sandbox/root:    /root/teraclaw/<slug>/.teraclaw/config.sh   (roda como root)
#   - usuario dedicado: /home/teraclaw-<slug>/.teraclaw/config.sh
# E confirma cruzando com o state-dir do Telegram em ~/.claude/teraclaw-channels/<slug>/.

set -uo pipefail

WANT="${1:-}"

# Junta candidatos dos dois layouts conhecidos, sem duplicar. O ls falha quando o padrao
# nao casa com nada (layout que esta maquina nao usa); isso e esperado, entao o erro some.
mapfile -t CONFIGS < <(
  { ls -1 /root/teraclaw/*/.teraclaw/config.sh 2>/dev/null
    ls -1 /home/teraclaw-*/.teraclaw/config.sh 2>/dev/null
    ls -1 /home/*/teraclaw/*/.teraclaw/config.sh 2>/dev/null
  } | sort -u
)

found=0
for cfg in "${CONFIGS[@]}"; do
  [ -f "$cfg" ] || continue
  # Le slug/workspace sem dar source (evita efeitos colaterais de env).
  slug=$(grep -E '^export TERACLAW_SLUG=' "$cfg" | head -1 | sed -E 's/.*="?([^"]*)"?.*/\1/')
  ws=$(grep -E '^export TERACLAW_WORKSPACE=' "$cfg" | head -1 | sed -E 's/.*="?([^"]*)"?.*/\1/')
  [ -n "$slug" ] || continue

  if [ -n "$WANT" ]; then
    if [ "$slug" = "$WANT" ]; then
      echo "$cfg"
      exit 0
    fi
    continue
  fi

  # lista as extensoes instaladas neste agente (o DG Alive e uma delas)
  exts=""
  if [ -d "$ws/.teraclaw/ext" ]; then
    for e in "$ws"/.teraclaw/ext/*/; do
      [ -f "${e}ext.json" ] || continue
      exts="${exts}${exts:+,}$(basename "$e")"
    done
  fi
  [ -n "$exts" ] || exts="-"
  # marca se o service existe
  svc="no"
  systemctl list-unit-files "teraclaw-${slug}.service" >/dev/null 2>&1 && \
    systemctl cat "teraclaw-${slug}.service" >/dev/null 2>&1 && svc="yes"

  echo "${slug}|${ws}|${cfg}|ext=${exts}|service=${svc}"
  found=1
done

if [ -n "$WANT" ]; then
  echo "detect-teraclaw: slug '$WANT' nao encontrado" >&2
  exit 1
fi

[ "$found" = "1" ] || { echo "detect-teraclaw: nenhum Tera Claw encontrado nesta maquina" >&2; exit 2; }
exit 0
