(() => {
  'use strict';
  const app = document.getElementById('app');
  const state = {
    view: null,            // dernier état reçu du serveur
    code: null,
    name: localStorage.getItem('cc-name') || '',
    selected: null,        // objet choisi pour la cachette (côté client)
    error: '',
    feedback: null,        // message court après une action : { kind, text }
    freshMiss: null,       // case ratée à l'instant (animation du cœur brisé)
  };
  let ws = null;
  let root = null;         // conteneur du jeu
  const slots = {};        // zones mises à jour séparément
  const keys = {};         // signature de chaque zone : on ne la reconstruit que si elle change

  // ---------- connexion temps réel ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'joined') state.code = m.code;
      if (m.type === 'error') state.error = m.message;
      if (m.type === 'state') onState(m.state);
      render();
    };
    ws.onclose = () => {
      state.error = 'Connexion perdue. Recharge la page pour reprendre.';
      render();
    };
  }
  const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  // ---------- état et retours ----------
  function onState(next) {
    const prev = state.view;
    const sameRound = prev && prev.round === next.round && prev.phase === next.phase;
    if (!sameRound) { state.selected = null; state.feedback = null; state.freshMiss = null; }
    if (sameRound && next.phase === 'guessing' && prev) {
      state.freshMiss = next.targetCells.findIndex((c, i) => c.state === 'my_miss' && prev.targetCells[i].state === 'hidden');
      if (state.freshMiss < 0) state.freshMiss = null;
      if (!prev.you.done && next.you.done) showFx();
    }
    if (sameRound && next.phase === 'placing' && next.you.used > prev.you.used) {
      state.feedback = { kind: 'info', text: `Objet posé (${next.you.used}/${next.items}).` };
    }
    if (sameRound && next.phase === 'guessing') {
      state.feedback = diffFeedback(prev, next) || state.feedback;
    }
    state.view = next;
    state.error = '';
  }

  function diffFeedback(p, n) {
    if (n.you.found > p.you.found) {
      const left = n.items - n.you.found;
      return { kind: 'ok', text: left ? `Touché ! Il te reste ${left} objet${left > 1 ? 's' : ''} à trouver.` : 'Les 3 objets sont trouvés !' };
    }
    if (n.you.misses > p.you.misses) {
      const left = n.maxMisses - n.you.misses;
      return { kind: 'ko', text: `Raté. Il te reste ${left} erreur${left > 1 ? 's' : ''}.` };
    }
    if (n.opponent && p.opponent && !p.opponent.done && n.opponent.done) {
      return { kind: 'warn', text: `${n.opponent.name} a épuisé ses erreurs : tu joues seul jusqu’à ses 3 objets ou tes erreurs.` };
    }
    if (n.opponent && p.opponent && n.opponent.found > p.opponent.found) {
      return { kind: 'warn', text: `${n.opponent.name} a trouvé un objet (${n.opponent.found}/${n.items}).` };
    }
    return null;
  }

  // ---------- helper DOM (les prénoms viennent des joueurs : on n'utilise jamais innerHTML pour du texte) ----------
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
  // Cœur brisé : deux moitiés qui s'écartent et une fissure (les animations sont dans style.css)
  const HEART = 'M32 56 C10 40 6 28 6 20 C6 11 13 6 20 6 C26 6 30 10 32 14 C34 10 38 6 44 6 C51 6 58 11 58 20 C58 28 54 40 32 56 Z';
  let heartId = 0;
  function brokenHeart(cls) {
    const id = 'hc' + (heartId++);
    const s = h('span', { class: 'bheart ' + cls });
    s.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
      <clipPath id="${id}l"><rect x="0" y="0" width="31.5" height="64"/></clipPath>
      <clipPath id="${id}r"><rect x="32.5" y="0" width="31.5" height="64"/></clipPath></defs>
      <g class="hl"><path clip-path="url(#${id}l)" d="${HEART}" fill="#d1785a"/></g>
      <g class="hr"><path clip-path="url(#${id}r)" d="${HEART}" fill="#a8583b"/></g>
      <path class="crack" d="M32.5 14 L28 24 L36 32 L29 42 L33.5 52" stroke="#fffdf9" stroke-width="2.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    return s;
  }
  // Cœur brisé plein écran, quand un joueur a épuisé ses erreurs
  function showFx() {
    const fx = document.getElementById('fx');
    if (!fx) return;
    fx.replaceChildren(brokenHeart('big'), h('p', { class: 'fx-text' }, 'Plus d’erreurs'));
    fx.classList.remove('on');
    void fx.offsetWidth;
    fx.classList.add('on');
  }

  // Objet low-poly : SVG fixe généré par objects.js
  const objNode = id => { const s = h('span', { class: 'obj' }); s.innerHTML = window.OBJ_SVG(id); return s; };

  function readName() {
    const input = document.getElementById('name');
    const n = (input ? input.value : state.name).trim().slice(0, 16);
    if (!n) { state.error = 'Entre ton prénom'; render(); return ''; }
    state.name = n;
    localStorage.setItem('cc-name', n);
    return n;
  }

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

  // ---------- grille : chaque état a une couleur ET une icône ----------
  const CELL_STATES = {
    hidden:       { label: 'Caché, pas encore joué', badge: '' },
    mine:         { label: 'Ton objet, pas encore trouvé', badge: '' },
    found_by_opp: { label: 'Objet trouvé par l’ordi', badge: '●', cls: 'b-opp' },
    opp_miss:     { label: 'Case vide jouée par l’ordi', badge: '−', cls: 'b-oppmiss' },
    found_by_me:  { label: 'Objet trouvé par toi', badge: '✓', cls: 'b-me' },
    my_miss:      { label: 'Case vide jouée par toi', badge: '✕', cls: 'b-mymiss' },
    empty:        { label: 'Case vide, révélée à la fin', badge: '○', cls: 'b-empty' },
    item:         { label: 'Objet non trouvé', badge: '' },
  };

  // Une grille de 12 cartes. onCell(i) est appelé au clic, seulement sur les cases cachées.
  function grid(cells, { small = false, onCell = null, fresh = null } = {}) {
    const g = h('div', { class: 'grid' + (small ? ' small' : '') });
    cells.forEach((c, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const tone = (row + col) % 2 ? 'sand' : 'sage';
      const active = !!onCell && c.state === 'hidden';
      const isFresh = fresh === i;
      const meta = CELL_STATES[c.state] || CELL_STATES.hidden;
      const content = [
        isFresh ? brokenHeart('mini') : c.emoji ? objNode(c.emoji) : null,
        meta.badge ? h('span', { class: 'badge ' + (meta.cls || ''), 'aria-hidden': 'true' }, meta.badge) : null,
      ];
      g.append(h('button', {
        class: `cell ${tone} st-${c.state}${c.emoji ? ' has' : ''}${active ? ' clickable' : ''}${isFresh ? ' fresh' : ''}`,
        disabled: !active,
        'aria-label': meta.label,
        onclick: active ? () => onCell(i) : null,
      }, content));
    });
    return g;
  }

  // ---------- compteurs : cercle = trouvé (✓), carré = erreur (✕), la forme aide autant que la couleur ----------
  function tally(n, total, kind, small = false) {
    const wrap = h('span', { class: 'tl ' + kind + (small ? ' sm' : '') });
    for (let i = 0; i < total; i++) {
      const on = i < n;
      const mark = on ? (kind === 'found' ? '✓' : '✕') : '';
      wrap.append(h('i', { class: on ? 'on' : '' }, mark));
    }
    return wrap;
  }
  function tallyRow(name, found, misses, v, small = false) {
    return h('div', { class: 'trow' + (small ? ' sm' : '') },
      h('span', { class: 'tname' }, name),
      tally(found, v.items, 'found', small),
      tally(misses, v.maxMisses, 'err', small));
  }

  // ---------- bandeau : une ligne d'état + une ligne de retour ----------
  function statusBlock(v) {
    const opp = v.opponent;
    const oppName = opp ? opp.name : 'ton ami';
    let title, text;
    if (v.phase === 'placing') {
      if (v.you.validated) { title = 'Cachette validée'; text = opp && opp.validated ? 'Les deux sont prêts' : `${oppName} place encore ses objets`; }
      else if (v.you.used < v.items && !state.selected) { title = 'Étape 1', text = 'choisis un objet'; }
      else if (v.you.used < v.items) { title = 'Étape 2', text = 'touche une case vide de ta grille'; }
      else { title = 'Étape 3', text = 'vérifie puis valide'; }
    } else if (v.phase === 'guessing') {
      if (v.you.done) {
        title = 'Tes erreurs sont épuisées';
        text = opp && !opp.done ? `${oppName} continue à chercher` : '';
      } else if (v.you.turn) {
        title = 'À toi de jouer';
        text = `trouve les objets de ${oppName}`;
      } else {
        title = `Tour de ${oppName}`;
        text = 'attends ton tour';
      }
    } else {
      title = 'Fin de manche';
      text = 'les cachettes sont révélées';
    }
    return h('div', { class: 'status', role: 'status', 'aria-live': 'polite' },
      h('b', {}, title), text ? h('span', { class: 'hint' }, ' · ' + text) : null);
  }

  function feedbackLine(v) {
    if (!state.feedback || (v.phase !== 'guessing' && v.phase !== 'placing')) return h('div', { class: 'fb-empty' });
    return h('div', { class: 'fb ' + state.feedback.kind }, state.feedback.text);
  }

  // ---------- panneau d'action ----------
  function placingPanel(v) {
    if (v.you.validated) return null;
    const remaining = v.items - v.you.used;
    const opts = v.options.length ? h('div', { class: 'opts' }, v.options.map(e =>
      h('button', {
        class: 'opt' + (state.selected === e ? ' sel' : ''),
        onclick: () => { state.selected = state.selected === e ? null : e; render(); },
      }, objNode(e)))) : null;
    return h('section', { class: 'panel' },
      h('p', { class: 'lead' }, remaining === 0 ? 'Tes 3 objets sont posés.' : state.selected ? `Objet choisi : touche une case vide de ta grille.` : `Choisis un objet (${remaining} à poser)`),
      opts,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { state.selected = null; send({ type: 'reset' }); } }, 'Recommencer'),
        h('button', { class: 'btn primary', disabled: v.you.used < v.items, onclick: () => send({ type: 'validate' }) }, 'Valider')));
  }

  function resultPanel(v, over) {
    const r = v.result || {};
    let title;
    if (!r.winner) title = 'Manche nulle';
    else if (r.winner === v.you.name) title = 'Tu gagnes la manche !';
    else title = `${r.winner} gagne la manche`;
    const why = r.reason === 'found' ? 'Les 3 objets ont été trouvés en premier.'
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

  // ---------- écran de jeu : chaque zone n'est reconstruite que si elle change ----------
  function buildRoot() {
    root = h('div', { class: 'game' });
    for (const name of ['score', 'guide', 'main', 'tally', 'side', 'panel', 'foot']) {
      slots[name] = h('div', { class: 'slot-' + name });
      root.append(slots[name]);
      keys[name] = null;
    }
    slots.foot.replaceChildren(h('button', { class: 'quit', onclick: () => location.reload() }, 'Quitter'));
  }

  function put(name, key, build) {
    if (keys[name] === key) return;
    keys[name] = key;
    const el = build();
    if (name === 'layer') { slots.layer = el; return; }
    el.classList.add('slot-' + name);
    slots[name].replaceWith(el);
    slots[name] = el;
  }

  const oppName = opp => (opp ? opp.name : 'ton ami');

  function scoreboard(v) {
    const turnOn = v.phase === 'guessing';
    return h('header', { class: 'score' },
      h('div', { class: 'who' + (turnOn && v.you.turn ? ' on' : '') }, h('b', {}, v.you.name), h('span', {}, v.you.score)),
      h('div', { class: 'round' }, `Manche ${v.round}/${v.totalRounds}`),
      h('div', { class: 'who' + (turnOn && v.opponent && v.opponent.turn ? ' on' : '') },
        h('b', {}, v.opponent ? v.opponent.name : '…'), h('span', {}, v.opponent ? v.opponent.score : 0)));
  }

  function updateGame(v) {
    const ended = v.phase === 'roundEnd' || v.phase === 'over';
    const opp = v.opponent;

    put('score', JSON.stringify([v.you.name, v.you.score, opp && opp.name, opp && opp.score, v.round, v.you.turn, opp && opp.turn, v.phase]),
      () => scoreboard(v));

    put('guide', JSON.stringify([v.phase, v.you.turn, v.you.used, v.you.validated, v.you.found, v.you.misses, v.you.done,
      opp && [opp.found, opp.misses, opp.validated, opp.done], state.feedback && state.feedback.text, state.selected]),
      () => h('div', { class: 'guidebox' }, statusBlock(v), feedbackLine(v)));

    put('tally', JSON.stringify([v.phase, v.you.found, v.you.misses, opp && opp.found, opp && opp.misses]), () => (v.phase === 'placing'
      ? h('div', { class: 'tally-none' })
      : h('div', { class: 'tallies' },
        tallyRow('Toi', v.you.found, v.you.misses, v),
        opp ? tallyRow(oppName(opp), opp.found, opp.misses, v, true) : null)));

    // Grille principale : ta cachette pendant le placement, la grille de l'ami pendant la devinette
    const placing = v.phase === 'placing';
    const cells = placing ? v.myCells : v.targetCells;
    const interactive = placing ? (!v.you.validated && !!state.selected)
      : v.phase === 'guessing' ? (v.you.turn && !v.you.done) : false;
    const onCell = interactive
      ? (i => placing
        ? (() => { const e = state.selected; state.selected = null; send({ type: 'place', cell: i, emoji: e }); })()
        : send({ type: 'guess', cell: i }))
      : null;
    const fresh = placing ? null : state.freshMiss;
    put('main', JSON.stringify([v.phase, interactive, v.you.turn, state.selected, cells, v.you.validated, fresh]), () => h('div', { class: 'zone' },
      h('p', { class: 'label' }, placing ? 'Ta cachette' : `La grille de ${oppName(opp)}`),
      grid(cells, { onCell, fresh })));

    // Petite grille : ta cachette, visible pendant la devinette et à la fin
    const showSide = v.phase === 'guessing' || ended;
    put('side', JSON.stringify([showSide, showSide && v.myCells]), () => showSide
      ? h('div', { class: 'zone' }, h('p', { class: 'label small-label' }, 'Ta cachette'), grid(v.myCells, { small: true }))
      : h('div', {}));

    let panel = null;
    if (v.phase === 'placing') panel = placingPanel(v);
    put('panel', JSON.stringify([v.phase, v.round, v.you.used, v.you.validated, state.selected, v.options]),
      () => panel || h('div', {}));

    // Fin de manche : fenêtre centrée au-dessus du jeu, sans scroll
    const layer = document.getElementById('result-layer');
    if (ended && layer) {
      put('layer', JSON.stringify([v.phase, v.round, v.result && v.result.winner, v.result && v.result.reason, v.you.score, v.opponent && v.opponent.score]),
        () => h('div', { class: 'rlayer-box' }, resultPanel(v, v.phase === 'over')));
      layer.replaceChildren(slots.layer);
      layer.hidden = false;
    } else if (layer) {
      layer.hidden = true;
      layer.replaceChildren();
      keys.layer = null;
    }

    put('foot', JSON.stringify([state.error]), () => h('div', { class: 'foot' }, errorBox()));
  }

  function render() {
    app.classList.toggle('in-game', !!state.view && state.view.phase !== 'waiting');
    if (!state.view) { root = null; app.replaceChildren(lobby()); return; }
    if (state.view.phase === 'waiting') { root = null; app.replaceChildren(waiting()); return; }
    if (!root || !app.contains(root)) {
      buildRoot();
      app.replaceChildren(root);
    }
    updateGame(state.view);
  }

  connect();
  render();
})();
