#!/usr/bin/env bash
# teraclaw-api: o comando do agente que fala com o Web pela caixa de arquivos.
# O Web e simulado por um laco em bash que le entrada/ e escreve saida/ como o de verdade faria.
# TERACLAW_CAIXA_DIR aponta a caixa para uma pasta temporaria (variavel so para testes).
set -uo pipefail
# shellcheck source=tests/cli/_comum.sh
. "$(dirname "$0")/_comum.sh"
preparar

API="$REPO/bin/teraclaw-api"
export TERACLAW_CAIXA_DIR="$TMP/caixa"
ENT="$TERACLAW_CAIXA_DIR/entrada"
SAI="$TERACLAW_CAIXA_DIR/saida"
mkdir -p "$ENT" "$SAI"
ULTIMO="$TMP/ultimo-pedido.json"

# Web falso: responde conforme a rota. /api/v1/mudo nunca recebe resposta.
web_falso() {
    local f id rota
    while :; do
        for f in "$ENT"/*.json; do
            [ -f "$f" ] || continue
            id="$(jq -r .id "$f")"; rota="$(jq -r .rota "$f")"
            cp "$f" "$ULTIMO"
            case "$rota" in
                /api/v1/mudo) continue ;;
                /api/v1/criado) jq -nc --arg id "$id" '{v:1,id:$id,status:201,corpo:{ok:true,id:"x1"}}' >"$SAI/.$id.tmp" ;;
                /api/v1/docs.md) jq -nc --arg id "$id" '{v:1,id:$id,status:200,corpo:"# Documento\nlinha dois"}' >"$SAI/.$id.tmp" ;;
                /api/v1/invalido) jq -nc --arg id "$id" '{v:1,id:$id,status:404,corpo:{ok:false,erro:"Nao existe esse item."}}' >"$SAI/.$id.tmp" ;;
                /api/v1/limite) jq -nc --arg id "$id" '{v:1,id:$id,status:429,corpo:{ok:false,erro:"Pedidos demais.",retryAfter:7}}' >"$SAI/.$id.tmp" ;;
                /api/v1/quebrado) jq -nc --arg id "$id" '{v:1,id:$id,status:500,corpo:{ok:false,erro:"Falha interna."}}' >"$SAI/.$id.tmp" ;;
                *) jq -nc --arg id "$id" '{v:1,id:$id,status:200,corpo:{ok:true}}' >"$SAI/.$id.tmp" ;;
            esac
            mv "$SAI/.$id.tmp" "$SAI/$id.json"
            rm -f "$f"
        done
        sleep 0.1
    done
}
web_falso &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

echo "sucesso (2xx)"
saida="$("$API" POST /api/v1/criado '{"texto":"ligar pro contador"}' 2>"$TMP/e.txt")"; rc=$?
igual "POST com corpo sai com 0" "0" "$rc"
igual "imprime o corpo da resposta" '{"ok":true,"id":"x1"}' "$saida"
igual "o pedido chegou com metodo, rota e corpo" 'POST /api/v1/criado ligar pro contador' "$(jq -r '"\(.metodo) \(.rota) \(.corpo.texto)"' "$ULTIMO")"
igual "o pedido tem v 1 e id de 32 hex" "true" "$(jq -r '.v == 1 and (.id | test("^[0-9a-f]{32}$"))' "$ULTIMO")"
igual "a entrada e a saida ficam vazias" "0" "$(find "$ENT" "$SAI" -type f | wc -l)"
igual "as pastas da caixa sao 700" "700 700" "$(stat -c '%a' "$ENT" "$SAI" | tr '\n' ' ' | sed 's/ $//')"

saida="$("$API" post /api/v1/criado --com-status '{"a":1}' 2>/dev/null)"
igual "--com-status junta status e corpo (e aceita metodo em minuscula)" '{"status":201,"corpo":{"ok":true,"id":"x1"}}' "$saida"

saida="$("$API" GET /api/v1/docs.md 2>/dev/null)"
igual "texto (docs.md) sai cru, com a quebra de linha" $'# Documento\nlinha dois' "$saida"

"$API" GET '/api/v1/lista?agente=x&limit=5' >/dev/null 2>&1
igual "a query string vai junto na rota" '/api/v1/lista?agente=x&limit=5' "$(jq -r .rota "$ULTIMO")"
igual "GET sem corpo nao leva o campo corpo" "false" "$(jq 'has("corpo")' "$ULTIMO")"

printf '{"via":"arquivo"}' >"$TMP/corpo.json"
"$API" PUT /api/v1/criado --arquivo "$TMP/corpo.json" >/dev/null 2>&1
igual "corpo por --arquivo" "arquivo" "$(jq -r .corpo.via "$ULTIMO")"
printf '{"via":"stdin"}' | "$API" PATCH /api/v1/criado - >/dev/null 2>&1
igual "corpo pelo stdin" "stdin" "$(jq -r .corpo.via "$ULTIMO")"

echo "erro HTTP"
saida="$("$API" GET /api/v1/invalido 2>"$TMP/e.txt")"; rc=$?
igual "4xx sai com 4" "4" "$rc"
igual "o corpo do erro sai no stdout" '{"ok":false,"erro":"Nao existe esse item."}' "$saida"
afirma "a frase do erro sai no stderr" grep -q 'Nao existe esse item.' "$TMP/e.txt"
"$API" GET /api/v1/limite >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "429 e erro do tipo 4" "4" "$rc"
afirma "429 diz quanto esperar" grep -q 'Tente de novo em 7 s' "$TMP/e.txt"
"$API" GET /api/v1/quebrado >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "5xx sai com 5" "5" "$rc"
afirma "5xx explica no stderr" grep -q 'Falha interna.' "$TMP/e.txt"

echo "o Web nao responde"
inicio=$SECONDS
"$API" GET /api/v1/mudo --espera 1 >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "estourou a espera: sai com 2" "2" "$rc"
igual "esperou so o combinado (no maximo 3 s)" "true" "$([ $((SECONDS - inicio)) -le 3 ] && echo true || echo false)"
afirma "diz o que fazer" grep -q 'Ele pode estar reiniciando' "$TMP/e.txt"
igual "o pedido que ninguem atendeu e retirado da entrada" "0" "$(find "$ENT" -type f | wc -l)"

echo "erros de uso (saida 1)"
for args in "BUSCAR /api/v1/x" "GET /outra/rota" "GET /api/v1/../x" "GET" "GET /api/v1/x --espera 0" "GET /api/v1/x --espera 999" "GET /api/v1/x --nada" "POST /api/v1/x {a:1}" "POST /api/v1/x --arquivo $TMP/nao-existe.json"; do
    # shellcheck disable=SC2086 # o teste quer a divisao em palavras
    "$API" $args >/dev/null 2>&1; rc=$?
    igual "uso errado '$args' sai com 1" "1" "$rc"
done
"$API" POST /api/v1/x '{"a":1}' '{"b":2}' >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "dois corpos: sai com 1" "1" "$rc"
afirma "dois corpos: explica" grep -q 'mais de um corpo' "$TMP/e.txt"
"$API" POST /api/v1/x '{a:1}' >/dev/null 2>"$TMP/e.txt"
afirma "JSON invalido: a mensagem aponta o argumento" grep -q 'nao e um JSON valido' "$TMP/e.txt"
head -c 1100000 /dev/zero | tr '\0' 'a' | jq -Rsc '{x: .}' >"$TMP/grande.json"
"$API" POST /api/v1/x --arquivo "$TMP/grande.json" >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "pedido de mais de 1 MB sai com 1" "1" "$rc"
afirma "pedido grande demais: explica o teto" grep -q '1048576' "$TMP/e.txt"

echo "caixa indisponivel (saida 3)"
: >"$TMP/arquivo-comum"
TERACLAW_CAIXA_DIR="$TMP/arquivo-comum/caixa" "$API" GET /api/v1/x >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "caixa dentro de um arquivo: sai com 3" "3" "$rc"
afirma "diz para chamar o dono" grep -q 'teraclaw agente reparar' "$TMP/e.txt"
env -u TERACLAW_CAIXA_DIR -u HOME "$API" GET /api/v1/x >/dev/null 2>"$TMP/e.txt"; rc=$?
igual "sem HOME e sem TERACLAW_CAIXA_DIR: sai com 3" "3" "$rc"

echo "ajuda"
"$API" >/dev/null 2>&1; igual "sem argumento mostra a ajuda e sai com 0" "0" "$?"
"$API" ajuda >"$TMP/ajuda.txt" 2>&1; rc=$?
igual "ajuda sai com 0" "0" "$rc"
afirma "ajuda mostra o uso e os codigos" grep -q 'Codigos de saida' "$TMP/ajuda.txt"

fim
