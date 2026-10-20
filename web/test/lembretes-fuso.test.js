'use strict';
// Fuso e regras dos lembretes: conversão local <-> instante, próxima ocorrência, texto em português.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/lembretes-fuso');

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const em = (tz, data, hora) => F.instanteDe(tz, data, hora);
const prox = (tz, regra, depois, fim) => {
  const r = F.proximaDepois(regra, depois, fim, tz);
  return r ? F.isoLocal(r.ep, tz) : null;
};

test('São Paulo: data e hora local viram instante e voltam com o deslocamento -03:00', () => {
  const ep = em(SP, '2026-10-20', '14:30');
  assert.equal(new Date(ep).toISOString(), '2026-10-20T17:30:00.000Z');
  assert.equal(F.isoLocal(ep, SP), '2026-10-20T14:30:00-03:00');
  assert.equal(F.dataLocal(ep, SP), '2026-10-20');
  assert.equal(F.horaLocal(ep, SP), '14:30');
});

test('Nova York: o deslocamento muda de -05:00 para -04:00 na virada de março', () => {
  assert.equal(F.isoLocal(em(NY, '2026-03-07', '12:00'), NY), '2026-03-07T12:00:00-05:00');
  assert.equal(F.isoLocal(em(NY, '2026-03-09', '12:00'), NY), '2026-03-09T12:00:00-04:00');
});

test('horário de verão: hora que não existe pula para a próxima válida', () => {
  // 08/03/2026 02:30 não existe em Nova York (02:00 vira 03:00)
  const ep = em(NY, '2026-03-08', '02:30');
  assert.equal(F.isoLocal(ep, NY), '2026-03-08T03:00:00-04:00');
});

test('horário de verão: hora repetida usa a primeira', () => {
  // 01/11/2026 01:30 acontece duas vezes em Nova York
  const ep = em(NY, '2026-11-01', '01:30');
  assert.equal(F.isoLocal(ep, NY), '2026-11-01T01:30:00-04:00');
  assert.equal(F.isoLocal(ep + 3600000, NY), '2026-11-01T01:30:00-05:00');
});

test('diário às 09:00 em Nova York atravessa a virada: de 24 h passa a 23 h', () => {
  const regra = { tipo: 'diario', hora: '09:00' };
  const sabado = em(NY, '2026-03-07', '09:00');
  const domingo = F.proximaDepois(regra, sabado, null, NY);
  assert.equal(F.isoLocal(domingo.ep, NY), '2026-03-08T09:00:00-04:00');
  assert.equal(domingo.ep - sabado, 23 * 3600000);
});

test('regra único: no futuro devolve o instante, no passado devolve null', () => {
  const regra = { tipo: 'unico', data: '2026-10-20', hora: '14:30' };
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '12:00')), '2026-10-20T14:30:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-20', '14:30')), null, 'estritamente depois');
  assert.equal(prox(SP, regra, em(SP, '2026-10-21', '08:00')), null);
});

test('regra diário: hoje se a hora ainda não passou, senão amanhã', () => {
  const regra = { tipo: 'diario', hora: '08:00' };
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '07:00')), '2026-10-17T08:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '08:00')), '2026-10-18T08:00:00-03:00');
});

test('regra semanal com vários dias: segue a ordem da semana e passa o fim de semana', () => {
  const regra = { tipo: 'semanal', dias: ['seg', 'qua'], hora: '09:00' };
  // 17/10/2026 é sábado
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '12:00')), '2026-10-19T09:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-19', '09:00')), '2026-10-21T09:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-21', '09:00')), '2026-10-26T09:00:00-03:00');
});

test('regra a cada N dias: conta a partir do início', () => {
  const regra = { tipo: 'a_cada_n_dias', n: 3, inicio: '2026-10-17', hora: '20:00' };
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '12:00')), '2026-10-17T20:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '20:00')), '2026-10-20T20:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-21', '08:00')), '2026-10-23T20:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-01', '08:00')), '2026-10-17T20:00:00-03:00', 'antes do início, vale o início');
});

test('fim: último dia em que ainda toca', () => {
  const regra = { tipo: 'diario', hora: '08:00' };
  assert.equal(prox(SP, regra, em(SP, '2026-10-17', '09:00'), '2026-10-18'), '2026-10-18T08:00:00-03:00');
  assert.equal(prox(SP, regra, em(SP, '2026-10-18', '09:00'), '2026-10-18'), null);
});

test('regra em português', () => {
  assert.equal(F.regraEmPortugues({ tipo: 'unico', data: '2026-10-20', hora: '14:30' }), 'uma vez, em 20/10/2026 às 14:30');
  assert.equal(F.regraEmPortugues({ tipo: 'diario', hora: '08:00' }), 'todo dia às 08:00');
  assert.equal(F.regraEmPortugues({ tipo: 'semanal', dias: ['seg', 'qua'], hora: '09:00' }), 'toda segunda e quarta às 09:00');
  assert.equal(F.regraEmPortugues({ tipo: 'semanal', dias: ['seg', 'ter', 'qua', 'qui', 'sex'], hora: '09:00' }), 'de segunda a sexta às 09:00');
  assert.equal(F.regraEmPortugues({ tipo: 'semanal', dias: ['sab', 'dom'], hora: '10:00' }), 'todo sábado e domingo às 10:00');
  assert.equal(F.regraEmPortugues({ tipo: 'a_cada_n_dias', n: 3, inicio: '2026-10-17', hora: '20:00' }), 'a cada 3 dias às 20:00 (desde 17/10/2026)');
  assert.equal(F.regraEmPortugues({ tipo: 'diario', hora: '08:00' }, '2026-12-31'), 'todo dia às 08:00, até 31/12/2026');
});

test('validaRegra: normaliza hora e dias por extenso, e diz o campo de cada erro', () => {
  const ok = F.validaRegra({ tipo: 'semanal', dias: ['Sábado', 'quarta-feira'], hora: '9:05' });
  assert.deepEqual(ok.regra, { tipo: 'semanal', hora: '09:05', dias: ['qua', 'sab'] });
  const ruim = F.validaRegra({ tipo: 'unico', hora: '25:00', data: '2026-02-30', extra: 1 });
  assert.equal(ruim.regra, null);
  assert.match(ruim.erros['regra.hora'], /HH:MM/);
  assert.match(ruim.erros['regra.data'], /calendário/);
  assert.match(ruim.erros['regra.extra'], /não existe na regra "unico"/);
  assert.match(F.validaRegra({ tipo: 'quinzenal' }).erros['regra.tipo'], /unico, diario, semanal, a_cada_n_dias/);
  assert.match(F.validaRegra({ tipo: 'a_cada_n_dias', n: 0, hora: '08:00' }).erros['regra.n'], /1 a 365/);
  assert.ok(F.validaRegra('segunda').erros.regra);
});
