#!/usr/bin/env bash
# `teraclaw atualizar --checar`, `teraclaw atualizar --aviso ligar|desligar` e a linha "atualizacao:" do
# `teraclaw status`. Raiz falsa e stubs como os outros testes da CLI; o GitHub e o Admin sao o
# servidor falso de tests/aviso-atualizacao (um servidor http local), e a checagem e a de verdade.
set -uo pipefail
# shellcheck source=tests/cli/_comum.sh
. "$(dirname "$0")/_comum.sh"
preparar
command -v node >/dev/null || { echo "falta o node no PATH" >&2; exit 1; }

SERVIDOR="$REPO/tests/aviso-atualizacao/servidor-falso.mjs"
CENARIO="$TMP/cenario.json"; REQ="$TMP/req.log"; ADM="$TMP/adm.log"
: >"$REQ"; : >"$ADM"; echo '{}' >"$CENARIO"
node "$SERVIDOR" "$CENARIO" "$TMP/porta" "$REQ" "$ADM" &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 50); do [ -s "$TMP/porta" ] && break; sleep 0.1; done
BASE="http://127.0.0.1:$(cat "$TMP/porta")"
export TERACLAW_AVISO_API_URL="$BASE" TERACLAW_AVISO_RAW_URL="$BASE" TERACLAW_ADMIN_URL="$BASE"

INSTALADO="$(printf '%040x' 1)"; NOVO="$(printf '%040x' 2)"
ENV="$ETC/teraclaw.env"
ESTADO="$LIB/web/atualizacao/estado.json"
UNIDADES="$TERACLAW_RAIZ/etc/systemd/system"
printf 'TERACLAW_DOMINIO=teste.exemplo.org\nLINHA_DA_MARTA=oi\nTERACLAW_VERSAO=v1-aaaaaaaaaaaa\nTERACLAW_COMMIT=%s\n' "$INSTALADO" >"$ENV"
chmod 640 "$ENV"

compare() { # compare <status> <ahead_by> <sha> <titulo>
    jq -n --arg st "$1" --argjson ab "$2" --arg sha "$3" --arg t "$4" \
        '{compare: {status: 200, body: {status: $st, ahead_by: $ab, commits: [{sha: $sha, commit: {message: $t, committer: {date: "2026-10-19T12:00:00Z"}}}]}}}'
}

echo "--checar"
compare ahead 1 "$NOVO" "Aviso de versao nova" >"$CENARIO"
teraclaw atualizar --checar >"$TMP/o.txt" 2>&1; rc=$?
igual "com versao nova sai 0" 0 "$rc"
afirma "diz que ha versao nova" grep -q "Ha uma vers.o nova do Tera Claw\|Há uma versão nova do Tera Claw" "$TMP/o.txt"
afirma "diz que nada foi instalado" grep -q "Nada foi baixado nem instalado" "$TMP/o.txt"
afirma "manda ver o resumo na faixa do painel" grep -q "faixa do painel" "$TMP/o.txt"
nega "nao imprime o texto vindo do GitHub" grep -q "Aviso de versao nova" "$TMP/o.txt"
igual "gravou o estado" true "$(jq -r .disponivel "$ESTADO")"
igual "estado 600" 600 "$(stat -c %a "$ESTADO")"
nega "nao chamou podman" grep -q '^podman' "$STUB_LOG"
nega "nao mexeu em unidade nenhuma" grep -q '^systemctl' "$STUB_LOG"
teraclaw atualizar --checar --simular >"$TMP/o.txt" 2>&1; rc=$?
igual "--simular so descreve e sai 0" 0 "$rc"
afirma "--simular anuncia o script" grep -q "checar-atualizacao.mjs" "$TMP/o.txt"
nega "opcao extra e recusada" teraclaw atualizar --checar --forcar-local
TERACLAW_AVISO_API_URL="http://127.0.0.1:1" teraclaw atualizar --checar >"$TMP/o.txt" 2>&1; rc=$?
igual "rede fora sai 1" 1 "$rc"
afirma "rede fora explica" grep -q "Nao consegui falar\|Não consegui falar" "$TMP/o.txt"
igual "rede fora mantem o estado anterior" true "$(jq -r .disponivel "$ESTADO")"

