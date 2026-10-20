// test-skills.mjs - a aba Skills: /api/skills lê <dir>/<nome>/SKILL.md do disco.
//
// Sobe o painel de verdade com duas pastas de skills falsas (uma existe, outra não) e confere a
// lista, o frontmatter em várias linhas, o item com erro e a pasta inexistente.
// Uso: NODE_PATH=$PWD/node_modules node test-skills.mjs (na pasta panel)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
let falhas = 0;
const ok = (cond, msg) => { console.log(cond ? `  ok   ${msg}` : `  FALHOU  ${msg}`); if (!cond) falhas++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
const extra = path.join(RAIZ, 'extra');
const naoExiste = path.join(RAIZ, 'nao-existe');
const mk = (dir, nome, conteudo) => { fs.mkdirSync(path.join(dir, nome), { recursive: true }); fs.writeFileSync(path.join(dir, nome, 'SKILL.md'), conteudo); };
mk(extra, 'resumo-semanal', '---\nname: resumo-semanal\ndescription: Monta o resumo da semana\n---\n# corpo\n');
mk(extra, 'faz-relatorio', '---\nname: faz-relatorio\ndescription: >\n  Faz o relatório mensal\n  com os números de vendas.\n  Use todo dia 1.\n---\n');
mk(extra, 'quebrada', 'sem cabeçalho nenhum\n');

const PORTA = 18900 + Math.floor(Math.random() * 100);
const SENHA = 'senha-de-teste-bem-longa-123';
const env = { ...process.env, HOME: RAIZ, TERACLAW_PANEL_PORT: String(PORTA), TERACLAW_PANEL_HOST: '127.0.0.1',
  TERACLAW_PANEL_PASSWORD: SENHA, TERACLAW_SAUDE_CHECAR_LOGIN: 'off', TERACLAW_PANEL_SKILLS_DIR: `${extra},${naoExiste}` };
const filho = spawn('node', ['server.js'], { cwd: AQUI, env, stdio: 'ignore' });

try {
  let login;
  for (let i = 0; i < 40 && !login; i++) {
    try { login = await fetch(`http://127.0.0.1:${PORTA}/login`, { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(SENHA)}` }); }
    catch { await dormir(250); }
  }
  ok(!!login, 'painel subiu e aceitou o login');
  const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const r = await fetch(`http://127.0.0.1:${PORTA}/api/skills`, { headers: { cookie } });
  ok(r.status === 200, `GET /api/skills responde 200 (veio ${r.status})`);
  const j = await r.json();
  const por = Object.fromEntries((j.skills || []).map((s) => [s.nome, s]));
  ok(j.skills.length === 3, `lista as 3 skills falsas (veio ${j.skills.length})`);
  ok(por['resumo-semanal']?.descricao === 'Monta o resumo da semana', 'descrição de uma linha');
  ok(por['faz-relatorio']?.descricao === 'Faz o relatório mensal com os números de vendas. Use todo dia 1.', 'descrição multilinha (>) vira um texto só');
  ok(por['resumo-semanal']?.pasta === path.join(extra, 'resumo-semanal') && por['resumo-semanal']?.origem === extra, 'traz a pasta e a origem');
  ok(por['quebrada']?.erro && /cabeçalho/.test(por['quebrada'].erro), 'SKILL.md sem frontmatter vem com erro e não derruba a lista');
  const p = Object.fromEntries(j.pastas.map((x) => [x.caminho, x.existe]));
  ok(p[extra] === true, 'pasta extra existente: existe:true');
  ok(p[naoExiste] === false, 'pasta inexistente: existe:false, sem erro 500');
  ok(j.pastas.some((x) => x.caminho.endsWith(path.join('.claude', 'skills'))), 'a pasta padrão do agente também é listada');
} finally {
  filho.kill();
  fs.rmSync(RAIZ, { recursive: true, force: true });
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO CERTO');
process.exit(falhas ? 1 : 0);
