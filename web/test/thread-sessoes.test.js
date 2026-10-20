'use strict';
// A conversa do agente junta TODAS as sessões do transcripts_dir (não só a atual). Transcripts sintéticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarConversa } = require('../lib/conversa');
const { criarLeitor } = require('../lib/thread');
const { criarRunner } = require('../lib/runner');
const { criarMidia } = require('../lib/media');
const { criarRunnerFalso } = require('./runner-falso');
const { pastaTemp, capturaLog } = require('./ajuda');

const ATUAL = 'sess-atual-0001';

/** Duas linhas de transcript: o dono fala (dgchat) e o agente responde, em segundos a partir de `seg` do dia 12/10. */
function par(seg, dono, resposta) {
  const ts = (s) => new Date(Date.UTC(2026, 9, 12, 15, 0, 0) + s * 1000).toISOString();
  return [
    JSON.stringify({ type: 'user', timestamp: ts(seg), message: { role: 'user', content: `<dgchat from="pessoa" chat="c_ana" msg="m${seg}" ts="${ts(seg)}">${dono}</dgchat>` } }),
    JSON.stringify({ type: 'assistant', timestamp: ts(seg + 1), message: { role: 'assistant', content: [{ type: 'tool_use', id: `tu${seg}`, name: 'mcp__dgchat__reply', input: { chat: 'c_ana', text: resposta } }] } }),
  ].join('\n') + '\n';
}
const escreve = (arq, texto, mtimeSeg) => {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, texto);
  if (mtimeSeg != null) fs.utimesSync(arq, mtimeSeg, mtimeSeg);
};

async function montar(opcoes) {
  const o = Object.assign({ runnerNoAr: true }, opcoes);
  const raiz = pastaTemp('sessoes');
  const transcripts = path.join(raiz, 'projects');
  fs.mkdirSync(transcripts, { recursive: true });
  const rf = criarRunnerFalso({ agenteId: 'ana1', sessionId: ATUAL });
  const porta = await rf.ouvir();
  if (!o.runnerNoAr) await rf.fechar();
  const agente = { slug: 'ana', nome: 'Ana', tipo: 'agente', runner: `http://127.0.0.1:${porta}`, agente_id: 'ana1', chat_id: 'c_ana', provedor: 'claude', modelo: 'sonnet', transcripts_dir: transcripts, home_host: pastaTemp('home'), home_container: '/home/agente' };
  const cap = capturaLog();
  const midia = criarMidia({ dataDir: pastaTemp('dados'), log: cap.log, registro: { obter: () => agente } });
  const leitor = criarLeitor({ log: cap.log, tz: 'America/Sao_Paulo', canalTelegram: 'plugin:telegram', midia });
  const conversa = criarConversa({ config: {}, runner: criarRunner({ log: cap.log }), leitor, midia, log: cap.log });
  return { conversa, agente, transcripts, raiz, cap, fechar: async () => { if (o.runnerNoAr) await rf.fechar(); } };
}
const textos = (t) => t.msgs.map((m) => m.text);

test('sessões: duas sessões em arquivos diferentes aparecem juntas e em ordem', async () => {
  const c = await montar();
  try {
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), par(0, 'oi antigo', 'resposta antiga'), 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(100, 'oi novo', 'resposta nova'), 2000);
    const t = await c.conversa.thread(c.agente);
    assert.deepEqual(textos(t), ['oi antigo', 'resposta antiga', 'oi novo', 'resposta nova']);
    assert.equal(t.arquivo, fs.realpathSync(path.join(c.transcripts, `${ATUAL}.jsonl`)), 'arquivo continua sendo o da sessão atual');
    assert.deepEqual(t.avisos, []);
  } finally { await c.fechar(); }
});

test('sessões: a ordem é por ep, mesmo quando o arquivo mais novo tem fala mais velha', async () => {
  const c = await montar();
  try {
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), par(500, 'tarde', 'tarde r'), 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(10, 'cedo', 'cedo r'), 2000);
    assert.deepEqual(textos(await c.conversa.thread(c.agente)), ['cedo', 'cedo r', 'tarde', 'tarde r']);
  } finally { await c.fechar(); }
});

test('sessões: sessão atual numa subpasta entra, e subagents/ não entra', async () => {
  const c = await montar();
  try {
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), par(0, 'oi antigo', 'r antiga'), 1000);
    escreve(path.join(c.transcripts, '-home-agente', `${ATUAL}.jsonl`), par(100, 'oi novo', 'r nova'), 2000);
    escreve(path.join(c.transcripts, 'sess-antiga-0001', 'subagents', 'agent-x.jsonl'), par(50, 'fala de subagente', 'r subagente'), 1500);
    escreve(path.join(c.transcripts, '-home-agente', 'outra-0001-aaaa.jsonl'), par(60, 'fala de outra subpasta', 'r outra'), 1500);
    const t = await c.conversa.thread(c.agente);
    assert.deepEqual(textos(t), ['oi antigo', 'r antiga', 'oi novo', 'r nova']);
  } finally { await c.fechar(); }
});

test('sessões: o mesmo id em dois arquivos aparece uma vez só', async () => {
  const c = await montar();
  try {
    const igual = par(0, 'repetida', 'r repetida');
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), igual, 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), igual + par(100, 'só na atual', 'r atual'), 2000);
    assert.deepEqual(textos(await c.conversa.thread(c.agente)), ['repetida', 'r repetida', 'só na atual', 'r atual']);
  } finally { await c.fechar(); }
});

