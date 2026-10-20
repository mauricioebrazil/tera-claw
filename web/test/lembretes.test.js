'use strict';
// Lembretes que insistem: rotas, agendador com relógio injetado, permissões, push e runner falsos.
// Contrato em web/docs/LEMBRETES.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { criarLembretes } = require('../lib/lembretes');
const { cliente, pastaTemp, capturaLog, subirWeb } = require('./ajuda');

const MIN = 60000;
const T0 = Date.parse('2026-10-17T12:00:00-03:00');   // sábado
const AGENTES = [
  { slug: 'admin', nome: 'Admin', tipo: 'admin', runner: 'http://x', agente_id: 'admin' },
  { slug: 'luna', nome: 'Luna', tipo: 'agente', runner: 'http://x', agente_id: 'luna' },
  { slug: 'bia', nome: 'Bia', tipo: 'agente', runner: 'http://x', agente_id: 'bia' },
];

/** Monta o módulo de lembretes atrás de um servidor mínimo. `quem` do pedido vem no cabeçalho x-quem. */
async function montar(o) {
  const op = o || {};
  const dataDir = op.dataDir || pastaTemp('lem');
  const relogio = { t: T0 };
  const cap = capturaLog();
  const pushes = []; const inputs = [];
  const falhas = { push: null, runner: null };
  const push = {
    enviar: async (aviso) => {
      pushes.push(aviso);
      if (falhas.push === 'lanca') throw new Error('chaves ilegíveis');
      return falhas.push || { inscricoes: 1, ok: 1, removidas: 0, falhas: [] };
    },
  };
  const runner = {
    input: async (agente, corpo) => {
      inputs.push({ slug: agente.slug, corpo });
      return falhas.runner ? { ok: false, erro: falhas.runner } : { ok: true, status: 202 };
    },
  };
  const lista = op.agentes || AGENTES;
  const registro = { estado: () => ({ ok: true, agentes: lista }), obter: (s) => lista.find((a) => a.slug === s) || null };
  const lem = criarLembretes({ config: { dataDir, tz: op.tz || 'America/Sao_Paulo' }, registro, runner, push, log: cap.log, agora: () => relogio.t });
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    const q = req.headers['x-quem'] || 'dono';
    const sessao = q === 'dono' ? { usuario: 'danilo' } : { usuario: 'agente:' + q, via: 'caixa', agente: q };
    lem.rotas(req, res, url, sessao).then((tratou) => {
      if (!tratou) { res.writeHead(404); res.end('{}'); }
    }).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ erro: e.stack })); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const c = cliente(srv.address().port);
  const pedir = (metodo, caminho, corpo, quem) => c.pedir(metodo, caminho, { json: corpo, headers: quem ? { 'x-quem': quem } : {} });
  const avanca = async (ms) => { relogio.t += ms; return lem.tique(); };
  return {
    lem, c, relogio, cap, pushes, inputs, falhas, dataDir, avanca, pedir,
    get: (cam, quem) => pedir('GET', cam, undefined, quem),
    post: (cam, corpo, quem) => pedir('POST', cam, corpo || {}, quem),
    patch: (cam, corpo, quem) => pedir('PATCH', cam, corpo, quem),
    del: (cam, quem) => pedir('DELETE', cam, undefined, quem),
    arq: path.join(dataDir, 'lembretes', 'lembretes.json'),
    fim: () => new Promise((r) => srv.close(r)),
  };
}

/** Cria um lembrete único daqui a `min` minutos para a luna e devolve { id, oc }. */
async function criaDaqui(s, min, extra) {
  const r = await s.post('/api/v1/lembretes', Object.assign({ texto: 'ligar pro contador', agente: 'luna', daqui_min: min }, extra || {}));
  assert.equal(r.status, 201, r.texto);
  return r.json.lembrete;
}
const ocorrencias = async (s, id) => (await s.get(`/api/v1/lembretes/${id}/ocorrencias?limit=60`)).json.ocorrencias;

test('daqui_min: o Web calcula a regra, no fuso dele, e devolve os padrões efetivos', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 20);
    assert.match(l.id, /^lem_[0-9a-f]{8}$/);
    assert.equal(l.proxima, '2026-10-17T12:20:00-03:00');
    assert.deepEqual(l.regra, { tipo: 'unico', data: '2026-10-17', hora: '12:20' });
    assert.equal(l.regra_texto, 'uma vez, em 17/10/2026 às 12:20');
    assert.equal(l.estado, 'ativo');
    assert.equal(l.intervalo_min, 5);
    assert.equal(l.teto_envios, 12);
    assert.equal(l.pelo_agente, true);
    assert.equal(l.titulo, '⏰ Hora do lembrete');
    assert.equal(l.criado_por, 'dono:danilo');
    assert.deepEqual(l.ultimas_ocorrencias, []);
  } finally { await s.fim(); }
});

