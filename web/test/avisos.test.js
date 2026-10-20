'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { criarAvisos, validar, injetaveisPara, textoInjecao, textoRecado } = require('../lib/avisos');
const { pastaTemp } = require('./ajuda');

const T0 = Date.parse('2026-10-17T15:00:00-03:00');
const AGENTES = [
  { slug: 'admin', nome: 'Admin', tipo: 'admin', home_host: null, agente_id: 'ad' },
  { slug: 'lara', nome: 'Lara', tipo: 'agente', home_host: '/h/lara', agente_id: 'la' },
  { slug: 'marina', nome: 'Marina', tipo: 'agente', home_host: '/h/marina', agente_id: 'ma' },
  { slug: 'luna', nome: 'Luna', tipo: 'agente', home_host: '/h/luna', agente_id: 'lu' },
  { slug: 'semcasa', nome: 'Sem Casa', tipo: 'agente', home_host: null, agente_id: 'sc' },
];

// monta o módulo com registro, runner e caixa falsos e sobe um http.Server mínimo que chama tratar()
async function montar(extra) {
  const x = Object.assign({ env: {}, falhaRunner: {}, falhaRetrato: {}, agentes: AGENTES }, extra || {});
  const dir = pastaTemp('avisos');
  const config = { dataDir: dir };
  const rec = { inputs: [], retratos: [], logs: [] };
  const ctx = { agoraMs: T0 };
  const registro = { estado: () => ({ ok: true, agentes: x.agentes }) };
  const runner = {
    input: async (ag, corpo) => {
      rec.inputs.push({ slug: ag.slug, corpo });
      if (x.falhaRunner[ag.slug]) return { ok: false, status: 500, erro: 'runner caiu' };
      return { ok: true, status: 202 };
    },
  };
  const caixa = {
    gravaRetrato: async (ag, frente, obj) => {
      if (x.falhaRetrato[ag.slug]) throw new Error('disco cheio');
      rec.retratos.push({ slug: ag.slug, frente, obj: JSON.parse(JSON.stringify(obj)) });
    },
  };
  const quemChamou = (sessao) => (sessao.via === 'caixa' ? { tipo: 'agente', slug: sessao.agente } : { tipo: 'dono', usuario: sessao.usuario });
  const avisos = criarAvisos({ config, registro, runner, caixa, log: (n, m) => rec.logs.push(`[${n}] ${m}`), agora: () => ctx.agoraMs, env: x.env, quemChamou });
  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const quem = req.headers['x-quem'] || 'dono';
    const sessao = quem === 'dono' ? { usuario: 'danilo' } : { usuario: `agente:${quem}`, via: 'caixa', agente: quem };
    if (!(await avisos.tratar(req, res, url, sessao))) { res.writeHead(404); res.end('fora'); }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;
  async function pedir(quem, metodo, caminho, json) {
    const corpo = json === undefined ? null : (typeof json === 'string' ? json : JSON.stringify(json));
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: Object.assign({ 'x-quem': quem }, corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}) }, (res) => {
        const p = []; res.on('data', (c) => p.push(c));
        res.on('end', () => { const t = Buffer.concat(p).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ } resolve({ status: res.statusCode, json: j, texto: t, headers: res.headers }); });
      });
      req.on('error', reject);
      if (corpo) req.write(corpo);
      req.end();
    });
  }
  const fechar = () => { avisos.parar(); servidor.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { avisos, rec, ctx, dir, pedir, fechar, arquivo: path.join(dir, 'avisos.json') };
}

const ultimoRetrato = (rec, slug) => [...rec.retratos].reverse().find((r) => r.slug === slug);