test('sessões: paginação com before atravessa de uma sessão para a outra', async () => {
  const c = await montar();
  try {
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), par(0, 'a1', 'a2') + par(10, 'a3', 'a4'), 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(100, 'b1', 'b2') + par(110, 'b3', 'b4'), 2000);
    const todas = (await c.conversa.thread(c.agente)).msgs;
    assert.equal(todas.length, 8);
    // Mesma conta do server.js: before filtra por ep e pega a cauda de `limite`.
    const pagina = (before, limite) => { const base = todas.filter((x) => x.ep < before); return { msgs: base.slice(Math.max(0, base.length - limite)), mais_antigas: base.length > limite }; };
    const p1 = pagina(Infinity, 3);
    assert.deepEqual(p1.msgs.map((m) => m.text), ['b2', 'b3', 'b4']);
    assert.equal(p1.mais_antigas, true);
    const p2 = pagina(p1.msgs[0].ep, 3);
    assert.deepEqual(p2.msgs.map((m) => m.text), ['a3', 'a4', 'b1'], 'cruza para a sessão antiga');
    assert.equal(p2.mais_antigas, true);
    const p3 = pagina(p2.msgs[0].ep, 3);
    assert.deepEqual(p3.msgs.map((m) => m.text), ['a1', 'a2']);
    assert.equal(p3.mais_antigas, false);
  } finally { await c.fechar(); }
});

test('sessões: versao muda quando o arquivo antigo cresce e quando aparece arquivo novo', async () => {
  const c = await montar();
  try {
    const antigo = path.join(c.transcripts, 'sess-antiga-0001.jsonl');
    escreve(antigo, par(0, 'a1', 'a2'), 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(100, 'b1', 'b2'), 2000);
    const t1 = await c.conversa.thread(c.agente);
    const t1b = await c.conversa.thread(c.agente);
    assert.equal(t1b.versao, t1.versao, 'sem mudança a versão é a mesma');
    assert.equal(t1b.msgs, t1.msgs, 'e a lista é a mesma (identidade)');
    fs.appendFileSync(antigo, par(20, 'a3', 'a4'));
    const t2 = await c.conversa.thread(c.agente);
    assert.notEqual(t2.versao, t1.versao, 'arquivo antigo cresceu');
    assert.equal(t2.msgs.length, 6);
    escreve(path.join(c.transcripts, 'sess-teste-0003.jsonl'), par(30, 'c1', 'c2'), 1500);
    const t3 = await c.conversa.thread(c.agente);
    assert.notEqual(t3.versao, t2.versao, 'apareceu arquivo novo');
    assert.equal(t3.msgs.length, 8);
    assert.ok(t3.versao > 0);
  } finally { await c.fechar(); }
});

test('sessões: com o runner fora do ar ainda mostra todas as sessões do disco', async () => {
  const c = await montar({ runnerNoAr: false });
  try {
    escreve(path.join(c.transcripts, 'sess-antiga-0001.jsonl'), par(0, 'a1', 'a2'), 1000);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(100, 'b1', 'b2'), 2000);
    const t = await c.conversa.thread(c.agente);
    assert.deepEqual(textos(t), ['a1', 'a2', 'b1', 'b2']);
    assert.ok(t.avisos.some((a) => /runner não respondeu/i.test(a)));
  } finally { await c.fechar(); }
});

test('sessões: atalho para fora da raiz é recusado com aviso e o resto aparece', async () => {
  const c = await montar();
  try {
    const fora = path.join(c.raiz, 'segredo.jsonl');
    escreve(fora, par(0, 'não pode aparecer', 'nem esta'), 1000);
    fs.symlinkSync(fora, path.join(c.transcripts, 'atalho-0001-aaaa.jsonl'));
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(100, 'b1', 'b2'), 2000);
    const t = await c.conversa.thread(c.agente);
    assert.deepEqual(textos(t), ['b1', 'b2']);
    assert.ok(t.avisos.some((a) => /Recusei/.test(a) && a.includes('atalho-0001-aaaa.jsonl')), t.avisos.join('|'));
  } finally { await c.fechar(); }
});

test('sessões: no máximo 40 arquivos, e a sessão atual sempre entra', async () => {
  const c = await montar();
  try {
    // 45 sessões antigas, todas mais novas que a atual (que fica fora do corte por mtime).
    for (let i = 0; i < 45; i += 1) escreve(path.join(c.transcripts, `sess-velha-${String(i).padStart(4, '0')}.jsonl`), par(1000 + i * 10, `v${i}`, `rv${i}`), 5000 + i);
    escreve(path.join(c.transcripts, `${ATUAL}.jsonl`), par(0, 'atual', 'r atual'), 100);
    const t = await c.conversa.thread(c.agente);
    const ts = textos(t);
    assert.ok(ts.includes('atual') && ts.includes('r atual'), 'a atual entra mesmo sendo a mais velha');
    assert.equal(ts.length, 40 * 2, 'exatamente 40 arquivos lidos');
    assert.ok(!ts.includes('v0') && ts.includes('v44'), 'saem os mais antigos por mtime');
  } finally { await c.fechar(); }
});
