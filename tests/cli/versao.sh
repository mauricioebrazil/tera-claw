#!/usr/bin/env bash
# A versao instalada: `teraclaw status` (primeira linha), `teraclaw versao`, `teraclaw --version`, e a
# garantia de que o arquivo VERSION, o panel/package.json e o runner/package.json dizem a mesma coisa.
set -uo pipefail
# shellcheck source=tests/cli/_comum.sh
. "$(dirname "$0")/_comum.sh"
preparar

echo "versoes alinhadas no repositorio"
V="$(tr -d '[:space:]' <"$REPO/VERSION")"
afirma "VERSION tem uma versao no formato N.N.N" bash -c "[[ '$V' =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]"
igual "panel/package.json esta na versao do VERSION" "$V" "$(jq -r .version "$REPO/panel/package.json")"
igual "runner/package.json esta na versao do VERSION" "$V" "$(jq -r .version "$REPO/runner/package.json")"
igual "runner/package-lock.json (raiz) esta na versao do VERSION" "$V" "$(jq -r .version "$REPO/runner/package-lock.json")"
igual "runner/package-lock.json (pacote da raiz) esta na versao do VERSION" "$V" "$(jq -r '.packages[""].version' "$REPO/runner/package-lock.json")"

echo "versao registrada"
printf 'TERACLAW_DOMINIO=teste.exemplo.org\nTERACLAW_VERSAO=1.0.0\nTERACLAW_COMMIT=abc123def4567890abc123def4567890abc12345\n' >"$ETC/teraclaw.env"
igual "teraclaw versao" "1.0.0 (commit abc123def456)" "$(teraclaw versao 2>&1)"
igual "teraclaw --version" "1.0.0 (commit abc123def456)" "$(teraclaw --version 2>&1)"
igual "a primeira linha do status e a versao" "Tera Claw 1.0.0 (commit abc123def456)" "$(teraclaw status 2>&1 | head -n 1)"

echo "so a versao, sem commit (instalou de um zip)"
printf 'TERACLAW_VERSAO=1.0.0\n' >"$ETC/teraclaw.env"
igual "teraclaw versao sem commit" "1.0.0" "$(teraclaw versao 2>&1)"

echo "versao nao registrada"
printf 'TERACLAW_DOMINIO=teste.exemplo.org\n' >"$ETC/teraclaw.env"
igual "a primeira linha do status avisa" "Tera Claw: versao nao registrada: rode sudo teraclaw atualizar ou ./install.sh de novo" "$(teraclaw status 2>&1 | head -n 1)"
teraclaw versao >"$TMP/o.txt" 2>&1; rc=$?
igual "teraclaw versao falha (1)" "1" "$rc"
afirma "e diz o que fazer" grep -q 'sudo teraclaw atualizar ou ./install.sh' "$TMP/o.txt"

fim
