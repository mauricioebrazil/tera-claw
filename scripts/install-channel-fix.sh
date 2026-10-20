#!/bin/bash
# install-channel-fix.sh — Instala o mitigador do bug "canal telegram mudo no 2o start".
#
# Coloca um drop-in systemd com ExecStartPre no servico do Tera Claw (teraclaw-<slug>.service)
# que limpa a chave needs-auth do telegram antes de cada start. NAO edita a unit do Tera Claw
# (drop-in e arquivo separado em .service.d/). Idempotente.
#
# Uso:  sudo bash install-channel-fix.sh <.teraclaw/config.sh>
#       sudo bash install-channel-fix.sh <.teraclaw/config.sh> --off   (remove)

set -uo pipefail

CONFIG="${1:?Uso: install-channel-fix.sh <.teraclaw/config.sh> [--off]}"
[ -f "$CONFIG" ] || { echo "config nao encontrada: $CONFIG" >&2; exit 1; }
OFF=0; [ "${2:-}" = "--off" ] && OFF=1
set +u; # shellcheck disable=SC1090
source "$CONFIG"; set -u
: "${TERACLAW_SLUG:?config sem TERACLAW_SLUG}"
: "${TERACLAW_WORKSPACE:?config sem TERACLAW_WORKSPACE}"
SLUG="$TERACLAW_SLUG"; WS="$TERACLAW_WORKSPACE"
PLUGIN="${TERACLAW_PLUGIN_ROOT:-$WS/.teraclaw/plugin}"

DROPDIR="/etc/systemd/system/teraclaw-${SLUG}.service.d"
DROPIN="$DROPDIR/10-teraclaw-tg-authcache.conf"
PRESTART="$WS/.teraclaw/prestart-clear-tg-authcache.sh"

if [ "$OFF" = "1" ]; then
    rm -f "$DROPIN" "$PRESTART"
    # A pasta pode nao existir ou ter outros drop-ins; nos dois casos nao ha o que remover.
    rmdir --ignore-fail-on-non-empty "$DROPDIR" 2>/dev/null || true
    systemctl daemon-reload || echo "install-channel-fix: o systemctl daemon-reload falhou. O drop-in foi removido do disco, mas o systemd ainda pode usar a versao antiga; rode 'systemctl daemon-reload' como root." >&2
    echo "channel-fix removido (drop-in + prestart)."
    exit 0
fi

# Resolve o config dir que o servico realmente usa (igual ao launch.sh do Tera Claw):
# TERACLAW_CLAUDE_CONFIG_DIR custom, senao o default /root/.claude (o servico faz unset).
CFGDIR="${TERACLAW_CLAUDE_CONFIG_DIR:-/root/.claude}"

# 1. copia estavel do prestart no workspace do agente
cp "$PLUGIN/scripts/prestart-clear-tg-authcache.sh" "$PRESTART"
chmod +x "$PRESTART"

# 2. drop-in (prefixo `-` no ExecStartPre = ignora erro, nunca bloqueia o boot)
mkdir -p "$DROPDIR"
cat > "$DROPIN" <<EOF
# Mitiga regressao do Claude Code: limpa a chave needs-auth do canal telegram
# antes de cada start (senao o bot fica mudo a partir do 2o start). Instalado pelo Tera Claw.
[Service]
ExecStartPre=-/bin/bash ${PRESTART} ${CFGDIR}
EOF

systemctl daemon-reload
echo "channel-fix instalado: $DROPIN"
echo "  (limpa plugin:telegram:telegram de ${CFGDIR}/mcp-needs-auth-cache.json a cada start)"
echo "  AVISO: a chave e GLOBAL do plugin telegram — se houver OUTROS agentes de canal"
echo "  telegram nesta maquina na mesma config dir, eles tambem precisam"
echo "  do mesmo ExecStartPre pra nao ficarem mudos no proximo restart deles."
