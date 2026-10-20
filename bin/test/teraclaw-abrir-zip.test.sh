#!/usr/bin/env bash
# Teste do teraclaw-abrir-zip: extração normal, não sobrescrever, zip slip, caminho absoluto,
# link simbólico, zip bomba e limite de arquivos. Uso: bash bin/test/teraclaw-abrir-zip.test.sh
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$AQUI/../teraclaw-abrir-zip"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
FALHAS=0; N=0
ok() { N=$((N+1)); if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FALHOU $1"; FALHAS=$((FALHAS+1)); fi; }

# Monta os zips malvados com Python (o comando zip normaliza "../" e "/").
python3 -I - "$T" <<'PY'
import os, stat, sys, zipfile
t = sys.argv[1]
with zipfile.ZipFile(f"{t}/normal.zip", "w") as z:
    z.writestr("a.txt", "ola")
    z.writestr("sub/b.txt", "mundo")
with zipfile.ZipFile(f"{t}/slip.zip", "w") as z:
    z.writestr("../fora.txt", "x")
with zipfile.ZipFile(f"{t}/abs.zip", "w") as z:
    z.writestr("/tmp/teraclaw-abs-teste.txt", "x")
with zipfile.ZipFile(f"{t}/link.zip", "w") as z:
    i = zipfile.ZipInfo("atalho")
    i.external_attr = (stat.S_IFLNK | 0o777) << 16
    z.writestr(i, "/etc/passwd")
with zipfile.ZipFile(f"{t}/bomba.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("zeros.bin", b"\0" * (50 * 1024 * 1024))
with zipfile.ZipFile(f"{t}/muitos.zip", "w") as z:
    for n in range(6):
        z.writestr(f"f{n}.txt", "x")
open(f"{t}/falso.zip", "w").write("isto nao e zip")
PY

SAIDA="$("$BIN" "$T/normal.zip" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ -f "$T/normal-extraido/sub/b.txt" ] && [ "$(cat "$T/normal-extraido/a.txt")" = ola ]
ok "zip normal extrai em pasta nova" $?
[[ "$SAIDA" == *"pasta: $T/normal-extraido"* && "$SAIDA" == *"arquivos: 2"* ]]
ok "saída diz a pasta e a contagem" $?

echo mudei > "$T/normal-extraido/a.txt"
"$BIN" "$T/normal.zip" >/dev/null 2>&1
[ -f "$T/normal-extraido-1/a.txt" ] && [ "$(cat "$T/normal-extraido/a.txt")" = mudei ]
ok "segunda extração vai para -extraido-1 e não sobrescreve" $?
[ -f "$T/normal.zip" ]
ok "o zip original continua lá" $?

SAIDA="$("$BIN" "$T/slip.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *'".."'* ]] && [ ! -e "$T/fora.txt" ] && [ ! -e "$T/slip-extraido" ]
ok "zip com ../ é recusado antes de extrair" $?

SAIDA="$("$BIN" "$T/abs.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"caminho absoluto"* ]] && [ ! -e /tmp/teraclaw-abs-teste.txt ] && [ ! -e "$T/abs-extraido" ]
ok "zip com caminho absoluto é recusado" $?

SAIDA="$("$BIN" "$T/link.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"link simbólico"* ]] && [ ! -e "$T/link-extraido" ]
ok "zip com link simbólico é recusado" $?

SAIDA="$("$BIN" "$T/bomba.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"zip bomba"* ]] && [ ! -e "$T/bomba-extraido" ]
ok "zip bomba por razão de compressão é recusado" $?

SAIDA="$(TERACLAW_ZIP_MAX_MB=10 TERACLAW_ZIP_MAX_RAZAO=100000 "$BIN" "$T/bomba.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"TERACLAW_ZIP_MAX_MB"* ]]
ok "zip acima do tamanho total é recusado" $?

SAIDA="$(TERACLAW_ZIP_MAX_ARQUIVOS=5 "$BIN" "$T/muitos.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"TERACLAW_ZIP_MAX_ARQUIVOS"* ]]
ok "zip com arquivos demais é recusado" $?

SAIDA="$("$BIN" "$T/falso.zip" 2>&1)"; RC=$?
[ "$RC" = 1 ] && [[ "$SAIDA" == *"não é um zip válido"* ]]
ok "arquivo que não é zip diz o que fazer" $?

SAIDA="$("$BIN" "$T/nao-existe.zip" 2>&1)"; RC=$?
[ "$RC" = 2 ] && [[ "$SAIDA" == *"não achei"* ]]
ok "caminho inexistente sai com 2 e explica" $?

echo "$N testes, $FALHAS falhas"
[ "$FALHAS" = 0 ]
