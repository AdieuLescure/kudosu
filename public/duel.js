/* Onglet Duel : salons temps reel (Socket.io). Le serveur envoie l'etat complet
 * ('state'), le client se redessine entierement a chaque fois. */
(function () {
  const { h } = App;
  const QUESTION = 'Qu\'est-ce qui marquera le plus le monde ?';
  const POOL_LABEL = { world: 'Monde', france: 'France' };

  let socket = null;
  let state = null;       // dernier etat recu
  let root = null;        // conteneur de l'onglet (null si on est sur un autre onglet)
  let error = '';
  let busy = false;

  function ensureSocket() {
    if (socket) return;
    socket = io();
    socket.on('state', (s) => {
      state = s;
      busy = false;
      error = '';
      App.storage.set('wd_room', s.code);
      render();
    });
    // (Re)connexion : on reprend le salon en cours s'il existe.
    socket.on('connect', () => {
      const code = App.storage.get('wd_room');
      if (code && !state) {
        socket.emit('room:rejoin', { playerId: App.playerId, code }, (r) => {
          if (!r || !r.ok) { App.storage.del('wd_room'); render(); }
        });
      } else if (state) {
        socket.emit('room:rejoin', { playerId: App.playerId, code: state.code }, (r) => {
          if (!r || !r.ok) { state = null; App.storage.del('wd_room'); render(); }
        });
      }
    });
    socket.on('disconnect', () => { error = 'Connexion perdue, reconnexion...'; render(); });
  }

  function act(event, payload, cb) {
    busy = true;
    socket.emit(event, payload || {}, (r) => {
      busy = false;
      if (r && !r.ok) { error = r.error || 'Erreur.'; }
      if (cb) cb(r);
      render();
    });
  }

  function createRoom() {
    act('room:create', { name: App.name, playerId: App.playerId });
  }

  function joinRoom(code) {
    code = String(code || '').toUpperCase().trim();
    if (!code) { error = 'Entre un code de salon.'; return render(); }
    act('room:join', { name: App.name, playerId: App.playerId, code });
  }

  function leaveRoom() {
    socket.emit('room:leave');
    App.storage.del('wd_room');
    state = null;
    render();
  }

  // --- Vues ----------------------------------------------------------------------

  function playerName(id) {
    const p = state.players.find((x) => x.id === id);
    return p ? p.name : '?';
  }

  function itemCard(item, index, mode) {
    // mode : 'pick' (cliquable), 'wait' (choix fait), 'reveal'
    const round = state.round;
    const chosen = round.myChoice === index;
    const media = item.img
      ? h('img', { src: item.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : h('div', { class: 'ph' }, item.title.slice(0, 1));
    const body = [
      h('div', { class: 'media' }, media),
      h('div', { class: 'info' },
        h('span', { class: 'badge' }, item.type === 'event' ? 'Événement' : 'Personnalité'),
        h('h3', {}, item.title),
        h('p', {}, item.desc || ''))
    ];
    const link = h('a', { class: 'wiki', href: item.url, target: '_blank', rel: 'noopener' }, 'Lire sur Wikipedia ↗');
    const card = h('div', { class: 'duel-card' + (chosen ? ' chosen' : '') + (mode === 'reveal' ? ' reveal' : '') });
    if (mode === 'pick') {
      card.append(h('button', { class: 'pick', type: 'button', onclick: () => socket.emit('duel:pick', { choice: index }) }, body));
    } else {
      card.append(h('div', { class: 'pick static' }, body));
    }
    if (mode === 'reveal') {
      const voters = Object.entries(round.choices).filter(([, c]) => c === index).map(([id]) => id);
      card.append(
        h('div', { class: 'views' }, h('strong', {}, App.formatViews(item.views)), ' vues / mois'),
        h('div', { class: 'voters' }, voters.length
          ? voters.map((id) => h('span', { class: 'chip' + (id === state.me ? ' me' : '') }, playerName(id)))
          : h('span', { class: 'muted' }, 'Personne')));
    }
    card.append(link);
    return card;
  }

  function viewHome() {
    const input = h('input', { type: 'text', maxlength: '5', placeholder: 'CODE', class: 'code-input', autocapitalize: 'characters' });
    return [
      h('h1', {}, 'Duel'),
      h('p', { class: 'lead' }, QUESTION + ' Deux pages Wikipedia à chaque manche, chacun choisit, puis on compare.'),
      h('div', { class: 'panel-row' },
        h('div', { class: 'panel' },
          h('h2', {}, 'Créer un salon'),
          h('p', {}, 'Tu choisiras Monde ou France et le nombre de manches dans le salon.'),
          h('button', { class: 'btn primary', type: 'button', disabled: busy, onclick: createRoom }, 'Créer un salon')),
        h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); joinRoom(input.value); } },
          h('h2', {}, 'Rejoindre'),
          h('p', {}, 'Entre le code que ton ami t\'a envoyé.'),
          input,
          h('button', { class: 'btn', type: 'submit', disabled: busy }, 'Rejoindre')))];
  }

  function viewLobby() {
    const isHost = state.hostId === state.me;
    const link = location.origin + '/?salon=' + state.code;
    const connected = state.players.filter((p) => p.connected).length;

    const seg = (label, options, current, onPick) => h('div', { class: 'setting' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'seg' }, options.map(([value, text]) =>
        h('button', {
          type: 'button', class: current === value ? 'on' : '', disabled: !isHost,
          onclick: () => onPick(value)
        }, text))));

    return [
      h('h1', {}, 'Salon'),
      h('div', { class: 'share' },
        h('div', {},
          h('div', { class: 'muted' }, 'Code du salon'),
          h('div', { class: 'code' }, state.code)),
        h('button', {
          class: 'btn', type: 'button',
          onclick: (e) => {
            const done = () => { e.target.textContent = 'Lien copié !'; setTimeout(() => (e.target.textContent = 'Copier le lien d\'invitation'), 1800); };
            if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => prompt('Copie ce lien :', link));
            else prompt('Copie ce lien :', link);
          }
        }, 'Copier le lien d\'invitation')),
      h('div', { class: 'panel' },
        h('h2', {}, 'Joueurs (' + state.players.length + ')'),
        h('div', { class: 'chips' }, state.players.map((p) =>
          h('span', { class: 'chip' + (p.connected ? '' : ' off') + (p.id === state.me ? ' me' : '') },
            (p.id === state.hostId ? '★ ' : '') + p.name)))),
      h('div', { class: 'panel' },
        h('h2', {}, 'Réglages' + (isHost ? '' : ' (choisis par l\'hôte)')),
        seg('Pages', [['world', 'Monde'], ['france', 'France']], state.pool,
          (pool) => socket.emit('room:settings', { pool })),
        h('p', { class: 'muted small' }, state.pool === 'france'
          ? 'Uniquement des personnalités et événements français.'
          : 'Personnalités et événements du monde entier.'),
        seg('Manches', [[5, '5'], [10, '10'], [15, '15']], state.rounds,
          (rounds) => socket.emit('room:settings', { rounds }))),
      h('div', { class: 'actions' },
        isHost
          ? h('button', {
              class: 'btn primary', type: 'button', disabled: connected < 2,
              onclick: () => socket.emit('game:start')
            }, connected < 2 ? 'Il faut au moins 2 joueurs' : 'Lancer la partie')
          : h('p', { class: 'muted' }, 'En attente de l\'hôte (' + playerName(state.hostId) + ')...'),
        h('button', { class: 'btn ghost', type: 'button', onclick: leaveRoom }, 'Quitter le salon'))
    ];
  }

  function viewRound() {
    const r = state.round;
    const reveal = state.phase === 'reveal';
    const isHost = state.hostId === state.me;
    const answered = new Set(r.answered);
    const waiting = state.players.filter((p) => p.connected && !answered.has(p.id)).map((p) => p.name);
    const last = state.index + 1 >= state.rounds;

    const mode = reveal ? 'reveal' : (r.myChoice === null ? 'pick' : 'wait');
    const out = [
      h('div', { class: 'round-head' },
        h('span', {}, 'Manche ' + (state.index + 1) + ' / ' + state.rounds),
        h('span', { class: 'muted' }, POOL_LABEL[state.pool])),
      h('div', { class: 'progress' }, h('i', { style: 'width:' + ((state.index + (reveal ? 1 : 0)) / state.rounds * 100) + '%' })),
      h('h1', { class: 'question' }, QUESTION),
      h('div', { class: 'duel' }, itemCard(r.options[0], 0, mode), h('div', { class: 'vs' }, 'VS'), itemCard(r.options[1], 1, mode))
    ];

    if (reveal) {
      out.push(h('div', { class: 'actions' },
        isHost
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => socket.emit('duel:next') }, last ? 'Voir le récap' : 'Manche suivante')
          : h('p', { class: 'muted' }, 'L\'hôte (' + playerName(state.hostId) + ') lance la suite...')));
    } else {
      out.push(h('p', { class: 'status' }, r.myChoice === null
        ? 'Choisis une page.'
        : 'Choix enregistré. En attente de : ' + (waiting.join(', ') || '...')));
    }
    return out;
  }

  function viewEnd() {
    const isHost = state.hostId === state.me;
    const { rounds, agreements } = state.recap;
    const mine = (r) => r.choices[state.me];
    return [
      h('h1', {}, 'Récap de la partie'),
      agreements.length ? h('div', { class: 'panel' },
        h('h2', {}, 'Accord entre joueurs'),
        h('ul', { class: 'plain' }, agreements.map((a) =>
          h('li', {}, playerName(a.a) + ' & ' + playerName(a.b) + ' : ', h('strong', {}, a.percent + ' %'), ' des mêmes choix')))) : null,
      h('div', { class: 'recap' }, rounds.map((r, i) => h('div', { class: 'recap-round' },
        h('div', { class: 'muted small' }, 'Manche ' + (i + 1)),
        h('div', { class: 'recap-opts' }, r.options.map((o, idx) => {
          const voters = Object.entries(r.choices).filter(([, c]) => c === idx).map(([id]) => id);
          return h('div', { class: 'recap-opt' + (mine(r) === idx ? ' mine' : '') },
            h('a', { href: o.url, target: '_blank', rel: 'noopener' }, o.title),
            h('span', { class: 'muted small' }, App.formatViews(o.views) + ' vues/mois'),
            h('div', { class: 'chips' }, voters.map((id) => h('span', { class: 'chip' + (id === state.me ? ' me' : '') }, playerName(id)))));
        }))))),
      h('div', { class: 'actions' },
        isHost
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => socket.emit('room:rematch') }, 'Rejouer avec le même salon')
          : h('p', { class: 'muted' }, 'L\'hôte peut relancer une partie.'),
        h('button', { class: 'btn ghost', type: 'button', onclick: leaveRoom }, 'Quitter le salon'))
    ];
  }

  function render() {
    if (!root) return;
    let content;
    if (!state) content = viewHome();
    else if (state.state === 'lobby') content = viewLobby();
    else if (state.state === 'playing') content = viewRound();
    else content = viewEnd();
    root.replaceChildren(...content.filter(Boolean));
    if (error) root.prepend(h('div', { class: 'alert' }, error));
  }

  App.routes.duel = {
    mount(view) {
      root = view;
      ensureSocket();
      render();
      // Arrivee par lien d'invitation.
      if (App.pendingRoom) {
        const code = App.pendingRoom;
        App.pendingRoom = null;
        if (!state) {
          const go = () => joinRoom(code);
          if (socket.connected) go(); else socket.once('connect', go);
        }
      }
    },
    unmount() { root = null; }
  };
})();
