---
name: service
description: Liga, desliga, reinicia, mostra status e logs do servico do assistente Tera Claw. Use quando o usuario pedir pra "ligar/desligar o assistente", "reiniciar o bot", "ver os logs", "ver se esta rodando", ou checar o status do servico teraclaw.
user-invocable: true
---

# /teraclaw:service — Controle do servico do assistente

Gerencia o servico systemd `teraclaw-<slug>` de um assistente Tera Claw.

## Descobrir os assistentes instalados

```bash
systemctl list-units --type=service --all 'teraclaw-*' --no-pager
ls -d "$HOME"/teraclaw/*/ 2>/dev/null
```

Se houver mais de um, pergunte qual (`SLUG`). Se houver so um, use ele.

## Acoes

Pergunte (ou infira do pedido) o que a pessoa quer e rode:

```bash
SLUG=ana    # ajuste

# status
systemctl status "teraclaw-$SLUG" --no-pager | head -20

# logs ao vivo (ultimas linhas)
journalctl -u "teraclaw-$SLUG" --no-pager -n 50

# reiniciar (use depois de editar AGENT.md / CLAUDE.md)
sudo systemctl restart "teraclaw-$SLUG"

# desligar / ligar
sudo systemctl stop "teraclaw-$SLUG"
sudo systemctl start "teraclaw-$SLUG"

# desabilitar de vez (nao sobe mais no boot)
sudo systemctl disable --now "teraclaw-$SLUG"
```

## Interpretar problemas comuns

- `active (running)` = no ar.
- Reiniciando em loop (`Restart=always`) geralmente e: token do Telegram errado,
  `bun` fora do PATH, ou workspace inexistente. Cheque `journalctl` e o
  `<workspace>/.teraclaw/config.sh`.
- "nao responde no Telegram" mas servico ativo: confira o `access.json` (o ID da
  pessoa precisa estar em `allowFrom`) e se o token bate com o bot certo.

Explique o que achou em linguagem simples e proponha o conserto antes de aplicar.
