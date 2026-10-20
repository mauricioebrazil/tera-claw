---
name: foco
description: Monta e mantém o "Modo foco", a lista curta do que o dono quer fechar agora, que aparece ao lado da conversa com você e onde ele tica os itens na tela. Use quando o dono disser "monta meu foco", "monta meu foco de hoje", "o que eu preciso fazer agora", "lista de foco", "modo foco", "me ajuda a priorizar o dia", "o que falta fazer hoje", "tica X", "marca X como feito", "já fiz X", "acrescenta Y no foco", "tira Z do foco", "limpa o foco". Também use antes de perguntar ao dono "você já fez X?": se X está na lista, o tique dele responde. Usa o comando teraclaw-api, que entrega o pedido ao Web pela caixa de arquivos. Documentação completa em GET /api/v1/foco/docs.md.
user-invocable: true
---

# /teraclaw:foco: a lista do que importa agora

O Modo foco é uma lista curta, **sua e do dono**: você monta, ele tica na tela. Cada agente
tem a própria lista. Ela aparece sozinha ao lado da conversa (no celular, numa faixa no topo).

## Quando montar

- O dono pediu o foco do dia, "o que eu preciso fazer agora" ou ajuda para priorizar.
- A conversa terminou com um monte de pendências e ele precisa de um próximo passo claro.

Não monte por conta própria sem ele ter pedido ou aceitado a ideia. Montar avisa o celular dele.

## Como montar bem

- **De 3 a 7 itens.** Mais que isso deixa de ser foco. O máximo do sistema é 50 itens, e o
  texto de cada um vai de 1 a 300 caracteres (o título, até 80).
- **Verbo no começo**, no infinitivo, e o item cabe numa ação só: "Revisar o contrato da
  Vitória", "Ligar pro Fernando", "Mandar a proposta pra Carla".
- Na ordem em que ele deve fazer. O que destrava os outros vem primeiro.
- Use as palavras do dono, os nomes que ele usa.

## Os comandos

Use sempre o alias `eu` no lugar do seu id: só você mexe na sua lista.

```bash
# montar ou substituir a lista inteira (itens: texto puro ou {"texto", "feito"?})
teraclaw-api PUT /api/v1/foco/eu \
  '{"titulo": "Foco de hoje", "itens": ["Revisar o contrato da Vitória", "Ligar pro Fernando", {"texto": "Pagar o boleto", "feito": true}]}'

# acrescentar um item no fim
teraclaw-api POST /api/v1/foco/eu/itens '{"texto": "Mandar a proposta pra Carla"}'

# ticar, desticar ou corrigir o texto (o id vem da lista)
teraclaw-api PATCH /api/v1/foco/eu/itens/42 '{"feito": true}'

# apagar um item, ou limpar a lista toda
teraclaw-api DELETE /api/v1/foco/eu/itens/42
teraclaw-api DELETE /api/v1/foco/eu

# ver a lista
teraclaw-api GET /api/v1/foco/eu
```

- O PUT troca a lista inteira. Sem `titulo`, mantém o que ela já tinha. Para mexer em um item só,
  use POST, PATCH ou DELETE.
- `"mudou": false` na resposta quer dizer que já estava assim. Nada de errado.
- Quando o dono disser "já fiz X", ticar é com você (PATCH com `"feito": true`) se ele não
  ticou sozinho.

## Códigos de saída do teraclaw-api

| Saída | Quer dizer | O que fazer |
| --- | --- | --- |
| 0 | deu certo | seguir |
| 4 | pedido errado | ler o campo `erro` no stderr (texto longo demais, mais de 50 itens, id que não existe...), corrigir e repetir |
| 2 | o Web está fora do ar | avisar o dono em uma frase e tentar de novo mais tarde; não invente que gravou |

## Saber o que o dono ticou

Os tiques dele **não chegam como mensagem**. Dois jeitos de ficar sabendo:

1. **Sozinho, no começo do turno** (agentes Claude): quando ele marcou algo desde a sua última
   mensagem, o contexto do turno traz um bloco assim:

   ```text
   🎯 Modo foco (marcado pelo dono na tela desde a sua última mensagem):
   - ticou: Ligar pro Fernando
   - desticou: Pagar o boleto
   Placar: 2 de 3. Faltam: Pagar o boleto.
   ```

2. **Quando você quiser conferir** (Claude e Codex), lendo os eventos com um cursor:

   ```bash
   teraclaw-api GET "/api/v1/foco/eu/eventos?desde_id=0"
   ```

   Guarde o `ultimo_id` da resposta e mande como `desde_id` na próxima. Se `tem_mais` vier
   `true`, leia de novo a partir do novo `ultimo_id`. O arquivo `~/.teraclaw/retratos/foco.json`
   tem a mesma informação, para ler direto, e só leitura: editar o arquivo não muda a lista.

## O tique do dono não é uma mensagem

Ele ticou um item: **não responda a isso como se fosse uma conversa**. Nada de "Boa, você
fechou o contrato!" a cada toque. Use a informação: se está na lista como feito, não pergunte
de novo, e quando ele voltar a falar, considere o placar. Comente só se ajudar (a lista
fechou, sobrou algo que está travando, ele destica algo que parecia resolvido).

Antes de perguntar ao dono "você já fez X?", confira a lista ou os eventos.

## Mais detalhes

`GET /api/v1/foco/docs.md` no Web (com a sessão, ou pela caixa com `teraclaw-api GET /api/v1/foco/docs.md`)
traz o formato completo da lista, todas as rotas e os erros.
