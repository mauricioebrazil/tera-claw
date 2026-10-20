# Primeiro agente pelo Admin

O painel recebe a pessoa depois da instalação. O **Admin** é a sessão administradora de Claude Code
(ou o provedor já escolhido na instalação). Ele cuida do servidor e cria os agentes. Os agentes de
trabalho continuam separados em containers.

## O que a pessoa vê e decide

1. O instalador entrega o endereço do painel, o usuário e um link de primeiro acesso (`/primeiro-acesso#<código>`,
   uso único, válido por 30 minutos). A pessoa abre o link, cadastra a senha no navegador e já entra em
   `/a/admin`. A senha nunca aparece no terminal. Na reinstalação com senha existente, o instalador
   informa que a atual foi mantida. Um link novo sai com `sudo teraclaw primeiro-acesso`. Não publique
   capturas do link de primeiro acesso antes de ele ser usado.
2. No Admin, o botão **Quero criar meu primeiro agente** envia essa frase à conversa. Depois vem
   a pergunta sobre o nome. **Continuar** manda o nome pela conversa, sem criar ainda.
3. O visual pede função, tom e foto opcional. **Criar meu agente** confirma essas escolhas e envia
   um pedido ao Admin. A foto aceita PNG, JPEG ou WebP de até 5 MB. **Gerar avatar** desenha
   um robô ilustrado no navegador, sem IA nem serviço externo, e usa o mesmo upload autenticado.
   Sem foto, há um avatar neutro. O campo opcional de nome do dono personaliza a saudação.
4. O visual mostra a etapa real, sem percentuais estimados. O Admin cria pela CLI existente.
5. Em **Conectar minha assinatura**, a pessoa abre a aba Status do painel do novo agente e usa
   **Entrar com a assinatura**. Depois volta ao Admin e toca em **Já entrei. Pode testar.**
6. O Admin manda uma saudação ao agente e espera uma resposta nova. Só após essa prova a caixa abre,
   aparece a badge e seu link leva à conversa cadastrada. Com Reduzir Movimento, a caixa dá lugar
   à badge em uma transição curta, sem tremor, giro ou deslocamento. A conversa abre com a
   apresentação que o agente produziu no teste e um tutorial apontando o menu à esquerda.

Se a pessoa responder pela conversa em vez de usar o formulário, o Admin grava o pedido com
`onboarding.js pedir` e segue o mesmo `criar` e `testar`, então a animação e a primeira mensagem
aparecem nos dois caminhos.

**Tutorial** fica junto do título. Cada seção tem `?`, com holofote, explicação do que é, como
funciona e por que está ali. O visual funciona no celular e com teclado.

## De onde vem cada estado

O Web grava pedidos em `TERACLAW_WEB_DATA/onboarding/<id>.json`, modo 600. O id é aleatório e cada pedido
é enviado uma vez. Dados do formulário são texto, nunca shell. O Web não tem uma rota para executar
comandos do cliente. O Admin lê a skill `criar-agente` e chama o helper local:

```sh
node /opt/teraclaw/app/web/bin/onboarding.js ver <id>
node /opt/teraclaw/app/web/bin/onboarding.js criar <id>
node /opt/teraclaw/app/web/bin/onboarding.js testar <id>
```

| Estado | Fonte | O que fazer |
| --- | --- | --- |
| Boas-vindas | Só existe o Admin no registro e não há pedido | Iniciar a conversa e escolher o nome |
| Solicitado | O runner do Admin aceitou a mensagem | Aguardar o Admin |
| Criando | Helper iniciou `teraclaw agente criar` | Aguardar, o andamento vem da criação real |
| Login | CLI terminou e o agente está no registro | Conectar a assinatura no painel dele |
| Testando | Saudação enviada à conversa real | Aguardar a resposta |
| Pronto | Mensagem nova com origem `agente` após o envio de teste | Abrir a conversa pela badge |
| Erro | Criação ou teste falhou | Pedir ajuda ao Admin, que retoma o mesmo pedido |
| Erro no envio | Runner do Admin não aceitou o pedido | Conferir o Admin e repetir o envio |

O helper usa argumentos separados, sem shell, e trava por pedido. A criação já cadastrada retoma
no login. Logs da CLI ficam ao lado do pedido, modo 600, sem exposição HTTP. Uma trava `.lock` após
queda exige conferir se o PID ainda está vivo antes de removê-la. Não apagar a casa do agente para
recomeçar. Se o processo morrer no meio da criação, o Admin diagnostica a etapa antes de retomar.

## Barra de progresso

`GET /api/v1/onboarding` devolve `progresso`: `{ pct, etapa, passo, total, erro }`. Tudo o que a barra
mostra vem daí. `pct` vai de 0 a 100 e nunca diminui dentro do mesmo pedido (o Web guarda o maior valor
em memória). `etapa` é um texto em português. `passo` e `total` só existem quando a etapa é contável
(criação e imagem). `erro` é `null` ou `{ motivo, oQueFazer }`.

