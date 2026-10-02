/* ============================================================================
 *  Wiki Duel — serveur Express + Socket.io
 *
 *  Deux jeux :
 *   - Duel : a chaque manche, 2 pages Wikipedia ; chaque joueur choisit celle qui
 *            "marquera le plus le monde". Pas de score : on revele les choix de
 *            tous, plus les vues mensuelles des pages. Version Monde ou France.
 *   - Tier list : les 50 personnalites francaises les plus connues, classees
 *            seul, sans limite de temps, puis enregistrees dans l'historique.
 *
 *  Les pages viennent de data/*.json (construits par scripts/build-data.js,
 *  uniquement des pages a 20000+ vues/mois).
 * ========================================================================== */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const store = require('./lib/store');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const MIN_VIEWS = 20000;

function loadPool(name) {
  try {
    const items = JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
    return items.filter((it) => it.views >= MIN_VIEWS);
  } catch (e) {
    console.warn('Liste manquante : data/' + name + '.json (lance `npm run build-data`)');
    return [];
  }
}

const POOLS = { world: loadPool('world'), france: loadPool('france') };
const TIERLIST_ITEMS = loadPool('tierlist');
const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

// --- Utilitaires ---------------------------------------------------------------

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
}

const wikiUrl = (title) => 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- API : tier list ------------------------------------------------------------

app.get('/api/tierlist/items', (req, res) => {
  res.json({
    tiers: TIERS,
    items: TIERLIST_ITEMS.map((it) => ({ id: it.id, title: it.title, desc: it.desc, img: it.img, url: wikiUrl(it.title) }))
  });
});

app.get('/api/tierlists', async (req, res) => {
  try {
    res.json({ persistent: store.useSupabase, tierlists: await store.list(100) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Historique indisponible.' });
  }
});

const postLog = new Map(); // ip -> timestamps
function tooMany(ip) {
  const now = Date.now();
  const recent = (postLog.get(ip) || []).filter((t) => now - t < 3600e3);
  recent.push(now);
  postLog.set(ip, recent);
  return recent.length > 20;
}

app.post('/api/tierlists', async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Trop de tier lists, reessaie plus tard.' });
  const name = cleanName(req.body && req.body.name);
  const input = req.body && req.body.tiers;
  if (!name) return res.status(400).json({ error: 'Pseudo manquant.' });
  if (!input || typeof input !== 'object') return res.status(400).json({ error: 'Tier list invalide.' });

  const byId = new Map(TIERLIST_ITEMS.map((it) => [it.id, it]));
  const seen = new Set();
  const tiers = {};
  for (const tier of TIERS) {
    const ids = Array.isArray(input[tier]) ? input[tier] : [];
    tiers[tier] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item || seen.has(id)) return res.status(400).json({ error: 'Tier list invalide.' });
      seen.add(id);
      tiers[tier].push({ id: item.id, t: item.title });
    }
  }
  if (seen.size !== TIERLIST_ITEMS.length) return res.status(400).json({ error: 'Il faut classer toutes les personnalites.' });

  try {
    res.json({ ok: true, entry: await store.add(name, tiers) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Impossible d\'enregistrer pour le moment.' });
  }
});

// --- Duel : salons ----------------------------------------------------------------

const MAX_PLAYERS = 8;
const ROUND_CHOICES = [5, 10, 15];

/** @type {Map<string, any>} */
const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

const validPlayerId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

function publicItem(it) {
  return { id: it.id, title: it.title, desc: it.desc, img: it.img, type: it.type, url: wikiUrl(it.title) };
}

// Vue d'un salon pour un joueur donne (le client se redessine entierement depuis ca).
function snapshot(room, playerId) {
  const snap = {
    code: room.code,
    pool: room.pool,
    rounds: room.rounds,
    hostId: room.hostId,
    me: playerId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    state: room.state,
    phase: room.phase,
    index: room.index,
    round: null,
    recap: null
  };
  if (room.state === 'playing') {
    const cur = room.history[room.index];
    const reveal = room.phase === 'reveal';
    snap.round = {
      options: cur.pair.map((it) => (reveal ? Object.assign(publicItem(it), { views: it.views }) : publicItem(it))),
      myChoice: cur.choices[playerId] === undefined ? null : cur.choices[playerId],
      answered: Object.keys(cur.choices),
      choices: reveal ? cur.choices : null
    };
  }
  if (room.state === 'ended') snap.recap = buildRecap(room);
  return snap;
}

function buildRecap(room) {
  const rounds = room.history.map((h) => ({
    options: h.pair.map((it) => Object.assign(publicItem(it), { views: it.views })),
    choices: h.choices
  }));
  // Pourcentage d'accord entre chaque paire de joueurs (pas de score : juste de quoi debattre).
  const agreements = [];
  for (let i = 0; i < room.players.length; i++) {
    for (let j = i + 1; j < room.players.length; j++) {
      const a = room.players[i], b = room.players[j];
      let both = 0, same = 0;
      for (const h of room.history) {
        if (h.choices[a.id] !== undefined && h.choices[b.id] !== undefined) {
          both++;
          if (h.choices[a.id] === h.choices[b.id]) same++;
        }
      }
      if (both) agreements.push({ a: a.id, b: b.id, percent: Math.round((same / both) * 100) });
    }
  }
  return { rounds, agreements };
}

function broadcast(room) {
  room.updatedAt = Date.now();
  for (const p of room.players) {
    if (p.socketId && p.connected) io.to(p.socketId).emit('state', snapshot(room, p.id));
  }
}

// Revele la manche si tous les joueurs connectes ont repondu.
function maybeReveal(room) {
  if (room.state !== 'playing' || room.phase !== 'picking') return;
  const cur = room.history[room.index];
  const connected = room.players.filter((p) => p.connected);
  if (connected.length && connected.every((p) => cur.choices[p.id] !== undefined)) room.phase = 'reveal';
}

