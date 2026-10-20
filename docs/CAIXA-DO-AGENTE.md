# Caixa do agente: o agente chamando a API do Web

O agente vive num container que **não alcança o host** (a cadeia `TERACLAW_HOST` do
[firewall](../lib/firewall.sh) bloqueia). O Tera Claw Web roda no host. Então o agente
não consegue fazer `curl` para o Web. A caixa resolve isso por arquivo: o agente deixa
um pedido numa pasta da casa dele, o Web (que é root e enxerga todas as casas) executa
o pedido como se fosse uma chamada HTTP normal e devolve a resposta noutra pasta.

Para o agente, isso aparece como um comando só:

```bash
teraclaw-api GET  /api/v1/lembretes
teraclaw-api POST /api/v1/lembretes '{"texto":"ligar pro contador","regra":{"tipo":"unico","data":"2026-10-20","hora":"14:30"}}'
teraclaw-api GET  "/api/v1/foco/eventos?desde_id=3"
teraclaw-api GET  /api/v1/lembretes/docs.md
```

A mesma rota, o mesmo corpo e a mesma resposta que a tela usa. Nenhuma função tem um
caminho só para o agente: quem constrói uma frente nova escreve as rotas uma vez e as
libera para a caixa com uma linha.

## O comando `teraclaw-api` (dentro do container)

```text
teraclaw-api <METODO> <ROTA> [CORPO_JSON | --arquivo F | -] [--com-status] [--espera S]
```

