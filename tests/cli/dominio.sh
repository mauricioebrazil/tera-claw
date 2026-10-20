#!/usr/bin/env bash
# teraclaw dominio: troca do dominio do painel.
set -uo pipefail
# shellcheck source=tests/cli/_comum.sh
. "$(dirname "$0")/_comum.sh"
preparar

CF="$TERACLAW_RAIZ/etc/caddy/Caddyfile"
CONFD="$TERACLAW_RAIZ/etc/caddy/conf.d/teraclaw.caddy"
mkdir -p "$TERACLAW_RAIZ/etc/caddy"
printf '# Tera Claw: antigo\nteste.exemplo.org {\n\treverse_proxy 127.0.0.1:8300\n}\n' >"$CF"
printf 'TERACLAW_DOMINIO=teste.exemplo.org\nTERACLAW_VERSAO=1.2\nTERACLAW_USUARIO=maria\n' >"$ETC/teraclaw.env"

# mostrar
teraclaw dominio >"$TMP/o.txt" 2>&1
afirma "mostrar: diz o dominio atual" grep -q 'teste.exemplo.org' "$TMP/o.txt"
afirma "mostrar: diz o IP publico" grep -q '203.0.113.7' "$TMP/o.txt"

# formato invalido
nega "formato invalido recusado" teraclaw dominio trocar 'https://x.com/'
nega "sem ponto recusado" teraclaw dominio trocar painel
nega "sem nome recusado" teraclaw dominio trocar
afirma "nada mudou apos recusas" grep -q 'teste.exemplo.org {' "$CF"

# DNS nao aponta
echo 192.0.2.55 >"$STUB_ESTADO/dns-novo.exemplo.com.br"
teraclaw dominio trocar novo.exemplo.com.br >"$TMP/o.txt" 2>&1
igual "DNS errado: sai com 1" "1" "$?"
afirma "DNS errado: explica o registro A e o IP" grep -q 'registro tipo A.*203.0.113.7' "$TMP/o.txt"
afirma "DNS errado: Caddyfile intacto" grep -q 'teste.exemplo.org {' "$CF"
afirma "DNS errado: teraclaw.env intacto" grep -q 'TERACLAW_DOMINIO=teste.exemplo.org' "$ETC/teraclaw.env"
nega "DNS errado: nao recarregou o caddy" grep -q 'systemctl reload caddy' "$STUB_LOG"

# DNS ok
echo 203.0.113.7 >"$STUB_ESTADO/dns-novo.exemplo.com.br"
: >"$STUB_LOG"
teraclaw dominio trocar Novo.Exemplo.com.br >"$TMP/o.txt" 2>&1
igual "DNS ok: sai com 0" "0" "$?"
afirma "DNS ok: Caddyfile com o nome novo" grep -q '^novo.exemplo.com.br {' "$CF"
nega "DNS ok: sem o nome antigo no Caddyfile" grep -q 'teste.exemplo.org' "$CF"
afirma "DNS ok: teraclaw.env com o dominio novo" grep -qx 'TERACLAW_DOMINIO=novo.exemplo.com.br' "$ETC/teraclaw.env"
afirma "DNS ok: teraclaw.env manteve as outras linhas" grep -qx 'TERACLAW_USUARIO=maria' "$ETC/teraclaw.env"
afirma "DNS ok: caddy validate" grep -q '^caddy validate' "$STUB_LOG"
afirma "DNS ok: reload do caddy" grep -q 'systemctl reload caddy' "$STUB_LOG"
afirma "DNS ok: esperou o HTTPS do nome novo" grep -q 'resolve novo.exemplo.com.br:443:127.0.0.1' "$STUB_LOG"
afirma "DNS ok: imprime o link novo" grep -q 'https://novo.exemplo.com.br/' "$TMP/o.txt"
nega "DNS ok: nao reiniciou o admin" grep -q 'restart teraclaw-admin' "$STUB_LOG"

# primeiro-acesso passa a usar o dominio novo
printf 'TERACLAW_PANEL_USER=maria\n' >"$ETC/web.env"
afirma "primeiro-acesso usa o dominio novo" bash -c "'$CLI' primeiro-acesso 2>/dev/null | grep -q '^https://novo.exemplo.com.br/primeiro-acesso#'"

# caddy recusa: restaura
touch "$STUB_ESTADO/caddy-falha"
echo 203.0.113.7 >"$STUB_ESTADO/dns-outro.exemplo.com.br"
teraclaw dominio trocar outro.exemplo.com.br >"$TMP/o.txt" 2>&1
igual "caddy recusa: sai com 1" "1" "$?"
afirma "caddy recusa: Caddyfile voltou ao que era" grep -q '^novo.exemplo.com.br {' "$CF"
afirma "caddy recusa: teraclaw.env nao mudou" grep -qx 'TERACLAW_DOMINIO=novo.exemplo.com.br' "$ETC/teraclaw.env"
rm -f "$STUB_ESTADO/caddy-falha"

# Caddyfile com outros sites: vai para conf.d
printf 'import conf.d/*\n\nloja.exemplo.com {\n\trespond "oi"\n}\n' >"$CF"
teraclaw dominio trocar outro.exemplo.com.br >"$TMP/o.txt" 2>&1
igual "outros sites: sai com 0" "0" "$?"
afirma "outros sites: site do Tera Claw em conf.d" grep -q '^outro.exemplo.com.br {' "$CONFD"
afirma "outros sites: Caddyfile dos outros preservado" grep -q 'loja.exemplo.com' "$CF"

# sem conferir DNS e ensaio
printf 'TERACLAW_DOMINIO=teste.exemplo.org\n' >"$ETC/teraclaw.env"
teraclaw --ensaio dominio trocar sem-dns.exemplo.com --sem-conferir-dns >"$TMP/o.txt" 2>&1
igual "ensaio: sai com 0" "0" "$?"
afirma "ensaio: teraclaw.env intacto" grep -qx 'TERACLAW_DOMINIO=teste.exemplo.org' "$ETC/teraclaw.env"
nega "ensaio: conf.d nao ganhou o nome" grep -q 'sem-dns' "$CONFD"

fim
