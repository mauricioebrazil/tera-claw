'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/sigilo');

function motorCom(mapa) {
  const m = S.criarMotor();
  for (const [t, tr] of Object.entries(mapa)) m.registra(t, tr);
  return m;
}

test('mascaraTrecho: e-mail, dinheiro, nome e número mantêm a forma sem mostrar o conteúdo', () => {
  assert.equal(S.mascaraTrecho('ana.silva@empresa.com'), 'a****@e*****');
  assert.equal(S.mascaraTrecho('R$ 1.997'), 'R$ ***');
  assert.equal(S.mascaraTrecho('Maria Souza'), 'M**** S****');
  assert.equal(S.mascaraTrecho('abcdefghijklmnopqrstuvwxyz'), 'abc*****');
});

test('filtro automático acha e-mail, valor, CPF, CNPJ, telefone, chave e id longo', () => {
  const m = S.criarMotor();
  const casos = [
    ['fale com ana@x.com.br hoje', 'ana@x.com.br'],
    ['custou R$ 35k no mês', 'R$ 35k'],
    ['foram 1.997 reais', '1.997 reais'],
    ['CPF 123.456.789-09 ok', '123.456.789-09'],
    ['CNPJ 12.345.678/0001-95 ok', '12.345.678/0001-95'],
    ['liga (11) 98765-4321 já', '(11) 98765-4321'],
    ['chave sk-abcdef123456 aqui', 'sk-abcdef123456'],
    ['id 123456789012345 fim', '123456789012345'],
    ['token ' + 'a1b2c3d4'.repeat(5) + ' fim', 'a1b2c3d4'.repeat(5)],
  ];
  for (const [texto, esperado] of casos) {
    const f = m.faixas(texto, true);
    assert.ok(f.length >= 1, texto);
    assert.ok(f.some(([a, b]) => texto.slice(a, b).includes(esperado.slice(0, 6))), texto + ' -> ' + JSON.stringify(f));
    assert.ok(!m.aplica(texto, true).includes(esperado), texto);
  }
  assert.equal(m.aplica('Reunião às 14:30 do dia 17/10', true), 'Reunião às 14:30 do dia 17/10');
});

test('trechos do modelo valem em todo texto onde aparecem, sem pegar pedaço de palavra', () => {
  const m = motorCom({ 'A Maria Souza ligou': ['Maria Souza', 'Maria'], 'outra conversa': [] });
  assert.equal(m.aplica('Falei com a maria souza. Mariana também veio.'), 'Falei com a m**** s****. Mariana também veio.');
  assert.equal(m.situacao('A Maria Souza ligou'), 'ok');
  assert.equal(m.situacao('texto novo'), 'espera');
  m.registra('quebrou', null);
  assert.equal(m.situacao('quebrou'), 'falhou');
  assert.deepEqual(m.pendentes(['texto novo', 'quebrou', 'outra conversa']), ['texto novo']);
  assert.deepEqual(m.pendentes(['texto novo', 'quebrou'], true), ['texto novo', 'quebrou']);
});

test('trecho curto vale só no texto de origem', () => {
  const m = motorCom({ 'o Lu pagou': ['Lu'] });
  assert.equal(m.aplica('o Lu pagou'), 'o L** pagou');
  assert.equal(m.aplica('Lu foi embora'), 'Lu foi embora');
});

test('mascaraPartes: nome partido entre dois nós (negrito no meio) também some', () => {
  const m = motorCom({ 'Ana Paula ligou': ['Ana Paula'] });
  const partes = [{ texto: 'Ana ', sep: false }, { texto: 'Paula', sep: false }, { texto: ' ligou', sep: false }];
  const r = m.mascaraPartes(partes, false, 'Ana Paula ligou');
  assert.equal(r.join(''), '*** ***** ligou');
  assert.ok(!r.join('').includes('Paula'));
});

test('mascaraPartes: trecho inteiro dentro de um nó usa a forma do trecho; fronteira de bloco vira quebra', () => {
  const m = motorCom({ 'x\nMaria Souza': ['Maria Souza'] });
  const r = m.mascaraPartes([{ texto: 'x', sep: false }, { texto: 'Maria Souza', sep: true }], false, 'x\nMaria Souza');
  assert.deepEqual(r, ['x', 'M**** S****']);
  assert.equal(S.junta([{ texto: 'a' }, { texto: 'b', sep: true }, { texto: 'c', sep: false }]).texto, 'a\nbc');
});

test('mudar os trechos invalida o que já foi calculado', () => {
  const m = S.criarMotor();
  assert.equal(m.aplica('fale com o Pedro'), 'fale com o Pedro');
  m.registra('fale com o Pedro', ['Pedro']);
  assert.equal(m.aplica('fale com o Pedro'), 'fale com o P****');
});
