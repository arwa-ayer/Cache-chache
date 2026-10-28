(() => {
  'use strict';
  const app = document.getElementById('app');
  const state = {
    view: null,            // dernier état reçu du serveur
    code: null,
    name: localStorage.getItem('cc-name') || '',
    selected: null,        // objet choisi par le placeur (côté client)
    error: '',
  };
  let ws = null;

  // ---------- connexion temps réel ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'joined') state.code = m.code;
      if (m.type === 'error') state.error = m.message;
      if (m.type === 'state') {
        const prev = state.view;
        if (!prev || prev.phase !== m.state.phase || prev.round !== m.state.round) state.selected = null;
        state.view = m.state;
        state.error = '';
      }
      render();
    };
    ws.onclose = () => {
      state.error = 'Connexion perdue. Recharge la page pour reprendre.';
      render();
    };
  }
  const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  // ---------- petit helper DOM (évite innerHTML : les prénoms sont saisis par les joueurs) ----------
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function readName() {
    const input = document.getElementById('name');
    const n = (input ? input.value : state.name).trim().slice(0, 16);
    if (!n) { state.error = 'Entre ton prénom'; render(); return ''; }
    state.name = n;
    localStorage.setItem('cc-name', n);
    return n;
  }

  const errorBox = () => (state.error ? h('p', { class: 'error' }, state.error) : null);

  // ---------- écrans ----------
  function lobby() {
    const codeInput = h('input', { id: 'code', class: 'code-in', maxlength: 4, placeholder: 'CODE', autocomplete: 'off' });
    return h('section', { class: 'card' },
      h('h1', {}, 'Cache-', h('span', {}, 'cache')),
      h('p', { class: 'lead' }, 'Cache 3 objets mignons, ton ami doit les retrouver. En temps réel, à deux.'),
      h('input', { id: 'name', maxlength: 16, placeholder: 'Ton prénom', value: state.name, autocomplete: 'off' }),
      h('button', { class: 'btn primary wide', onclick: () => { const n = readName(); if (n) send({ type: 'create', name: n }); } },
        'Créer une partie'),
      h('div', { class: 'or' }, 'ou'),
      h('div', { class: 'row' }, codeInput,
        h('button', {
          class: 'btn',
          onclick: () => {
            const n = readName();
            const c = codeInput.value.trim().toUpperCase();
            if (!n) return;
            if (c.length !== 4) { state.error = 'Le code fait 4 caractères'; return render(); }
            send({ type: 'join', name: n, code: c });
          },
        }, 'Rejoindre')),
      errorBox()
    );
  }

  function waiting() {
    return h('section', { class: 'card' },
      h('p', { class: 'lead' }, 'Code de la partie'),
      h('div', { class: 'bigcode' }, state.view.code),
      h('p', { class: 'lead' }, 'Envoie ce code à ton ami(e). La partie démarre dès qu’il ou elle entre.'),
      h('div', { class: 'pulse' }, '● En attente…'),
      h('button', { class: 'btn ghost', onclick: () => navigator.clipboard && navigator.clipboard.writeText(state.view.code) }, 'Copier le code'),
      h('button', { class: 'quit', onclick: () => location.reload() }, 'Quitter')
    );
  }

  function scoreboard(v) {
    return h('header', { class: 'score' },
      h('div', { class: 'who' + (v.you.isPlacer ? ' on' : '') }, h('b', {}, v.you.name), h('span', {}, v.you.score)),
      h('div', { class: 'round' }, `Manche ${v.round}/${v.totalRounds}`),
      h('div', { class: 'who' + (v.opponent && v.opponent.isPlacer ? ' on' : '') },
        h('b', {}, v.opponent ? v.opponent.name : '…'), h('span', {}, v.opponent ? v.opponent.score : 0))
    );
  }

  function board(v) {
    const canPlace = v.phase === 'placing' && v.you.isPlacer && state.selected;
    const canGuess = v.phase === 'guessing' && !v.you.isPlacer;
    const grid = h('div', { class: 'grid' });
    v.cells.forEach((c, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const color = (row + col) % 2 ? 'pink' : 'yellow';
      let onclick = null;
      if (canPlace && c.state === 'hidden') {
        onclick = () => { const e = state.selected; state.selected = null; send({ type: 'place', cell: i, emoji: e }); };
      } else if (canGuess && c.state === 'hidden') {
        onclick = () => send({ type: 'guess', cell: i });
      }
      grid.append(h('button', {
        class: `cell ${color} ${c.state}${c.emoji ? ' has' : ''}${onclick ? ' clickable' : ''}`,
        disabled: !onclick,
        onclick,
      }, c.emoji || ''));
    });
    return grid;
  }

  const info = (text) => h('section', { class: 'panel' }, h('p', { class: 'lead' }, text), h('span', { class: 'live' }, '● en direct'));

  function placingPanel(v) {
    const remaining = v.items - v.used;
    const opts = h('div', { class: 'opts' }, v.options.map(e =>
      h('button', {
        class: 'opt' + (state.selected === e ? ' sel' : ''),
        onclick: () => { state.selected = state.selected === e ? null : e; render(); },
      }, e)));
    return h('section', { class: 'panel' },
      h('p', { class: 'lead' }, state.selected
        ? 'Maintenant touche une case vide pour poser ton objet.'
        : `Choisis un objet mignon (${remaining} à placer)`),
      opts,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { state.selected = null; send({ type: 'reset' }); } }, 'Recommencer'),
        h('button', { class: 'btn primary', disabled: v.used < v.items, onclick: () => send({ type: 'validate' }) }, 'Valider ma cachette')));
  }

  function resultPanel(v, over) {
    const r = v.result;
    const why = r.reason === 'found' ? 'a trouvé les 3 objets.' : 'a fait trop d’erreurs.';
    const next = over
      ? h('button', { class: 'btn primary wide', onclick: () => send({ type: 'restart' }) }, 'Rejouer')
      : h('button', { class: 'btn primary wide', onclick: () => send({ type: 'next' }) }, 'Manche suivante');
    return h('section', { class: 'panel result' },
      h('p', { class: 'big' }, over ? 'Fin de partie' : 'Manche terminée'),
      h('p', { class: 'lead' }, `${r.winner} ${why}`),
      over && h('p', { class: 'big' }, `${v.you.name} ${v.you.score} – ${v.opponent ? v.opponent.score : 0} ${v.opponent ? v.opponent.name : ''}`),
      next);
  }

  function panel(v) {
    if (v.phase === 'placing') {
      return v.you.isPlacer ? placingPanel(v) : info(`${v.placerName} cache ses ${v.items} objets…`);
    }
    if (v.phase === 'guessing') {
      if (v.you.isPlacer) return info(`Ton ami cherche… erreurs ${v.misses}/${v.maxMisses} · trouvés ${v.found}/${v.items}`);
      return info(`Trouve les ${v.items} objets. Erreurs ${v.misses}/${v.maxMisses} · trouvés ${v.found}/${v.items}`);
    }
    if (v.phase === 'roundEnd') return resultPanel(v, false);
    if (v.phase === 'over') return resultPanel(v, true);
    return null;
  }

  function game(v) {
    return h('div', { class: 'game' },
      scoreboard(v),
      board(v),
      panel(v),
      errorBox(),
      h('button', { class: 'quit', onclick: () => location.reload() }, 'Quitter'));
  }

  function render() {
    app.replaceChildren();
    if (!state.view) { app.append(lobby()); return; }
    const v = state.view;
    app.append(v.phase === 'waiting' ? waiting() : game(v));
    if (v.phase === 'waiting' && state.error) app.append(errorBox());
  }

  connect();
  render();
})();
