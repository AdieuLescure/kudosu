/* Onglet Tier list : on classe les 50 personnalites francaises de S a F.
 * Clic/tap (mobile) ou glisser-deposer (ordinateur). Le brouillon est garde
 * dans le navigateur ; l'enregistrement envoie la tier list a l'historique. */
(function () {
  const { h } = App;
  const DRAFT_KEY = 'wd_tl_draft';
  const COLORS = { S: '#ff7f7f', A: '#ffbf7f', B: '#ffdf7f', C: '#f3f37f', D: '#bfff7f', F: '#7fffbf' };

  let root = null;
  let data = null;          // { tiers, items }
  let placement = {};       // id -> tier (absent = pas encore classe)
  let selected = null;      // id selectionne (pour le clic/tap)
  let status = null;        // { kind: 'ok' | 'error', text }
  let saving = false;

  function loadDraft() {
    try {
      const d = JSON.parse(App.storage.get(DRAFT_KEY) || '{}');
      const valid = new Set(data.items.map((i) => i.id));
      placement = {};
      for (const [id, tier] of Object.entries(d)) if (valid.has(id) && data.tiers.includes(tier)) placement[id] = tier;
    } catch (e) { placement = {}; }
  }
  function saveDraft() { App.storage.set(DRAFT_KEY, JSON.stringify(placement)); }

  function place(id, tier) {   // tier = null -> retour dans le lot a classer
    if (!id) return;
    if (tier) placement[id] = tier; else delete placement[id];
    selected = null;
    status = null;
    saveDraft();
    render();
  }

  function tile(item) {
    const el = h('div', {
      class: 'tl-item' + (selected === item.id ? ' sel' : ''),
      draggable: 'true', title: item.title, tabindex: '0', role: 'button',
      onclick: () => { selected = selected === item.id ? null : item.id; render(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === item.id ? null : item.id; render(); } },
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; selected = null; }
    },
      item.img ? h('img', { src: item.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false' }) : h('div', { class: 'tl-ph' }, item.title.slice(0, 1)),
      h('span', {}, item.title));
    return el;
  }

  function zone(className, onDropTo, onClickTo, children, label) {
    const z = h('div', {
      class: className + (selected ? ' armed' : ''),
      onclick: (e) => { if (selected && !e.target.closest('.tl-item')) onClickTo(); },
      ondragover: (e) => { e.preventDefault(); z.classList.add('over'); },
      ondragleave: () => z.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); z.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) onDropTo(id); }
    }, label, children);
    return z;
  }

  async function save() {
    saving = true; status = null; render();
    const tiers = {};
    data.tiers.forEach((t) => { tiers[t] = data.items.filter((i) => placement[i.id] === t).map((i) => i.id); });
    try {
      const res = await fetch('/api/tierlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: App.name, tiers })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      placement = {}; saveDraft();
      status = { kind: 'ok', text: 'Tier list enregistrée !' };
    } catch (e) {
      status = { kind: 'error', text: e.message || 'Impossible d\'enregistrer.' };
    }
    saving = false;
    render();
  }

  function render() {
    if (!root) return;
    if (!data) { root.replaceChildren(h('p', { class: 'muted' }, 'Chargement...')); return; }
    const total = data.items.length;
    const placed = Object.keys(placement).length;
    const unplaced = data.items.filter((i) => !placement[i.id]);

    const rows = data.tiers.map((t) => zone('tl-row',
      (id) => place(id, t), () => place(selected, t),
      h('div', { class: 'tl-items' }, data.items.filter((i) => placement[i.id] === t).map(tile)),
      h('div', { class: 'tl-label', style: 'background:' + COLORS[t] }, t)));

    const pool = zone('tl-pool', (id) => place(id, null), () => place(selected, null),
      h('div', { class: 'tl-items' }, unplaced.map(tile)),
      h('div', { class: 'tl-pool-title' }, unplaced.length ? 'À classer (' + unplaced.length + ')' : 'Tout est classé !'));

    root.replaceChildren(...[
      h('h1', {}, 'Tier list'),
      h('p', { class: 'lead' }, 'Les 50 personnalités françaises les plus connues. Touche une personnalité puis la ligne où la ranger (ou glisse-la). Pas de limite de temps.'),
      status ? h('div', { class: 'alert ' + status.kind }, status.text, status.kind === 'ok' ? [' ', h('a', { href: '#/historique' }, 'Voir l\'historique')] : null) : null,
      h('div', { class: 'tl-bar' },
        h('span', {}, placed + ' / ' + total + ' classées'),
        h('div', { class: 'tl-progress' }, h('i', { style: 'width:' + (placed / total * 100) + '%' })),
        h('button', { class: 'btn ghost', type: 'button', disabled: !placed, onclick: () => { if (confirm('Tout remettre à classer ?')) { placement = {}; selected = null; saveDraft(); render(); } } }, 'Recommencer')),
      h('div', { class: 'tl-board' }, rows),
      pool,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', disabled: placed < total || saving, onclick: save },
          saving ? 'Enregistrement...' : (placed < total ? 'Classe tout le monde pour enregistrer' : 'Enregistrer ma tier list')))
    ].filter(Boolean));
  }

  App.routes.tierlist = {
    async mount(view) {
      root = view;
      status = null; selected = null;
      render();
      if (!data) {
        try {
          data = await (await fetch('/api/tierlist/items')).json();
          if (!data.items || !data.items.length) throw new Error();
        } catch (e) {
          data = null;
          if (root) root.replaceChildren(h('div', { class: 'alert error' }, 'La liste des personnalités n\'est pas disponible sur le serveur.'));
          return;
        }
      }
      loadDraft();
      render();
    },
    unmount() { root = null; }
  };
})();
