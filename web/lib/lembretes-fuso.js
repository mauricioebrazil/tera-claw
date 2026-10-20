'use strict';
// Fuso e regras dos lembretes: conversão data/hora local <-> instante (epoch em ms) para um fuso
// IANA usando só Intl.DateTimeFormat, a próxima ocorrência de cada regra e a regra em português.
// Sem dependências. Contrato dos lembretes em docs/LEMBRETES.md.

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];       // índice 0 = segunda
const NOMES_DIA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const TIPOS = ['unico', 'diario', 'semanal', 'a_cada_n_dias'];
const CAMPOS_REGRA = {
  unico: ['tipo', 'hora', 'data'],
  diario: ['tipo', 'hora'],
  semanal: ['tipo', 'hora', 'dias'],
  a_cada_n_dias: ['tipo', 'hora', 'n', 'inicio'],
};
const EXEMPLO_REGRA = '{"tipo":"semanal","dias":["seg","qua"],"hora":"09:00"}';
const RX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86400000;

// ── fuso ──────────────────────────────────────────────────────────────────────
const formatadores = new Map();
function formatador(tz) {
  let f = formatadores.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatadores.set(tz, f);
  }
  return f;
}

/** O fuso existe? Devolve null se sim, ou o motivo. */
function erroDoFuso(tz) {
  try { formatador(tz).format(0); return null; } catch (e) { return e.message; }
}

