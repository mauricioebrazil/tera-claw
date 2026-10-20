// skills.js: a aba Skills. Mostra o que o agente sabe fazer, uma skill por cartão.
//
// A lista vem de /api/skills, que lê as pastas do disco (ver lib/skills.js). Usa fetch próprio
// em vez do API.get porque aquele devolve null no erro e o MOTIVO que o servidor mandou
// precisa chegar na pessoa. Cartão fechado mostra ~2 linhas; tocar abre a descrição inteira e a
// pasta onde a skill fica salva (a resposta de "onde fica salvo isso?").
(function () {
  const BASE = window.TERACLAW_BASE || '';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  async function carregar() {
    const raiz = document.getElementById('skills-root');
    if (!raiz) return;
    let res;
    try {
      res = await fetch(BASE + '/api/skills');
    } catch (e) {
      raiz.innerHTML = `<div class="vazio-util">Não alcancei o painel: ${esc(e.message)}. Confira a internet e tente de novo.</div>`;
      return;
    }
    if (res.status === 401) { window.location = BASE + '/login.html'; return; }
    let corpo = {};
    try { corpo = await res.json(); } catch { /* sem json */ }
    if (!res.ok) {
      raiz.innerHTML = `<div class="vazio-util">${esc(corpo.error || 'Não consegui listar as skills.')} ${esc(corpo.howToFix || '')}</div>`;
      return;
    }
    desenhar(raiz, corpo.skills || [], corpo.pastas || []);
  }

  function desenhar(raiz, skills, pastas) {
    const principal = pastas[0] ? pastas[0].caminho : '';
    const n = skills.length;
    let html = `<div class="sk-topo"><div class="sk-contador"><b>${n}</b> ${n === 1 ? 'skill' : 'skills'}</div>`
      + `<div class="sk-onde">ficam salvas em <code>${esc(principal)}</code>`
      + (pastas.length > 1 ? ' e em mais ' + (pastas.length - 1) + (pastas.length - 1 === 1 ? ' pasta' : ' pastas') : '') + '</div></div>';
    const semPasta = pastas.filter((p) => !p.existe);
    if (semPasta.length) {
      html += '<div class="vazio-util sk-aviso">Procurei e não achei: '
        + semPasta.map((p) => `<code>${esc(p.caminho)}</code>${p.erro ? ' (' + esc(p.erro) + ')' : ''}`).join(', ')
        + '. A pasta aparece quando a primeira skill é criada.</div>';
    }
    if (!n) {
      html += '<div class="vazio-util convite">Este agente ainda não tem nenhuma skill. Peça a ele na Conversa, '
        + 'por exemplo: <b>"cria uma skill que monta o meu resumo semanal"</b>. Ela aparece aqui.</div>';
    } else {
      html += '<div class="sk-grade">' + skills.map((s, i) => `
        <article class="sk-cartao${s.erro ? ' sk-erro' : ''}" data-i="${i}">
          <button type="button" class="sk-cab" aria-expanded="false">
            <span class="sk-nome">${esc(s.nome)}</span>
            <span class="sk-desc">${esc(s.descricao || 'sem descrição')}</span>
          </button>
          <div class="sk-detalhe" hidden>
            <div class="sk-desc-inteira">${esc(s.descricao || 'sem descrição')}</div>
            ${s.erro ? `<div class="sk-msg-erro">${esc(s.erro)}</div>` : ''}
            <div class="sk-pasta">Fica salva em <code>${esc(s.pasta)}</code></div>
          </div>
        </article>`).join('') + '</div>';
    }
    raiz.innerHTML = html;
    raiz.querySelectorAll('.sk-cab').forEach((b) => b.addEventListener('click', () => {
      const cartao = b.closest('.sk-cartao');
      const det = cartao.querySelector('.sk-detalhe');
      const abrir = det.hidden;
      det.hidden = !abrir;
      cartao.classList.toggle('aberto', abrir);
      b.setAttribute('aria-expanded', String(abrir));
    }));
  }

  window.DGSkills = { carregar };
})();
