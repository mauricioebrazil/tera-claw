---
name: lembretes
description: Agenda lembretes para o DONO que insistem até ele confirmar (faixa na tela do Tera Claw, aviso no celular e recado para você, repetidos a cada poucos minutos até ele tocar Feito ou Adiar). Use SEMPRE que o dono pedir para ser lembrado ou avisado de algo ("me lembra de...", "me avisa às 15h", "não me deixa esquecer de...", "lembrete", "me cutuca amanhã", "insiste até eu fazer", "toca um alarme", "daqui a 20 minutos me lembra"), e quando chegar o recado que começa com [LEMBRETE]. Também serve para listar, pausar e apagar lembretes. NÃO use para você mesmo fazer um trabalho num horário (resumo do dia, conferir e-mail): isso é a skill agenda.
user-invocable: true
---

# /teraclaw:lembretes, avisar o dono e insistir até ele confirmar

O dono pede "me lembra de ligar pro contador amanhã às 9h". Você agenda pela API do Tera Claw Web. Na hora, o
próprio Tera Claw avisa de três jeitos ao mesmo tempo: uma faixa ⏰ no alto da conversa, um aviso no celular
(se ele ativou) e um recado para você. E repete a cada 5 minutos, até 12 vezes, até ele confirmar. Quem
insiste é o Tera Claw, não você.

## Lembrete ou rotina?

- **Lembrete (esta skill):** avisar o **dono** de alguma coisa e esperar a confirmação dele.
- **Rotina (skill `agenda`):** **você** fazer um trabalho num horário (mandar o resumo, conferir algo).
  Se a rotina precisar da confirmação do dono, ela mesma cria um lembrete.

## Como criar

Use o `teraclaw-api` (a documentação completa está em `teraclaw-api GET /api/v1/lembretes/docs.md`).

**Prazo relativo ("daqui a 20 minutos", "em meia hora"): sempre `daqui_min`.** O Tera Claw faz a conta da hora
no fuso certo. Não calcule hora na mão.

```bash
teraclaw-api POST /api/v1/lembretes '{"texto":"tirar o bolo do forno","daqui_min":20}'
```

**Data e hora marcadas:** rode `date` antes, para saber que dia é hoje e que dia da semana, e só então
escreva a data completa. O fuso é o do servidor; mande a hora que o dono falou.

```bash
# uma vez
teraclaw-api POST /api/v1/lembretes '{"texto":"ligar pro contador","regra":{"tipo":"unico","data":"2026-10-20","hora":"14:30"}}'
# todo dia, até o fim do ano, insistindo de 10 em 10 minutos
teraclaw-api POST /api/v1/lembretes '{"texto":"tomar o remédio","fim":"2026-12-31","intervalo_min":10,"regra":{"tipo":"diario","hora":"08:00"}}'
# segunda e quarta
teraclaw-api POST /api/v1/lembretes '{"texto":"treino","regra":{"tipo":"semanal","dias":["seg","qua"],"hora":"18:00"}}'
# a cada 3 dias
teraclaw-api POST /api/v1/lembretes '{"texto":"regar as plantas","regra":{"tipo":"a_cada_n_dias","n":3,"inicio":"2026-10-17","hora":"20:00"}}'
```

- Os tipos de regra são `unico`, `diario`, `semanal` e `a_cada_n_dias`. `hora`, `dias`, `data` e companhia vão
  **dentro** de `regra`.
- Opcionais: `intervalo_min` (1 a 120, padrão 5), `teto_envios` (1 a 60, padrão 12), `pelo_agente`,
  `titulo`, `fim`. O campo `agente` você não precisa mandar: é sempre você.
- **Confirme ao dono com a `regra_texto` e a `proxima` que a resposta devolveu**, nas palavras dele:
  "Combinado, toda segunda e quarta às 18:00. A próxima é segunda, 19/10 às 18:00." Se a resposta não
  bater com o que ele pediu, corrija na hora (PATCH) em vez de deixar passar.
- Erro 400 traz `erros` com o motivo de cada campo: leia, corrija e tente de novo. Não invente outro campo.

## Quando chegar o recado [LEMBRETE]

O recado vem como um aviso da plataforma, assim:

```text
[LEMBRETE] envio 2 de 12: "ligar pro contador" (marcado para 14:30).
Ocorrência oc_2f8b1819_202610201430. Avise o dono pelo canal que ele usa com você.
```

1. Se você tem um canal conectado (Telegram, WhatsApp), mande a mensagem por lá, curta, com o texto do
   lembrete. Se não tem, não responda nada: a faixa na tela e o aviso no celular já cumprem esse papel.
2. **Não repita o aviso por conta própria.** O Tera Claw já insiste; cada novo recado é o próximo aviso, e
   você só age quando ele chega.
3. Se o dono responder **"feito"**, "já fiz", "ok": `teraclaw-api POST /api/v1/lembretes/ocorrencias/<oc>/feito '{"origem":"telegram"}'`
   (troque a origem pelo canal: `whatsapp`, `chat`).
4. Se pedir para **adiar** ("me avisa daqui a meia hora"): `teraclaw-api POST /api/v1/lembretes/ocorrencias/<oc>/adiar '{"minutos":30}'`
   (de 1 a 1440). Depois do adiamento o aviso volta sozinho no prazo.
5. Use o id da ocorrência que veio no recado (`oc_...`). Se a rota responder 409, a ocorrência já foi
   encerrada por outro caminho (ele tocou Feito na tela, por exemplo): é só avisar o dono que já estava resolvido.

## Listar, pausar, apagar

```bash
teraclaw-api GET /api/v1/lembretes                     # os seus lembretes e o que está tocando agora
teraclaw-api GET "/api/v1/lembretes?estado=ativo"
teraclaw-api POST /api/v1/lembretes/<id>/pausar        # pausa (e retoma com /retomar)
teraclaw-api DELETE /api/v1/lembretes/<id>             # apaga de vez: confirme com o dono antes
teraclaw-api GET /api/v1/lembretes/<id>/ocorrencias    # histórico: quando tocou e como terminou
```

Você só enxerga os lembretes que são seus. O dono vê todos na tela Lembretes, no menu.

## Códigos de saída do teraclaw-api

| Código | Quer dizer | O que fazer |
| --- | --- | --- |
| 0 | deu certo | confirme ao dono |
| 1 | erro de uso (JSON inválido, rota errada) | corrija o comando |
| 2 | o Web não respondeu | tente de novo em 1 minuto; se repetir, avise o dono que o lembrete NÃO foi criado |
| 3 | a caixa não está disponível | peça ao dono para rodar `sudo teraclaw agente reparar <seu-slug>` |
| 4 | pedido recusado (400, 404, 409...) | leia o `erro` na saída e corrija |
| 5 | problema do lado do Web (503...) | avise o dono com a frase do `erro` |

Nunca diga ao dono que o lembrete está marcado antes de a resposta chegar com código 0.
