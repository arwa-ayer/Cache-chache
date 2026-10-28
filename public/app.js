(() => {
  'use strict';
  const app = document.getElementById('app');
  const state = {
    view: null,            // dernier état reçu du serveur
    code: null,
    name: localStorage.getItem('cc-name') || '',
    selected: null,        // objet choisi pour la cachette (côté client)
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

  // ---------- helper DOM (évite innerHTML : les prénoms viennent des joueurs) ----------
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

  // Objet low-poly (SVG généré par objects.js, aucun texte saisi par un joueur ici)
  const objNode = id => { const s = h('span', { class: 'obj' }); s.innerHTML = window.OBJ_SVG(id); return s; };

  const errorBox = () => (state.error ? h('p', { class: 'error' }, state.error) : null);

  // ---------- écrans d'entrée ----------
  function lobby() {
    const codeInput = h('input', { id: 'code', class: 'code-in', maxlength: 4, placeholder: 'CODE', autocomplete: 'off' });
    return h('section', { class: 'card' },
      h('h1', {}, 'Cache-', h('span', {}, 'cache')),
      h('p', { class: 'lead' }, 'Chacun cache 3 objets mignons et cherche ceux de l’autre. En même temps, en temps réel.'),
      h('input', { id: 'name', maxlength: 16, placeholder: 'Ton prénom', value: state.name, autocomplete: 'off' }),
      h('button', { class: 'btn primary wide', onclick: () => { const n = readName(); if (n) send({ type: 'create', name: n }); } },
        'Créer une partie'),
      h('button', { class: 'btn ghost wide', onclick: () => { const n = readName(); if (n) send({ type: 'solo', name: n }); } },
        'Jouer contre l’ordi'),
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

  // ---------- écran de jeu ----------
  function scoreboard(v) {
    return h('header', { class: 'score' },
      h('div', { class: 'who on' }, h('b', {}, v.you.name), h('span', {}, v.you.score)),
      h('div', { class: 'round' }, `Manche ${v.round}/${v.totalRounds}`),
      h('div', { class: 'who' }, h('b', {}, v.opponent ? v.opponent.name : '…'), h('span', {}, v.opponent ? v.opponent.score : 0)));
  }

  // Une grille de 12 cartes. onCell(i) est appelé au clic si la case est active.
  function grid(cells, { small = false, onCell = null, isClickable = () => false } = {}) {
    const g = h('div', { class: 'grid' + (small ? ' small' : '') });
    cells.forEach((c, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const color = (row + col) % 2 ? 'sand' : 'sage';
      const active = onCell && isClickable(c, i);
      const content = c.emoji ? objNode(c.emoji) : null;
      g.append(h('button', {
        class: `cell ${color} ${c.state}${c.emoji ? ' has' : ''}${active ? ' clickable' : ''}`,
        disabled: !active,
        onclick: active ? () => onCell(i) : null,
      }, content));
    });
    return g;
  }

  const info = (text, live = false) => h('section', { class: 'panel' },
    h('p', { class: 'lead' }, text),
    live ? h('span', { class: 'live' }, '● en direct') : null);

  function placingPanel(v) {
    const me = v.you;
    if (me.validated) {
      return info(v.opponent && v.opponent.validated
        ? 'Les deux cachettes sont prêtes…'
        : 'Ta cachette est prête. Ton ami finit de placer ses objets…', true);
    }
    const remaining = v.items - me.used;
    const opts = h('div', { class: 'opts' }, v.options.map(e =>
      h('button', {
        class: 'opt' + (state.selected === e ? ' sel' : ''),
        onclick: () => { state.selected = state.selected === e ? null : e; render(); },
      }, objNode(e))));
    return h('section', { class: 'panel' },
      h('p', { class: 'lead' }, remaining === 0
        ? 'Tes 3 objets sont posés. Vérifie puis valide.'
        : state.selected
          ? 'Touche une case vide de TA grille pour poser ton objet.'
          : `Choisis un objet mignon (${remaining} à placer)`),
      opts,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { state.selected = null; send({ type: 'reset' }); } }, 'Recommencer'),
        h('button', { class: 'btn primary', disabled: me.used < v.items, onclick: () => send({ type: 'validate' }) }, 'Valider')));
  }

  function guessingPanel(v) {
    const me = v.you, opp = v.opponent;
    if (me.done) {
      return info(`Tu as épuisé tes ${v.maxMisses} erreurs. On attend la fin de la manche…`, true);
    }
    return info(`Trouve les ${v.items} objets de ${opp ? opp.name : 'ton ami'}. Erreurs ${me.misses}/${v.maxMisses} · trouvés ${me.found}/${v.items}`
      + (opp ? ` · ${opp.name} : ${opp.found}/${v.items}` : ''), true);
  }

  function resultPanel(v, over) {
    const r = v.result || {};
    let title;
    if (!r.winner) title = 'Manche nulle';
    else if (r.winner === v.you.name) title = 'Tu gagnes la manche !';
    else title = `${r.winner} gagne la manche`;
    const why = r.reason === 'found' ? 'Les 3 objets ont été trouvés.'
      : r.reason === 'draw' ? 'Les deux joueurs ont épuisé leurs erreurs.' : '';
    const next = over
      ? h('button', { class: 'btn primary wide', onclick: () => send({ type: 'restart' }) }, 'Rejouer')
      : h('button', { class: 'btn primary wide', onclick: () => send({ type: 'next' }) }, 'Manche suivante');
    return h('section', { class: 'panel result' },
      h('p', { class: 'big' }, over ? 'Fin de partie' : title),
      h('p', { class: 'lead' }, why),
      over && h('p', { class: 'big' }, `${v.you.name} ${v.you.score} – ${v.opponent ? v.opponent.score : 0} ${v.opponent ? v.opponent.name : ''}`),
      next);
  }

  function game(v) {
    const ended = v.phase === 'roundEnd' || v.phase === 'over';
    const children = [scoreboard(v)];

    if (v.phase === 'placing') {
      children.push(h('p', { class: 'label' }, 'Ta cachette'));
      children.push(grid(v.myCells, {
        onCell: i => { const e = state.selected; state.selected = null; send({ type: 'place', cell: i, emoji: e }); },
        isClickable: (c) => !v.you.validated && state.selected && c.state === 'hidden',
      }));
      children.push(placingPanel(v));
    } else if (v.phase === 'guessing') {
      children.push(h('p', { class: 'label' }, `Grille de ${v.opponent ? v.opponent.name : 'ton ami'}`));
      children.push(grid(v.targetCells, {
        onCell: i => send({ type: 'guess', cell: i }),
        isClickable: (c) => !v.you.done && c.state === 'hidden',
      }));
      children.push(h('p', { class: 'label small-label' }, 'Ta cachette'));
      children.push(grid(v.myCells, { small: true }));
      children.push(guessingPanel(v));
    } else if (ended) {
      children.push(h('p', { class: 'label' }, `Grille de ${v.opponent ? v.opponent.name : 'ton ami'}`));
      children.push(grid(v.targetCells, { }));
      children.push(h('p', { class: 'label small-label' }, 'Ta cachette'));
      children.push(grid(v.myCells, { small: true }));
      children.push(resultPanel(v, v.phase === 'over'));
    }

    children.push(errorBox());
    children.push(h('button', { class: 'quit', onclick: () => location.reload() }, 'Quitter'));
    return h('div', { class: 'game' }, ...children);
  }

  function render() {
    app.replaceChildren();
    if (!state.view) { app.append(lobby()); return; }
    const v = state.view;
    app.append(v.phase === 'waiting' ? waiting() : game(v));
  }

  connect();
  render();
})();