test('validar: cada campo, com erro campo a campo', () => {
  const ctx = { slugs: ['lara', 'marina'] };
  assert.deepEqual(validar({ tipo: 'decisao', texto: 'ok' }, ctx).campos.para, ['todos']);
  const r = validar({ tipo: 'xis', texto: '   ', link: 'ftp://a', assunto: 'a'.repeat(61), tags: new Array(7).fill('a'), substitui: 0, para: 'x', foo: 1 }, ctx);
  for (const c of ['tipo', 'texto', 'link', 'assunto', 'tags', 'substitui', 'campos']) assert.ok(r.erros[c], c);
  assert.deepEqual(r.inexistentes, ['x']);
  assert.ok(validar({ tipo: 'pedido', texto: 'a\nb\nc' }, ctx).erros.texto);
  assert.ok(validar({ tipo: 'pedido', texto: 'a'.repeat(281) }, ctx).erros.texto);
  assert.ok(validar({ tipo: 'pedido', texto: 'a', para: ['todos', 'lara'] }, ctx).erros.para);
  assert.deepEqual(validar({ tipo: 'pedido', texto: 'a', tags: 'Live, CPDF', link: ' https://a.com/x ', assunto: ' Lives  x ' }, ctx).campos.tags, ['live', 'cpdf']);
  assert.equal(validar({ tipo: 'pedido', texto: 'a', link: ' https://a.com/x ' }, ctx).campos.link, 'https://a.com/x');
});

test('postar pela caixa: 201, autor da caixa, dono sem forjar, 400 por campo, para inexistente 404', async () => {
  const w = await montar();
  try {
    let r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'Lives às 14h.', assunto: 'Lives' });
    assert.equal(r.status, 201);
    assert.equal(r.json.aviso.id, 1);
    assert.equal(r.json.aviso.agente, 'lara');
    assert.equal(r.json.aviso.criado_por, 'agente lara (caixa)');
    assert.match(r.json.aviso.criado_em, /-03:00$/);
    assert.deepEqual(Object.keys(r.json.aviso.entregas).sort(), ['luna', 'marina', 'semcasa']);
    assert.ok(r.json.aviso.entregas.marina.retrato_em);
    assert.equal(fs.statSync(w.arquivo).mode & 0o777, 0o600);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x', agente: 'marina' });
    assert.equal(r.status, 403);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x', agente: 'lara' });
    assert.equal(r.status, 201);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'nada', texto: '' });
    assert.equal(r.status, 400);
    assert.ok(r.json.erros.tipo && r.json.erros.texto);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'x', para: ['fantasma'] });
    assert.equal(r.status, 404);
    assert.match(r.json.erro, /fantasma/);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'x', para: ['lara'] });
    assert.equal(r.status, 400);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'x', para: ['admin'] });
    assert.equal(r.status, 404);
    r = await w.pedir('admin', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'x' });
    assert.equal(r.status, 403);
    r = await w.pedir('dono', 'POST', '/api/v1/avisos', { tipo: 'preferencia', texto: 'Sem travessão.' });
    assert.equal(r.status, 201);
    assert.equal(r.json.aviso.agente, 'dono');
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', '{quebrado');
    assert.equal(r.status, 400);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'a', tags: 'x'.repeat(5000) });
    assert.equal(r.status, 413);
  } finally { w.fechar(); }
});

test('taxa: 20 por hora vira 429 com tente_em; o dono não tem limite', async () => {
  const w = await montar();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: `a${i}` })).status, 201);
    const r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'mais um' });
    assert.equal(r.status, 429);
    assert.equal(r.json.tente_em, '2026-10-17T16:00:00-03:00');
    assert.equal((await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'outra' })).status, 201);
    assert.equal((await w.pedir('dono', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'dono' })).status, 201);
    w.ctx.agoraMs += 3600 * 1000 + 1000;
    assert.equal((await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'de novo' })).status, 201);
  } finally { w.fechar(); }
});

test('taxa: 100 por dia', async () => {
  const w = await montar();
  try {
    for (let i = 0; i < 100; i++) {
      w.ctx.agoraMs = T0 + i * 10 * 60 * 1000; // 6 por hora, nunca passa de 20/h
      assert.equal((await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: `a${i}` })).status, 201, `aviso ${i}`);
    }
    w.ctx.agoraMs = T0 + 100 * 10 * 60 * 1000;
    const r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'x' });
    assert.equal(r.status, 429);
    assert.equal(r.json.tente_em, '2026-10-18T15:00:00-03:00');
  } finally { w.fechar(); }
});