test('arquivo: pasta 0700, arquivo 0600, e outro módulo sobre a mesma pasta enxerga os lembretes', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 20);
    assert.equal(fs.statSync(path.dirname(s.arq)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(s.arq).mode & 0o777, 0o600);
    const s2 = await montar({ dataDir: s.dataDir });
    try {
      const r = await s2.get('/api/v1/lembretes/' + l.id);
      assert.equal(r.status, 200);
      assert.equal(r.json.lembrete.texto, 'ligar pro contador');
    } finally { await s2.fim(); }
  } finally { await s.fim(); }
});

test('dono sem dizer o agente: com dois agentes é 400, com um só vale o único', async () => {
  const s = await montar();
  try {
    const r = await s.post('/api/v1/lembretes', { texto: 'x', daqui_min: 5 });
    assert.equal(r.status, 400);
    assert.match(r.json.erros.agente, /luna, bia/);
  } finally { await s.fim(); }
  const u = await montar({ agentes: AGENTES.slice(0, 2) });
  try {
    const r = await u.post('/api/v1/lembretes', { texto: 'x', daqui_min: 5 });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.lembrete.agente, 'luna');
  } finally { await u.fim(); }
});

test('agente que não existe no registro: 404 dizendo onde listar', async () => {
  const s = await montar();
  try {
    const r = await s.post('/api/v1/lembretes', { texto: 'x', daqui_min: 5, agente: 'fantasma' });
    assert.equal(r.status, 404);
    assert.match(r.json.erro, /GET \/api\/v1\/agents/);
  } finally { await s.fim(); }
});

test('validação: 400 com o motivo de cada campo', async () => {
  const s = await montar();
  try {
    const base = { texto: 'x', agente: 'luna' };
    const casos = [
      [{ ...base, daqui_min: 5, foo: 1 }, 'foo', /campo desconhecido/],
      [{ ...base, daqui_min: 5, proxima: 'x' }, 'proxima', /calculado/],
      [{ ...base, hora: '09:00', daqui_min: 5 }, 'hora', /DENTRO de "regra"/],
      [{ ...base, dias: ['seg'], daqui_min: 5 }, 'dias', /DENTRO de "regra"/],
      [{ ...base, daqui_min: 0 }, 'daqui_min', /1 a 10080/],
      [{ ...base, daqui_min: 5, regra: { tipo: 'diario', hora: '08:00' } }, 'daqui_min', /não vai junto/],
      [{ ...base }, 'regra', /faltou/],
      [{ ...base, regra: { tipo: 'unico', data: '2026-10-16', hora: '08:00' } }, 'regra', /já passou/],
      [{ ...base, regra: { tipo: 'diario', hora: '08:00' }, fim: '2026-10-16' }, 'fim', /já passou/],
      [{ ...base, regra: { tipo: 'unico', data: '2026-10-30', hora: '08:00' }, fim: '2026-10-20' }, 'fim', /nenhum horário no futuro/],
      [{ texto: '   ', agente: 'luna', daqui_min: 5 }, 'texto', /mande o que lembrar/],
      [{ ...base, daqui_min: 5, intervalo_min: 0 }, 'intervalo_min', /1 a 120/],
      [{ ...base, daqui_min: 5, teto_envios: 61 }, 'teto_envios', /1 a 60/],
      [{ ...base, daqui_min: 5, pelo_agente: 'sim' }, 'pelo_agente', /true ou false/],
      [{ ...base, daqui_min: 5, titulo: 'x'.repeat(81) }, 'titulo', /máximo é 80/],
      [{ ...base, daqui_min: 5, texto: 'x'.repeat(501) }, 'texto', /máximo é 500/],
    ];
    for (const [corpo, campo, rx] of casos) {
      const r = await s.post('/api/v1/lembretes', corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo) + ' => ' + r.texto);
      assert.equal(r.json.ok, false);
      assert.ok(r.json.erros[campo], `faltou erros.${campo} em ${r.texto}`);
      assert.match(r.json.erros[campo], rx);
      assert.match(r.json.erro, /\S/);
    }
    const reg = await s.post('/api/v1/lembretes', { ...base, regra: { tipo: 'semanal', dias: ['xx'], hora: '08:00' } });
    assert.match(reg.json.erros['regra.dias'], /não reconheci/);
    assert.equal((await s.get('/api/v1/lembretes')).json.lembretes.length, 0, 'nada foi criado');
  } finally { await s.fim(); }
});

