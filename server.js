'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const GRID = 12;        // 4 colonnes x 3 lignes
const ITEMS = 3;        // objets cachés par joueur et par manche
const MAX_MISSES = 6;   // erreurs autorisées pendant la devinette
const ROUNDS = 4;       // manches au total
const OPTIONS = 8;      // objets mignons proposés à chaque choix
const CUTE = ['cherry', 'star', 'heart', 'moon', 'mushroom', 'cactus', 'diamond', 'drop',
  'leaf', 'planet', 'house', 'flower', 'bear', 'cat', 'egg', 'cloud'];

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const rooms = new Map();

// ---------- HTTP (fichiers statiques) ----------
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const urlPath = req.url.split('?')[0];
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- utilitaires ----------
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const fail = (ws, message) => send(ws, { type: 'error', message });
const cleanName = s => String(s || '').trim().slice(0, 16);
const shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};
const pickOptions = used => shuffle(CUTE.filter(e => !used.includes(e))).slice(0, OPTIONS);

function newCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => alpha[crypto.randomInt(alpha.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newRoom(code) {
  return { code, players: [], phase: 'waiting', round: 0, result: null, bot: false, botTimer: null, turn: 0 };
}

// Chaque joueur a sa propre grille cachée (board) et ses propres devinettes (guesses) sur l'autre grille
function resetPlayer(p) {
  p.board = Array(GRID).fill(null);
  p.used = [];
  p.options = pickOptions([]);
  p.validated = false;
  p.guesses = Array(GRID).fill(null);  // null | 'hit' | 'miss'
  p.found = 0;     // objets de l'adversaire trouvés
  p.misses = 0;    // erreurs
  p.done = false;  // plus de devinette possible (3 trouvés ou erreurs épuisées)
}

const BOT_NAME = "L'ordi 🤖";

function startRound(room) {
  room.phase = 'placing';
  room.result = null;
  room.players.forEach(resetPlayer);
  room.players.forEach(p => { if (p.bot) botPlace(p); });
}

// L'ordi cache 3 objets au hasard sur sa grille
function botPlace(bot) {
  const cells = shuffle(Array.from({ length: GRID }, (_, i) => i)).slice(0, ITEMS);
  const emojis = pickOptions([]).slice(0, ITEMS);
  cells.forEach((c, k) => { bot.board[c] = emojis[k]; });
  bot.used = [...emojis];
  bot.options = [];
  bot.validated = true;
}

// Une devinette (joueur ou ordi), puis le tour passe à l'adversaire (sauf s'il a épuisé ses erreurs)
function doGuess(room, me, opp, cell) {
  if (room.phase !== 'guessing' || me.done || me.guesses[cell]) return;
  if (room.players[room.turn] !== me) return;
  if (opp.board[cell]) { me.guesses[cell] = 'hit'; me.found++; }
  else { me.guesses[cell] = 'miss'; me.misses++; }
  if (me.found === ITEMS) return endRound(room, me, 'found');
  if (me.misses >= MAX_MISSES) {
    me.done = true;
    if (opp.done) return endRound(room, null, 'draw');
  }
  room.turn = room.players.indexOf(opp.done ? me : opp);
}

// L'ordi devine une case toutes les 1,4 à 3 secondes
function kickBot(room) {
  if (!room.bot || room.botTimer || room.phase !== 'guessing') return;
  const bot = room.players.find(p => p.bot);
  const human = room.players.find(p => !p.bot);
  if (!bot || !human || bot.done || room.players[room.turn] !== bot) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.phase !== 'guessing' || bot.done || room.players[room.turn] !== bot) return;
    const hidden = Array.from({ length: GRID }, (_, i) => i).filter(i => !bot.guesses[i]);
    if (hidden.length) doGuess(room, bot, human, hidden[crypto.randomInt(hidden.length)]);
    broadcast(room);
  }, 1200 + Math.random() * 1000);
}

function endRound(room, winner, reason) {
  if (winner) winner.score++;
  room.result = { winner: winner ? winner.name : null, reason, round: room.round };
  room.phase = room.round >= ROUNDS ? 'over' : 'roundEnd';
}

// Cellules de la grille d'un joueur (sa cachette)
// États d'une case de MA grille : caché, mon objet, trouvé par l'ordi, erreur de l'ordi, vide révélé, objet non trouvé
function ownCells(room, me, opp) {
  const ended = room.phase === 'roundEnd' || room.phase === 'over';
  return Array.from({ length: GRID }, (_, i) => {
    const emoji = me.board[i];
    const rev = opp.guesses[i];
    if (emoji && rev === 'hit') return { emoji, state: 'found_by_opp' };
    if (rev === 'miss') return { emoji: null, state: 'opp_miss' };
    if (ended) return { emoji, state: emoji ? 'item' : 'empty' };
    return { emoji, state: emoji ? 'mine' : 'hidden' };
  });
}

// Cellules de la grille de l'adversaire, vues depuis moi (mes devinettes)
// États d'une case de LA grille de l'adversaire : caché, trouvé par moi, mon erreur, vide révélé, objet non trouvé
function targetCells(room, me, opp) {
  const ended = room.phase === 'roundEnd' || room.phase === 'over';
  return Array.from({ length: GRID }, (_, i) => {
    const rev = me.guesses[i];
    const emoji = opp.board[i];
    if (rev === 'hit') return { emoji, state: 'found_by_me' };
    if (rev === 'miss') return { emoji: null, state: 'my_miss' };
    if (ended) return { emoji, state: emoji ? 'item' : 'empty' };
    return { emoji: null, state: 'hidden' };
  });
}