echo "--checar de fora da raiz do sistema grava na raiz, nao no diretorio atual"
mkdir -p "$TMP/cwd"
( cd "$TMP/cwd" && "$CLI" atualizar --checar >/dev/null 2>&1 )
igual "nada criado no diretorio atual" 0 "$(find "$TMP/cwd" -mindepth 1 | wc -l)"
( cd "$TMP/cwd" && TERACLAW_RAIZ=relativa "$CLI" atualizar --checar >"$TMP/o.txt" 2>&1 ); rc=$?
igual "raiz relativa e recusada" 1 "$rc"

echo "--aviso desligar e ligar"
mkdir -p "$UNIDADES"
touch "$UNIDADES/teraclaw-checar-atualizacao.timer" "$UNIDADES/teraclaw-checar-atualizacao.service"
: >"$STUB_LOG"
: >"$REQ"
teraclaw atualizar --aviso desligar >"$TMP/o.txt" 2>&1; rc=$?
igual "desligar sai 0" 0 "$rc"
afirma "grava TERACLAW_AVISO_ATUALIZACAO=0" grep -qx 'TERACLAW_AVISO_ATUALIZACAO=0' "$ENV"
afirma "a linha alheia sobreviveu" grep -qx 'LINHA_DA_MARTA=oi' "$ENV"
afirma "as linhas de antes continuam na ordem" bash -c "[ \"\$(grep -n -e '^TERACLAW_DOMINIO=' -e '^LINHA_DA_MARTA=' -e '^TERACLAW_VERSAO=' -e '^TERACLAW_COMMIT=' '$ENV' | cut -d: -f1 | tr '\n' ' ')\" = '1 2 3 4 ' ]"
igual "o modo do arquivo foi mantido" 640 "$(stat -c %a "$ENV")"
afirma "desligou o timer" grep -q '^systemctl disable --now teraclaw-checar-atualizacao.timer' "$STUB_LOG"
afirma "parou a checagem que pudesse estar rodando" grep -q '^systemctl stop teraclaw-checar-atualizacao.service' "$STUB_LOG"
igual "desligar so anuncia depois de ler o estado: desligado=true" true "$(jq -r .desligado "$ESTADO")"
igual "o stop vem antes da checagem sem rede (depois do disable)" "disable stop" "$(grep -o '^systemctl \(disable\|stop\)' "$STUB_LOG" | cut -d' ' -f2 | tr '\n' ' ' | sed 's/ $//')"
igual "o estado passou a desligado" true "$(jq -r .desligado "$ESTADO")"
igual "nenhuma consulta ao GitHub" 0 "$(grep -c . "$REQ")"
teraclaw atualizar --aviso desligar >/dev/null 2>&1
igual "desligar duas vezes nao duplica a linha" 1 "$(grep -c '^TERACLAW_AVISO_ATUALIZACAO=' "$ENV")"
: >"$STUB_LOG"
teraclaw atualizar --aviso ligar >"$TMP/o.txt" 2>&1; rc=$?
igual "ligar sai 0" 0 "$rc"
afirma "grava TERACLAW_AVISO_ATUALIZACAO=1" grep -qx 'TERACLAW_AVISO_ATUALIZACAO=1' "$ENV"
afirma "a linha alheia continua la" grep -qx 'LINHA_DA_MARTA=oi' "$ENV"
afirma "ligou o timer" grep -q '^systemctl enable --now teraclaw-checar-atualizacao.timer' "$STUB_LOG"
igual "ligar so anuncia depois de ler o estado: desligado=false" false "$(jq -r .desligado "$ESTADO")"
rm -f "$UNIDADES/teraclaw-checar-atualizacao.timer"
: >"$STUB_LOG"
teraclaw atualizar --aviso desligar >"$TMP/o.txt" 2>&1; rc=$?
igual "sem o timer instalado: grava a linha e sai 0" 0 "$rc"
afirma "sem o timer instalado: avisa o que fazer" grep -q "ainda nao esta instalado" "$TMP/o.txt"
nega "sem o timer instalado: nao chama systemctl" grep -q '^systemctl' "$STUB_LOG"
nega "valor invalido e recusado" teraclaw atualizar --aviso talvez
teraclaw atualizar --aviso talvez >"$TMP/o.txt" 2>&1
afirma "valor invalido diz o que fazer" grep -q "O que fazer" "$TMP/o.txt"
nega "--aviso sem valor e recusado" teraclaw atualizar --aviso
afirma "o teraclaw.env nao ficou com valor invalido" grep -qx 'TERACLAW_AVISO_ATUALIZACAO=0' "$ENV"

