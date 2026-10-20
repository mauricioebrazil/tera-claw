'use strict';
// Quadro de avisos de ponta a ponta: servidor inteiro, três agentes com casa temporária,
// pedidos pela caixa do agente e conferência dos retratos e do recado pelo runner falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { subirWeb } = require('./ajuda');
const { criarRunnerFalso } = require('./runner-falso');

const souRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const UID = souRoot ? 65534 : process.getuid();
const GID = souRoot ? 65534 : process.getgid();
const dar = (p) => { if (souRoot) fs.chownSync(p, UID, GID); };

/** Casa com .teraclaw/caixa/entrada e .teraclaw/retratos, entregue ao dono que a caixa exige. */
function casa() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-casa-'));
  fs.chmodSync(h, 0o755); dar(h);
  let atual = h;
  for (const d of ['.teraclaw', 'caixa', 'entrada']) {
    atual = path.join(atual, d);
    fs.mkdirSync(atual, { mode: 0o700 }); dar(atual);
  }
  const ret = path.join(h, '.teraclaw', 'retratos');
  fs.mkdirSync(ret, { mode: 0o700 }); dar(ret);
  return h;
}
const entrada = (h) => path.join(h, '.teraclaw', 'caixa', 'entrada');
const saida = (h) => path.join(h, '.teraclaw', 'caixa', 'saida');
const retrato = (h) => JSON.parse(fs.readFileSync(path.join(h, '.teraclaw', 'retratos', 'avisos.json'), 'utf8'));
let contador = 0;

/** Grava um pedido na caixa do agente, roda a volta e devolve { id, resp }. */
async function pelaCaixa(s, slug, metodo, rota, corpo) {
  const id = `ponta-${String(++contador).padStart(6, '0')}`;
  const arq = path.join(entrada(s.homes[slug]), `${id}.json`);
  fs.writeFileSync(arq, JSON.stringify(Object.assign({ v: 1, id, metodo, rota }, corpo === undefined ? {} : { corpo })));
  dar(arq);
  const lido = path.join(saida(s.homes[slug]), `${id}.json`);
  for (let i = 0; i < 50 && !fs.existsSync(lido); i++) {
    await s.t.web.caixa.volta();
    if (!fs.existsSync(lido)) await new Promise((r) => setTimeout(r, 100));
  }
  return { id, resp: JSON.parse(fs.readFileSync(lido, 'utf8')) };
}

async function cenario() {
  const slugs = ['lara', 'marina', 'luna'];
  const runners = {}; const homes = {}; const agentes = [];
  for (const slug of slugs) {
    runners[slug] = criarRunnerFalso({ agenteId: `${slug}-id`, sessionId: `sess-${slug}-0001` });
    const porta = await runners[slug].ouvir();
    homes[slug] = casa();
    agentes.push({ slug, nome: slug[0].toUpperCase() + slug.slice(1), tipo: 'agente', runner: `http://127.0.0.1:${porta}`, agente_id: `${slug}-id`, chat_id: `c_${slug}`, provedor: 'claude', modelo: 'sonnet', home_host: homes[slug], home_container: `/home/${slug}` });
  }
  const t = await subirWeb({ agentes });
  fs.writeFileSync(path.join(t.publico, 'avisos.html'), '<html>avisos de teste</html>');
  const fechar = async () => {
    await t.fechar();
    for (const slug of slugs) { await runners[slug].fechar(); fs.rmSync(homes[slug], { recursive: true, force: true }); }
  };
  return { t, runners, homes, fechar };
}

test('quadro de avisos de ponta a ponta', async (tc) => {
  const s = await cenario();
  try {
    let aviso;
    await tc.test('a) lara grava um pedido e a resposta 201 aparece na saida da caixa dela', async () => {
      const { resp } = await pelaCaixa(s, 'lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', para: ['marina'], texto: 'Marina, preciso do relatório de ontem.' });
      assert.equal(resp.status, 201, JSON.stringify(resp));
      aviso = resp.corpo.aviso || resp.corpo;
      assert.equal(aviso.agente, 'lara');
    });

    await tc.test('b) retrato da marina tem o aviso com recado:true e o runner recebeu o recado', async () => {
      const r = retrato(s.homes.marina);
      const lista = r.avisos || [];
      const a = lista.find((x) => x.agente === 'lara');
      assert.ok(a, `retrato da marina sem o aviso: ${JSON.stringify(r)}`);
      assert.equal(a.recado, true);
      const inp = s.runners.marina.rec.inputs;
      assert.equal(inp.length, 1);
      assert.equal(inp[0].injectWhenIdle, true);
      assert.ok(inp[0].text.includes('<quadro-de-avisos de="lara"'), inp[0].text);
    });

    await tc.test('c) o retrato da lara não contém o próprio aviso', () => {
      const r = retrato(s.homes.lara);
      assert.equal((r.avisos || []).filter((x) => x.agente === 'lara').length, 0, JSON.stringify(r));
      assert.equal(s.runners.lara.rec.inputs.length, 0);
    });

    await tc.test('d) a luna não vê o aviso, nem pela caixa nem no retrato', async () => {
      const { resp } = await pelaCaixa(s, 'luna', 'GET', '/api/v1/avisos');
      assert.equal(resp.status, 200, JSON.stringify(resp));
      assert.ok(!JSON.stringify(resp.corpo).includes('relatório de ontem'), JSON.stringify(resp.corpo));
      assert.ok(!JSON.stringify(retrato(s.homes.luna)).includes('relatório de ontem'));
      assert.equal(s.runners.luna.rec.inputs.length, 0);
    });

    await tc.test('e) lara mandando "agente":"marina" pela caixa leva 403', async () => {
      const { resp } = await pelaCaixa(s, 'lara', 'POST', '/api/v1/avisos', { agente: 'marina', tipo: 'pedido', para: ['luna'], texto: 'Falsificando autor.' });
      assert.equal(resp.status, 403, JSON.stringify(resp));
    });

    await tc.test('f) dono vê tudo; /avisos dá HTML com sessão e redireciona para /login sem ela', async () => {
      await s.t.login();
      const g = await s.t.c.get('/api/v1/avisos');
      assert.equal(g.status, 200);
      assert.ok(g.texto.includes('relatório de ontem'), g.texto);
      const pag = await s.t.c.get('/avisos');
      assert.equal(pag.status, 200);
      assert.match(pag.headers['content-type'], /text\/html/);
      const { cliente } = require('./ajuda');
      const sem = cliente(s.t.porta);
      const r = await sem.get('/avisos');
      assert.equal(r.status, 302);
      assert.match(r.headers.location, /^\/login/);
    });
  } finally { await s.fechar(); }
});
