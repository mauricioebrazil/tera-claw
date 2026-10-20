#!/usr/bin/env bash
# lib/versao.sh: a versao e o commit que estao INSTALADOS, lidos do teraclaw.env (o install.sh
# grava TERACLAW_VERSAO a partir do arquivo VERSION e TERACLAW_COMMIT do clone).
#
# Carregado com `source` pelo bin/teraclaw, nunca executado. Quem chama ja rodou carregar_env_teraclaw.

# versao_texto: "1.0.0 (commit abc123def456)"; sai com 1 e nao imprime nada se a versao nao foi registrada.
versao_texto() {
    local v="${TERACLAW_VERSAO:-}" c="${TERACLAW_COMMIT:-}"
    [ -n "$v" ] || return 1
    if [ -n "$c" ]; then printf '%s (commit %s)' "$v" "${c:0:12}"; else printf '%s' "$v"; fi
}

# versao_linha: a primeira linha do `teraclaw status`.
versao_linha() {
    local t
    if t="$(versao_texto)"; then printf 'Tera Claw %s\n' "$t"
    else printf 'Tera Claw: versao nao registrada: rode sudo teraclaw atualizar ou ./install.sh de novo\n'; fi
}

# versao_main: `teraclaw versao`, so a versao e o commit.
versao_main() {
    [ $# -eq 0 ] || falha "'versao' nao tem opcoes (recebi: $*)." "use: teraclaw versao"
    carregar_env_teraclaw
    local t
    t="$(versao_texto)" || falha "o Tera Claw nao registrou a versao instalada (falta TERACLAW_VERSAO em $DG_ETC/teraclaw.env)." \
        "rode sudo teraclaw atualizar ou ./install.sh de novo dentro do clone; o instalador anota a versao."
    printf '%s\n' "$t"
}