test('substituir e retirar, incluindo aviso de outro agente (403)', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'Lives às 14h.' });
    let r = await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'corrigindo', substitui: 1 });
    assert.equal(r.status, 403);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'Lives às 14h30.', substitui: 1 });
    assert.equal(r.status, 201);
    r = await w.pedir('lara', 'GET', '/api/v1/avisos/1');
    assert.equal(r.json.aviso.substituido_por, 2);
    assert.equal(r.json.aviso.ativo, false);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x', substitui: 1 });
    assert.equal(r.status, 400);
    r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x', substitui: 99 });
    assert.equal(r.status, 400);
    r = await w.pedir('marina', 'DELETE', '/api/v1/avisos/2', { motivo: 'não é meu' });
    assert.equal(r.status, 403);
    r = await w.pedir('lara', 'DELETE', '/api/v1/avisos/2', { motivo: 'postei  errado' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ja_estava, false);
    assert.equal(r.json.aviso.motivo_retirada, 'postei errado');
    assert.equal(r.json.aviso.ativo, false);
    r = await w.pedir('lara', 'DELETE', '/api/v1/avisos/2');
    assert.equal(r.json.ja_estava, true);
    assert.equal((await w.pedir('lara', 'DELETE', '/api/v1/avisos/77')).status, 404);
    // o dono retira qualquer um
    await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'entrega', texto: 'pronto' });
    assert.equal((await w.pedir('dono', 'DELETE', '/api/v1/avisos/3')).status, 200);
    assert.deepEqual(ultimoRetrato(w.rec, 'luna').obj.avisos, []);
  } finally { w.fechar(); }
});

test('GET filtrado pela caixa: isolamento entre agentes', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'só para a Luna', para: ['luna'] });
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'para todos' });
    await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'aprendizado', texto: 'da Marina', assunto: 'x', tags: ['t1'] });
    const ids = async (quem, q) => (await w.pedir(quem, 'GET', '/api/v1/avisos' + (q || ''))).json.avisos.map((a) => a.id);
    assert.deepEqual(await ids('marina'), [3, 2]);
    assert.deepEqual(await ids('luna'), [3, 2, 1]);
    assert.deepEqual(await ids('lara'), [3, 2, 1]);
    assert.deepEqual(await ids('dono'), [3, 2, 1]);
    assert.deepEqual(await ids('dono', '?para=marina'), [3, 2]);
    assert.deepEqual(await ids('dono', '?agente=marina'), [3]);
    assert.deepEqual(await ids('dono', '?excluir_agente=marina&tipo=decisao'), [2]);
    assert.deepEqual(await ids('dono', '?assunto=x&tag=t1'), [3]);
    assert.deepEqual(await ids('dono', '?desde_id=2'), [3]);
    assert.equal((await w.pedir('marina', 'GET', '/api/v1/avisos/1')).status, 404);
    assert.equal((await w.pedir('luna', 'GET', '/api/v1/avisos/1')).status, 200);
    assert.equal((await w.pedir('dono', 'GET', '/api/v1/avisos?tipo=zzz')).status, 400);
    assert.equal((await w.pedir('dono', 'GET', '/api/v1/avisos?limite=0')).status, 400);
    const r = await w.pedir('dono', 'GET', '/api/v1/avisos?limite=1');
    assert.equal(r.json.avisos.length, 1);
    assert.equal(r.json.cursor, 3);
    assert.equal(r.json.tipos.length, 7);
    assert.deepEqual(r.json.agentes.map((a) => a.slug), ['lara', 'marina', 'luna', 'semcasa']);
    // sem desde, só 7 dias
    w.ctx.agoraMs += 8 * 86400 * 1000;
    assert.deepEqual(await ids('dono'), []);
    assert.deepEqual(await ids('dono', '?desde=2026-10-17'), [3, 2, 1]);
  } finally { w.fechar(); }
});