echo "desligar com uma checagem lenta segurando a trava"
compare ahead 1 "$NOVO" "Mudanca" | jq '.compare.atraso_ms = 2000' >"$CENARIO"
mkdir -p "$ETC/runner"; printf 'abcdefgh12345678\n' >"$ETC/runner/admin.token"
teraclaw atualizar --aviso ligar >/dev/null 2>&1
rm -f "$LIB/web/atualizacao/avisado-admin.json"; : >"$ADM"
( teraclaw atualizar --checar >"$TMP/lenta.txt" 2>&1 ) &
LENTA=$!
sleep 0.7
teraclaw atualizar --aviso desligar >"$TMP/o.txt" 2>&1; rc=$?
wait "$LENTA"
igual "desligar espera a trava e sai 0" 0 "$rc"
igual "estado final desligado" true "$(jq -r .desligado "$ESTADO")"
igual "sem versao nova no estado" false "$(jq -r .disponivel "$ESTADO")"
igual "nenhum recado ao Admin" 0 "$(grep -c . "$ADM")"
echo "sem conseguir a trava o comando falha com instrucao"
( flock -x 9; sleep 3 ) 9>"$LIB/web/atualizacao/.trava" &
SEGURA=$!
sleep 0.3
TERACLAW_AVISO_ESPERA_TRAVA=1 teraclaw atualizar --checar >"$TMP/o.txt" 2>&1; rc=$?
igual "--checar sai com erro" 1 "$rc"
afirma "diz que a trava estava ocupada e o que fazer" grep -q "segurou a trava.*O que fazer\|O que fazer: veja se ela travou" "$TMP/o.txt"
wait "$SEGURA"

echo "status"
criar_agente ana --nome "Ana"
for u in caddy teraclaw-web teraclaw-admin; do echo active >"$STUB_ESTADO/svc-$u"; done
status() { teraclaw status >"$TMP/o.txt" 2>&1; echo $?; }
igual "desligado: status sai 0" 0 "$(status)"
afirma "desligado: diz aviso desligado" grep -q "atualizacao: aviso desligado" "$TMP/o.txt"
teraclaw atualizar --aviso ligar >/dev/null 2>&1
rm -f "$ESTADO"
igual "sem estado: status sai 0" 0 "$(status)"
afirma "sem estado: ainda nao verificado" grep -q "atualizacao: ainda nao verificado" "$TMP/o.txt"
compare ahead 1 "$NOVO" "Mudanca" >"$CENARIO"; teraclaw atualizar --checar >/dev/null 2>&1
igual "versao nova: status sai 0 (nao e essencial)" 0 "$(status)"
afirma "versao nova: avisa e manda rodar teraclaw atualizar" grep -q "atualizacao: versao nova disponivel (v1-aaaaaaaaaaaa → bbbbbbb\|atualizacao: versao nova disponivel (v1-aaaaaaaaaaaa → 0000000" "$TMP/o.txt"
afirma "versao nova: cita o comando" grep -q "sudo teraclaw atualizar" "$TMP/o.txt"
compare identical 0 "$NOVO" "x" | jq '.compare.body.commits = []' >"$CENARIO"; teraclaw atualizar --checar >/dev/null 2>&1
igual "em dia: status sai 0" 0 "$(status)"
afirma "em dia: diz em dia" grep -q "atualizacao: em dia" "$TMP/o.txt"
TERACLAW_AVISO_API_URL="http://127.0.0.1:1" teraclaw atualizar --checar >/dev/null 2>&1
igual "checagem falhou: status sai 0" 0 "$(status)"
afirma "checagem falhou: mostra o motivo" grep -q "atualizacao: a ultima checagem falhou: " "$TMP/o.txt"
printf 'isto nao e json' >"$ESTADO"
igual "estado ilegivel: status sai 0" 0 "$(status)"
afirma "estado ilegivel: explica e manda refazer" grep -q "nao consegui ler .*estado.json.*teraclaw atualizar --checar" "$TMP/o.txt"

fim