/** Data e hora de parede de um instante no fuso. */
function partes(ms, tz) {
  const o = {};
  for (const p of formatador(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { ano: o.year, mes: o.month, dia: o.day, hora: o.hour % 24, min: o.minute, seg: o.second };
}

/** Deslocamento do fuso em minutos (positivo a leste de Greenwich) no instante dado. */
function offsetMin(ms, tz) {
  const p = partes(ms, tz);
  const base = Math.floor(ms / 1000) * 1000;
  return Math.round((Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg) - base) / 60000);
}

const dois = (n) => String(n).padStart(2, '0');

function dataLocal(ms, tz) { const p = partes(ms, tz); return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`; }
function horaLocal(ms, tz) { const p = partes(ms, tz); return `${dois(p.hora)}:${dois(p.min)}`; }

/** ISO com deslocamento: 2026-10-20T14:30:00-03:00. */
function isoLocal(ms, tz) {
  if (ms == null) return null;
  const p = partes(ms, tz);
  const off = offsetMin(ms, tz);
  const abs = Math.abs(off);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.min)}:${dois(p.seg)}` +
    `${off < 0 ? '-' : '+'}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`;
}

/**
 * Instante (ms) em que o relógio do fuso marca ano-mês-dia hora:min.
 * Hora repetida (fim do horário de verão): vale a primeira. Hora que não existe (início do horário
 * de verão): vale o primeiro instante válido depois do buraco.
 */
function localParaEpoch(tz, ano, mes, dia, hora, min) {
  const alvoUtc = Date.UTC(ano, mes - 1, dia, hora, min);
  const antes = offsetMin(alvoUtc - 36 * 3600000, tz);
  const depois = offsetMin(alvoUtc + 36 * 3600000, tz);
  const validos = [];
  for (const off of new Set([antes, depois])) {
    const t = alvoUtc - off * 60000;
    const p = partes(t, tz);
    if (p.ano === ano && p.mes === mes && p.dia === dia && p.hora === hora && p.min === min) validos.push(t);
  }
  if (validos.length) return Math.min(...validos);
  // buraco: acha o primeiro minuto em que o deslocamento deixa de ser o de antes
  let lo = alvoUtc - 48 * 3600000;
  let hi = alvoUtc + 48 * 3600000;
  if (offsetMin(hi, tz) === antes) return alvoUtc - antes * 60000;
  while (hi - lo > 60000) {
    const meio = lo + Math.floor((hi - lo) / 120000) * 60000;
    if (offsetMin(meio, tz) === antes) lo = meio; else hi = meio;
  }
  return hi;
}

// ── datas de calendário (sem fuso) ────────────────────────────────────────────
function dataParaPartes(s) { const [a, m, d] = s.split('-').map(Number); return { a, m, d }; }
function utcDe(s) { const p = dataParaPartes(s); return Date.UTC(p.a, p.m - 1, p.d); }
function somaDias(s, n) {
  const d = new Date(utcDe(s) + n * DIA_MS);
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}
function diasEntre(a, b) { return Math.round((utcDe(b) - utcDe(a)) / DIA_MS); }
function diaDaSemana(s) { return (new Date(utcDe(s)).getUTCDay() + 6) % 7; }   // 0 = segunda
function dataExiste(s) {
  if (typeof s !== 'string' || !RX_DATA.test(s)) return false;
  const p = dataParaPartes(s);
  const d = new Date(Date.UTC(p.a, p.m - 1, p.d));
  return d.getUTCFullYear() === p.a && d.getUTCMonth() === p.m - 1 && d.getUTCDate() === p.d;
}
function dataBr(s) { const p = dataParaPartes(s); return `${dois(p.d)}/${dois(p.m)}/${p.a}`; }

/** Instante de uma data "AAAA-MM-DD" + hora "HH:MM" no fuso. */
function instanteDe(tz, data, hora) {
  const p = dataParaPartes(data);
  return localParaEpoch(tz, p.a, p.m, p.d, Number(hora.slice(0, 2)), Number(hora.slice(3, 5)));
}

/**
 * Primeiro horário da regra ESTRITAMENTE depois de `depoisMs`. Devolve { ep, data } ou null quando a
 * regra acabou (único que já passou, ou além do `fim`).
 */
function proximaDepois(regra, depoisMs, fim, tz) {
  const hoje = dataLocal(depoisMs, tz);
  const em = (data) => ({ ep: instanteDe(tz, data, regra.hora), data });
  let c = null;
  if (regra.tipo === 'unico') {
    c = em(regra.data);
    if (c.ep <= depoisMs) c = null;
  } else if (regra.tipo === 'diario') {
    c = em(hoje);
    if (c.ep <= depoisMs) c = em(somaDias(hoje, 1));
  } else if (regra.tipo === 'semanal') {
    const alvo = new Set(regra.dias.map((d) => DIAS.indexOf(d)));
    for (let i = 0; i < 9 && !c; i += 1) {
      const d = somaDias(hoje, i);
      if (alvo.has(diaDaSemana(d))) { const x = em(d); if (x.ep > depoisMs) c = x; }
    }
  } else if (regra.tipo === 'a_cada_n_dias') {
    const k = Math.max(0, Math.floor(diasEntre(regra.inicio, hoje) / regra.n));
    let d = somaDias(regra.inicio, regra.n * k);
    c = em(d);
    while (c.ep <= depoisMs) { d = somaDias(d, regra.n); c = em(d); }
  } else {
    throw new TypeError(`Regra de tipo desconhecido: ${JSON.stringify(regra.tipo)}. Os tipos são: ${TIPOS.join(', ')}.`);
  }
  if (c && fim && c.data > fim) return null;
  return c;
}

// ── texto em português ────────────────────────────────────────────────────────
function junta(itens) {
  return itens.length === 1 ? itens[0] : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function regraEmPortugues(regra, fim) {
  const hora = regra.hora;
  let txt;
  if (regra.tipo === 'unico') txt = `uma vez, em ${dataBr(regra.data)} às ${hora}`;
  else if (regra.tipo === 'diario') txt = `todo dia às ${hora}`;
  else if (regra.tipo === 'semanal') {
    const idx = regra.dias.map((d) => DIAS.indexOf(d)).sort((a, b) => a - b);
    if (idx.length === 7) txt = `todo dia às ${hora}`;
    else if (idx.length === 5 && idx.every((v, i) => v === i)) txt = `de segunda a sexta às ${hora}`;
    else {
      const uteis = idx.filter((i) => i < 5).map((i) => NOMES_DIA[i]);
      const fds = idx.filter((i) => i >= 5).map((i) => NOMES_DIA[i]);
      const partesTxt = [];
      if (uteis.length) partesTxt.push('toda ' + junta(uteis));
      if (fds.length) partesTxt.push('todo ' + junta(fds));
      txt = `${partesTxt.join(' e ')} às ${hora}`;
    }
  } else {
    txt = (regra.n === 1 ? `todo dia às ${hora}` : `a cada ${regra.n} dias às ${hora}`) + ` (desde ${dataBr(regra.inicio)})`;
  }
  if (fim && regra.tipo !== 'unico') txt += `, até ${dataBr(fim)}`;
  return txt;
}

// ── validação da regra ────────────────────────────────────────────────────────
const veio = (v) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) === undefined ? 'nada' : JSON.stringify(v));
  return s.length <= 60 ? s : s.slice(0, 57) + '...';
};
const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const DIA_POR_NOME = {};
DIAS.forEach((cod, i) => {
  DIA_POR_NOME[cod] = cod;
  DIA_POR_NOME[semAcento(NOMES_DIA[i])] = cod;
  DIA_POR_NOME[semAcento(NOMES_DIA[i]) + '-feira'] = cod;
});

