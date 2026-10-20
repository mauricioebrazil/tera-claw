#!/usr/bin/env node
// Gancho UserPromptSubmit do Claude Code para o Modo foco (roda dentro do container, como o
// usuário agente). Lê o retrato da lista, compara com o cursor e, se o dono marcou algo desde
// a última vez, acrescenta um bloco ao contexto do turno. Qualquer erro: sai com 0, sem texto
// no stdout, e anota o motivo em <workspace>/.teraclaw/logs/foco-hook.log. Contrato: web/docs/MODO-FOCO.md.
import fs from 'node:fs';
import path from 'node:path';

const LIMITE = 1500;
const ws = process.env.TERACLAW_WORKSPACE || '/home/agente';
const retratoArq = path.join(ws, '.teraclaw', 'retratos', 'foco.json');
const cursorArq = path.join(ws, '.teraclaw', 'foco-hook-cursor.json');
const logArq = path.join(ws, '.teraclaw', 'logs', 'foco-hook.log');

function anota(motivo) {
  try {
    fs.mkdirSync(path.dirname(logArq), { recursive: true });
    fs.appendFileSync(logArq, `${new Date().toISOString()} ${motivo}\n`);
  } catch (e) {
    process.stderr.write(`foco-hook: ${motivo} (e não consegui anotar em ${logArq}: ${e.message})\n`);
  }
}

function gravaCursor(ultimoId) {
  const tmp = `${cursorArq}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cursorArq), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ ultimo_id: ultimoId }));
    fs.renameSync(tmp, cursorArq);
  } catch (e) {
    anota(`não consegui gravar o cursor em ${cursorArq}: ${e.message}. O próximo turno pode repetir o aviso.`);
  }
}

const VERBO = { ticou: 'ticou', desticou: 'desticou', editou: 'editou', criou: 'acrescentou', apagou: 'apagou', substituiu: 'substituiu a lista', limpou: 'limpou a lista' };

function linha(e) {
  const verbo = VERBO[e.tipo] || String(e.tipo);
  const texto = typeof e.texto === 'string' ? e.texto.trim() : '';
  return texto ? `- ${verbo}: ${texto}` : `- ${verbo}`;
}

function monta(lista, novos) {
  const cab = '🎯 Modo foco (marcado pelo dono na tela desde a sua última mensagem):';
  const itens = Array.isArray(lista && lista.itens) ? lista.itens : [];
  const faltam = itens.filter(i => !i.feito).map(i => i.texto);
  const total = Number.isInteger(lista && lista.total) ? lista.total : itens.length;
  const feitos = Number.isInteger(lista && lista.feitos) ? lista.feitos : itens.length - faltam.length;
  const placar = `Placar: ${feitos} de ${total}.${faltam.length ? ` Faltam: ${faltam.join(', ')}.` : ''}`;
  let corpo = novos.map(linha).join('\n');
  const reserva = cab.length + placar.length + 2;
  if (reserva + corpo.length > LIMITE) {
    const cabe = Math.max(0, LIMITE - reserva - 1);
    corpo = `${corpo.slice(0, cabe)}…`;
  }
  let bloco = `${cab}\n${corpo}\n${placar}`;
  if (bloco.length > LIMITE) bloco = `${bloco.slice(0, LIMITE - 1)}…`;
  return bloco;
}

function principal() {
  let bruto;
  try { bruto = fs.readFileSync(retratoArq, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return;
    anota(`não consegui ler o retrato ${retratoArq}: ${e.message}`);
    return;
  }
  let retrato;
  try {
    retrato = JSON.parse(bruto);
    if (!retrato || typeof retrato !== 'object' || !Number.isInteger(retrato.ultimo_id) || !Array.isArray(retrato.eventos)) throw new Error('faltam ultimo_id e eventos');
  } catch (e) {
    anota(`o retrato ${retratoArq} está inválido (${e.message}); ignorei neste turno.`);
    return;
  }

  let cursor = null;
  try {
    const c = JSON.parse(fs.readFileSync(cursorArq, 'utf8'));
    if (Number.isInteger(c.ultimo_id)) cursor = c.ultimo_id;
    else anota(`o cursor ${cursorArq} não tem ultimo_id inteiro; recomecei dele.`);
  } catch (e) {
    if (e.code !== 'ENOENT') anota(`o cursor ${cursorArq} está ilegível (${e.message}); recomecei dele.`);
  }
  if (cursor === null) { gravaCursor(retrato.ultimo_id); return; }
  if (cursor > retrato.ultimo_id) { gravaCursor(retrato.ultimo_id); return; }

  const novos = retrato.eventos.filter(e => e && e.id > cursor);
  const doDono = novos.filter(e => e.por !== 'agente');
  if (doDono.length) {
    const saida = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: monta(retrato.lista, doDono) } };
    process.stdout.write(`${JSON.stringify(saida)}\n`);
  }
  if (retrato.ultimo_id !== cursor) gravaCursor(retrato.ultimo_id);
}

try { principal(); } catch (e) { anota(`falha inesperada: ${e.stack || e.message}`); }
process.exit(0);
