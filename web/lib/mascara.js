'use strict';
// Máscara de segredos para o que vai do transcript para a tela (comando e resultado da trilha).
// Porte dos padrões de runner/src/mascara.ts (que protege a saída do terminal). O Web não conhece as
// variáveis de ambiente do agente, então aqui valem só os padrões de chave e as atribuições com cara
// de segredo (NOME_DA_CHAVE=valor, Authorization: ..., token de bot do Telegram).
// É defesa em profundidade: um segredo fora desses formatos passa. Por isso a trilha só mostra
// trechos curtos e fica fechada por padrão.

const OCULTO = '[segredo oculto]';

const PADROES = [
  /sk-ant-api03-[A-Za-z0-9_-]{90,}/g,
  /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g,
  /sk-proj-[A-Za-z0-9_-]{40,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /AIza[A-Za-z0-9_-]{35}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|$)/g,
  /AKIA[A-Z0-9]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+\/=-]{20,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  /\b[a-z][a-z0-9+.\-]{0,20}:\/\/[^\s:/?#@'"<>]+:[^\s@/?#'"<>]+@[^\s'"<>]+/gi,
];

// NOME=valor, "nome": "valor", nome: valor, quando o nome sugere segredo. Mantém o nome, esconde o valor.
const ATRIBUICAO = /((?:[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|senha|credential|auth)[A-Za-z0-9_.-]*)["']?\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'&;|]+)/gi;

function mascarar(texto) {
  if (texto == null) return '';
  let r = String(texto);
  for (const p of PADROES) { p.lastIndex = 0; r = r.replace(p, OCULTO); }
  ATRIBUICAO.lastIndex = 0;
  r = r.replace(ATRIBUICAO, (_, nome, valor) => (valor === OCULTO ? nome + valor : nome + OCULTO));
  return r;
}

module.exports = { mascarar, OCULTO };
