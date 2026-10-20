'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { subirWeb, cliente } = require('./ajuda');
const { criarSigilo } = require('../lib/sigilo');

// Valores de mentira, só para o servidor falso reconhecer o cabeçalho.
const CHAVE_CLAUDE = 'valor-falso-claude-123456789';
const CHAVE_OPENAI = 'valor-falso-openai-123456789';

/**
 * Servidor de modelo falso, no formato da Anthropic (/v1/messages) ou da OpenAI (/v1/chat/completions).
 * Regras: "Maria Souza" aponta "Maria Souza" e "Maria"; "Danilo" aponta "Danilo" (deve ser filtrado
 * como liberado); "Inventado" aponta um trecho que não existe no texto; "EXPLODE" derruba a chamada
 * com HTTP 500; "CHAVEECO" responde 401 com a chave no corpo, como a OpenAI faz.
 */
async function modeloFalso(formato) {
  const chamadas = [];
  const srv = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => {
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
      chamadas.push({ url: req.url, headers: req.headers, corpo });
      const usuario = formato === 'anthropic' ? corpo.messages[0].content : corpo.messages[1].content;
      const itens = JSON.parse(usuario.split('\n').pop());
      if (itens.some((x) => x.t.includes('EXPLODE'))) { res.writeHead(500); return res.end('erro interno do modelo'); }
      if (itens.some((x) => x.t.includes('CHAVEECO'))) {
        res.writeHead(401);
        return res.end(`chave ${req.headers['x-api-key'] || (req.headers.authorization || '').slice(7)} recusada`);
      }
      const r = itens.map((x) => {
        const s = [];
        if (x.t.includes('Maria Souza')) s.push('Maria Souza', 'Maria');
        if (x.t.includes('Danilo')) s.push('Danilo');
        if (x.t.includes('Inventado')) s.push('Fulano Que Não Existe');
        return { i: x.i, s };
      });
      const json = JSON.stringify({ r });
      const saida = formato === 'anthropic'
        ? { content: [{ type: 'text', text: 'Aqui vai: ' + json }] }
        : { choices: [{ message: { content: json } }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(saida));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, chamadas, fechar: () => new Promise((ok) => srv.close(ok)) };
}

async function web(env) {
  const t = await subirWeb({ env, agentes: [{ slug: 'ana', nome: 'Ana', runner: 'http://127.0.0.1:1', agente_id: 'a1', dono: 'Beto' }] });
  await t.login();
  return t;
}

test('sem chave: só filtro automático, trechos vazios e aviso com o caminho para ligar', async () => {
  const t = await web({});
  try {
    const r = await t.c.post('/api/v1/sigilo', { json: { textos: ['Maria Souza pagou R$ 10', ''] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.trechos, [[], []]);
    assert.equal(r.json.so_regex, true);
    assert.equal(r.json.modelo, null);
    assert.equal(r.json.analisados, 0);
    assert.match(r.json.avisos[0], /Sem chave de modelo/);
    assert.match(r.json.avisos[0], /liga o modo escondido completo/);
    const e = await t.c.get('/api/v1/sigilo/estado');
    assert.equal(e.json.so_regex, true);
    assert.equal(e.json.modelo, null);
  } finally { await t.fechar(); }
});

test('Claude Haiku: trechos certos, liberados filtrados, invenção descartada e cache na segunda chamada', async () => {
  const m = await modeloFalso('anthropic');
  const t = await web({ ANTHROPIC_API_KEY: CHAVE_CLAUDE, ANTHROPIC_BASE_URL: m.url, TERACLAW_SIGILO_LIBERADOS: 'Danilo, Beta', OPENAI_API_KEY: CHAVE_OPENAI });
  try {
    const textos = ['Maria Souza ligou', 'Danilo e Ana conversaram', 'Inventado aqui', 'nada sensível', 'Maria Souza ligou'];
    const r = await t.c.post('/api/v1/sigilo', { json: { textos } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.trechos, [['Maria Souza', 'Maria'], [], [], [], ['Maria Souza', 'Maria']]);
    assert.equal(r.json.modelo, 'claude-haiku-4-5');
    assert.equal(r.json.so_regex, false);
    assert.equal(r.json.analisados, 4);                       // o texto repetido vai uma vez só
    assert.equal(m.chamadas.length, 1);
    assert.equal(m.chamadas[0].url, '/v1/messages');
    assert.equal(m.chamadas[0].headers['x-api-key'], CHAVE_CLAUDE);
    assert.equal(m.chamadas[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(m.chamadas[0].corpo.model, 'claude-haiku-4-5');
    const antes = m.chamadas.length;
    const r2 = await t.c.post('/api/v1/sigilo', { json: { textos } });
    assert.equal(r2.json.analisados, 0);
    assert.deepEqual(r2.json.trechos, r.json.trechos);
    assert.equal(m.chamadas.length, antes);
    const cache = path.join(t.dados, 'sigilo-cache.json');
    assert.equal(fs.statSync(cache).mode & 0o777, 0o600);
    assert.ok(!t.log.texto().includes('Maria'), 'o log não pode trazer texto de mensagem');
    assert.ok(!t.log.texto().includes(CHAVE_CLAUDE), 'o log não pode trazer a chave');
    assert.equal((await t.c.get('/api/v1/sigilo/estado')).json.modelo, 'claude-haiku-4-5');
  } finally { await t.fechar(); await m.fechar(); }
});

test('nome do agente, o campo dono do registro e as plataformas nunca são escondidos', async () => {
  const t = await web({});
  try {
    const s = criarSigilo({ env: { TERACLAW_SIGILO_LIBERADOS: 'Danilo' }, registro: t.web.registro, dataDir: t.dados, log: () => {} });
    const lib = s.liberados();
    for (const n of ['ana', 'beto', 'danilo', 'claude', 'tera claw', 'whatsapp', 'github', 'telegram']) assert.ok(lib.has(n), n);
  } finally { await t.fechar(); }
});

test('OpenAI quando só há OPENAI_API_KEY, e TERACLAW_SIGILO_MODELO troca o modelo', async () => {
  const m = await modeloFalso('openai');
  const t = await web({ OPENAI_API_KEY: CHAVE_OPENAI, OPENAI_BASE_URL: m.url });
  const t2 = await web({ OPENAI_API_KEY: CHAVE_OPENAI, OPENAI_BASE_URL: m.url, TERACLAW_SIGILO_MODELO: 'gpt-5-mini' });
  try {
    const r = await t.c.post('/api/v1/sigilo', { json: { textos: ['Maria Souza'] } });
    assert.deepEqual(r.json.trechos, [['Maria Souza', 'Maria']]);
    assert.equal(r.json.modelo, 'gpt-4.1-mini');
    assert.equal(m.chamadas[0].url, '/v1/chat/completions');
    assert.equal(m.chamadas[0].headers.authorization, `Bearer ${CHAVE_OPENAI}`);
    assert.deepEqual(m.chamadas[0].corpo.response_format, { type: 'json_object' });
    const r2 = await t2.c.post('/api/v1/sigilo', { json: { textos: ['Maria Souza'] } });
    assert.equal(r2.json.modelo, 'gpt-5-mini');
    assert.equal(m.chamadas[1].corpo.model, 'gpt-5-mini');
    assert.equal(r2.json.analisados, 1);
  } finally { await t.fechar(); await t2.fechar(); await m.fechar(); }
});

test('lote que falha tenta item a item; o que ainda falha vira null com aviso sem vazar a chave', async () => {
  const m = await modeloFalso('anthropic');
  const t = await web({ ANTHROPIC_API_KEY: CHAVE_CLAUDE, ANTHROPIC_BASE_URL: m.url });
  try {
    const r = await t.c.post('/api/v1/sigilo', { json: { textos: ['Maria Souza ok', 'EXPLODE tudo', 'CHAVEECO agora'] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.trechos[0], ['Maria Souza', 'Maria']);
    assert.equal(r.json.trechos[1], null);
    assert.equal(r.json.trechos[2], null);
    assert.ok(r.json.avisos.length >= 2);
    assert.match(r.json.avisos.join(' '), /HTTP 500/);
    assert.match(r.json.avisos.join(' '), /HTTP 401/);
    assert.ok(!JSON.stringify(r.json).includes(CHAVE_CLAUDE), 'a chave não pode voltar na resposta');
    assert.ok(!t.log.texto().includes(CHAVE_CLAUDE), 'nem no log');
    assert.match(t.log.texto(), /não consegui analisar uma mensagem/);
    // o que falhou não entra no cache: de novo, vai outra vez ao modelo
    const r2 = await t.c.post('/api/v1/sigilo', { json: { textos: ['EXPLODE tudo'] } });
    assert.equal(r2.json.analisados, 1);
  } finally { await t.fechar(); await m.fechar(); }
});

test('cache ilegível: loga o motivo e recomeça vazio', async () => {
  const m = await modeloFalso('anthropic');
  const t = await web({ ANTHROPIC_API_KEY: CHAVE_CLAUDE, ANTHROPIC_BASE_URL: m.url });
  try {
    fs.writeFileSync(path.join(t.dados, 'sigilo-cache.json'), '{quebrado');
    const r = await t.c.post('/api/v1/sigilo', { json: { textos: ['Maria Souza'] } });
    assert.equal(r.json.analisados, 1);
    assert.match(t.log.texto(), /sigilo-cache\.json está ilegível/);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(t.dados, 'sigilo-cache.json'), 'utf8')));
  } finally { await t.fechar(); await m.fechar(); }
});

test('validação: sem textos, não-lista, item que não é texto e mais de 600 itens dão 400 com motivo', async () => {
  const t = await web({});
  try {
    const casos = [
      [{}, /Faltou o campo "textos"/],
      [{ textos: 'oi' }, /precisa ser uma lista/],
      [{ textos: ['a', 3] }, /O item 1 é do tipo number/],
      [{ textos: Array(601).fill('x') }, /Até 600 textos.*vieram 601/],
    ];
    for (const [json, rx] of casos) {
      const r = await t.c.post('/api/v1/sigilo', { json });
      assert.equal(r.status, 400, JSON.stringify(json).slice(0, 40));
      assert.equal(r.json.ok, false);
      assert.match(r.json.erro, rx);
    }
    const ok = await t.c.post('/api/v1/sigilo', { json: { textos: Array(600).fill('x') } });
    assert.equal(ok.status, 200);
    assert.equal((await t.c.get('/api/v1/sigilo')).status, 405);
  } finally { await t.fechar(); }
});

test('a rota exige login e a origem do próprio site', async () => {
  const t = await web({});
  try {
    const anonimo = cliente(t.porta);
    assert.equal((await anonimo.post('/api/v1/sigilo', { json: { textos: ['a'] } })).status, 401);
    assert.equal((await anonimo.get('/api/v1/sigilo/estado')).status, 401);
    const semOrigem = await t.c.post('/api/v1/sigilo', { json: { textos: ['a'] }, origin: false });
    assert.equal(semOrigem.status, 403);
    const docs = await t.c.get('/api/v1/sigilo/docs.md');
    assert.equal(docs.status, 200);
    assert.match(docs.texto, /POST \/api\/v1\/sigilo/);
  } finally { await t.fechar(); }
});
