# Mesa de tarefas

A mesa de tarefas mostra ao dono, numa tela só, o que cada agente está fazendo: quem está em
quê, quanto falta, o que travou e o que espera por ele. Funciona sozinha em cada VPS, dentro do
Tera Claw Web, sem nenhum serviço de fora. Nada para ligar: ela já vem com o Web.

## Onde fica

A tela é `/mesa` no Tera Claw Web, com o item **Mesa de tarefas** no menu da conversa. Um bloco
por agente, com os cartões das tarefas; o que espera pelo dono e o que travou vêm primeiro. O
dono também mexe nela: cria tarefa para um agente, responde, conclui, cancela e reabre.

## Como o agente usa

O agente cria, atualiza e conclui as próprias tarefas pelo comando `teraclaw-mesa`, que roda dentro
do container e fala com o Web pela [caixa do agente](CAIXA-DO-AGENTE.md) (o `teraclaw-api`). Ele não
passa endereço nem chave.

```bash
teraclaw-mesa criar --titulo "Roteiro do reels" --origem "Dono, 05/10 15h42: faz o roteiro" --passo pesquisa --passo roteiro
teraclaw-mesa atualizar 12 --progresso 60 --nota "escrevendo o gancho"
teraclaw-mesa pedir 12 --motivo "gancho A ou B?"
teraclaw-mesa concluir 12 --link "https://..."
teraclaw-mesa listar
```

A regra de quando criar uma tarefa está na seção "Mesa de tarefas" do `CLAUDE.md` do agente
(`templates/CLAUDE.md.tmpl`; no Codex, `templates/AGENTS.md.tmpl`) e na skill `mesa`
(`/teraclaw:mesa`). Quando o dono mexe numa tarefa pela tela, o Web manda ao agente um recado
começando com `[Mesa]`.

## Referência completa

- `web/docs/MESA.md`: a tarefa, os estados, quem pode o quê, as rotas, os erros e o comando.
- `GET /api/v1/tarefas/docs.md`: o mesmo documento, servido pelo Web (o agente lê com
  `teraclaw-api GET /api/v1/tarefas/docs.md`).

## O que o doctor diz

O bloco "mesa de tarefas local" do `/teraclaw:doctor` confere três coisas: se `teraclaw-mesa` e
`teraclaw-api` existem, e se o `CLAUDE.md` do agente tem a seção "Mesa de tarefas" atual. Sem os
comandos, o aviso diz para atualizar o Tera Claw e rodar `sudo teraclaw agente reparar <slug>`. Sem a
seção, o aviso pede `--fix`, que a acrescenta no fim do `CLAUDE.md` (com cópia de segurança ao lado).

## Integração antiga com o DG Telegram

A primeira versão da mesa ficava no app DG Telegram e usava `TERACLAW_MESA_URL` e `TERACLAW_MESA_KEY`
no `config.sh` do agente. A mesa local a substituiu, e essas variáveis são ignoradas por ela. O
[quadro de avisos da equipe](QUADRO-DE-AVISOS.md) ainda pode usá-las até a frente dele trocar de
base; o doctor continua conferindo essa integração quando as variáveis existem, como opcional.