- `METODO`: `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- `ROTA`: começa com `/api/v1/`. Query string vale (`?agente=x&limit=5`).
- Corpo: JSON como argumento, `--arquivo caminho.json`, ou `-` para ler do stdin.
- Saída padrão: o corpo da resposta. JSON sai como veio; texto (os `docs.md`) sai cru.
- `--com-status`: em vez do corpo, imprime `{"status": 201, "corpo": {...}}`.
- `--espera S`: quantos segundos esperar a resposta (padrão 20, de 1 a 120).
- Erro HTTP: o corpo sai no stdout mesmo assim, e a frase do campo `erro` sai no stderr.

| Código de saída | Quer dizer |
| --- | --- |
| 0 | resposta 2xx |
| 1 | erro de uso (método, rota fora de `/api/v1/`, JSON inválido, arquivo ilegível) |
| 2 | o Web não respondeu dentro da espera (fora do ar ou reiniciando). O pedido é descartado pelo Web se chegar com mais de 5 minutos |
| 3 | a caixa não está disponível (pasta ausente ou sem permissão). O instalador cria a pasta; peça ao dono para rodar `sudo teraclaw agente reparar <slug>` |
| 4 | resposta 4xx (pedido errado: leia o `erro`) |
| 5 | resposta 5xx (problema do lado do Web: leia o `erro`) |

## Os arquivos

Tudo dentro de `~/.teraclaw/caixa/` na casa do agente (no host, `<home_host>/.teraclaw/caixa/`).

| Caminho | Quem escreve | Conteúdo |
| --- | --- | --- |
| `entrada/<id>.json` | o agente | `{"v":1,"id":"<id>","metodo":"POST","rota":"/api/v1/...","corpo":{...}}` |
| `saida/<id>.json` | o Web | `{"v":1,"id":"<id>","status":201,"corpo":{...}}` |

- `<id>`: 8 a 64 caracteres `a-z 0-9 -`. O comando gera um aleatório.
- O agente escreve num temporário que começa com ponto (`.<id>.tmp`) e renomeia: o Web
  ignora nomes que começam com ponto, então nunca lê pedido pela metade.
- Teto de 1 MB por pedido. Maior que isso volta 413 na `saida`.
- O Web apaga o pedido da `entrada` depois de responder. O comando apaga a resposta da
  `saida` depois de ler.
- O Web olha as caixas a cada 1 segundo. Pedido com mais de 5 minutos é descartado com
  uma resposta 408 e uma linha no log.
- Até 20 pedidos por agente por volta, e no máximo 120 por minuto por agente. Passou do teto,
  o pedido volta 429 na `saida`, com quantos segundos esperar: um agente em laço não derruba o Web.

## Segurança

O Web é root e a casa é do agente. O risco conhecido é o agente trocar um arquivo ou uma
pasta por um atalho e fazer o root ler ou gravar em outro lugar (`/etc/shadow`). Por isso:

- a pasta `~/.teraclaw/caixa/` e as subpastas são conferidas com `lstat` e `realpath`: atalho é
  recusado, e o caminho real tem de ficar dentro de `home_host`;
- a leitura usa `lstat` e abre com `O_NOFOLLOW`; só arquivo regular, do mesmo dono da casa,
  dentro do teto. Atalho, pasta, fifo ou arquivo de outro dono é recusado e registrado no log;
- a resposta é gravada pelo [gravador seguro](../web/lib/grava-seguro.js), com o dono e o
  grupo da casa e modo 0600;
- o pedido é executado com a **identidade do agente**, nunca a do dono. A rota sabe quem
  chamou (abaixo) e decide o que esse agente pode fazer;
- só rotas cujo prefixo foi liberado com `caixa.permitir()` são executadas. As demais voltam
  403 dizendo que a rota não está liberada para agentes. Login, cofre, onboarding, uploads e
  conversa nunca são liberados;
- a chamada interna vai para o próprio Web em `127.0.0.1`, com um segredo que nasce na memória
  a cada partida do processo e nunca vai para disco nem para log.

## Para quem constrói uma frente nova (contrato do código)

No `web/server.js`, depois de criar a sua frente, uma linha:

```js
caixa.permitir('/api/v1/lembretes');
```

No handler da rota, quem chamou vem da sessão:

```js
const { quemChamou } = require('./lib/caixa-agente');
const quem = quemChamou(sessao);
// { tipo: 'dono',   usuario: 'danilo' }        sessão do navegador
// { tipo: 'agente', slug: 'luna' }             pedido vindo da caixa da Luna
if (quem.tipo === 'agente' && quem.slug !== agenteAlvo.slug) {
  return H.erroJson(res, 403, `O agente ${quem.slug} só mexe nos próprios lembretes, não nos de ${agenteAlvo.slug}.`);
}
```

A sessão de um pedido da caixa é `{ usuario: 'agente:<slug>', via: 'caixa', agente: '<slug>' }`.
A conferência de Origin (CSRF) não se aplica a ela: o pedido não vem de navegador.

### Retrato: o Web deixando um arquivo para o agente ler sem perguntar

Algumas frentes querem que o agente leia o estado direto do disco, sem ida e volta
(um hook que roda a cada mensagem, por exemplo). Para isso:

```js
await caixa.gravaRetrato(agente, 'foco', objeto);          // atalho para o caso comum
await caixa.gravaNaCasa(agente, 'retratos/foco.json', objeto);  // caminho livre dentro de ~/.teraclaw/
```

- `gravaRetrato(agente, frente, objeto)` grava `<home_host>/.teraclaw/retratos/<frente>.json`
  (frente em `a-z 0-9 -`), com `atualizado_em` acrescentado;
- `gravaNaCasa` grava `<home_host>/.teraclaw/<relPath>` com o gravador seguro, dono da casa, modo 0600;
- `relPath` só aceita `a-z 0-9 . _ -` e barras, sem `..`, sem começar com barra;
- **a verdade fica no Web** (`<TERACLAW_WEB_DATA>/<frente>/...`, por slug). O retrato é cópia de
  leitura: se o agente mexer nele, nada muda no Web, e o próximo retrato sobrescreve.
- Erro de gravação lança `ErroGravacao` com a causa em português; a frente decide se registra
  e segue.

### Testar sem container

`web/test/caixa-agente.test.js` monta uma casa temporária, escreve o pedido como o comando
faria e confere a resposta. O comando tem teste próprio em `tests/` apontando
`TERACLAW_CAIXA_DIR` para uma pasta temporária (variável só para testes).