test('insistência: envio 1 na hora, depois a cada intervalo, e no teto vira sem_resposta', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 10, { teto_envios: 3 });
    assert.equal(await s.avanca(9 * MIN), 0, 'antes da hora nada sai');
    assert.equal(await s.avanca(1 * MIN), 1, 'na hora sai o envio 1');
    let oc = (await ocorrencias(s, l.id))[0];
    assert.equal(oc.estado, 'insistindo');
    assert.equal(oc.agendada_para, '2026-10-17T12:10:00-03:00');
    assert.equal(oc.envio, 1);
    assert.equal(oc.proximo_envio_em, '2026-10-17T12:15:00-03:00');
    assert.equal(await s.avanca(4 * MIN), 0);
    assert.equal(await s.avanca(1 * MIN), 1, 'envio 2');
    assert.equal(await s.avanca(5 * MIN), 1, 'envio 3');
    assert.equal(await s.avanca(4 * MIN), 0);
    assert.equal(await s.avanca(1 * MIN), 0, 'no teto: nenhum envio novo');
    oc = (await ocorrencias(s, l.id))[0];
    assert.equal(oc.estado, 'sem_resposta');
    assert.equal(oc.total_envios, 3);
    assert.match(oc.motivo, /3 aviso/);
    assert.equal(s.pushes.length, 3);
    assert.equal(await s.avanca(60 * MIN), 0, 'depois do teto não volta a avisar');
    assert.equal((await s.get('/api/v1/lembretes/' + l.id)).json.lembrete.estado, 'encerrado');
  } finally { await s.fim(); }
});

test('cada envio: push com tag, url e botões; recado ao agente como <plataforma>', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 10, { texto: 'ligar pro contador' });
    await s.avanca(10 * MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    assert.equal(s.pushes.length, 1);
    const p = s.pushes[0];
    assert.equal(p.titulo, '⏰ Hora do lembrete');
    assert.equal(p.corpo, 'ligar pro contador', 'o primeiro aviso não leva a contagem');
    assert.equal(p.tag, 'lembrete-' + oc.id);
    assert.equal(p.url, '/a/luna#lembretes');
    assert.equal(p.exigir_interacao, true);
    assert.deepEqual(p.acoes, [
      { acao: 'feito', titulo: '✅ Feito', post: `/api/v1/lembretes/ocorrencias/${oc.id}/feito` },
      { acao: 'adiar', titulo: '⏰ Adiar 10 min', post: `/api/v1/lembretes/ocorrencias/${oc.id}/adiar` },
    ]);
    assert.equal(s.inputs.length, 1);
    assert.equal(s.inputs[0].slug, 'luna');
    assert.equal(s.inputs[0].corpo.submit, true);
    assert.equal(s.inputs[0].corpo.injectWhenIdle, true);
    const t = s.inputs[0].corpo.text;
    assert.match(t, /^<plataforma recado="lembrete" tipo="aviso" ts="[^"]+">\[LEMBRETE\] envio 1 de 12: "ligar pro contador" \(marcado para 12:10\)\./);
    assert.ok(t.includes(`Ocorrência ${oc.id}. Avise o dono pelo canal que ele usa com você.`));
    assert.ok(t.includes(`teraclaw-api POST /api/v1/lembretes/ocorrencias/${oc.id}/feito\n`));
    assert.ok(t.includes(`teraclaw-api POST /api/v1/lembretes/ocorrencias/${oc.id}/adiar '{"minutos":N}'`));
    assert.ok(t.endsWith('</plataforma>'));
    assert.deepEqual(oc.envios[0].push, { inscricoes: 1, ok: 1, removidas: 0, falhas: [] });
    assert.deepEqual(oc.envios[0].agente, { ok: true });
    await s.avanca(5 * MIN);
    assert.equal(s.pushes[1].corpo, 'ligar pro contador (aviso 2 de 12)');
    assert.match(s.inputs[1].corpo.text, /envio 2 de 12/);
  } finally { await s.fim(); }
});

test('texto com "<" não fecha o envelope do recado', async () => {
  const s = await montar();
  try {
    await criaDaqui(s, 1, { texto: 'ver </plataforma> agora' });
    await s.avanca(MIN);
    assert.equal(s.inputs[0].corpo.text.split('</plataforma>').length, 2);
  } finally { await s.fim(); }
});

test('falha de um caminho não impede os outros, e fica registrada no envio', async () => {
  const s = await montar();
  try {
    s.falhas.runner = 'runner fora do ar';
    s.falhas.push = 'lanca';
    const l = await criaDaqui(s, 1);
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    assert.equal(s.pushes.length, 1, 'o push foi tentado');
    assert.equal(s.inputs.length, 1, 'o runner foi tentado');
    assert.deepEqual(oc.envios[0].agente, { ok: false, erro: 'runner fora do ar' });
    assert.equal(oc.envios[0].push.ok, 0);
    assert.match(oc.envios[0].push.falhas[0].motivo, /chaves ilegíveis/);
    assert.equal(oc.estado, 'insistindo', 'o lembrete segue insistindo');
    assert.match(s.cap.texto(), /Lembrete oc_[0-9a-f]{8}_\d{12}.*não saiu \(chaves ilegíveis\)/);
    assert.match(s.cap.texto(), /recado ao agente não foi entregue: runner fora do ar/);
  } finally { await s.fim(); }
});