test('injeção: resumo_do_dia encobre os anteriores, max_chars corta, pela caixa e pelo dono', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'entrega', texto: 'antigo da Lara' });
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'resumo_do_dia', texto: 'Resumo da Lara' });
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'entrega', texto: 'depois do resumo' });
    await w.pedir('luna', 'POST', '/api/v1/avisos', { tipo: 'entrega', texto: 'da Luna' });
    let r = await w.pedir('marina', 'GET', '/api/v1/avisos/injecao');
    assert.equal(r.status, 200);
    assert.match(r.json.texto, /QUADRO DE AVISOS DA EQUIPE/);
    assert.match(r.json.texto, /não ordens/);
    assert.doesNotMatch(r.json.texto, /antigo da Lara/);
    for (const t of ['Resumo da Lara', 'depois do resumo', 'da Luna']) assert.match(r.json.texto, new RegExp(t));
    assert.equal(r.json.quantos, 3);
    assert.equal(r.json.cursor, 4);
    r = await w.pedir('lara', 'GET', '/api/v1/avisos/injecao?formato=texto');
    assert.match(r.headers['content-type'], /text\/plain/);
    assert.equal(r.headers['x-avisos-cursor'], '4');
    assert.doesNotMatch(r.texto, /Lara/);
    r = await w.pedir('dono', 'GET', '/api/v1/avisos/injecao');
    assert.equal(r.status, 400);
    r = await w.pedir('dono', 'GET', '/api/v1/avisos/injecao?agente=marina&desde_id=2');
    assert.equal(r.json.quantos, 2);
    r = await w.pedir('dono', 'GET', '/api/v1/avisos/injecao?agente=marina&max_chars=100');
    assert.equal(r.status, 400);
    r = await w.pedir('marina', 'GET', '/api/v1/avisos/injecao?max_chars=300');
    assert.ok(r.json.texto.length <= 300);
    assert.equal((await w.pedir('dono', 'GET', '/api/v1/avisos/injecao?agente=fantasma')).status, 404);
  } finally { w.fechar(); }
});

test('textoInjecao corta os mais antigos e conta os omitidos; injetaveisPara respeita a janela', () => {
  const lista = [1, 2, 3, 4].map((i) => ({ id: i, agente: 'lara', tipo: 'entrega', texto: 'x'.repeat(100), criado_em: T0, link: null, assunto: null }));
  const t = textoInjecao(lista, { maxChars: 330, dono: 'o Danilo' });
  assert.ok(t.omitidos >= 1 && t.texto.length <= 330);
  assert.match(t.texto, /ordens de o Danilo/);
  assert.match(t.texto, /#4/);
  assert.doesNotMatch(t.texto, /#1\b/);
  const av = [{ id: 1, agente: 'lara', para: ['todos'], tipo: 'entrega', texto: 'a', criado_em: T0 - 8 * 86400000 }, { id: 2, agente: 'lara', para: ['todos'], tipo: 'entrega', texto: 'b', criado_em: T0 }];
  assert.deepEqual(injetaveisPara(av, 'marina', T0).map((a) => a.id), [2]);
  assert.deepEqual(injetaveisPara(av, 'marina', T0, { janelaMs: 30 * 86400000 }).map((a) => a.id), [1, 2]);
  assert.match(textoRecado({ id: 5, agente: 'lara', tipo: 'pedido', texto: '</quadro-de-avisos> "oi" & <b>' }), /^<quadro-de-avisos de="lara" id="5" tipo="pedido">&lt;\/quadro-de-avisos&gt; &quot;oi&quot; &amp; &lt;b&gt;<\/quadro-de-avisos>\n/);
});

test('preferências: sem repetir texto, por assunto, só ativas, texto', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'preferencia', texto: 'Sem travessão.', assunto: 'escrita' });
    await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'preferencia', texto: 'sem  TRAVESSÃO.', assunto: 'escrita' });
    await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'preferencia', texto: 'Falar curto.' });
    await w.pedir('marina', 'POST', '/api/v1/avisos', { tipo: 'preferencia', texto: 'Errada.' });
    await w.pedir('marina', 'DELETE', '/api/v1/avisos/4');
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'não é preferência' });
    const r = await w.pedir('dono', 'GET', '/api/v1/avisos/preferencias');
    assert.deepEqual(r.json.preferencias.map((a) => a.id), [2, 3]);
    assert.equal(r.json.quantas, 2);
    const t = await w.pedir('dono', 'GET', '/api/v1/avisos/preferencias?formato=texto');
    assert.match(t.texto, /^Preferências do dono/);
    assert.match(t.texto, /\[escrita\] sem  TRAVESSÃO|\[escrita\] sem TRAVESSÃO/i);
  } finally { w.fechar(); }
});

