/* ============================================================================
 *  Sudoku Duel — serveur Express + Socket.io
 *
 *  Deux modes de jeu :
 *   - 'classic' : sudoku 9x9, en manches (best-of 1 ou 3). Le premier a finir
 *                 la grille remporte la manche.
 *   - 'rapid'   : "Jeux rapides". Une sequence de N grilles (3 ou 5) tirees au
 *                 sort parmi les jeux choisis (sans repetition immediate). Tous
 *                 les joueurs recoivent la meme sequence et les memes grilles ;
 *                 le premier a terminer toute la sequence gagne.
 *
 *  Erreurs : gerees cote client (blocage d'ecran + decompte). Le serveur ne
 *  relaie que la progression (0..1) pour les barres, et l'ordre d'arrivee.
 *
 *  De 2 a 5 joueurs par salon. Fin de partie -> retour au salon pour rejouer.
 * ========================================================================== */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Games = require('./public/games.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const MAX_PLAYERS = 5;

/** @type {Map<string, Room>} */
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

function publicPlayers(room) {
  return room.players.map((p) => ({
    id: p.id, name: p.name, score: p.score, connected: p.connected
  }));
}

// Retire les infos sensibles selon le jeu (solution non envoyee pour les jeux
// sans penalite, ou la validation se fait par regles cote client).
function sanitizeGrid(grid) {
  const g = Object.assign({}, grid);
  if (g.type === 'tango') delete g.solution;
  if (g.type === 'zip') delete g.solutionPath;
  return g;
}

// Construit une sequence de `target` grilles pour le mode rapide.
function buildSequence(games, target) {
  const pool = (games && games.length) ? games.slice() : Games.RAPID_GAMES.slice();
  const seq = [];
  let last = null;
  for (let i = 0; i < target; i++) {
    let choices = pool.filter((g) => g !== last);
    if (!choices.length) choices = pool.slice();
    const gid = choices[Math.floor(Math.random() * choices.length)];
    last = gid;
    const grid = Games.generate(gid, {});
    if (grid) seq.push({ gameId: gid, grid });
  }
  return seq;
}

function resetRoundState(room) {
  room.players.forEach((p) => { p.progress = 0; p.done = false; });
  room.finishOrder = [];
  room.resolved = false;
}

// Demarre une partie (ou la manche suivante en classique).
function startMatch(room, isNextRound) {
  resetRoundState(room);

  if (room.mode === 'rapid') {
    room.round = 1;
    room.sequence = buildSequence(room.config.games, room.config.target);
  } else {
    room.round = isNextRound ? room.round + 1 : 1;
    const grid = Games.generate('sudoku9', { difficulty: room.config.difficulty });
    room.sequence = [{ gameId: 'sudoku9', grid }];
  }

  const payload = {
    mode: room.mode,
    round: room.round,
    target: room.mode === 'rapid' ? room.config.target : (room.config.bestOf === 3 ? 2 : 1),
    sequence: room.sequence.map((s) => ({ gameId: s.gameId, grid: sanitizeGrid(s.grid) })),
    players: publicPlayers(room)
  };

  room.state = 'countdown';
  // Decompte de 3s uniquement au debut du match (pas entre les manches).
  if (isNextRound) {
    room.state = 'playing';
    io.to(room.code).emit('play:start', payload);
  } else {
    io.to(room.code).emit('countdown', { seconds: 3 });
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      room.state = 'playing';
      io.to(room.code).emit('play:start', payload);
    }, 3000);
  }
}

function endMatch(room, winnerId) {
  room.state = 'matchend';
  io.to(room.code).emit('match:end', {
    winnerId,
    players: publicPlayers(room)
  });
}