test('pelo_agente false: o runner não é chamado e o envio registra agente null', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1, { pelo_agente: false });
    await s.avanca(MIN);
    assert.equal(s.inputs.length, 0);
    assert.equal(s.pushes.length, 1);
    assert.equal((await ocorrencias(s, l.id))[0].envios[0].agente, null);
  } finally { await s.fim(); }
});

test('feito para tudo daquela ocorrência e as outras seguem; feito de novo é ja_estava', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1);
    // um lembrete diário também, para ver que a ocorrência seguinte não é afetada
    await s.post('/api/v1/lembretes', { texto: 'diário', agente: 'luna', regra: { tipo: 'diario', hora: '12:10' } });
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    const r = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`, { origem: 'telegram' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ja_estava, false);
    assert.equal(r.json.ocorrencia.estado, 'feito');
    assert.equal(r.json.ocorrencia.feito_por, 'dono:danilo');
    assert.equal(r.json.ocorrencia.feito_origem, 'telegram');
    assert.equal(r.json.ocorrencia.tarde, false);
    const doOc = () => s.pushes.filter((p) => p.tag === 'lembrete-' + oc.id).length;
    const antes = doOc();
    await s.avanca(10 * MIN);
    assert.equal(doOc(), antes, 'depois do feito essa ocorrência não avisa mais');
    assert.equal((await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`)).json.ja_estava, true);
    assert.equal((await s.get('/api/v1/lembretes')).json.insistindo.some((i) => i.id === oc.id), false);
    // origem inválida
    const ruim = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`, { origem: 5 });
    assert.equal(ruim.status, 400);
  } finally { await s.fim(); }
});

test('feito depois do teto marca tarde', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1, { teto_envios: 1 });
    await s.avanca(MIN);
    await s.avanca(5 * MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    assert.equal(oc.estado, 'sem_resposta');
    const r = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`);
    assert.equal(r.json.ocorrencia.estado, 'feito');
    assert.equal(r.json.ocorrencia.tarde, true);
  } finally { await s.fim(); }
});

