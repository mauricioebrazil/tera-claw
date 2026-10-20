'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pastaTemp } = require('./ajuda');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'foco-hook.mjs');

function ev(id, tipo, texto, por) { return { id, agente: 'ana', item_id: 1, tipo, texto, por, em: '2026-10-16T10:00:00-03:00' }; }
function retrato(ws, obj) {
  const d = path.join(ws, '.teraclaw', 'retratos'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'foco.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function roda(ws) {
  const t0 = Date.now();
  const r = spawnSync('node', [HOOK], { input: '{"hook_event_name":"UserPromptSubmit"}', env: { ...process.env, TERACLAW_WORKSPACE: ws }, encoding: 'utf8' });
  return { ...r, ms: Date.now() - t0 };
}
const cursor = (ws) => JSON.parse(fs.readFileSync(path.join(ws, '.teraclaw', 'foco-hook-cursor.json'), 'utf8'));
const logHook = (ws) => { try { return fs.readFileSync(path.join(ws, '.teraclaw', 'logs', 'foco-hook.log'), 'utf8'); } catch (_) { return ''; } };
const lista = { agente: 'ana', itens: [{ id: 1, texto: 'Ligar pro Fernando', feito: true }, { id: 2, texto: 'Pagar o boleto', feito: false }, { id: 3, texto: 'Enviar a proposta', feito: false }], feitos: 1, total: 3 };

test('gancho: sem retrato fica calado e sem log', () => {
  const ws = pastaTemp('hook');
  try {
    const r = roda(ws);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(logHook(ws), '');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('gancho: sem cursor grava o ultimo_id e não injeta nada; depois injeta os tiques do dono', () => {
  const ws = pastaTemp('hook');
  try {
    retrato(ws, { lista, eventos: [ev(7, 'ticou', 'Ligar pro Fernando', 'dono')], ultimo_id: 7 });
    let r = roda(ws);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(cursor(ws).ultimo_id, 7);
    retrato(ws, { lista, eventos: [ev(7, 'ticou', 'Ligar pro Fernando', 'dono'), ev(8, 'ticou', 'Ligar pro Fernando', 'dono'), ev(9, 'desticou', 'Pagar o boleto', 'dono')], ultimo_id: 9 });
    r = roda(ws);
    assert.equal(r.status, 0); assert.ok(r.ms < 1000, `levou ${r.ms} ms`);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(saida.hookSpecificOutput.additionalContext, [
      '🎯 Modo foco (marcado pelo dono na tela desde a sua última mensagem):',
      '- ticou: Ligar pro Fernando', '- desticou: Pagar o boleto',
      'Placar: 1 de 3. Faltam: Pagar o boleto, Enviar a proposta.'].join('\n'));
    assert.equal(cursor(ws).ultimo_id, 9);
    r = roda(ws);
    assert.equal(r.stdout, ''); assert.equal(logHook(ws), '');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('gancho: eventos do próprio agente só avançam o cursor', () => {
  const ws = pastaTemp('hook');
  try {
    retrato(ws, { lista, eventos: [], ultimo_id: 3 }); roda(ws);
    retrato(ws, { lista, eventos: [ev(4, 'substituiu', '3 itens', 'agente'), ev(5, 'ticou', 'x', 'agente')], ultimo_id: 5 });
    const r = roda(ws);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(cursor(ws).ultimo_id, 5);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('gancho: bloco limitado a cerca de 1500 caracteres', () => {
  const ws = pastaTemp('hook');
  try {
    retrato(ws, { lista, eventos: [], ultimo_id: 0 }); roda(ws);
    const muitos = Array.from({ length: 40 }, (_, i) => ev(i + 1, 'ticou', 'Item bem comprido número ' + i + ' '.padEnd(60, 'x'), 'dono'));
    retrato(ws, { lista, eventos: muitos, ultimo_id: 40 });
    const r = roda(ws);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.length <= 1500, String(ctx.length)); assert.match(ctx, /Placar: 1 de 3/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('gancho: retrato ou cursor inválido gera silêncio e uma linha de log com o motivo', () => {
  const ws = pastaTemp('hook');
  try {
    retrato(ws, 'quebrado{');
    let r = roda(ws);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.match(logHook(ws), /foco\.json.*inválido/);
    retrato(ws, { lista, eventos: [ev(2, 'ticou', 'a', 'dono')], ultimo_id: 2 });
    fs.writeFileSync(path.join(ws, '.teraclaw', 'foco-hook-cursor.json'), 'lixo');
    r = roda(ws);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.match(logHook(ws), /cursor.*ilegível/);
    assert.equal(cursor(ws).ultimo_id, 2);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});
