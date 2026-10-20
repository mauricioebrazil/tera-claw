// test-arquivos-sem-pasta.mjs — agente novo, sem a pasta arquivos/, na aba Pasta.
//
// Confere: subir na raiz cria a pasta e grava; subpasta inexistente segue 404;
// listar nunca cria a pasta; nomes comuns de zip passam.
// `node test-arquivos-sem-pasta.mjs` na pasta do painel.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildArquivos } = require('./lib/arquivos.js');

let falhas = 0;
const ok = (cond, oQue) => {
  console.log(`  ${cond ? 'ok  ' : 'FALHOU'}  ${oQue}`);
  if (!cond) falhas++;
};

const agentDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arq-sem-pasta-')));
const arq = buildArquivos({ agentDir });
const pasta = path.join(agentDir, 'arquivos');

const l1 = arq.listar('');
ok(!l1.erro && l1.pastas.length === 0 && l1.arquivos.length === 0, 'listar na raiz sem a pasta devolve lista vazia');
ok(/subir um arquivo mesmo assim/.test(l1.motivo || ''), 'o motivo diz que dá para subir mesmo assim');
ok(!fs.existsSync(pasta), 'listar NÃO cria a pasta');

const sub = arq.subir('projetos', 'a.zip', Buffer.from('x'));
ok(sub.status === 404, 'subir em subpasta inexistente continua 404');
ok(!fs.existsSync(pasta), 'o 404 da subpasta não cria a raiz');

const r = arq.subir('', 'Projeto final (v2).zip', Buffer.from('PK123'));
ok(r.ok === true, 'subir na raiz sem a pasta dá certo');
ok(fs.statSync(pasta).isDirectory(), 'a pasta arquivos/ foi criada');
ok(fs.readFileSync(path.join(pasta, 'Projeto final (v2).zip'), 'utf8') === 'PK123', 'o arquivo foi gravado com o conteúdo certo');
const dono = fs.statSync(agentDir);
const st = fs.statSync(pasta);
ok(st.uid === dono.uid && st.gid === dono.gid, 'a pasta criada tem o dono do agentDir');
ok((st.mode & 0o777) === 0o755, 'a pasta criada tem modo 755');

const r2 = arq.subir('', 'relatorio_2026-10.zip', Buffer.from('PK'));
ok(r2.ok === true, 'segundo envio (pasta já existe) e nome com sublinhado e hífen passam');
ok(arq.subir('', 'Projeto final (v2).zip', Buffer.from('PK')).status === 409, 'repetir o nome continua 409');

const semAgente = buildArquivos({ agentDir: path.join(agentDir, 'nao-existe') });
const r3 = semAgente.subir('', 'a.zip', Buffer.from('x'));
ok(r3.erro && r3.status === 404, 'agentDir inexistente dá erro 404 com motivo, sem criar nada');

fs.rmSync(agentDir, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
