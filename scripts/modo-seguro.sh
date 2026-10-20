#!/bin/bash
# modo-seguro.sh — Reinicia o agente em MODO DE SEGURANCA: sessao nova, SEM carregar a
# conversa anterior (que fica guardada), com a mensagem que travou em quarentena e um
# recado para o agente avisar o dono que voltou.
#
# Uso:  bash modo-seguro.sh <config.sh> [--motivo "texto"] [--origem painel|watchdog|manual]
#                                      [--json] [--dry-run]
#
# Quando usar: o agente parou de responder porque a CONVERSA esta envenenada (a Anthropic
# bloqueou uma resposta pelo filtro de seguranca, ou a conversa ficou grande demais). Um
# reinicio normal nao resolve esses dois casos: ele recarrega a mesma conversa e o
# problema volta. O porque de cada passo esta no cabecalho de _lib/reinicio.py.
#
# Este script so le o config do agente (as variaveis TERACLAW_*) e entrega o resto ao
# _lib/reinicio.py, que e o mesmo codigo que o painel e o watchdog usam. Um conserto la
# vale para os tres.

set -uo pipefail

CONFIG="${1:-${TERACLAW_CONFIG:-}}"
if [ -z "$CONFIG" ] || [ ! -f "$CONFIG" ]; then
    echo "modo-seguro.sh: nao achei a config do agente ('${CONFIG}')." >&2
    echo "  O que fazer: passe o caminho do .teraclaw/config.sh do agente como primeiro argumento." >&2
    exit 64
fi
shift

# shellcheck disable=SC1090
source "$CONFIG"
: "${TERACLAW_WORKSPACE:?modo-seguro.sh: a config nao define TERACLAW_WORKSPACE}"
export TERACLAW_WORKSPACE TERACLAW_SLUG TERACLAW_BUNKER_CARD TERACLAW_BUNKER_URL RUNNER_TOKEN_FILE TERACLAW_INJECT_MODE TERACLAW_SERVICE

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/_lib/reinicio.py" seguro "$@"
