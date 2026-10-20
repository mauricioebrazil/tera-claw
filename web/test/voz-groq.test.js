'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarVoz } = require('../lib/voz');

const log = () => {};

test('microfone fica ligado só com GROQ_API_KEY e a mensagem cita a chave', () => {
  assert.equal(criarVoz({ env: {}, log }).microfone, false);
  const v = criarVoz({ env: { GROQ_API_KEY: 'gsk_teste' }, log });
  assert.equal(v.microfone, true);
  assert.equal(v.vozDoAgente({ voz: 'x' }), false);
  assert.match(criarVoz({ env: {}, log }).semChaveMic, /GROQ_API_KEY/);
});

test('transcrever com Groq: URL, modelo, idioma, Authorization e User-Agent próprio', async () => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url, init) => { chamadas.push({ url, init }); return { ok: true, json: async () => ({ text: ' olá mundo ' }) }; };
  try {
    const v = criarVoz({ env: { GROQ_API_KEY: 'gsk_teste', OPENAI_API_KEY: 'sk-x' }, log });
    const r = await v.transcrever(Buffer.from('audio'), 'a.webm', 'audio/webm');
    assert.deepEqual(r, { texto: 'olá mundo' });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(chamadas[0].init.headers.Authorization, 'Bearer gsk_teste');
    assert.equal(chamadas[0].init.headers['User-Agent'], 'TeraClaw/1.0');
    assert.equal(chamadas[0].init.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(chamadas[0].init.body.get('language'), 'pt');
  } finally { global.fetch = original; }
});

test('ElevenLabs continua na frente da Groq', async () => {
  const original = global.fetch;
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return { ok: true, json: async () => ({ text: 'oi' }) }; };
  try {
    await criarVoz({ env: { GROQ_API_KEY: 'g', ELEVENLABS_API_KEY: 'e' }, log }).transcrever(Buffer.from('a'), 'a.webm', 'audio/webm');
    assert.match(urls[0], /elevenlabs/);
  } finally { global.fetch = original; }
});