io.on('connection', (socket) => {

  socket.on('room:create', ({ name, mode, config }, cb) => {
    const code = makeRoomCode();
    mode = mode === 'rapid' ? 'rapid' : 'classic';
    const safeConfig = mode === 'rapid'
      ? {
          target: config && config.target === 5 ? 5 : 3,
          games: (config && Array.isArray(config.games) && config.games.length)
            ? config.games.filter((g) => Games.RAPID_GAMES.indexOf(g) >= 0)
            : Games.RAPID_GAMES.slice()
        }
      : {
          difficulty: (config && config.difficulty) || 'moyen',
          bestOf: config && config.bestOf === 3 ? 3 : 1
        };
    if (mode === 'rapid' && !safeConfig.games.length) safeConfig.games = Games.RAPID_GAMES.slice();

    const room = {
      code, mode, config: safeConfig,
      players: [{ id: socket.id, name: (name || 'Joueur 1').slice(0, 16), score: 0, connected: true, progress: 0, done: false }],
      hostId: socket.id,
      state: 'lobby',
      round: 0, sequence: [], finishOrder: [], resolved: false
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code, mode, config: safeConfig, hostId: room.hostId, players: publicPlayers(room) });
  });

  socket.on('room:join', ({ name, code }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Salon introuvable.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Salon complet (5 max).' });
    if (room.state !== 'lobby' && room.state !== 'matchend') return cb({ ok: false, error: 'Partie en cours.' });

    room.players.push({
      id: socket.id, name: (name || ('Joueur ' + (room.players.length + 1))).slice(0, 16),
      score: 0, connected: true, progress: 0, done: false
    });
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code, mode: room.mode, config: room.config, hostId: room.hostId, players: publicPlayers(room) });
    io.to(code).emit('room:update', { players: publicPlayers(room), hostId: room.hostId });
  });

  // L'hote lance la partie.
  socket.on('game:start', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.length < 2) return;
    if (room.state !== 'lobby' && room.state !== 'matchend') return;
    startMatch(room, false);
  });

  // Progression globale (0..1) relayee aux autres pour les barres.
  socket.on('progress', ({ value }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === socket.id);
    if (p) p.progress = Math.max(0, Math.min(1, value || 0));
    socket.to(room.code).emit('opponent:progress', { id: socket.id, value: p ? p.progress : 0 });
  });

  // Classique : un joueur a fini la grille de la manche -> il gagne la manche.
  socket.on('round:done', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.mode !== 'classic' || room.resolved || room.state !== 'playing') return;
    room.resolved = true;
    const winner = room.players.find((p) => p.id === socket.id);
    if (winner) winner.score += 1;

    const target = room.config.bestOf === 3 ? 2 : 1;
    const matchOver = winner && winner.score >= target;

    room.state = matchOver ? 'matchend' : 'roundend';
    io.to(room.code).emit('round:result', {
      winnerId: socket.id,
      players: publicPlayers(room),
      round: room.round,
      matchOver: !!matchOver
    });
    if (matchOver) endMatch(room, socket.id);
  });

  // Classique : l'hote enchaine la manche suivante.
  socket.on('round:next', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.id !== room.hostId || room.mode !== 'classic') return;
    if (room.state !== 'roundend') return;
    startMatch(room, true);
  });

  // Rapide : un joueur a termine toute la sequence -> il gagne le match.
  socket.on('match:done', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.mode !== 'rapid' || room.resolved || room.state !== 'playing') return;
    room.resolved = true;
    const winner = room.players.find((p) => p.id === socket.id);
    if (winner) winner.score += 1;
    endMatch(room, socket.id);
  });

  // Rejouer : retour de tout le monde au salon avec le meme code.
  socket.on('room:rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.id !== room.hostId) return;
    room.state = 'lobby';
    room.round = 0;
    room.sequence = [];
    room.players.forEach((p) => { p.score = 0; p.progress = 0; p.done = false; });
    io.to(room.code).emit('room:return', {
      players: publicPlayers(room), mode: room.mode, config: room.config, hostId: room.hostId
    });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (player) player.connected = false;
    socket.to(room.code).emit('opponent:left', { id: socket.id });

    // Tous deconnectes -> on supprime le salon.
    if (room.players.every((p) => !p.connected)) {
      rooms.delete(room.code);
      return;
    }
    // Reattribution de l'hote si besoin.
    if (room.hostId === socket.id) {
      const next = room.players.find((p) => p.connected);
      if (next) room.hostId = next.id;
    }
    io.to(room.code).emit('room:update', { players: publicPlayers(room), hostId: room.hostId });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sudoku Duel en ecoute sur le port ${PORT}`);
});
