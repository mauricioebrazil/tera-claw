#!/bin/bash
# inject.sh — Helper bash compartilhado pros crons de vida do Tera Claw injetarem um "poke"
# na sessao --channels VIVA do agente (a mesma que serve o bot Telegram), em vez de chamar
# `claude -p` (que queima credito de API). A propria persona executa a tarefa na sessao dela,
# na ASSINATURA FLAT do dono. Tecnica de injecao headless, generalizada e
# namespaceada por-slug pra varios agentes coexistirem no mesmo host.
#
# Funcoes exportadas:
#   is_session_alive <slug>            -> rc 0 se a sessao --channels esta viva, !=0 se morta
#   require_live_session <slug> <ctx>  -> loga e retorna 2 se a sessao esta morta (no-op gracioso)
#   inject_session <slug> <tag>        -> monta poke (idempotencia) e injeta (prompt via stdin)
#                                          rc 0 = injetado | 2 = sessao morta | 75 = sessao ocupada
#                                          (turno em voo; adiado, NAO e erro) | outro = falha de injecao
#
# Uso tipico num cron:
#   source "$(dirname "$0")/_lib/inject.sh"
#   inject_session "$SLUG" reflection <<< "$PROMPT"   # fire-and-forget
#
# Dry-run: TERACLAW_INJECT_DRYRUN=1 monta o poke e checa a sessao, mas NAO injeta.
# Modo:    TERACLAW_INJECT_MODE=tiocsti (default, root) | tmux (opt-in, portavel).
#
# VERIFICACAO DE POKE (opt-in, retrocompativel): exporte TERACLAW_POKE_VERIFY=1 ANTES de
# chamar inject_session pra ligar o "recibo deterministico". Quando ligado, inject_session:
#   (a) anexa no poke-file a instrucao de ACK (a persona roda poke-ack.sh ao concluir);
#   (b) registra o poke como PENDENTE no ledger (.teraclaw/pokes/) — mesmo se a sessao
#       estiver ocupada e o poke for adiado — pra que o poke-verify.py confira o recibo
#       depois, re-injete se faltar e alerte o dono se esgotar. Env extras (todos opcionais):
#       TERACLAW_POKE_KEY (default <tag>-<data>), TERACLAW_POKE_ARTIFACT (rel ao ws),
#       TERACLAW_POKE_DEADLINE_SEC, TERACLAW_POKE_MAX_RETRIES, TERACLAW_POKE_RETRY_INTERVAL_SEC,
#       TERACLAW_POKE_RETRIGGER (comando pra re-injetar; ex: "bash .../reflection.sh $CONFIG").
# Sem TERACLAW_POKE_VERIFY a injecao segue fire-and-forget como sempre foi.

# Resolve o dir deste lib de forma estavel (apontamos pra .teraclaw/plugin/scripts/_lib)
_DGA_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_DGA_INJECT_PY="$_DGA_LIB_DIR/inject.py"
_DGA_SCRIPTS_DIR="$(dirname "$_DGA_LIB_DIR")"
_DGA_LEDGER_PY="$_DGA_LIB_DIR/poke_ledger.py"

# is_session_alive <slug> — rc 0 viva / !=0 morta. Wrapper do --check do inject.py.
is_session_alive() {
    local slug="$1"
    python3 "$_DGA_INJECT_PY" --slug "$slug" --check >/dev/null 2>&1
}

# require_live_session <slug> <contexto> — guarda pros crons. Se a sessao esta MORTA
# (dono desligou o bot 24/7 pra poupar), loga "sessao nao ativa, pulando" e retorna 2.
# O cron deve checar o rc e sair 0 (no-op gracioso) — NUNCA cair pra claude -p.
require_live_session() {
    local slug="$1" ctx="${2:-cron}"
    if is_session_alive "$slug"; then
        return 0
    fi
    echo "[teraclaw-inject] sessao viva de '${slug}' nao ativa — pulando ${ctx} (no-op gracioso)" >&2
    return 2
}

