#!/usr/bin/env python3
"""Confere a chave da Groq e, se receber um arquivo de audio, transcreve.

Uso:
  testar_chave.py                      confere a chave (GROQ_API_KEY do ambiente)
  testar_chave.py audio.mp3            confere e transcreve o audio
  printf '%s' "$CHAVE" | testar_chave.py --stdin [audio]   chave vinda da entrada padrao

A chave nunca e impressa. Saida 0 = deu certo, 1 = falhou (a mensagem diz o que fazer).
"""
import os
import sys

import requests

BASE = "https://api.groq.com/openai/v1"
UA = {"User-Agent": "TeraClaw/1.0"}  # o Cloudflare da Groq bloqueia o User-Agent padrao
MODELO = "whisper-large-v3-turbo"


def falha(msg):
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def explica(r, o_que):
    c = r.status_code
    if c in (401, 403):
        falha(f"A Groq recusou a chave ao {o_que} (HTTP {c}). Confira se copiou a chave inteira (comeca com gsk_) "
              "de https://console.groq.com/keys e se e da GROQ, nao do Grok da xAI. Se precisar, crie outra.")
    if c == 429:
        falha(f"Limite gratuito da Groq atingido (HTTP 429). Espere um minuto e tente de novo.")
    if c == 413:
        falha("O audio e grande demais para a Groq (limite de 25 MB). Corte em pedacos menores ou converta para mp3 mono.")
    falha(f"A Groq respondeu HTTP {c} ao {o_que}: {r.text[:200].replace(chr(10), ' ')}")


def main():
    args = sys.argv[1:]
    usa_stdin = "--stdin" in args
    args = [a for a in args if a != "--stdin"]
    chave = sys.stdin.read().strip() if usa_stdin else os.environ.get("GROQ_API_KEY", "").strip()
    if not chave:
        falha("Nao encontrei a GROQ_API_KEY. Ela ainda nao foi gravada no cofre do agente, ou o agente nao foi reiniciado "
              "depois de gravar. Siga os passos da skill groq-audio para criar e gravar a chave.")
    if not chave.startswith("gsk_"):
        falha("Essa chave nao comeca com gsk_, entao nao e da Groq. Lembre: Groq (console.groq.com) e diferente do Grok da xAI.")
    cab = dict(UA, Authorization=f"Bearer {chave}")
    try:
        r = requests.get(f"{BASE}/models", headers=cab, timeout=30)
    except requests.RequestException as e:
        falha(f"Nao consegui falar com a Groq ({type(e).__name__}). Confira a internet e tente de novo.")
    if r.status_code != 200:
        explica(r, "conferir a chave")
    print("Chave da Groq valida.")
    if not args:
        return
    audio = args[0]
    if not os.path.isfile(audio):
        falha(f"O arquivo {audio} nao existe. Confira o caminho.")
    try:
        with open(audio, "rb") as f:
            r = requests.post(f"{BASE}/audio/transcriptions", headers=cab,
                              data={"model": MODELO, "language": "pt", "response_format": "json"},
                              files={"file": (os.path.basename(audio), f)}, timeout=180)
    except requests.RequestException as e:
        falha(f"Nao consegui enviar o audio ({type(e).__name__}). Tente de novo.")
    if r.status_code == 400:
        falha("A Groq nao aceitou esse audio (formato ou arquivo vazio). Converta com: "
              f"ffmpeg -i {audio} -ar 16000 -ac 1 saida.mp3  e tente com saida.mp3.")
    if r.status_code != 200:
        explica(r, "transcrever")
    print(r.json().get("text", "").strip() or "(nenhuma fala encontrada no audio)")


if __name__ == "__main__":
    main()