test('adiar: some da faixa, volta no prazo com o teto contado de novo', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1, { teto_envios: 2 });
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    const r = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/adiar`, { minutos: 30 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ocorrencia.estado, 'adiada');
    assert.equal(r.json.adiada_ate, '2026-10-17T12:31:00-03:00');
    assert.equal(r.json.ocorrencia.adiamentos, 1);
    assert.equal((await s.get('/api/v1/lembretes')).json.insistindo.length, 0);
    assert.equal(await s.avanca(29 * MIN), 0, 'adiada não avisa');
    assert.equal(await s.avanca(1 * MIN), 1, 'na volta sai o envio 1 do novo ciclo');
    let o = (await ocorrencias(s, l.id))[0];
    assert.equal(o.estado, 'insistindo');
    assert.equal(o.envio, 1);
    assert.equal(o.total_envios, 2);
    assert.match(s.pushes[1].corpo, /^ligar pro contador$/, 'o novo ciclo recomeça sem contagem');
    assert.match(s.inputs[1].corpo.text, /envio 1 de 2/);
    assert.equal(await s.avanca(5 * MIN), 1, 'envio 2 do novo ciclo');
    assert.equal(await s.avanca(5 * MIN), 0);
    o = (await ocorrencias(s, l.id))[0];
    assert.equal(o.estado, 'sem_resposta');
    assert.equal(o.total_envios, 3);
  } finally { await s.fim(); }
});

test('adiar: padrão 10 minutos, valor fora da faixa é 400, 21º adiamento é 409', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1);
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    const url = `/api/v1/lembretes/ocorrencias/${oc.id}/adiar`;
    for (const minutos of [0, 1441, 1.5, 'dez']) {
      const r = await s.post(url, { minutos });
      assert.equal(r.status, 400, String(minutos));
      assert.match(r.json.erros.minutos, /1 a 1440/);
    }
    const primeiro = await s.post(url);
    assert.equal(primeiro.json.minutos, 10);
    assert.equal(primeiro.json.adiada_ate, '2026-10-17T12:11:00-03:00');
    for (let i = 2; i <= 20; i += 1) assert.equal((await s.post(url, { minutos: 1 })).status, 200, 'adiamento ' + i);
    const r21 = await s.post(url, { minutos: 1 });
    assert.equal(r21.status, 409);
    assert.match(r21.json.erro, /20 vezes/);
  } finally { await s.fim(); }
});

test('adiar ocorrência feita é 409; feito em ocorrência perdida ou cancelada é 409', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1);
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`);
    const r = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/adiar`);
    assert.equal(r.status, 409);
    assert.match(r.json.erro, /"feito"/);
    const m = await criaDaqui(s, 1);
    await s.avanca(MIN);
    const oc2 = (await ocorrencias(s, m.id))[0];
    await s.post(`/api/v1/lembretes/${m.id}/pausar`);
    const f = await s.post(`/api/v1/lembretes/ocorrencias/${oc2.id}/feito`);
    assert.equal(f.status, 409);
    assert.match(f.json.erro, /cancelada/);
  } finally { await s.fim(); }
});

test('Web fora do ar: menos de 1 h de atraso dispara na volta e marca atrasado', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 10);
    s.relogio.t += 50 * MIN;   // ninguém chamou o tique durante a queda
    assert.equal(await s.lem.tique(), 1);
    const oc = (await ocorrencias(s, l.id))[0];
    assert.equal(oc.estado, 'insistindo');
    assert.equal(oc.atrasado, true);
  } finally { await s.fim(); }
});

test('Web fora do ar: mais de 1 h vira perdida, sem nenhum aviso', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 10);
    s.relogio.t += 90 * MIN;
    assert.equal(await s.lem.tique(), 0);
    const oc = (await ocorrencias(s, l.id))[0];
    assert.equal(oc.estado, 'perdida');
    assert.match(oc.motivo, /fora do ar/);
    assert.equal(s.pushes.length, 0);
    assert.equal(s.inputs.length, 0);
    assert.equal((await s.get('/api/v1/lembretes/' + l.id)).json.lembrete.estado, 'encerrado');
  } finally { await s.fim(); }
});

test('Web fora do ar por muito tempo: no máximo 50 perdidas por lembrete', async () => {
  const s = await montar();
  try {
    const r = await s.post('/api/v1/lembretes', { texto: 'tomar o remédio', agente: 'luna', regra: { tipo: 'diario', hora: '08:00' } });
    const id = r.json.lembrete.id;
    s.relogio.t += 120 * 86400000;
    await s.lem.tique();
    const ocs = await ocorrencias(s, id);
    assert.equal(ocs.filter((o) => o.estado === 'perdida').length, 50);
    assert.ok(ocs.length <= 60);
    assert.match(s.cap.texto(), /ficaram como perdidos \(guardei só 50\)/);
    assert.equal(s.pushes.length, 0);
  } finally { await s.fim(); }
});

test('Web fora do ar no meio da insistência: janela fechada vira sem_resposta sem rajada', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1, { teto_envios: 4 });
    await s.avanca(MIN);
    assert.equal(s.pushes.length, 1);
    s.relogio.t += 3 * 3600000;
    assert.equal(await s.lem.tique(), 0);
    assert.equal(s.pushes.length, 1, 'nenhum aviso atrasado');
    assert.equal((await ocorrencias(s, l.id))[0].estado, 'sem_resposta');
  } finally { await s.fim(); }
});

test('Web fora do ar no meio da janela: continua de onde dá, um aviso por passada', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1, { teto_envios: 12 });
    await s.avanca(MIN);
    s.relogio.t += 22 * MIN;
    assert.equal(await s.lem.tique(), 1);
    assert.equal(await s.avanca(15000), 0, 'sem rajada de avisos atrasados');
    assert.equal((await ocorrencias(s, l.id))[0].estado, 'insistindo');
  } finally { await s.fim(); }
});

test('pausar cancela a insistência e pausado não acumula; retomar segue de agora', async () => {
  const s = await montar();
  try {
    const r = await s.post('/api/v1/lembretes', { texto: 'água', agente: 'luna', regra: { tipo: 'diario', hora: '12:10' } });
    const id = r.json.lembrete.id;
    await s.avanca(10 * MIN);
    const oc = (await ocorrencias(s, id))[0];
    const p = await s.post(`/api/v1/lembretes/${id}/pausar`);
    assert.equal(p.json.lembrete.estado, 'pausado');
    assert.equal(p.json.lembrete.proxima, null);
    assert.equal((await ocorrencias(s, id))[0].estado, 'cancelada');
    assert.match((await ocorrencias(s, id))[0].motivo, /pausado/);
    assert.equal((await s.post(`/api/v1/lembretes/${id}/pausar`)).json.ja_estava, true);
    const antes = s.pushes.length;
    s.relogio.t += 3 * 86400000;
    await s.lem.tique();
    assert.equal(s.pushes.length, antes, 'pausado não toca');
    assert.equal((await ocorrencias(s, id)).length, 1, 'pausado não acumula ocorrências perdidas');
    const ret = await s.post(`/api/v1/lembretes/${id}/retomar`);
    assert.equal(ret.json.lembrete.estado, 'ativo');
    assert.equal(ret.json.lembrete.proxima, '2026-10-21T12:10:00-03:00');
    assert.ok(oc.id);
  } finally { await s.fim(); }
});

test('retomar lembrete cuja regra acabou: 200 com aviso', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 5);
    await s.post(`/api/v1/lembretes/${l.id}/pausar`);
    s.relogio.t += 10 * MIN;
    const r = await s.post(`/api/v1/lembretes/${l.id}/retomar`);
    assert.equal(r.status, 200);
    assert.match(r.json.aviso, /regra já acabou/);
    assert.equal(r.json.lembrete.estado, 'encerrado');
  } finally { await s.fim(); }
});

test('apagar: some, cancela a insistência e responde 404 depois', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 1);
    await s.avanca(MIN);
    const oc = (await ocorrencias(s, l.id))[0];
    const r = await s.del('/api/v1/lembretes/' + l.id);
    assert.equal(r.status, 200);
    assert.equal(r.json.apagado, true);
    const g = await s.get('/api/v1/lembretes/' + l.id);
    assert.equal(g.status, 404);
    assert.match(g.json.erro, /GET \/api\/v1\/lembretes/);
    const f = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`);
    assert.equal(f.status, 409);
    assert.match(f.json.erro, /cancelada/);
    const antes = s.pushes.length;
    await s.avanca(10 * MIN);
    assert.equal(s.pushes.length, antes);
  } finally { await s.fim(); }
});