# inject_session <slug> <tag>  (prompt via stdin)
# Retorno: 0 injetado | 2 sessao morta | 75 sessao ocupada (adiado) | outro = falha.
#   Morta e ocupada tinham o mesmo rc 2 e o chamador nao sabia dizer "nao rodou" de "vai rodar
#   daqui a pouco"; por isso o 75 (o mesmo do inject.py) passa adiante sem conversao.
# Faz: (1) checa a sessao viva (morta -> loga e retorna 2);
#      (2) escreve o prompt num poke file UNICO em /tmp (sem clobber), com cabecalho de
#          idempotencia (tag/slot/data + "se ja executou, nao repita");
#      (3) injeta "leia <pokefile> e execute" via inject.py (fire-and-forget), sob lock por-slug.
inject_session() {
    local slug="$1" tag="$2"
    local today stamp slot pokefile
    today="$(date +%F)"
    stamp="$(date +%Y%m%d-%H%M%S)"
    slot="$(date +%H:%M)"
    pokefile="/tmp/teraclaw-poke-${slug}-${tag}-${stamp}.txt"

    # Verificacao de poke (opt-in). key estavel por (tag,data) pra retries reusarem o mesmo poke.
    local verify_on=0 key=""
    case "${TERACLAW_POKE_VERIFY:-0}" in 1|on|true|yes) verify_on=1 ;; esac
    key="${TERACLAW_POKE_KEY:-${tag}-${today}}"

    # Poke file com cabecalho de IDEMPOTENCIA (o TUI pode re-receber; a persona deve checar
    # antes de repetir). Conteudo do prompt vem do stdin. umask 077: o poke (reflexao/auditoria/
    # proatividade) NAO deve ser world-readable em /tmp — outros usuarios locais nao leem.
    (
        umask 077
        {
            echo "[${tag}] slug=${slug} slot=${slot} date=${today} time=${slot}"
            echo "IDEMPOTENCIA: se voce JA executou '${tag}' em ${today} (confira working-memory.md / memory/${today}.md / state), NAO repita — registre 'ja feito' e pare."
            echo "---"
            cat
            if [ "$verify_on" = "1" ]; then
                echo ""
                echo "---"
                echo "RECIBO (OBRIGATORIO): ao TERMINAR este poke, rode exatamente, em silencio (sem comentar):"
                echo "  bash ${_DGA_SCRIPTS_DIR}/poke-ack.sh ${slug} ${key}"
                echo "Isso confirma ao sistema que voce recebeu e concluiu. Se voce NAO rodar, o sistema vai achar que o poke falhou e re-injetar."
            fi
        } > "$pokefile"
    )

    # Sessao morta -> no-op gracioso. Nao injeta; remove o poke pra nao acumular orfaos em /tmp.
    if ! is_session_alive "$slug"; then
        echo "[teraclaw-inject] sessao viva de '${slug}' nao ativa — NAO injetei ${tag} (poke descartado)" >&2
        rm -f "$pokefile"
        return 2
    fi

    if [ -n "${TERACLAW_INJECT_DRYRUN:-}" ]; then
        echo "[teraclaw-inject] DRYRUN — poke pronto em ${pokefile}, NAO injetei ${tag}" >&2
        return 0
    fi

    # Registra o PENDENTE (idempotente) ANTES de injetar — a sessao esta viva. Assim, mesmo
    # que o poke seja adiado por sessao ocupada (rc 75 abaixo), o verificador vai re-injetar
    # depois. Sem TERACLAW_WORKSPACE nao da pra registrar (avisa e segue fire-and-forget).
    if [ "$verify_on" = "1" ]; then
        if [ -n "${TERACLAW_WORKSPACE:-}" ]; then
            python3 "$_DGA_LEDGER_PY" register --ws "$TERACLAW_WORKSPACE" \
                --slug "$slug" --tag "$tag" --key "$key" \
                ${TERACLAW_POKE_DEADLINE_SEC:+--deadline-sec "$TERACLAW_POKE_DEADLINE_SEC"} \
                ${TERACLAW_POKE_MAX_RETRIES:+--max-retries "$TERACLAW_POKE_MAX_RETRIES"} \
                ${TERACLAW_POKE_RETRY_INTERVAL_SEC:+--retry-interval-sec "$TERACLAW_POKE_RETRY_INTERVAL_SEC"} \
                ${TERACLAW_POKE_ARTIFACT:+--artifact "$TERACLAW_POKE_ARTIFACT"} \
                ${TERACLAW_POKE_RETRIGGER:+--retrigger "$TERACLAW_POKE_RETRIGGER"} >/dev/null 2>&1 \
                || echo "[teraclaw-inject] aviso: falha ao registrar pendente de verificacao (${key})" >&2
        else
            echo "[teraclaw-inject] aviso: TERACLAW_POKE_VERIFY=1 mas sem TERACLAW_WORKSPACE — sem verificacao" >&2
        fi
    fi

    # Guarda de ociosidade (default ON): nao atropela um turno do dono em voo. Pra desligar
    # (ex: poke critico que precisa entrar ja), exporte TERACLAW_INJECT_NO_IDLE_GUARD=1.
    local idle_flag="--require-idle"
    case "${TERACLAW_INJECT_NO_IDLE_GUARD:-0}" in 1|on|true|yes) idle_flag="" ;; esac

    # Carimbo de quem esta falando. TODO poke passa por aqui, e por isso o default e
    # "auto" NESTE ponto e nao no inject.py: quem chama o inject.py direto e a aba Conversa
    # do painel, e la quem esta digitando E a pessoa. Se o default de fabrica fosse "auto"
    # dentro do inject.py, a mensagem que o proprio cliente escreve chegaria carimbada como
    # recado de maquina, e o hook de fim de turno pararia de cobrar a resposta a ele.
    # Sem este carimbo, a reflexao das 23h30 chega indistinguivel do cliente falando, e o
    # agente responde no canal sobre uma rotina interna que ninguem pediu.
    local envelope="${TERACLAW_POKE_ENVELOPE:-auto}"

    # O lock por-slug fica DENTRO do inject.py (acquire_lock); aqui so chamamos.
    python3 "$_DGA_INJECT_PY" --slug "$slug" --envelope "$envelope" $idle_flag "leia ${pokefile} e execute"
    local rc=$?
    if [ "$rc" = "75" ]; then
        # Sessao OCUPADA (turno do dono em voo) -> adia este poke. Remove o orfao pra nao
        # poluir /tmp; o proximo disparo do cron tenta de novo (poke e idempotente).
        echo "[teraclaw-inject] sessao '${slug}' ocupada — adiei ${tag} (poke descartado, tenta no proximo disparo)" >&2
        rm -f "$pokefile"
        return 75
    fi
    if [ "$rc" != "0" ]; then
        echo "[teraclaw-inject] FALHA ao injetar ${tag} em '${slug}' (rc=${rc}, poke em ${pokefile})" >&2
        return "$rc"
    fi
    echo "[teraclaw-inject] injetado ${tag} -> sessao viva de '${slug}' (${pokefile})" >&2
    return 0
}