function viewFor(room, me) {
  const opp = room.players.find(x => x !== me) || null;
  const ready = room.phase !== 'waiting' && room.players.length === 2;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: ROUNDS,
    items: ITEMS,
    maxMisses: MAX_MISSES,
    you: {
      name: me.name, score: me.score, validated: me.validated, used: me.used.length,
      found: me.found, misses: me.misses, done: me.done,
      turn: room.phase === 'guessing' && room.players[room.turn] === me,
    },
    opponent: opp ? {
      name: opp.name, score: opp.score, validated: opp.validated,
      found: opp.found, misses: opp.misses, done: opp.done,
      turn: room.phase === 'guessing' && room.players[room.turn] === opp,
    } : null,
    options: ready && room.phase === 'placing' && !me.validated ? me.options : [],
    myCells: ready ? ownCells(room, me, opp) : null,
    targetCells: ready && opp && room.phase !== 'placing' ? targetCells(room, me, opp) : null,
    result: room.result,
  };
}

function broadcast(room) {
  for (const p of room.players) if (!p.bot) send(p.ws, { type: 'state', state: viewFor(room, p) });
  kickBot(room);
}

// ---------- logique de salle ----------
function handleJoin(ws, msg, create) {
  if (ws.roomCode) return fail(ws, 'Tu es déjà dans une partie');
  const name = cleanName(msg.name);
  if (!name) return fail(ws, 'Entre ton prénom');
  let room;
  if (create) {
    room = newRoom(newCode());
    rooms.set(room.code, room);
  } else {
    room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return fail(ws, 'Partie introuvable');
    if (room.players.length >= 2) return fail(ws, 'Partie déjà complète');
  }
  const p = { id: crypto.randomUUID(), name, ws, score: 0 };
  resetPlayer(p);
  room.players.push(p);
  ws.roomCode = room.code;
  send(ws, { type: 'joined', code: room.code });
  if (room.players.length === 2) {
    room.round = 1;
    room.players.forEach(x => { x.score = 0; });
    startRound(room);
  }
  broadcast(room);
}

function handleAction(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.phase === 'waiting') return;
  const me = room.players.find(x => x.ws === ws);
  if (!me) return;
  const opp = room.players.find(x => x !== me);

  switch (msg.type) {
    case 'place': {
      if (room.phase !== 'placing' || me.validated) break;
      const { cell, emoji } = msg;
      if (!Number.isInteger(cell) || cell < 0 || cell >= GRID || me.board[cell]) break;
      if (!me.options.includes(emoji) || me.used.length >= ITEMS) break;
      me.board[cell] = emoji;
      me.used.push(emoji);
      me.options = me.used.length < ITEMS ? pickOptions(me.used) : [];
      break;
    }
    case 'reset':
      if (room.phase === 'placing' && !me.validated) {
        me.board = Array(GRID).fill(null);
        me.used = [];
        me.options = pickOptions([]);
      }
      break;
    case 'validate':
      if (room.phase === 'placing' && !me.validated && me.used.length === ITEMS) {
        me.validated = true;
        me.options = [];
        if (room.players.every(x => x.validated)) {
          room.phase = 'guessing';
          room.turn = (room.round - 1) % 2;   // la manche 1 commence par le 1er joueur, puis on alterne
        }
      }
      break;
    case 'guess': {
      const { cell } = msg;
      if (room.players[room.turn] !== me) break;
      if (Number.isInteger(cell) && cell >= 0 && cell < GRID) doGuess(room, me, opp, cell);
      break;
    }
    case 'next':
      if (room.phase === 'roundEnd') { room.round++; startRound(room); }
      break;
    case 'restart':
      if (room.phase === 'over' && room.players.length === 2) {
        room.round = 1;
        room.players.forEach(x => { x.score = 0; });
        startRound(room);
      }
      break;
  }
  broadcast(room);
}

function handleSolo(ws, msg) {
  if (ws.roomCode) return fail(ws, 'Tu es déjà dans une partie');
  const name = cleanName(msg.name);
  if (!name) return fail(ws, 'Entre ton prénom');
  const room = newRoom(newCode());
  room.bot = true;
  rooms.set(room.code, room);
  const me = { id: crypto.randomUUID(), name, ws, score: 0, bot: false };
  const bot = { id: crypto.randomUUID(), name: BOT_NAME, ws: null, score: 0, bot: true };
  resetPlayer(me);
  resetPlayer(bot);
  room.players.push(me, bot);
  ws.roomCode = room.code;
  send(ws, { type: 'joined', code: room.code });
  room.round = 1;
  startRound(room);
  broadcast(room);
}

function leave(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.players = room.players.filter(p => p.ws !== ws);
  if (!room.players.some(p => !p.bot)) {
    clearTimeout(room.botTimer);
    rooms.delete(room.code);
    return;
  }
  room.phase = 'waiting';
  room.round = 0;
  room.result = null;
  room.turn = 0;
  room.players.forEach(p => { p.score = 0; resetPlayer(p); });
  broadcast(room);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'create') return handleJoin(ws, msg, true);
    if (msg.type === 'join') return handleJoin(ws, msg, false);
    if (msg.type === 'solo') return handleSolo(ws, msg);
    handleAction(ws, msg);
  });
  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => console.log(`Cache-cache sur le port ${PORT}`));