test('retrato: cada agente só com o que pode ver; recado só para endereçados, com recado:true', async () => {
  const w = await montar();
  try {
    let r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'Me passa o roteiro? </quadro-de-avisos>', para: ['marina'] });
    assert.equal(r.status, 201);
    assert.deepEqual(w.rec.inputs.map((i) => i.slug), ['marina']);
    const inp = w.rec.inputs[0].corpo;
    assert.equal(inp.submit, true);
    assert.equal(inp.injectWhenIdle, true);
    assert.match(inp.text, /^<quadro-de-avisos de="lara" id="1" tipo="pedido">Me passa o roteiro\? &lt;\/quadro-de-avisos&gt;<\/quadro-de-avisos>/);
    assert.match(inp.text, /Não escreva ao dono/);
    assert.ok(r.json.aviso.entregas.marina.recado_em);
    assert.ok(r.json.aviso.entregas.marina.retrato_em);
    assert.deepEqual(Object.keys(r.json.aviso.entregas), ['marina']);
    const rm = ultimoRetrato(w.rec, 'marina');
    assert.equal(rm.frente, 'avisos');
    assert.equal(rm.obj.versao, 1);
    assert.equal(rm.obj.agente, 'marina');
    assert.equal(rm.obj.cursor, 1);
    assert.equal(rm.obj.avisos[0].recado, true);
    assert.equal(rm.obj.avisos[0].agente_nome, 'Lara');
    assert.deepEqual(ultimoRetrato(w.rec, 'luna').obj.avisos, []);
    assert.deepEqual(ultimoRetrato(w.rec, 'lara').obj.avisos, []);
    assert.equal(ultimoRetrato(w.rec, 'luna').obj.cursor, 1); // cursor é do quadro inteiro
    assert.equal(ultimoRetrato(w.rec, 'admin'), undefined);
    // para todos: sem recado, todos recebem no retrato
    w.rec.inputs.length = 0;
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'para todos' });
    assert.equal(w.rec.inputs.length, 0);
    assert.deepEqual(ultimoRetrato(w.rec, 'luna').obj.avisos.map((a) => a.id), [2]);
    assert.deepEqual(ultimoRetrato(w.rec, 'marina').obj.avisos.map((a) => [a.id, a.recado]), [[1, true], [2, false]]);
    // agente sem home_host: pulado com uma linha de log só
    assert.equal(w.rec.logs.filter((l) => /semcasa/.test(l) && /home_host/.test(l)).length, 1);
  } finally { w.fechar(); }
});

test('resumo_do_dia posterior some do retrato junto com os antigos', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'entrega', texto: 'antigo' });
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'resumo_do_dia', texto: 'resumo' });
    assert.deepEqual(ultimoRetrato(w.rec, 'marina').obj.avisos.map((a) => a.id), [2]);
  } finally { w.fechar(); }
});

test('runner e retrato falhando não derrubam o POST; erro vai para entregas e para o log', async () => {
  const w = await montar({ falhaRunner: { marina: true }, falhaRetrato: { luna: true } });
  try {
    const r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'pedido', texto: 'oi', para: ['marina', 'luna'] });
    assert.equal(r.status, 201);
    assert.match(r.json.aviso.entregas.marina.erro, /runner caiu/);
    assert.equal(r.json.aviso.entregas.marina.recado_em, null);
    assert.ok(r.json.aviso.entregas.marina.retrato_em, 'o retrato de marina saiu mesmo sem o recado');
    assert.ok(r.json.aviso.entregas.luna.recado_em);
    assert.match(r.json.aviso.entregas.luna.erro, /disco cheio/);
    assert.equal(r.json.aviso.entregas.luna.retrato_em, null);
    assert.ok(w.rec.logs.some((l) => /marina/.test(l) && /runner caiu/.test(l)));
    assert.ok(w.rec.logs.some((l) => /luna/.test(l) && /disco cheio/.test(l)));
    // o que foi gravado persiste
    const d = JSON.parse(fs.readFileSync(w.arquivo, 'utf8'));
    assert.equal(d.versao, 1);
    assert.equal(d.proximo_id, 2);
    assert.match(d.avisos[0].entregas.marina.erro, /runner caiu/);
  } finally { w.fechar(); }
});