| Situação | pct | Etapa mostrada |
| --- | --- | --- |
| Enviando | 2 | Enviando suas escolhas ao Admin |
| Solicitado | 5 | O Admin está lendo o seu pedido |
| Imagem dos agentes em construção (fase solicitado ou criando, antes da primeira etapa do `teraclaw`) | 5 a 30, proporcional ao último `STEP n/m` do podman | Preparando a imagem dos agentes (só na primeira vez, leva alguns minutos) |
| Criando | 30 a 80, proporcional à etapa do `teraclaw agente criar` | Uma das 11 etapas abaixo |
| Login | 85 | Falta conectar a assinatura |
| Testando | 92 | Esperando o primeiro oi do agente |
| Pronto | 100 | Pronto! Seu agente chegou |

Etapas da criação, lidas do fim do `<id>.log` (últimos 64 KB, sem cores): reservando um espaço para o
agente, preparando a casa do agente, escrevendo a identidade do agente, gerando as chaves de segurança,
criando o ambiente isolado, aplicando as regras de proteção, ligando a máquina do agente, instalando as
rotinas do agente, esperando o agente acordar, conferindo o isolamento e registrando o agente. Linha
desconhecida é ignorada e a barra mantém a última etapa conhecida. Uma nova tentativa vale só pela
execução mais recente do log.

A imagem é construída pela unidade `teraclaw-imagem.service` antes do primeiro `agente criar`. O Web pergunta
`systemctl is-active` (sem shell, 2 s de limite, resposta guardada por 3 s) e lê o fim de
`/var/log/teraclaw/imagem.log` (`TERACLAW_RAIZ` muda a raiz). Se a unidade falhou com o pedido ainda em
solicitado, `erro` traz as últimas linhas do log e "Peça ao Admin para rodar teraclaw imagem construir de novo".
Sem resposta do systemd, a barra segue só pela fase do pedido e o Web registra um aviso.

Erro mantém o `pct` da última etapa. O motivo vem da linha `Nao deu certo:` do log e o que fazer vem de
`O que fazer:`. Sem essas linhas, usa o motivo gravado pelo helper (`motivo`, junto com `ultimaFase`, só
para a barra) e, por fim, a mensagem do pedido. Toda frase de falha passa por limpeza: sem cores, sem
`sk-...`, `Bearer`, `token=`, caminhos de `/etc/teraclaw` ou de segredos, e no máximo 300 caracteres.

Na tela, a consulta é de 1,5 s enquanto o pedido está enviando, solicitado, criando ou testando, e de 6 s
nas outras fases; para no pronto. A barra tem `role="progressbar"` com `aria-valuenow` e `aria-valuetext`.
O cartão só é redesenhado quando a fase ou a mensagem muda; as consultas trocam apenas texto e largura da
barra. Com `prefers-reduced-motion`, a largura muda sem transição.

## Rotas e arquivos

- `GET /api/v1/onboarding`: estado do último pedido, sem caminhos privados ou logs.
- `POST /api/v1/onboarding`: nome, papel, jeito, dono opcional, id e id da foto previamente enviada pelo upload do
  Admin. Exige login e Origin, como as demais mutações. Não aceita caminho de arquivo do navegador.
- `web/public/onboarding.js` e `.css`: visual nativo dentro do chat. Usa a intenção `data-pergunta`
  e o marcador `[do visual Criar meu agente]`, seguindo a linguagem dos `vis-*`. Não acrescenta
  permissões ao sandbox dos anexos nem permite navegação comandada por HTML de terceiros.
- A foto é servida pela rota de mídia autenticada existente, dentro das raízes já permitidas. O
  pedido conserva o caminho interno para registrar a mídia novamente depois de reiniciar o Web.
- O formulário usa a assinatura do Admin e o chat do painel como padrão. Outras escolhas continuam
  disponíveis na conversa com o Admin, pelo roteiro da skill.

## Prova e limites

`node --test web/test/onboarding.test.js` verifica o contrato HTTP e o helper com dublês explícitos.
`qa/instalacao/onboarding-navegador.cjs` verifica a interface em 390 px com movimento reduzido e
1440 px com movimento normal, upload, tutorial, criação sem duplicação e link da badge. Usa runner
falso. Nenhuma dessas baterias substitui a instalação limpa, login e resposta de Claude Code na KVM 2.

## Instalação rápida

O instalador deixa a unidade de construção da imagem disponível, mas não a inicia por padrão.
O Admin inicia essa preparação na primeira criação e acompanha o resultado. `--com-imagem` permite
antecipá-la. FFmpeg e canais externos não entram na instalação inicial. O Admin usa `HOME=/root`
e o login existente de Claude Code ou Codex; esse acesso não é copiado para agentes de trabalho.

## A animação de nascimento toca uma vez só

Quando o agente fica pronto, a caixa abre uma única vez. O web grava `animacaoVista` no JSON do pedido
(`POST /api/v1/onboarding/animacao-vista` com `{ "id": ... }`, só aceito com o pedido em `pronto`), então
vale em qualquer aparelho; o navegador guarda também `teraclaw-anim-vista:<id>` como camada extra. Depois
disso, e em todo recarregamento, o `GET /api/v1/onboarding` devolve o pedido em `cartoes` e a conversa mostra
um cartão estático "<Nome> nasceu às HH:MM", encaixado na ordem cronológica pela hora em que a criação terminou
(`concluidoEp`) e não mais preso no fim. Com `prefers-reduced-motion` a versão estática vem direto.
