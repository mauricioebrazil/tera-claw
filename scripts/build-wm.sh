#!/bin/bash
# build-wm.sh — wrapper do build-working-memory.py pros timers systemd.
# Sourcia a config (exporta TERACLAW_*) e roda o rebuild da working-memory.
#
# Uso:  bash build-wm.sh <.teraclaw/config.sh> [--agora-only]

set -uo pipefail
CONFIG="${1:?Uso: build-wm.sh <config.sh> [--agora-only]}"
[ -f "$CONFIG" ] || { echo "config nao encontrada: $CONFIG" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONFIG"
: "${TERACLAW_WORKSPACE:?config sem TERACLAW_WORKSPACE}"
export TERACLAW_WORKSPACE TERACLAW_OWNER TERACLAW_NAME TERACLAW_TZ
export TERACLAW_PERSONA_DIR="${TERACLAW_PERSONA_DIR:-$TERACLAW_WORKSPACE/persona}"
PLUGIN="${TERACLAW_PLUGIN_ROOT:-$TERACLAW_WORKSPACE/.teraclaw/plugin}"

# Pulso: registra ok/erro deste cron no ledger (componente "build-wm").
# shellcheck disable=SC1091
if source "$PLUGIN/scripts/_lib/pulso-lib.sh"; then
    pulso_auto build-wm
else
    echo "build-wm: nao consegui carregar $PLUGIN/scripts/_lib/pulso-lib.sh. O build roda, mas o Pulso fica sem o registro; reinstale o plugin do agente." >&2
fi

python3 "$PLUGIN/scripts/build-working-memory.py" "${2:-}"
RC=$?

# Sem o dono da pasta (stat falhou), assume root e pula o chown: nada a corrigir nesse caso.
WS_OWNER=$(stat -c '%U' "$TERACLAW_WORKSPACE" 2>/dev/null || echo root)
if [ "$WS_OWNER" != "root" ]; then
    for f in working-memory.md memory/wm-transbordo.md; do
        [ -f "$TERACLAW_WORKSPACE/$f" ] || continue
        chown "$WS_OWNER" "$TERACLAW_WORKSPACE/$f" \
            || echo "build-wm: nao consegui passar $f para o usuario $WS_OWNER (o agente pode nao conseguir editar)" >&2
    done
fi

# Depois do build completo, atualiza tambem o indice da busca em conversas. E a rede de
# seguranca de quem ainda nao tem o timer conversas-fts (agentes instalados antes de
# 01/10/2026): pelo menos uma vez por dia o indice anda. Falha aqui nao muda o resultado
# do build (a working-memory ja foi escrita), mas fica registrada no conversas-fts.log.
if [ "${2:-}" != "--agora-only" ] && [ -f "$PLUGIN/scripts/conversas-fts.sh" ]; then
    bash "$PLUGIN/scripts/conversas-fts.sh" "$CONFIG" \
        || echo "build-wm: o reindex da busca em conversas falhou; ver $TERACLAW_WORKSPACE/.teraclaw/logs/conversas-fts.log" >&2
fi

# Rede de seguranca da memoria: se a reflexao da noite consolidou o MEMORY.md na sessao viva
# e ninguem conferiu (a persona esqueceu o recibo), confere agora. So no build completo.
# Idempotente: se o poke-ack ja conferiu, esta chamada nao faz nada.
if [ "${2:-}" != "--agora-only" ] && [ -f "$PLUGIN/scripts/_lib/memoria_guarda.py" ]; then
    REFLOG="$TERACLAW_WORKSPACE/.teraclaw/logs/reflection.log"
    mkdir -p "$(dirname "$REFLOG")" || echo "build-wm: nao consegui criar a pasta de $REFLOG. A conferencia do MEMORY.md roda, mas o resultado dela nao sera registrado; confira permissao e espaco em disco." >&2
    python3 "$PLUGIN/scripts/_lib/memoria_guarda.py" conferir --ws "$TERACLAW_WORKSPACE" >> "$REFLOG" 2>&1 \
        || echo "[$(date '+%F %T')] build-wm: a conferencia do MEMORY.md saiu com codigo diferente de 0 (3 = restaurou a versao anterior; outro = nao consegui conferir). Detalhes nas linhas acima." >> "$REFLOG"
fi
exit "$RC"
