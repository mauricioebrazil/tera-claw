// test-teto-gastos.mjs - sem teto configurado, o painel não inventa um (era US$ 200 fixo).
// Quem configurou budgetUsd numérico continua com o mesmo comportamento.
// Uso: node test-teto-gastos.mjs (não precisa de express)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { loadConfig, defaults } = require('./lib/config.js');
const { buildCosts } = require('./lib/costs.js');

let falhas = 0;
const ok = (cond, msg) => { console.log(cond ? `  ok   ${msg}` : `  FALHOU  ${msg}`); if (!cond) falhas++; };

console.log('config');
ok(defaults().budgetUsd === null, 'o default é sem teto (null)');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teto-'));
const comConfig = (conteudo) => {
  const dir = fs.mkdtempSync(path.join(pasta, 'c-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(conteudo));
  return loadConfig(dir);
};
ok(comConfig({}).budgetUsd === null, 'config sem budgetUsd fica sem teto');
ok(comConfig({ budgetUsd: null }).budgetUsd === null, 'budgetUsd null continua sem teto');
ok(comConfig({ budgetUsd: 0 }).budgetUsd === null, 'budgetUsd 0 vira sem teto (não divide por zero)');
ok(comConfig({ budgetUsd: 50 }).budgetUsd === 50, 'budgetUsd numérico explícito é respeitado');

console.log('\ncustos');
const logDir = fs.mkdtempSync(path.join(pasta, 'logs-'));
const overview = (budgetUsd) => buildCosts({ logDir, budgetUsd, timezoneOffsetHours: -3 }).getOverview();
ok(overview(null).budget === null, 'overview sem teto devolve budget null');
ok(overview(undefined).budget === null, 'overview com budgetUsd ausente devolve budget null');
ok(overview(120).budget === 120, 'overview com teto explícito devolve o teto');

fs.rmSync(pasta, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
process.exit(falhas ? 1 : 0);