function validaData(campo, v, erros) {
  if (typeof v !== 'string' || !RX_DATA.test(v)) {
    erros[campo] = `veio ${veio(v)}, use o formato "AAAA-MM-DD" (ex.: "2026-10-20")`;
    return null;
  }
  if (!dataExiste(v)) { erros[campo] = `veio ${veio(v)}, que não é uma data que existe no calendário`; return null; }
  return v;
}

/** Devolve { regra, erros }. `erros` é { 'regra.campo': motivo }. */
function validaRegra(r) {
  const erros = {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return { regra: null, erros: { regra: `veio ${veio(r)}, mande um objeto como ${EXEMPLO_REGRA}` } };
  }
  const tipo = r.tipo;
  if (!TIPOS.includes(tipo)) return { regra: null, erros: { 'regra.tipo': `veio ${veio(tipo)}, use um destes: ${TIPOS.join(', ')}` } };
  for (const k of Object.keys(r)) {
    if (CAMPOS_REGRA[tipo].includes(k)) continue;
    const donos = TIPOS.filter((t) => CAMPOS_REGRA[t].includes(k));
    erros[`regra.${k}`] = `não existe na regra "${tipo}"${donos.length ? ` (só em: ${donos.join(', ')})` : ''}. Campos da regra "${tipo}": ${CAMPOS_REGRA[tipo].join(', ')}`;
  }
  const norm = { tipo };
  let hora = r.hora;
  if (typeof hora === 'string' && /^\d:[0-5]\d$/.test(hora)) hora = '0' + hora;
  if (typeof hora !== 'string' || !RX_HORA.test(hora)) {
    erros['regra.hora'] = `veio ${veio(r.hora)}, use "HH:MM" em 24 horas (ex.: "09:00", "21:30")`;
  } else norm.hora = hora;
  if (tipo === 'unico') {
    if (!('data' in r)) erros['regra.data'] = 'faltou. O lembrete único precisa da data: "AAAA-MM-DD"';
    else { const v = validaData('regra.data', r.data, erros); if (v) norm.data = v; }
  } else if (tipo === 'semanal') {
    const dias = r.dias;
    if (!Array.isArray(dias) || !dias.length) {
      erros['regra.dias'] = `veio ${veio(dias)}, use uma lista como ["seg","qua"] (dias: ${DIAS.join(', ')})`;
    } else {
      const cods = []; const ruins = [];
      for (const d of dias) {
        const cod = typeof d === 'string' ? DIA_POR_NOME[semAcento(d)] : null;
        if (cod) cods.push(cod); else ruins.push(d);
      }
      if (ruins.length) erros['regra.dias'] = `não reconheci ${veio(ruins)}. Use os códigos ${DIAS.join(', ')}, numa lista como ["seg","qua"]`;
      else norm.dias = [...new Set(cods)].sort((a, b) => DIAS.indexOf(a) - DIAS.indexOf(b));
    }
  } else if (tipo === 'a_cada_n_dias') {
    const n = r.n;
    if (!Number.isInteger(n) || n < 1 || n > 365) erros['regra.n'] = `veio ${veio(n)}, use um número inteiro de 1 a 365 (de quantos em quantos dias)`;
    else norm.n = n;
    if (!('inicio' in r)) erros['regra.inicio'] = 'faltou. Diga o primeiro dia da contagem: "AAAA-MM-DD" (ex.: hoje)';
    else { const v = validaData('regra.inicio', r.inicio, erros); if (v) norm.inicio = v; }
  }
  return { regra: Object.keys(erros).length ? null : norm, erros };
}

module.exports = {
  DIAS, TIPOS, EXEMPLO_REGRA, RX_HORA,
  erroDoFuso, partes, offsetMin, dataLocal, horaLocal, isoLocal, localParaEpoch, instanteDe,
  somaDias, diasEntre, dataExiste, dataBr, proximaDepois, regraEmPortugues, validaRegra, validaData, veio,
};
