# Modo escondido na API do Tera Claw Web

Esconde nomes, valores e contatos para mostrar a tela numa aula. A conversa web chama estas rotas
sozinha quando a pessoa liga o 👁; um agente pode usar as mesmas para conferir um texto. Todas
exigem sessão e, no POST, o cabeçalho `Origin` do próprio site. Guia completo: `docs/MODO-ESCONDIDO.md`.

## POST /api/v1/sigilo

Corpo: `{"textos": ["mensagem 1", "mensagem 2"]}` (até 600 textos, todos em texto).

```bash
curl -s -X POST https://SEU-SITE/api/v1/sigilo \
  -H 'Content-Type: application/json' -H 'Origin: https://SEU-SITE' -b cookie.txt \
  -d '{"textos":["A Maria Souza pagou R$ 1.997"]}'
```

Resposta, na mesma ordem dos textos:

```json
{"ok":true,"trechos":[["Maria Souza","Maria"]],"avisos":[],"analisados":1,
 "modelo":"claude-haiku-4-5","so_regex":false}
```

- `trechos[i]`: os trechos exatos a esconder no texto `i` (lista vazia: nada sensível).
  `null`: o modelo falhou naquele texto, o motivo está em `avisos`, e a tela deve manter escondido.
- `analisados`: quantos textos foram ao modelo. O resto veio do cache, que não expira.
- `so_regex: true`: não há chave de modelo no servidor. `trechos` vem vazio e `avisos` explica como
  ligar. O filtro automático (e-mail, valor, CPF, CNPJ, telefone, chave) roda na tela, não aqui.
- Erro de entrada: 400 com o motivo em português.

## GET /api/v1/sigilo/estado

`{"ok":true,"modelo":"claude-haiku-4-5"|"gpt-4.1-mini"|null,"provedor":"anthropic"|"openai"|null,"so_regex":false,"aviso":null}`
