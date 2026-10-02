/* Onglet Historique : toutes les tier lists enregistrees. */
(function () {
  const { h } = App;
  const COLORS = { S: '#ff7f7f', A: '#ffbf7f', B: '#ffdf7f', C: '#f3f37f', D: '#bfff7f', F: '#7fffbf' };
  let root = null;
  let images = new Map();   // id -> { img, url }

  function entry(t) {
    const tiers = Object.keys(COLORS);
    const card = h('article', { class: 'hist-card' },
      h('header', {},
        h('strong', {}, t.name),
        h('span', { class: 'muted small' }, App.formatDate(t.createdAt))),
      tiers.map((tier) => h('div', { class: 'hist-row' },
        h('div', { class: 'hist-label', style: 'background:' + COLORS[tier] }, tier),
        h('div', { class: 'hist-items' }, (t.tiers[tier] || []).map((it) => {
          const meta = images.get(it.id);
          return h('div', { class: 'hist-item', title: it.t },
            meta && meta.img ? h('img', { src: meta.img, alt: it.t, loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', {}, it.t.slice(0, 2)));
        })))));
    return card;
  }

  App.routes.historique = {
    async mount(view) {
      root = view;
      view.append(h('h1', {}, 'Historique'), h('p', { class: 'muted' }, 'Chargement...'));
      try {
        const [list, items] = await Promise.all([
          fetch('/api/tierlists').then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
          fetch('/api/tierlist/items').then((r) => r.json()).catch(() => ({ items: [] }))
        ]);
        images = new Map((items.items || []).map((i) => [i.id, i]));
        if (root !== view) return;
        view.replaceChildren(...[
          h('h1', {}, 'Historique'),
          h('p', { class: 'lead' }, 'Les tier lists enregistrées par tous les joueurs, de la plus récente à la plus ancienne. Survole un portrait pour voir son nom.'),
          list.persistent ? null : h('div', { class: 'alert' }, 'Stockage temporaire : l\'historique sera effacé au prochain redémarrage du serveur (Supabase n\'est pas configuré).'),
          list.tierlists.length
            ? h('div', { class: 'hist' }, list.tierlists.map(entry))
            : h('p', { class: 'muted' }, 'Aucune tier list pour le moment. ', h('a', { href: '#/tierlist' }, 'Fais la première !'))
        ].filter(Boolean));
      } catch (e) {
        if (root === view) view.replaceChildren(h('h1', {}, 'Historique'), h('div', { class: 'alert error' }, 'Historique indisponible pour le moment.'));
      }
    },
    unmount() { root = null; }
  };
})();