test('PATCH: muda campos, recalcula a próxima e recusa campos calculados', async () => {
  const s = await montar();
  try {
    const l = await criaDaqui(s, 60);
    const r = await s.patch('/api/v1/lembretes/' + l.id, { texto: 'novo texto', intervalo_min: 10, regra: { tipo: 'unico', data: '2026-10-18', hora: '08:00' } });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.lembrete.texto, 'novo texto');
    assert.equal(r.json.lembrete.intervalo_min, 10);
    assert.equal(r.json.lembrete.proxima, '2026-10-18T08:00:00-03:00');
    const volta = await s.patch('/api/v1/lembretes/' + l.id, { intervalo_min: null, titulo: null });
    assert.equal(volta.json.lembrete.intervalo_min, 5);
    const ruim = await s.patch('/api/v1/lembretes/' + l.id, { estado: 'pausado', daqui_min: 5 });
    assert.equal(ruim.status, 400);
    assert.match(ruim.json.erros.estado, /calculado/);
    assert.match(ruim.json.erros.daqui_min, /só vale ao criar/);
    assert.equal((await s.patch('/api/v1/lembretes/' + l.id, {})).status, 400);
    const passado = await s.patch('/api/v1/lembretes/' + l.id, { regra: { tipo: 'unico', data: '2026-10-01', hora: '08:00' } });
    assert.equal(passado.status, 400);
    assert.match(passado.json.erros.regra, /já passou/);
  } finally { await s.fim(); }
});

test('GET: filtros, agendador e insistindo com os campos da faixa', async () => {
  const s = await montar();
  try {
    const a = await criaDaqui(s, 1);
    const b = await criaDaqui(s, 600, { agente: 'bia', texto: 'da Bia' });
    await s.post(`/api/v1/lembretes/${b.id}/pausar`);
    await s.avanca(MIN);
    const r = await s.get('/api/v1/lembretes');
    assert.equal(r.status, 200);
    assert.equal(r.json.lembretes.length, 2);
    assert.deepEqual(r.json.agendador, { ultimo_tique_em: '2026-10-17T12:01:00-03:00', intervalo_s: 15, fuso: 'America/Sao_Paulo', erro: null });
    assert.equal(r.json.insistindo.length, 1);
    const i = r.json.insistindo[0];
    assert.equal(i.agente, 'luna');
    assert.equal(i.agente_nome, 'Luna');
    assert.equal(i.texto, 'ligar pro contador');
    assert.equal(i.titulo, '⏰ Hora do lembrete');
    assert.equal(i.envio, 1);
    assert.equal(i.teto, 12);
    assert.equal(i.proximo_envio_em, '2026-10-17T12:06:00-03:00');
    assert.equal(i.agendada_para, '2026-10-17T12:01:00-03:00');
    assert.equal(i.lembrete_id, a.id);
    assert.equal((await s.get('/api/v1/lembretes?estado=pausado')).json.lembretes.length, 1);
    assert.equal((await s.get('/api/v1/lembretes?agente=bia')).json.lembretes[0].id, b.id);
    assert.equal((await s.get('/api/v1/lembretes?estado=xx')).status, 400);
    assert.equal((await s.get('/api/v1/lembretes/' + a.id)).json.lembrete.ultimas_ocorrencias.length, 1);
  } finally { await s.fim(); }
});