function startGame(room) {
  const pool = shuffle(POOLS[room.pool]);
  room.history = [];
  for (let i = 0; i < room.rounds; i++) room.history.push({ pair: [pool[2 * i], pool[2 * i + 1]], choices: {} });
  room.index = 0;
  room.state = 'playing';
  room.phase = 'picking';
}

function findRoomOf(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return {};
  const player = room.players.find((p) => p.id === socket.data.playerId);
  return player ? { room, player } : {};
}

function attach(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
}

io.on('connection', (socket) => {

  socket.on('room:create', ({ name, playerId }, cb) => {
    name = cleanName(name);
    if (!name || !validPlayerId(playerId)) return cb({ ok: false, error: 'Pseudo invalide.' });
    if (POOLS.world.length < 30 || POOLS.france.length < 30) {
      return cb({ ok: false, error: 'Les listes de pages ne sont pas encore construites sur le serveur.' });
    }
    const room = {
      code: makeRoomCode(), pool: 'world', rounds: 10, hostId: playerId,
      players: [{ id: playerId, name, socketId: socket.id, connected: true }],
      state: 'lobby', phase: 'picking', index: 0, history: [], updatedAt: Date.now()
    };
    rooms.set(room.code, room);
    attach(socket, room, room.players[0]);
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('room:join', ({ name, playerId, code }, cb) => {
    name = cleanName(name);
    code = String(code || '').toUpperCase().trim();
    if (!name || !validPlayerId(playerId)) return cb({ ok: false, error: 'Pseudo invalide.' });
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Salon introuvable.' });
    let player = room.players.find((p) => p.id === playerId);
    if (!player) {
      if (room.state === 'playing') return cb({ ok: false, error: 'Partie deja en cours.' });
      if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Salon complet.' });
      player = { id: playerId, name, socketId: socket.id, connected: true };
      room.players.push(player);
    }
    attach(socket, room, player);
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  // Retour apres un rechargement de page / une coupure reseau.
  socket.on('room:rejoin', ({ playerId, code }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room && validPlayerId(playerId) && room.players.find((p) => p.id === playerId);
    if (!player) return cb({ ok: false });
    attach(socket, room, player);
    if (!room.players.some((p) => p.id === room.hostId && p.connected)) room.hostId = player.id;
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  // L'hote regle le jeu (Monde / France, nombre de manches) dans le salon.
  socket.on('room:settings', ({ pool, rounds }) => {
    const { room, player } = findRoomOf(socket);
    if (!room || player.id !== room.hostId || room.state !== 'lobby') return;
    if (pool === 'world' || pool === 'france') room.pool = pool;
    if (ROUND_CHOICES.includes(rounds)) room.rounds = rounds;
    broadcast(room);
  });

  socket.on('game:start', () => {
    const { room, player } = findRoomOf(socket);
    if (!room || player.id !== room.hostId || room.state !== 'lobby') return;
    if (room.players.filter((p) => p.connected).length < 2) return;
    startGame(room);
    broadcast(room);
  });

  socket.on('duel:pick', ({ choice }) => {
    const { room, player } = findRoomOf(socket);
    if (!room || room.state !== 'playing' || room.phase !== 'picking') return;
    if (choice !== 0 && choice !== 1) return;
    const cur = room.history[room.index];
    if (cur.choices[player.id] !== undefined) return; // choix definitif
    cur.choices[player.id] = choice;
    maybeReveal(room);
    broadcast(room);
  });

  socket.on('duel:next', () => {
    const { room, player } = findRoomOf(socket);
    if (!room || player.id !== room.hostId || room.state !== 'playing' || room.phase !== 'reveal') return;
    if (room.index + 1 >= room.rounds) {
      room.state = 'ended';
    } else {
      room.index += 1;
      room.phase = 'picking';
      maybeReveal(room);
    }
    broadcast(room);
  });

  // Rejouer : tout le monde revient au salon, meme code.
  socket.on('room:rematch', () => {
    const { room, player } = findRoomOf(socket);
    if (!room || player.id !== room.hostId || room.state !== 'ended') return;
    room.state = 'lobby';
    room.history = [];
    room.index = 0;
    broadcast(room);
  });

  socket.on('room:leave', () => {
    const { room, player } = findRoomOf(socket);
    if (!room) return;
    socket.leave(room.code);
    socket.data.roomCode = null;
    leave(room, player, true);
  });

  socket.on('disconnect', () => {
    const { room, player } = findRoomOf(socket);
    if (!room || player.socketId !== socket.id) return;
    leave(room, player, false);
  });
});

// Un joueur quitte (definitivement) ou se deconnecte (il pourra revenir).
function leave(room, player, forever) {
  player.connected = false;
  player.socketId = null;
  if (forever && room.state === 'lobby') room.players = room.players.filter((p) => p.id !== player.id);
  if (room.hostId === player.id) {
    const next = room.players.find((p) => p.connected);
    if (next) room.hostId = next.id;
  }
  maybeReveal(room);
  if (room.players.some((p) => p.connected)) broadcast(room);
  else room.updatedAt = Date.now();
}

// Nettoyage des salons abandonnes.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players.some((p) => p.connected) && now - room.updatedAt > 30 * 60e3) rooms.delete(code);
  }
}, 5 * 60e3).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Wiki Duel en ecoute sur le port ' + PORT +
    ' (monde: ' + POOLS.world.length + ' pages, france: ' + POOLS.france.length + ', tier list: ' + TIERLIST_ITEMS.length + ')');
  console.log('Historique : ' + (store.useSupabase ? 'Supabase' : 'fichier local (non permanent)'));
});
