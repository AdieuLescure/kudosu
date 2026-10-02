/* Noyau du front : pseudo, navigation par onglets, petites aides DOM. */
(function () {
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } }
  };

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // h('div', {class:'x', onclick: fn}, 'texte', autreNoeud) -> toujours en textContent (pas d'innerHTML).
  function h(tag, attrs) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (Array.isArray(child)) child.forEach((c) => append(el, c));
    else if (child != null && child !== false) el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  const App = {
    storage, h,
    name: storage.get('wd_name') || '',
    playerId: storage.get('wd_pid') || '',
    routes: {},
    current: null,

    start() {
      if (!App.playerId) { App.playerId = newId(); storage.set('wd_pid', App.playerId); }

      // Lien d'invitation : ?salon=ABCDE
      const code = new URLSearchParams(location.search).get('salon');
      if (code) {
        App.pendingRoom = code.toUpperCase().slice(0, 5);
        history.replaceState(null, '', location.pathname + '#/duel');
      }

      document.getElementById('who-change').addEventListener('click', () => App.askName());
      document.getElementById('gate-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('gate-input').value.replace(/[<>]/g, '').trim().slice(0, 20);
        if (!name) return;
        App.name = name;
        storage.set('wd_name', name);
        document.getElementById('gate').hidden = true;
        App.refreshWho();
        App.route(true);
      });
      window.addEventListener('hashchange', () => App.route());

      App.refreshWho();
      if (!App.name) App.askName(); else App.route(true);
    },

    askName() {
      document.getElementById('gate-input').value = App.name;
      document.getElementById('gate').hidden = false;
      document.getElementById('gate-input').focus();
    },

    refreshWho() {
      document.getElementById('who-name').textContent = App.name;
      document.getElementById('who-change').hidden = !App.name;
    },

    route(force) {
      if (!App.name) return;
      const tab = (location.hash.replace(/^#\/?/, '') || 'accueil').split('/')[0];
      const key = App.routes[tab] ? tab : 'accueil';
      if (App.current && App.current.key === key && !force) return;
      if (App.current && App.current.mod.unmount) App.current.mod.unmount();
      const view = document.getElementById('view');
      view.replaceChildren();
      view.className = 'view view-' + key;
      document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === key));
      App.current = { key, mod: App.routes[key] };
      App.routes[key].mount(view);
      window.scrollTo(0, 0);
    },

    // Date en francais, ex. "2 oct. 2026, 21:40"
    formatDate(iso) {
      try {
        return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) { return ''; }
    },

    formatViews(n) { return Number(n).toLocaleString('fr-FR'); }
  };

  // Accueil
  App.routes.accueil = {
    mount(view) {
      view.append(
        h('section', { class: 'hero' },
          h('h1', {}, 'Deux jeux, un seul site.'),
          h('p', {}, 'Des pages Wikipedia très consultées (plus de 20 000 vues par mois), à jouer entre amis.')),
        h('div', { class: 'tiles' },
          h('a', { class: 'tile', href: '#/duel' },
            h('h2', {}, 'Duel'),
            h('p', {}, 'Deux pages Wikipedia, une question : « Qu\'est-ce qui marquera le plus le monde ? » Chacun choisit, puis on compare. Version Monde ou France.'),
            h('span', { class: 'btn primary' }, 'Créer ou rejoindre un salon')),
          h('a', { class: 'tile', href: '#/tierlist' },
            h('h2', {}, 'Tier list'),
            h('p', {}, 'Classe les 50 personnalités françaises les plus connues de S à F. Seul, sans limite de temps.'),
            h('span', { class: 'btn primary' }, 'Faire ma tier list')),
          h('a', { class: 'tile', href: '#/historique' },
            h('h2', {}, 'Historique'),
            h('p', {}, 'Toutes les tier lists enregistrées : compare la tienne à celles de tes amis.'),
            h('span', { class: 'btn' }, 'Voir l\'historique'))));
    }
  };

  window.App = App;
})();