test('arquivo corrompido: 503 com caminho e motivo, sem sobrescrever', async () => {
  const w = await montar();
  try {
    fs.writeFileSync(w.arquivo, '{quebrado');
    for (const [m, c, j] of [['GET', '/api/v1/avisos'], ['POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x' }], ['GET', '/api/v1/avisos/injecao']]) {
      const r = await w.pedir('lara', m, c, j);
      assert.equal(r.status, 503, `${m} ${c}`);
      assert.ok(r.json.erro.includes(w.arquivo));
      assert.match(r.json.erro, /corrompido/);
    }
    assert.equal(fs.readFileSync(w.arquivo, 'utf8'), '{quebrado');
    await w.avisos.redistribuir();
    assert.equal(w.rec.retratos.length, 0);
    assert.equal(fs.readFileSync(w.arquivo, 'utf8'), '{quebrado');
    // docs continua servido
    assert.equal((await w.pedir('lara', 'GET', '/api/v1/avisos/docs.md')).status, 200);
  } finally { w.fechar(); }
});

test('TERACLAW_WEB_AVISOS=off: 503 explicando, docs.md segue, redistribuir não grava', async () => {
  const w = await montar({ env: { TERACLAW_WEB_AVISOS: 'off' } });
  try {
    const r = await w.pedir('dono', 'GET', '/api/v1/avisos');
    assert.equal(r.status, 503);
    assert.match(r.json.erro, /TERACLAW_WEB_AVISOS/);
    assert.equal((await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'x' })).status, 503);
    const d = await w.pedir('dono', 'GET', '/api/v1/avisos/docs.md');
    assert.equal(d.status, 200);
    assert.match(d.texto, /Quadro de avisos entre agentes/);
    assert.match(d.headers['content-type'], /markdown/);
    await w.avisos.redistribuir();
    assert.equal(w.rec.retratos.length, 0);
    assert.equal(fs.existsSync(w.arquivo), false);
  } finally { w.fechar(); }
});

test('redistribuir regrava o retrato de todos, rota de fora devolve false, retenção poda', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'velho' });
    w.rec.retratos.length = 0;
    await w.avisos.redistribuir();
    assert.deepEqual(w.rec.retratos.map((r) => r.slug).sort(), ['lara', 'luna', 'marina']);
    // 91 dias depois, o próximo gravar apaga o aviso velho, mas o id continua crescendo
    w.ctx.agoraMs += 91 * 86400 * 1000;
    const r = await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'novo' });
    assert.equal(r.json.aviso.id, 2);
    const d = JSON.parse(fs.readFileSync(w.arquivo, 'utf8'));
    assert.deepEqual(d.avisos.map((a) => a.id), [2]);
    const fora = await w.pedir('dono', 'GET', '/api/v1/outra-coisa');
    assert.equal(fora.texto, 'fora');
    assert.equal(fora.status, 404);
  } finally { w.fechar(); }
});

test('persistência: um módulo novo lê o quadro gravado e continua os ids', async () => {
  const w = await montar();
  try {
    await w.pedir('lara', 'POST', '/api/v1/avisos', { tipo: 'decisao', texto: 'um' });
    const outro = criarAvisos({ config: { dataDir: w.dir }, registro: { estado: () => ({ ok: true, agentes: AGENTES }) }, runner: {}, caixa: {}, log: () => {}, agora: () => T0, quemChamou: () => ({ tipo: 'dono', usuario: 'x' }) });
    const res = { writeHead(s) { this.status = s; }, end(t) { this.corpo = t; }, headersSent: false };
    await outro.tratar({ method: 'GET', headers: {} }, res, new URL('http://x/api/v1/avisos/1'), {});
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.corpo).aviso.texto, 'um');
  } finally { w.fechar(); }
});
