#!/usr/bin/env node
'use strict';
// Gera o par de chaves dos avisos no aparelho (vapid.json) se ele ainda não existe.
// Idempotente: nunca sobrescreve um arquivo que já existe. Imprime só a chave pública.
//
// Uso: node web/bin/push-chaves.js <pasta-de-dados-do-web>      (ex.: /var/lib/teraclaw/web)
// Saída: 0 ok (chave pública na saída), 1 uso errado, 2 não consegui ler ou criar as chaves.

const { criarPush } = require('../lib/push');

const dataDir = process.argv[2];
if (!dataDir || process.argv.length > 3) {
  console.error('push-chaves: informe a pasta de dados do Web, por exemplo: node web/bin/push-chaves.js /var/lib/teraclaw/web');
  process.exit(1);
}
const log = (nivel, msg) => { console.error(`push-chaves [${nivel}] ${msg}`); };
try {
  const c = criarPush({ dataDir, log }).garantirChaves();
  console.log(c.publica);
} catch (e) {
  console.error(`push-chaves: ${e.message}`);
  process.exit(2);
}