test('disparar: cria um lembrete já encerrado e o 1º envio sai antes da resposta', async () => {
  const s = await montar();
  try {
    const r = await s.post('/api/v1/lembretes/disparar', { texto: 'agora!', agente: 'luna' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.lembrete.estado, 'encerrado');
    assert.equal(r.json.ocorrencia.estado, 'insistindo');
    assert.equal(r.json.ocorrencia.total_envios, 1);
    assert.equal(s.pushes.length, 1);
    assert.equal(s.inputs.length, 1);
    await s.avanca(5 * MIN);
    assert.equal(s.pushes.length, 2, 'e segue insistindo');
    const ruim = await s.post('/api/v1/lembretes/disparar', { texto: 'x', agente: 'luna', regra: { tipo: 'diario', hora: '08:00' }, fim: '2026-12-31' });
    assert.equal(ruim.status, 400);
    assert.match(ruim.json.erros.regra, /dispara AGORA/);
    assert.ok(ruim.json.erros.fim);
  } finally { await s.fim(); }
});

test('permissões: o agente só vê e mexe nos lembretes dele', async () => {
  const s = await montar();
  try {
    const da = await s.post('/api/v1/lembretes', { texto: 'da luna', daqui_min: 1 }, 'luna');
    assert.equal(da.status, 201, da.texto);
    assert.equal(da.json.lembrete.agente, 'luna');
    assert.equal(da.json.lembrete.criado_por, 'agente:luna');
    const id = da.json.lembrete.id;
    const outro = await s.post('/api/v1/lembretes', { texto: 'da bia', daqui_min: 1 }, 'bia');
    assert.equal(outro.status, 201);
    await s.avanca(MIN);

    const lista = await s.get('/api/v1/lembretes', 'luna');
    assert.deepEqual(lista.json.lembretes.map((l) => l.agente), ['luna']);
    assert.deepEqual(lista.json.insistindo.map((i) => i.agente), ['luna']);
    assert.equal((await s.get('/api/v1/lembretes')).json.lembretes.length, 2, 'o dono vê todos');

    assert.equal((await s.get('/api/v1/lembretes/' + id, 'bia')).status, 404);
    assert.equal((await s.patch('/api/v1/lembretes/' + id, { texto: 'x' }, 'bia')).status, 404);
    assert.equal((await s.del('/api/v1/lembretes/' + id, 'bia')).status, 404);
    assert.equal((await s.post(`/api/v1/lembretes/${id}/pausar`, {}, 'bia')).status, 404);
    const oc = (await ocorrencias(s, id))[0];
    assert.equal((await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`, {}, 'bia')).status, 404);
    assert.equal((await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/adiar`, {}, 'bia')).status, 404);
    assert.equal((await s.get('/api/v1/lembretes?agente=bia', 'luna')).status, 404);

    const alheio = await s.post('/api/v1/lembretes', { texto: 'x', daqui_min: 5, agente: 'bia' }, 'luna');
    assert.equal(alheio.status, 403);
    assert.match(alheio.json.erro, /só cria e mexe em lembretes dele mesmo/);
    const proprio = await s.post('/api/v1/lembretes', { texto: 'x', daqui_min: 5, agente: 'luna' }, 'luna');
    assert.equal(proprio.status, 201);

    const feito = await s.post(`/api/v1/lembretes/ocorrencias/${oc.id}/feito`, { origem: 'telegram' }, 'luna');
    assert.equal(feito.status, 200);
    assert.equal(feito.json.ocorrencia.feito_por, 'agente:luna');
  } finally { await s.fim(); }
});

test('mais de 200 lembretes ativos ou pausados por agente: 409', async () => {
  const s = await montar();
  try {
    const dados = {
      versao: 1, ocorrencias: [],
      lembretes: Array.from({ length: 200 }, (_, i) => ({
        id: 'lem_' + i.toString(16).padStart(8, '0'), agente: 'luna', texto: 'n' + i, regra: { tipo: 'diario', hora: '08:00' }, fim: null,
        intervalo_min: 5, teto_envios: 12, pelo_agente: true, titulo: 'x', ativo: true, proxima_ep: T0 + 86400000,
        criado_por: 'dono:x', criado_em: '2026-10-17T12:00:00-03:00', criado_ep: T0, atualizado_em: '2026-10-17T12:00:00-03:00',
      })),
    };
    fs.mkdirSync(path.dirname(s.arq), { recursive: true });
    fs.writeFileSync(s.arq, JSON.stringify(dados));
    const r = await s.post('/api/v1/lembretes', { texto: 'mais um', agente: 'luna', daqui_min: 5 });
    assert.equal(r.status, 409);
    assert.match(r.json.erro, /200 lembretes/);
    assert.equal((await s.post('/api/v1/lembretes', { texto: 'outro agente', agente: 'bia', daqui_min: 5 })).status, 201);
  } finally { await s.fim(); }
});

