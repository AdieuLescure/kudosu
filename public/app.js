/* ============================================================================
 *  Sudoku Duel — logique client
 *  Gere la navigation, les salons multijoueurs (2 a 5), et un moteur de jeu
 *  generique qui enchaine des grilles (1 en classique, 3 ou 5 en jeux rapides)
 *  via un controleur dedie par type de jeu.
 * ========================================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ---------------------------------------------------------------------------
  //  Config & preferences
  // ---------------------------------------------------------------------------
  var ACCENTS = ['#5b8cff', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

  var config = {
    name: '',
    theme: localStorage.getItem('sd_theme') || 'sombre',
    accent: localStorage.getItem('sd_accent') || ACCENTS[0],
    mode: 'classic',
    // classique
    difficulty: 'moyen',
    bestOf: 1,
    // rapide
    target: 3,
    games: ['queens', 'tango', 'zip', 'sudoku6']
  };

  function applyTheme() {
    document.body.setAttribute('data-theme', config.theme);
    document.documentElement.style.setProperty('--accent', config.accent);
  }
  applyTheme();

  $('#btn-theme').addEventListener('click', function () {
    config.theme = config.theme === 'sombre' ? 'clair' : 'sombre';
    localStorage.setItem('sd_theme', config.theme);
    applyTheme();
  });
  $('#btn-accent').addEventListener('click', function () {
    var i = ACCENTS.indexOf(config.accent);
    config.accent = ACCENTS[(i + 1) % ACCENTS.length];
    localStorage.setItem('sd_accent', config.accent);
    applyTheme();
  });

  $('#pseudo').addEventListener('input', function (e) { config.name = e.target.value.trim(); });

  // ---------------------------------------------------------------------------
  //  Navigation
  // ---------------------------------------------------------------------------
  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () { resetAll(); show('screen-home'); });
  });
  function ensureName() {
    if (!config.name) { config.name = 'Joueur'; $('#pseudo').value = 'Joueur'; }
    return config.name;
  }

  // Choix de categorie
  $('#cat-classic').addEventListener('click', function () { config.mode = 'classic'; show('screen-config-classic'); });
  $('#cat-rapid').addEventListener('click', function () { config.mode = 'rapid'; show('screen-config-rapid'); });

  // Segmented controls
  function setupSegmented(id, key, cast) {
    var group = document.getElementById(id);
    if (!group) return;
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg');
      if (!btn) return;
      group.querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var v = btn.getAttribute('data-value');
      config[key] = cast ? cast(v) : v;
    });
  }
  setupSegmented('difficulty', 'difficulty');
  setupSegmented('bestof', 'bestOf', function (v) { return parseInt(v, 10); });
  setupSegmented('target', 'target', function (v) { return parseInt(v, 10); });

  // Toggles des jeux (rapide)
  $('#game-toggles').addEventListener('click', function (e) {
    var btn = e.target.closest('.game-toggle');
    if (!btn) return;
    btn.classList.toggle('active');
    config.games = $$('#game-toggles .game-toggle.active').map(function (b) { return b.getAttribute('data-game'); });
  });

  // ---------------------------------------------------------------------------
  //  Etat reseau
  // ---------------------------------------------------------------------------
  var socket = null;
  var roomCode = null;
  var myId = null;
  var isHost = false;
  var hostId = null;
  var players = [];
  var roomMode = 'classic';
  var roomConfig = {};

  function connectSocket() {
    if (socket) return socket;
    socket = io();
    socket.on('connect', function () { myId = socket.id; });

    socket.on('room:update', function (d) { players = d.players; hostId = d.hostId; isHost = (d.hostId === myId); renderLobby(); });

    socket.on('countdown', function (d) { runCountdown(d.seconds || 3); });

    socket.on('play:start', function (d) { startMatch(d); });

    socket.on('opponent:progress', function (d) {
      if (!engine) return;
      engine.progressById[d.id] = d.value;
      renderBars();
    });

    socket.on('round:result', function (d) {
      players = d.players;
      showRoundResult(d);
    });

    socket.on('match:end', function (d) {
      players = d.players;
      showMatchEnd(d);
    });

    socket.on('room:return', function (d) {
      players = d.players; roomMode = d.mode; roomConfig = d.config; hostId = d.hostId; isHost = (d.hostId === myId);
      stopEngine();
      hideOverlay();
      renderLobby();
      show('screen-lobby');
    });

    socket.on('opponent:left', function () { toast('Un joueur a quitte le salon.'); });
    return socket;
  }

  function buildCreateConfig() {
    return config.mode === 'rapid'
      ? { target: config.target, games: config.games }
      : { difficulty: config.difficulty, bestOf: config.bestOf };
  }

  // Creer un salon
  $$('.create-from').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ensureName();
      config.mode = btn.getAttribute('data-mode');
      if (config.mode === 'rapid' && !config.games.length) { toast('Choisis au moins un jeu.'); return; }
      connectSocket();
      socket.emit('room:create', { name: config.name, mode: config.mode, config: buildCreateConfig() }, function (res) {
        if (!res.ok) { toast(res.error || 'Erreur'); return; }
        roomCode = res.code; players = res.players; isHost = true; hostId = res.hostId;
        roomMode = res.mode; roomConfig = res.config;
        $('#room-code').textContent = res.code;
        renderLobby(); show('screen-lobby');
      });
    });
  });

  // Rejoindre un salon
  $('#btn-join').addEventListener('click', function () {
    var code = $('#join-code').value.toUpperCase().trim();
    if (code.length < 4) { toast('Entre un code de salon.'); return; }
    ensureName();
    connectSocket();
    socket.emit('room:join', { name: config.name, code: code }, function (res) {
      if (!res.ok) { toast(res.error || 'Erreur'); return; }
      roomCode = res.code; players = res.players; hostId = res.hostId; isHost = (res.hostId === myId);
      roomMode = res.mode; roomConfig = res.config;
      $('#room-code').textContent = res.code;
      renderLobby(); show('screen-lobby');
    });
  });
  $('#join-code').addEventListener('input', function (e) {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('#btn-copy').addEventListener('click', function () {
    var code = roomCode || '';
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast('Code copie !'); });
    else toast('Code : ' + code);
  });

  $('#btn-launch').addEventListener('click', function () { if (isHost) socket.emit('game:start'); });

  // ---------------------------------------------------------------------------
  //  Lobby
  // ---------------------------------------------------------------------------
  function modeLabel() {
    if (roomMode === 'rapid') {
      var names = (roomConfig.games || []).map(function (g) { return GAME_LABEL[g] || g; }).join(', ');
      return 'Jeux rapides · premier a finir ' + roomConfig.target + ' grilles · ' + names;
    }
    var diff = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert' }[roomConfig.difficulty] || roomConfig.difficulty;
    return 'Sudoku · ' + diff + ' · ' + (roomConfig.bestOf === 3 ? 'Premier a 2 manches' : '1 manche');
  }

  function renderLobby() {
    $('#lobby-mode').textContent = modeLabel();
    var box = $('#lobby-players');
    box.innerHTML = '';
    players.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'lobby-player';
      row.innerHTML = '<span class="dot ' + (p.connected ? '' : 'off') + '"></span>' +
        '<span>' + escapeHtml(p.name) + '</span>' +
        (p.id === myId ? '<span class="you-badge">vous</span>' : '') +
        (p.id === hostId ? '<span class="host-badge">hote</span>' : '');
      box.appendChild(row);
    });
    var ready = players.length >= 2;
    $('#lobby-info').textContent = ready
      ? (isHost ? 'Tout le monde est la ? Lance la partie !' : "En attente du lancement par l'hote...")
      : 'En attente de joueurs (2 a 5)... Partage le code.';
    var launch = $('#btn-launch');
    launch.disabled = !(ready && isHost);
    launch.style.display = isHost ? 'block' : 'none';
  }

  // ===========================================================================
  //  MOTEUR DE JEU
  // ===========================================================================
  var GAME_LABEL = { sudoku9: 'Sudoku', sudoku6: 'Sudoku 6×6', queens: 'Queens', tango: 'Tango', zip: 'Zip' };

  var engine = null; // etat de la partie en cours
  var boardEl = $('#board');

  function startMatch(d) {
    stopEngine();
    hideOverlay();
    engine = {
      mode: d.mode,
      sequence: d.sequence,
      total: d.sequence.length,
      target: d.target,
      round: d.round,
      index: 0,
      blocked: false,
      finished: false,
      startTime: Date.now(),
      progressById: {},
      ctrl: null,
      timer: null
    };
    players = d.players || players;
    show('screen-game');
    startTimer();
    loadGrid(0);
    renderBars();
  }

  function stopEngine() {
    if (engine) {
      if (engine.ctrl && engine.ctrl.destroy) engine.ctrl.destroy();
      stopTimer();
      if (engine._blockTO) clearInterval(engine._blockTO);
    }
    engine = null;
    $('#block-overlay').classList.remove('show');
    $('#countdown-overlay').classList.remove('show');
  }

  function loadGrid(idx) {
    engine.index = idx;
    if (engine.ctrl && engine.ctrl.destroy) engine.ctrl.destroy();
    var item = engine.sequence[idx];
    var grid = item.grid;
    $('#round-pill').textContent = engine.mode === 'rapid'
      ? (GAME_LABEL[item.gameId] + ' · ' + (idx + 1) + '/' + engine.total)
      : ('Manche ' + engine.round);
    var ctx = makeCtx(grid);
    engine.ctrl = GAME_CTRL[item.gameId](grid, ctx);
    engine.ctrl.render();
    setLead('En cours...', '');
  }

  // Contexte fourni a chaque controleur
  function makeCtx(grid) {
    return {
      board: boardEl,
      penalty: grid.penalty || 0,
      isInteractive: function () { return engine && !engine.blocked && !engine.finished; },
      reportProgress: function (frac) {
        engine.gridFrac = Math.max(0, Math.min(1, frac));
        var overall = (engine.index + engine.gridFrac) / engine.total;
        engine.progressById[myId] = overall;
        if (socket) socket.emit('progress', { value: overall });
        renderBars();
      },
      error: function () {
        triggerBlock(grid.penalty || 5);
      },
      complete: function () { gridComplete(); }
    };
  }

  function gridComplete() {
    engine.gridFrac = 1;
    if (engine.index + 1 < engine.total) {
      // grille suivante (course fluide, pas de decompte)
      var overall = (engine.index + 1) / engine.total;
      engine.progressById[myId] = overall;
      if (socket) socket.emit('progress', { value: overall });
      renderBars();
      loadGrid(engine.index + 1);
    } else {
      // toute la sequence est finie
      engine.finished = true;
      engine.progressById[myId] = 1;
      if (socket) socket.emit('progress', { value: 1 });
      renderBars();
      stopTimer();
      if (engine.ctrl && engine.ctrl.destroy) engine.ctrl.destroy();
      if (engine.mode === 'rapid') {
        socket.emit('match:done');
        setLead('Termine ! En attente du resultat...', 'lead');
      } else {
        socket.emit('round:done');
        setLead('Grille terminee !', 'lead');
      }
    }
  }

  // ---- Blocage suite a une erreur ----
  function triggerBlock(seconds) {
    if (!seconds || engine.blocked || engine.finished) return;
    engine.blocked = true;
    var ov = $('#block-overlay');
    var num = $('#block-num');
    var left = seconds;
    num.textContent = left;
    ov.classList.add('show');
    engine._blockTO = setInterval(function () {
      left--;
      num.textContent = left;
      if (left <= 0) {
        clearInterval(engine._blockTO);
        ov.classList.remove('show');
        engine.blocked = false;
      }
    }, 1000);
  }

  // ---- Timer ----
  function startTimer() {
    stopTimer();
    engine.timer = setInterval(function () {
      var el = Math.floor((Date.now() - engine.startTime) / 1000);
      $('#timer').textContent = fmtTime(el);
    }, 250);
    $('#timer').textContent = '00:00';
  }
  function stopTimer() { if (engine && engine.timer) { clearInterval(engine.timer); engine.timer = null; } }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---- Barres de progression (vous + meneur adverse) ----
  function renderBars() {
    if (!engine) return;
    var wrap = $('#progress-wrap');
    var me = engine.progressById[myId] || 0;
    // meneur parmi les autres
    var lead = null;
    players.forEach(function (p) {
      if (p.id === myId) return;
      var v = engine.progressById[p.id] || 0;
      if (!lead || v > lead.v) lead = { name: p.name, v: v };
    });
    var html = '';
    html += bar('Vous', me, true);
    if (lead) {
      var label = (me >= lead.v) ? lead.name + ' (2e)' : lead.name + ' (meneur)';
      html += bar(label, lead.v, false);
    }
    wrap.innerHTML = html;

    // banniere d'avance
    if (lead && !engine.finished) {
      if (me > lead.v) setLead('Vous menez', 'lead');
      else if (me < lead.v) setLead('Vous etes derriere', 'behind');
      else setLead('Au coude a coude', '');
    }
  }
  function bar(name, frac, isMe) {
    var pct = Math.round(frac * 100);
    return '<div class="prog">' +
      '<div class="prog-head"><span class="pname ' + (isMe ? 'me' : '') + '">' + escapeHtml(name) + '</span><span>' + pct + '%</span></div>' +
      '<div class="prog-bar"><div class="prog-fill ' + (isMe ? 'me' : 'opp') + '" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }
  function setLead(text, cls) {
    var b = $('#lead-banner');
    b.textContent = text;
    b.className = 'lead-banner' + (cls ? ' ' + cls : '');
  }

  // ---- Decompte de debut de match ----
  function runCountdown(seconds) {
    show('screen-game');
    boardEl.innerHTML = '';
    $('#progress-wrap').innerHTML = '';
    setLead('Pret ?', '');
    var ov = $('#countdown-overlay');
    var num = $('#cd-num');
    var left = seconds;
    num.textContent = left;
    ov.classList.add('show');
    var iv = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(iv); ov.classList.remove('show'); }
      else { num.textContent = left; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; }
    }, 1000);
  }

  // ===========================================================================
  //  HELPERS DE PLATEAU
  // ===========================================================================
  function buildBoard(n) {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--n', n);
    boardEl.style.position = 'relative';
    var cells = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c;
        boardEl.appendChild(cell);
        row.push(cell);
      }
      cells.push(row);
    }
    return cells;
  }

  // ===========================================================================
  //  CONTROLEURS DE JEU
  // ===========================================================================
  var GAME_CTRL = {};

  // ---------------------------- SUDOKU (9 et 6) ------------------------------
  function sudokuCtrl(grid, ctx) {
    var size = grid.size, box = grid.box;
    var values = grid.puzzle.map(function (r) { return r.slice(); });
    var notes = [];
    for (var i = 0; i < size; i++) { notes.push([]); for (var j = 0; j < size; j++) notes[i].push({}); }
    var solution = grid.solution;
    var locked = grid.puzzle.map(function (r) { return r.map(function (v) { return v !== 0; }); });
    var totalEmpty = 0, correct = 0;
    for (var rr = 0; rr < size; rr++) for (var cc = 0; cc < size; cc++) if (grid.puzzle[rr][cc] === 0) totalEmpty++;
    var sel = null, notesMode = false;
    var cells;

    function render() {
      cells = buildBoard(size);
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
        var cell = cells[r][c];
        if ((c + 1) % box.bc === 0 && c < size - 1) cell.classList.add('bx-right');
        if ((r + 1) % box.br === 0 && r < size - 1) cell.classList.add('bx-bottom');
        if (locked[r][c]) { cell.classList.add('given'); cell.textContent = values[r][c]; }
        cell.addEventListener('click', onClick);
      }
      buildPad();
      document.addEventListener('keydown', onKey);
      ctx.reportProgress(0);
    }
    function onClick(e) {
      if (!ctx.isInteractive()) return;
      var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
      if (locked[r][c]) return;
      sel = { r: r, c: c };
      refresh();
    }
    function refresh() {
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
        var cell = cells[r][c];
        cell.classList.remove('selected', 'peer', 'same');
        if (!sel) continue;
        if (r === sel.r && c === sel.c) cell.classList.add('selected');
        else if (r === sel.r || c === sel.c || sameBox(r, c, sel.r, sel.c)) cell.classList.add('peer');
      }
    }
    function sameBox(r1, c1, r2, c2) {
      return Math.floor(r1 / box.br) === Math.floor(r2 / box.br) && Math.floor(c1 / box.bc) === Math.floor(c2 / box.bc);
    }
    function drawNotes(r, c) {
      var cell = cells[r][c];
      cell.innerHTML = '';
      var keys = Object.keys(notes[r][c]).map(Number).filter(function (k) { return notes[r][c][k]; });
      if (!keys.length) { cell.textContent = values[r][c] ? values[r][c] : ''; return; }
      var nd = document.createElement('div');
      nd.className = 'notes';
      nd.style.gridTemplateColumns = 'repeat(' + box.bc + ', 1fr)';
      for (var v = 1; v <= size; v++) {
        var sp = document.createElement('span');
        sp.textContent = notes[r][c][v] ? v : '';
        nd.appendChild(sp);
      }
      cell.appendChild(nd);
    }
    function input(n) {
      if (!ctx.isInteractive() || !sel) return;
      var r = sel.r, c = sel.c;
      if (locked[r][c]) return;
      if (notesMode) {
        notes[r][c][n] = !notes[r][c][n];
        drawNotes(r, c);
        return;
      }
      // placement : on efface d'abord les annotations de n sur la ligne/colonne/boite
      clearPeersNotes(r, c, n);
      if (solution[r][c] === n) {
        values[r][c] = n; locked[r][c] = true;
        var cell = cells[r][c];
        cell.innerHTML = ''; cell.textContent = n;
        cell.classList.add('placed', 'given'); cell.classList.remove('selected', 'peer');
        notes[r][c] = {};
        correct++;
        sel = null; refresh(); updatePad();
        ctx.reportProgress(correct / totalEmpty);
        if (correct >= totalEmpty) ctx.complete();
      } else {
        var cl = cells[r][c];
        cl.classList.add('wrong');
        setTimeout(function () { cl.classList.remove('wrong'); }, 400);
        ctx.error();
      }
    }
    function clearPeersNotes(r, c, n) {
      for (var i = 0; i < size; i++) {
        if (notes[r][i][n]) { notes[r][i][n] = false; drawNotes(r, i); }
        if (notes[i][c][n]) { notes[i][c][n] = false; drawNotes(i, c); }
      }
      var r0 = r - (r % box.br), c0 = c - (c % box.bc);
      for (var a = 0; a < box.br; a++) for (var b = 0; b < box.bc; b++) {
        if (notes[r0 + a][c0 + b][n]) { notes[r0 + a][c0 + b][n] = false; drawNotes(r0 + a, c0 + b); }
      }
    }
    function erase() {
      if (!ctx.isInteractive() || !sel) return;
      var r = sel.r, c = sel.c;
      if (locked[r][c]) return;
      notes[r][c] = {}; values[r][c] = 0; drawNotes(r, c);
    }
    function onKey(e) {
      if (!engine || engine.ctrl !== api) return;
      if (e.key >= '1' && e.key <= '9') {
        var n = parseInt(e.key, 10);
        if (n <= size) input(n);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { erase(); }
      else if (e.key === 'n' || e.key === 'N') { toggleNotes(); }
      else if (sel && e.key.indexOf('Arrow') === 0) {
        var r = sel.r, c = sel.c;
        if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
        if (e.key === 'ArrowDown') r = Math.min(size - 1, r + 1);
        if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
        if (e.key === 'ArrowRight') c = Math.min(size - 1, c + 1);
        sel = { r: r, c: c }; refresh(); e.preventDefault();
      }
    }
    var padPad, notesBtn;
    function buildPad() {
      var ctrls = $('#game-controls');
      ctrls.innerHTML = '';
      var pad = document.createElement('div');
      pad.className = 'pad';
      pad.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
      for (var v = 1; v <= size; v++) {
        var b = document.createElement('button');
        b.className = 'num'; b.dataset.n = v; b.textContent = v;
        pad.appendChild(b);
      }
      pad.addEventListener('click', function (e) {
        var btn = e.target.closest('.num');
        if (btn) input(parseInt(btn.dataset.n, 10));
      });
      var tools = document.createElement('div');
      tools.className = 'pad-tools';
      notesBtn = document.createElement('button');
      notesBtn.className = 'tool-btn'; notesBtn.innerHTML = '✏️ Notes';
      notesBtn.addEventListener('click', toggleNotes);
      var eraseBtn = document.createElement('button');
      eraseBtn.className = 'tool-btn'; eraseBtn.innerHTML = '⌫ Effacer';
      eraseBtn.addEventListener('click', erase);
      tools.appendChild(notesBtn); tools.appendChild(eraseBtn);
      ctrls.appendChild(pad); ctrls.appendChild(tools);
      padPad = pad;
      updatePad();
    }
    function toggleNotes() { notesMode = !notesMode; if (notesBtn) notesBtn.classList.toggle('active', notesMode); }
    function updatePad() {
      if (!padPad) return;
      var counts = {};
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) { var v = values[r][c]; if (v) counts[v] = (counts[v] || 0) + 1; }
      padPad.querySelectorAll('.num').forEach(function (btn) {
        btn.classList.toggle('disabled', (counts[btn.dataset.n] || 0) >= size);
      });
    }
    function destroy() { document.removeEventListener('keydown', onKey); $('#game-controls').innerHTML = ''; }

    var api = { render: render, destroy: destroy };
    return api;
  }
  GAME_CTRL.sudoku9 = sudokuCtrl;
  GAME_CTRL.sudoku6 = sudokuCtrl;

  // ---------------------------------- QUEENS ---------------------------------
  var REGION_COLORS = ['#ef9a9a', '#a5d6a7', '#90caf9', '#fff59d', '#ce93d8', '#ffcc80', '#80cbc4', '#f48fb1', '#bcaaa4'];

  function queensCtrl(grid, ctx) {
    var n = grid.size, regions = grid.regions, solution = grid.solution;
    var marks = []; // 0 none, 1 user X, 2 crown
    for (var i = 0; i < n; i++) { marks.push([]); for (var j = 0; j < n; j++) marks[i].push(0); }
    var cells;

    function render() {
      cells = buildBoard(n);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        var cell = cells[r][c];
        cell.classList.add('q-cell');
        cell.style.background = REGION_COLORS[regions[r][c] % REGION_COLORS.length];
        cell.style.color = '#222';
        cell.addEventListener('click', onClick);
      }
      var ctrls = $('#game-controls');
      ctrls.innerHTML = '<p class="game-instructions">Place une couronne 👑 par couleur, ligne et colonne, sans que deux couronnes se touchent. Touche une case : croix puis couronne. Les croix se posent automatiquement autour d\'une couronne.</p>';
      draw();
      ctx.reportProgress(0);
    }
    function onClick(e) {
      if (!ctx.isInteractive()) return;
      var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
      var cur = marks[r][c];
      if (cur === 0) marks[r][c] = 1;
      else if (cur === 1) {
        // tentative de couronne
        if (solution[r][c] === 1) { marks[r][c] = 2; }
        else { marks[r][c] = 0; flashWrong(r, c); ctx.error(); draw(); return; }
      } else { marks[r][c] = 0; }
      draw();
    }
    function flashWrong(r, c) {
      var cell = cells[r][c];
      cell.classList.add('wrong');
      setTimeout(function () { cell.classList.remove('wrong'); }, 400);
    }
    function draw() {
      // calcule les croix automatiques autour des couronnes
      var autoX = [];
      for (var i = 0; i < n; i++) { autoX.push([]); for (var j = 0; j < n; j++) autoX[i].push(false); }
      var crowns = 0;
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (marks[r][c] === 2) {
          crowns++;
          for (var k = 0; k < n; k++) { autoX[r][k] = true; autoX[k][c] = true; }
          for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
            var nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < n && nc >= 0 && nc < n) autoX[nr][nc] = true;
          }
        }
      }
      for (var r2 = 0; r2 < n; r2++) for (var c2 = 0; c2 < n; c2++) {
        var cell = cells[r2][c2];
        cell.innerHTML = '';
        if (marks[r2][c2] === 2) cell.innerHTML = '<span class="qcrown">👑</span>';
        else if (marks[r2][c2] === 1 || autoX[r2][c2]) cell.innerHTML = '<span class="qmark">✕</span>';
      }
      ctx.reportProgress(crowns / n);
      if (crowns >= n) ctx.complete();
    }
    function destroy() { $('#game-controls').innerHTML = ''; }
    return { render: render, destroy: destroy };
  }
  GAME_CTRL.queens = queensCtrl;

  // ---------------------------------- TANGO ----------------------------------
  function tangoCtrl(grid, ctx) {
    var n = grid.size;
    var values = grid.puzzle.map(function (r) { return r.slice(); }); // -1/0/1
    var given = grid.puzzle.map(function (r) { return r.map(function (v) { return v !== -1; }); });
    var constraints = grid.constraints || [];
    var cells;
    var SYM = { 1: '☀️', 0: '🌙' };

    function render() {
      cells = buildBoard(n);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        var cell = cells[r][c];
        cell.classList.add('tango-cell');
        if (given[r][c]) cell.classList.add('tango-given');
        cell.addEventListener('click', onClick);
      }
      drawConstraints();
      drawAll();
      var ctrls = $('#game-controls');
      ctrls.innerHTML = '<p class="game-instructions">Remplis la grille de ☀️ et 🌙 : autant de chaque par ligne/colonne, jamais 3 identiques d\'affilee. « = » : cases egales · « ✕ » : cases differentes. Touche une case pour alterner.</p>';
      ctx.reportProgress(filledFrac());
    }
    function onClick(e) {
      if (!ctx.isInteractive()) return;
      var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
      if (given[r][c]) return;
      var v = values[r][c];
      values[r][c] = (v === -1) ? 1 : (v === 1 ? 0 : -1);
      drawCell(r, c);
      ctx.reportProgress(filledFrac());
      checkWin();
    }
    function drawCell(r, c) {
      var cell = cells[r][c];
      cell.innerHTML = values[r][c] === -1 ? '' : '<span class="sym">' + SYM[values[r][c]] + '</span>';
    }
    function drawAll() { for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) drawCell(r, c); }
    function drawConstraints() {
      for (var i = 0; i < constraints.length; i++) {
        var k = constraints[i];
        var x = ((k.a[1] + k.b[1]) / 2 + 0.5) / n * 100;
        var y = ((k.a[0] + k.b[0]) / 2 + 0.5) / n * 100;
        var el = document.createElement('div');
        el.className = 'constraint';
        el.style.left = x + '%'; el.style.top = y + '%';
        el.textContent = k.type === '=' ? '=' : '✕';
        boardEl.appendChild(el);
      }
    }
    function filledFrac() {
      var tot = 0, fill = 0;
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) { if (!given[r][c]) { tot++; if (values[r][c] !== -1) fill++; } }
      return tot ? fill / tot : 1;
    }
    function valid() {
      var half = n / 2;
      for (var r = 0; r < n; r++) {
        var rc = 0, cc = 0;
        for (var c = 0; c < n; c++) {
          if (values[r][c] === -1) return false;
          if (values[r][c] === 1) rc++;
          if (values[c][r] === -1) return false;
          if (values[c][r] === 1) cc++;
          if (c >= 2 && values[r][c] === values[r][c - 1] && values[r][c] === values[r][c - 2]) return false;
          if (c >= 2 && values[c][r] === values[c - 1][r] && values[c][r] === values[c - 2][r]) return false;
        }
        if (rc !== half || cc !== half) return false;
      }
      for (var i = 0; i < constraints.length; i++) {
        var k = constraints[i];
        var av = values[k.a[0]][k.a[1]], bv = values[k.b[0]][k.b[1]];
        if (k.type === '=' && av !== bv) return false;
        if (k.type === 'x' && av === bv) return false;
      }
      return true;
    }
    function checkWin() { if (valid()) ctx.complete(); }
    function destroy() { $('#game-controls').innerHTML = ''; }
    return { render: render, destroy: destroy };
  }
  GAME_CTRL.tango = tangoCtrl;

  // ----------------------------------- ZIP -----------------------------------
  function zipCtrl(grid, ctx) {
    var n = grid.size, numbers = grid.numbers, count = grid.count;
    var path = []; // [r,c]
    var visited = [];
    for (var i = 0; i < n; i++) { visited.push([]); for (var j = 0; j < n; j++) visited[i].push(false); }
    var cells, drawing = false;

    function render() {
      cells = buildBoard(n);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        var cell = cells[r][c];
        cell.classList.add('zip-cell');
        if (numbers[r][c]) { cell.classList.add('zip-num'); cell.innerHTML = '<span class="zip-badge">' + numbers[r][c] + '</span>'; }
        cell.dataset.r = r; cell.dataset.c = c;
      }
      boardEl.addEventListener('pointerdown', onDown);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      var ctrls = $('#game-controls');
      ctrls.innerHTML = '<p class="game-instructions">Relie 1 → 2 → … en un seul trace continu qui passe par TOUTES les cases, une seule fois. Glisse depuis le 1.</p>';
      var clr = document.createElement('button');
      clr.className = 'btn zip-clear'; clr.textContent = 'Effacer le trace';
      clr.addEventListener('click', function () { reset(); });
      ctrls.appendChild(clr);
      ctx.reportProgress(0);
    }
    function cellFromPoint(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) return null;
      el = el.closest('.cell');
      if (!el || el.parentNode !== boardEl) return null;
      return { r: +el.dataset.r, c: +el.dataset.c };
    }
    function onDown(e) {
      if (!ctx.isInteractive()) return;
      e.preventDefault();
      var p = cellFromPoint(e.clientX, e.clientY);
      if (!p) return;
      drawing = true;
      tryExtend(p);
    }
    function onMove(e) {
      if (!drawing || !ctx.isInteractive()) return;
      var p = cellFromPoint(e.clientX, e.clientY);
      if (p) tryExtend(p);
    }
    function onUp() { drawing = false; }
    function tryExtend(p) {
      if (!path.length) {
        if (numbers[p.r][p.c] === 1) { addCell(p.r, p.c); }
        return;
      }
      var last = path[path.length - 1];
      if (p.r === last.r && p.c === last.c) return;
      // retour arriere
      if (path.length >= 2) {
        var prev = path[path.length - 2];
        if (p.r === prev.r && p.c === prev.c) { removeLast(); return; }
      }
      if (Math.abs(p.r - last.r) + Math.abs(p.c - last.c) === 1 && !visited[p.r][p.c]) {
        // contrainte d'ordre : si la case porte un numero, ce doit etre le suivant
        var nextNum = currentMaxNum() + 1;
        if (numbers[p.r][p.c] && numbers[p.r][p.c] !== nextNum) return;
        addCell(p.r, p.c);
      }
    }
    function currentMaxNum() {
      var m = 0;
      for (var i = 0; i < path.length; i++) { var v = numbers[path[i].r][path[i].c]; if (v > m) m = v; }
      return m;
    }
    function addCell(r, c) { path.push({ r: r, c: c }); visited[r][c] = true; draw(); }
    function removeLast() { var p = path.pop(); if (p) visited[p.r][p.c] = false; draw(); }
    function reset() { path = []; for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) visited[r][c] = false; draw(); }
    function draw() {
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        cells[r][c].classList.remove('zip-path', 'zip-head');
      }
      for (var i = 0; i < path.length; i++) {
        var cell = cells[path[i].r][path[i].c];
        cell.classList.add('zip-path');
        if (i === path.length - 1) cell.classList.add('zip-head');
      }
      ctx.reportProgress(path.length / (n * n));
      checkWin();
    }
    function checkWin() {
      if (path.length !== n * n) return;
      // tous les numeros dans l'ordre
      var seq = [];
      for (var i = 0; i < path.length; i++) { var v = numbers[path[i].r][path[i].c]; if (v) seq.push(v); }
      for (var j = 0; j < seq.length; j++) if (seq[j] !== j + 1) return;
      if (seq.length === count) ctx.complete();
    }
    function destroy() {
      boardEl.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      $('#game-controls').innerHTML = '';
    }
    return { render: render, destroy: destroy };
  }
  GAME_CTRL.zip = zipCtrl;

  // ===========================================================================
  //  RESULTATS
  // ===========================================================================
  function standingsHtml(winnerId) {
    var sorted = players.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var html = '';
    sorted.forEach(function (p, i) {
      var win = p.id === winnerId;
      html += '<div class="ov-row ' + (win ? 'win' : '') + '">' +
        '<span><span class="rank">#' + (i + 1) + '</span>' + escapeHtml(p.name) + (p.id === myId ? ' (vous)' : '') + '</span>' +
        '<span>' + (p.score || 0) + ' pt' + ((p.score || 0) > 1 ? 's' : '') + (win ? ' 🏆' : '') + '</span></div>';
    });
    return html;
  }

  function showRoundResult(d) {
    stopTimer();
    if (engine) engine.finished = true;
    if (engine && engine.ctrl && engine.ctrl.destroy) engine.ctrl.destroy();
    var iWin = d.winnerId === myId;
    $('#ov-title').textContent = iWin ? 'Manche gagnee !' : 'Manche perdue';
    var winner = players.find(function (p) { return p.id === d.winnerId; });
    $('#ov-sub').textContent = iWin ? 'Tu as fini la grille en premier.' : ((winner ? winner.name : 'Un joueur') + ' a fini en premier.');
    $('#ov-standings').innerHTML = standingsHtml(d.winnerId);

    var nextBtn = $('#ov-next');
    if (d.matchOver) { showMatchEnd({ winnerId: d.winnerId }); return; }
    if (isHost) {
      nextBtn.style.display = 'block'; nextBtn.textContent = 'Manche suivante'; nextBtn.disabled = false;
      nextBtn.onclick = function () { socket.emit('round:next'); };
    } else {
      nextBtn.style.display = 'block'; nextBtn.textContent = "En attente de l'hote..."; nextBtn.disabled = true; nextBtn.onclick = null;
    }
    showOverlay();
  }

  function showMatchEnd(d) {
    stopTimer();
    if (engine) engine.finished = true;
    if (engine && engine.ctrl && engine.ctrl.destroy) engine.ctrl.destroy();
    var iWin = d.winnerId === myId;
    var winner = players.find(function (p) { return p.id === d.winnerId; });
    $('#ov-title').textContent = iWin ? '🏆 Victoire !' : 'Termine';
    $('#ov-sub').textContent = iWin ? 'Tu es arrive au bout en premier !' : ((winner ? winner.name : 'Un joueur') + ' a gagne la partie.');
    $('#ov-standings').innerHTML = standingsHtml(d.winnerId);

    var nextBtn = $('#ov-next');
    if (isHost) {
      nextBtn.style.display = 'block'; nextBtn.textContent = 'Rejouer (meme salon)'; nextBtn.disabled = false;
      nextBtn.onclick = function () { socket.emit('room:rematch'); };
    } else {
      nextBtn.style.display = 'block'; nextBtn.textContent = "En attente de l'hote..."; nextBtn.disabled = true; nextBtn.onclick = null;
    }
    showOverlay();
  }

  $('#ov-home').addEventListener('click', function () { resetAll(); show('screen-home'); });
  function showOverlay() { $('#overlay').classList.add('show'); }
  function hideOverlay() { $('#overlay').classList.remove('show'); }

  // ===========================================================================
  //  UTILITAIRES
  // ===========================================================================
  function resetAll() {
    stopEngine();
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    roomCode = null; isHost = false; players = []; myId = null;
    hideOverlay();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
