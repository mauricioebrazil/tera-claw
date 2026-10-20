'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// barra.js num contexto com window/document mínimos: sem DOM de verdade, só as funções puras
const codigo = fs.readFileSync(path.join(__dirname, '../public/barra.js'), 'utf8');
const janela = {};
janela.window = janela;
janela.document = { createElement() { return {}; } };
vm.createContext(janela);
vm.runInContext(codigo, janela, { filename: 'barra.js' });
const B = janela.DGBarra;
const nomes = lista => Array.from(lista, c => c.nome);   // o vm cria Array de outro realm

test('deveAbrir: abre só com uma barra no começo e o cursor no nome', () => {
  assert.equal(B.deveAbrir('/', 1), true);
  assert.equal(B.deveAbrir('/comp', 5), true);
  assert.equal(B.deveAbrir('/comp', 3), true);
  assert.equal(B.deveAbrir('/compact x', 10), false);
  assert.equal(B.deveAbrir('/compact ', 9), false);
  assert.equal(B.deveAbrir('oi /x', 5), false);
  assert.equal(B.deveAbrir('//x', 3), false);
  assert.equal(B.deveAbrir('', 0), false);
  assert.equal(B.deveAbrir('/x', 0), false);
});

const CAT = [
  { nome: '/review', roda: true },
  { nome: '/compact', roda: true },
  { nome: '/Context', roda: true },
  { nome: '/recompute', roda: true },
  { nome: '/cost', roda: true },
];

test('filtrar: quem começa com o termo vem antes de quem só contém', () => {
  const r = nomes(B.filtrar(CAT, 'co'));
  assert.deepEqual(r, ['/compact', '/Context', '/cost', '/recompute']);
});

test('filtrar: ignora maiúsculas e a barra do começo', () => {
  assert.deepEqual(nomes(B.filtrar(CAT, 'CON')), ['/Context']);
  assert.deepEqual(nomes(B.filtrar(CAT, '/RE')), ['/review', '/recompute']);
});

test('filtrar: termo vazio devolve tudo, limitado ao máximo; sem resultado devolve vazio', () => {
  assert.equal(B.filtrar(CAT, '').length, 5);
  const muitos = Array.from({ length: 80 }, (_, i) => ({ nome: '/c' + i }));
  assert.equal(B.filtrar(muitos, '').length, 50);
  assert.equal(B.filtrar(CAT, 'zzz').length, 0);
});
