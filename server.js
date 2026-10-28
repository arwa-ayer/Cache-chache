'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const GRID = 12;        // 4 colonnes x 3 lignes
const ITEMS = 3;        // objets cachés par manche
const MAX_MISSES = 6;   // erreurs autorisées au devineur
const ROUNDS = 4;       // manches au total (chaque joueur cache 2 fois)
const OPTIONS = 8;      // objets mignons proposés à chaque choix
const CUTE = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🐸', '🐥', '🦋', '🐞', '🐙', '🍓',
  '🍒', '🍉', '🍭', '🍩', '🧁', '🍄', '🌸', '🌻', '🌈', '⭐', '🎀', '🧸', '🎈', '💎',
  '🍑', '🦄', '🍬', '🌙'];

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
  return {
    code, players: [], phase: 'waiting', round: 0, placerIdx: 0,
    board: [], revealed: [], used: [], options: [], misses: 0, found: 0, result: null,
  };
}

function resetBoard(room) {
  room.board = Array(GRID).fill(null);
  room.revealed = Array(GRID).fill(null);
  room.used = [];
  room.misses = 0;
  room.found = 0;
  room.options = pickOptions([]);
}

function startRound(room) {
  room.phase = 'placing';
  room.placerIdx = (room.round - 1) % 2;
  room.result = null;
  resetBoard(room);
}

function endRound(room, winner, reason) {
  winner.score++;
  room.result = { winner: winner.name, reason, round: room.round };
  room.phase = room.round >= ROUNDS ? 'over' : 'roundEnd';
}

// Vue propre à chaque joueur : le placeur voit ses objets, le devineur ne voit que ce qu'il a découvert
function cellsFor(room, isPlacer) {
  const ended = room.phase === 'roundEnd' || room.phase === 'over';
  return Array.from({ length: GRID }, (_, i) => {
    const emoji = room.board[i];
    const rev = room.revealed[i];
    if (ended) return { emoji, state: emoji ? 'item' : rev === 'miss' ? 'miss' : 'empty' };
    if (isPlacer) return { emoji, state: rev || (emoji ? 'mine' : 'hidden') };
    if (rev === 'hit') return { emoji, state: 'hit' };
    if (rev === 'miss') return { emoji: null, state: 'miss' };
    return { emoji: null, state: 'hidden' };
  });
}

function viewFor(room, p) {
  const placer = room.players[room.placerIdx];
  const isPlacer = !!placer && placer.id === p.id;
  const opp = room.players.find(x => x.id !== p.id) || null;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: ROUNDS,
    items: ITEMS,
    you: { name: p.name, score: p.score, isPlacer },
    opponent: opp ? { name: opp.name, score: opp.score, isPlacer: !isPlacer } : null,
    placerName: placer ? placer.name : null,
    cells: room.phase === 'waiting' ? null : cellsFor(room, isPlacer),
    used: room.used.length,
    options: isPlacer && room.phase === 'placing' ? room.options : [],
    misses: room.misses,
    maxMisses: MAX_MISSES,
    found: room.found,
    result: room.result,
  };
}

function broadcast(room) {
  for (const p of room.players) send(p.ws, { type: 'state', state: viewFor(room, p) });
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
  room.players.push({ id: crypto.randomUUID(), name, ws, score: 0 });
  ws.roomCode = room.code;
  send(ws, { type: 'joined', code: room.code });
  if (room.players.length === 2) {
    room.round = 1;
    room.players.forEach(p => { p.score = 0; });
    startRound(room);
  }
  broadcast(room);
}

function handleAction(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.find(x => x.ws === ws);
  if (!p) return;
  const placer = room.players[room.placerIdx];
  const isPlacer = !!placer && placer.ws === ws;

  switch (msg.type) {
    case 'place': {
      if (!(room.phase === 'placing' && isPlacer)) break;
      const { cell, emoji } = msg;
      if (!Number.isInteger(cell) || cell < 0 || cell >= GRID || room.board[cell]) break;
      if (!room.options.includes(emoji) || room.used.length >= ITEMS) break;
      room.board[cell] = emoji;
      room.used.push(emoji);
      room.options = room.used.length < ITEMS ? pickOptions(room.used) : [];
      break;
    }
    case 'reset':
      if (room.phase === 'placing' && isPlacer) resetBoard(room);
      break;
    case 'validate':
      if (room.phase === 'placing' && isPlacer && room.used.length === ITEMS) {
        room.phase = 'guessing';
        room.options = [];
      }
      break;
    case 'guess': {
      if (room.phase !== 'guessing' || isPlacer) break;
      const { cell } = msg;
      if (!Number.isInteger(cell) || cell < 0 || cell >= GRID || room.revealed[cell]) break;
      if (room.board[cell]) { room.revealed[cell] = 'hit'; room.found++; }
      else { room.revealed[cell] = 'miss'; room.misses++; }
      if (room.found === ITEMS) endRound(room, p, 'found');
      else if (room.misses >= MAX_MISSES) endRound(room, placer, 'misses');
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

function leave(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.players = room.players.filter(p => p.ws !== ws);
  if (room.players.length === 0) { rooms.delete(room.code); return; }
  room.phase = 'waiting';
  room.round = 0;
  room.board = [];
  room.revealed = [];
  room.used = [];
  room.options = [];
  room.misses = 0;
  room.found = 0;
  room.result = null;
  room.players.forEach(p => { p.score = 0; });
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
    handleAction(ws, msg);
  });
  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => console.log(`Cache-cache sur le port ${PORT}`));