test('arquivo ilegível: 503 com o caminho, nada é sobrescrito, o agendador não dispara; consertado, volta', async () => {
  const s = await montar();
  try {
    await criaDaqui(s, 1);
    fs.writeFileSync(s.arq, '{isto não é json');
    const r = await s.get('/api/v1/lembretes');
    assert.equal(r.status, 503);
    assert.ok(r.json.erro.includes(s.arq), r.json.erro);
    assert.match(r.json.erro, /nada foi gravado por cima/);
    const p = await s.post('/api/v1/lembretes', { texto: 'x', agente: 'luna', daqui_min: 5 });
    assert.equal(p.status, 503);
    assert.equal(fs.readFileSync(s.arq, 'utf8'), '{isto não é json', 'o arquivo ruim continua como estava');
    assert.equal(await s.avanca(2 * MIN), 0);
    assert.equal(s.pushes.length, 0);
    assert.match(s.cap.texto(), /Agendador de lembretes parado nesta passada: O arquivo dos lembretes .* ilegível/);
    fs.writeFileSync(s.arq, JSON.stringify({ versao: 1, lembretes: [], ocorrencias: [] }));
    assert.equal((await s.get('/api/v1/lembretes')).status, 200, 'depois de consertado, volta sozinho');
  } finally { await s.fim(); }
});

test('rotas: docs.md, método errado e rota inexistente', async () => {
  const s = await montar();
  try {
    const d = await s.c.pedir('GET', '/api/v1/lembretes/docs.md');
    assert.equal(d.status, 200);
    assert.match(d.headers['content-type'], /text\/markdown/);
    assert.match(d.texto, /^# Lembretes que insistem até você confirmar/);
    assert.equal((await s.get('/api/v1/lembretes/docs.md', 'luna')).status, 200, 'o agente também lê');
    assert.equal((await s.post('/api/v1/lembretes/docs.md')).status, 405);
    assert.equal((await s.pedir('PUT', '/api/v1/lembretes', {})).status, 405);
    assert.equal((await s.get('/api/v1/lembretes/lem_00000000')).status, 404);
    assert.equal((await s.get('/api/v1/lembretes/ocorrencias/oc_00000000_202610171200/feito')).status, 405);
    assert.equal((await s.get('/api/v1/lembretes/a/b/c')).status, 404);
  } finally { await s.fim(); }
});

test('semanal e a_cada_n_dias criados pela API trazem regra em português e próxima certa', async () => {
  const s = await montar();
  try {
    const a = await s.post('/api/v1/lembretes', { texto: 'x', agente: 'luna', regra: { tipo: 'semanal', dias: ['seg', 'qua'], hora: '9:00' } });
    assert.equal(a.json.lembrete.regra_texto, 'toda segunda e quarta às 09:00');
    assert.equal(a.json.lembrete.proxima, '2026-10-19T09:00:00-03:00');
    const b = await s.post('/api/v1/lembretes', { texto: 'y', agente: 'luna', fim: '2026-12-31', regra: { tipo: 'a_cada_n_dias', n: 3, inicio: '2026-10-17', hora: '20:00' } });
    assert.equal(b.json.lembrete.regra_texto, 'a cada 3 dias às 20:00 (desde 17/10/2026), até 31/12/2026');
    assert.equal(b.json.lembrete.proxima, '2026-10-17T20:00:00-03:00');
  } finally { await s.fim(); }
});

test('no Web completo: sessão, caixa liberada e página /lembretes', async () => {
  const s = await subirWeb({ agentes: [{ slug: 'luna', nome: 'Luna', tipo: 'agente', runner: 'http://127.0.0.1:1', agente_id: 'luna', chat_id: 'c_luna' }] });
  try {
    fs.writeFileSync(path.join(s.publico, 'lembretes.html'), '<html>lembretes de teste</html>');
    const sem = await s.c.get('/api/v1/lembretes', { semCookie: true });
    assert.equal(sem.status, 401);
    const semPagina = await s.c.get('/lembretes', { semCookie: true, headers: { Accept: 'text/html' } });
    assert.equal(semPagina.status, 302);
    await s.login();
    const pag = await s.c.get('/lembretes');
    assert.equal(pag.status, 200);
    assert.match(pag.texto, /lembretes de teste/);
    const cria = await s.c.post('/api/v1/lembretes', { json: { texto: 'teste', daqui_min: 10 } });
    assert.equal(cria.status, 201, cria.texto);
    assert.equal(cria.json.lembrete.agente, 'luna', 'com um agente só, ele é o padrão');
    const lista = await s.c.get('/api/v1/lembretes');
    assert.equal(lista.json.lembretes.length, 1);
    assert.equal(lista.json.agendador.fuso, 'America/Sao_Paulo');
    assert.equal((await s.c.get('/api/v1/lembretes/docs.md')).status, 200);
    assert.equal(s.web.caixa.rotaPermitida('/api/v1/lembretes/docs.md'), true);
    assert.equal(s.web.caixa.rotaPermitida('/api/v1/lembretes'), true);
  } finally { await s.fechar(); }
});
