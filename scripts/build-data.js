#!/usr/bin/env node
/* ============================================================================
 *  Construit les listes de pages Wikipedia utilisees par le jeu.
 *
 *    node scripts/build-data.js
 *
 *  Sources (toutes publiques) :
 *   - Wikidata SPARQL : evenements (monde + France), personnalites francaises
 *   - Wikipedia "Vital articles" (niveau 4) : personnalites mondiales
 *   - API Wikimedia (pageviews) : vues des 30 derniers jours sur fr.wikipedia
 *
 *  Seules les pages avec au moins MIN_VIEWS vues sur 30 jours sont gardees.
 *  Sortie : data/world.json, data/france.json, data/tierlist.json, data/meta.json
 *
 *  Un cache (scripts/.cache) permet de reprendre apres une erreur reseau.
 *  Sur certains reseaux partages, les API Wikimedia repondent 429 : le script
 *  patiente et reessaie tout seul.
 *  Option : WIKI_USER_AGENT="MonApp/1.0 (https://exemple.fr; moi@exemple.fr)"
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_VIEWS = 20000;
const TIERLIST_SIZE = 50;
const UA = process.env.WIKI_USER_AGENT || 'WikiDuel/1.0 (https://github.com/adieulescure/kudosu)';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data');
const CACHE = path.join(__dirname, '.cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --- reseau -----------------------------------------------------------------

async function getJson(url, accept) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept || 'application/json' }, signal: AbortSignal.timeout(120000) });
    } catch (e) {
      await sleep(Math.min(60000, 3000 * 2 ** attempt));
      continue;
    }
    if (res.ok) {
      try { return await res.json(); } catch (e) { /* reponse tronquee -> on reessaie */ }
    } else if (![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error('HTTP ' + res.status + ' ' + url.slice(0, 120));
    }
    const retryAfter = res.ok ? 0 : Number(res.headers.get('retry-after')) * 1000;
    const wait = retryAfter || Math.min(60000, 4000 * 2 ** attempt);
    log('  attente ' + Math.round(wait / 1000) + 's (' + (res.ok ? 'reponse invalide' : 'HTTP ' + res.status) + ')');
    await sleep(wait);
  }
  throw new Error('Trop de tentatives : ' + url.slice(0, 120));
}

async function cached(key, fn) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, crypto.createHash('md5').update(key).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = await fn();
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}

function api(host, params) {
  const qs = new URLSearchParams(Object.assign({ format: 'json', formatversion: '2' }, params));
  return getJson('https://' + host + '/w/api.php?' + qs);
}

async function sparql(query) {
  return cached('sparql:' + query, async () => {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
    const json = await getJson(url, 'application/sparql-results+json');
    await sleep(1500);
    return json.results.bindings.map((b) => ({
      qid: b.item.value.split('/').pop(),
      n: Number(b.n.value)
    }));
  });
}

// --- candidats ----------------------------------------------------------------

// Classes Wikidata d'evenements (avec sous-classes). Une requete par classe :
// regrouper toutes les classes depasse le delai de Wikidata.
const EVENT_CLASSES = [
  'Q13418847', // evenement historique
  'Q178561',   // bataille
  'Q198',      // guerre
  'Q10931',    // revolution
  'Q625298',   // traite de paix
  'Q131569',   // traite
  'Q2223653',  // attentat
  'Q8065',     // catastrophe naturelle
  'Q3839081',  // catastrophe
  'Q45382',    // coup d'Etat
  'Q124757'    // emeute
];

async function events(label, extra, minSitelinks) {
  log('Evenements (' + label + ')...');
  const out = [];
  for (const c of EVENT_CLASSES) {
    out.push(...await sparql(`SELECT ?item ?n WHERE { ${extra}
      ?item wdt:P31/wdt:P279* wd:${c}; wikibase:sitelinks ?n. FILTER(?n >= ${minSitelinks}) }`));
  }
  return out;
}

const worldEvents = () => events('monde', '', 50);
const franceEvents = () => events('France', 'VALUES ?p { wd:Q142 wd:Q70972 } ?item wdt:P17 ?p.', 15);

// Personnalites francaises : requetes decoupees par tranche de naissance
// (une seule requete globale depasse le delai de Wikidata).
async function francePeople() {
  const edges = [];
  for (let y = 700; y < 1700; y += 100) edges.push(y);
  for (let y = 1700; y < 1950; y += 20) edges.push(y);
  for (let y = 1950; y <= 2010; y += 10) edges.push(y);
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    log('Personnalites francaises nees ' + a + '-' + b + '...');
    const rows = await sparql(`SELECT ?item ?n WHERE { VALUES ?p { wd:Q142 wd:Q70972 }
      ?item wdt:P27 ?p; wdt:P31 wd:Q5; wdt:P569 ?d; wikibase:sitelinks ?n.
      FILTER(?d >= "${String(a).padStart(4, '0')}-01-01T00:00:00Z"^^xsd:dateTime && ?d < "${String(b).padStart(4, '0')}-01-01T00:00:00Z"^^xsd:dateTime && ?n >= 25) }`);
    out.push(...rows);
  }
  return out;
}

// Personnalites mondiales : pages "Vital articles" (niveau 4) de Wikipedia EN.
async function vitalPeopleTitles() {
  log('Liste des articles vitaux (personnes)...');
  const list = await api('en.wikipedia.org', {
    action: 'query', list: 'allpages', apprefix: 'Vital articles/Level/4/People/', apnamespace: '4', aplimit: '100'
  });
  const pages = list.query.allpages.map((p) => p.title).filter((t) => !/Candidates|Removed|Draft|alerts/i.test(t));
  const titles = new Set();
  for (const page of pages) {
    const json = await cached('parse:' + page, async () => {
      const r = await api('en.wikipedia.org', { action: 'parse', page, prop: 'wikitext' });
      await sleep(1000);
      return r.parse.wikitext;
    });
    for (const line of json.split('\n')) {
      if (!/^[*#]/.test(line)) continue;
      const m = line.match(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/);
      if (m && !/^(File|Category|Wikipedia|Template|Help):/i.test(m[1])) titles.add(m[1].trim());
    }
  }
  log('  ' + titles.size + ' titres');
  return [...titles];
}

// --- resolution Wikidata (QID <-> titre fr.wikipedia) ----------------------------

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function readEntities(entities, into) {
  for (const e of Object.values(entities || {})) {
    if (!e || e.missing !== undefined || !e.sitelinks || !e.sitelinks.frwiki) continue;
    into[e.id] = {
      id: e.id,
      title: e.sitelinks.frwiki.title,
      desc: (e.descriptions && e.descriptions.fr && e.descriptions.fr.value) || ''
    };
  }
}

async function resolveQids(qids) {
  const found = {};
  for (const ids of chunk(qids, 50)) {
    const r = await cached('qids:' + ids.join(','), async () => {
      const res = await api('www.wikidata.org', {
        action: 'wbgetentities', ids: ids.join('|'), props: 'sitelinks|descriptions',
        sitefilter: 'frwiki', languages: 'fr'
      });
      await sleep(1000);
      return res.entities;
    });
    readEntities(r, found);
  }
  return found;
}

async function resolveEnTitles(titles) {
  const found = {};
  for (const batch of chunk(titles, 50)) {
    const r = await cached('entitles:' + batch.join('|'), async () => {
      const res = await api('www.wikidata.org', {
        action: 'wbgetentities', sites: 'enwiki', titles: batch.join('|'), normalize: '1',
        props: 'sitelinks|descriptions', sitefilter: 'frwiki', languages: 'fr'
      });
      await sleep(1000);
      return res.entities;
    });
    readEntities(r, found);
  }
  return found;
}

// --- vues et images (fr.wikipedia) ---------------------------------------------------

async function fetchStats(items) {
  const byTitle = new Map(items.map((it) => [it.title, it]));
  const titles = [...byTitle.keys()];
  const batches = chunk(titles, 50);
  let i = 0;
  for (const batch of batches) {
    i++;
    if (i % 10 === 1) log('Vues Wikipedia : lot ' + i + '/' + batches.length);
    const r = await cached('stats:' + batch.join('|'), async () => {
      const res = await api('fr.wikipedia.org', {
        action: 'query', prop: 'pageviews|pageimages', pvipdays: '60', piprop: 'thumbnail', pithumbsize: '480',
        titles: batch.join('|'), redirects: '1'
      });
      await sleep(1200);
      return res.query;
    });
    const redirect = new Map((r.redirects || []).map((x) => [x.to, x.from]));
    const normal = new Map((r.normalized || []).map((x) => [x.to, x.from]));
    for (const page of r.pages || []) {
      const orig = byTitle.get(page.title) || byTitle.get(redirect.get(page.title)) ||
        byTitle.get(normal.get(redirect.get(page.title) || page.title));
      if (!orig || page.missing) continue;
      const days = Object.keys(page.pageviews || {}).sort().filter((d) => page.pageviews[d] != null).slice(-30);
      const sum = days.reduce((s, d) => s + page.pageviews[d], 0);
      orig.views = days.length ? Math.round(sum * 30 / days.length) : 0;
      orig.img = (page.thumbnail && page.thumbnail.source) || '';
      orig.title = page.title;
    }
  }
}

// --- assemblage ---------------------------------------------------------------------

async function build(name, candidates) {
  const items = candidates.map((c) => ({
    id: c.id, title: c.title, desc: c.desc, type: c.type, n: c.n || 0, img: '', views: 0
  }));
  log(name + ' : ' + items.length + ' candidats, lecture des vues...');
  await fetchStats(items);
  const kept = items.filter((it) => it.views >= MIN_VIEWS);
  kept.sort((a, b) => b.views - a.views);
  log(name + ' : ' + kept.length + ' pages avec >= ' + MIN_VIEWS + ' vues/mois');
  return kept;
}

function attach(rows, resolved, type) {
  const out = [];
  for (const row of rows) {
    const r = resolved[row.qid];
    if (r) out.push({ id: r.id, title: r.title, desc: r.desc, type, n: row.n });
  }
  return out;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : seen.add(it.id)));
}

function slim(it) {
  return { id: it.id, title: it.title, desc: it.desc, type: it.type, img: it.img, views: it.views };
}

// Mode rapide (--quick) : listes reduites (les pages les plus connues) pour tester vite.
const QUICK = process.argv.includes('--quick');
const top = (rows, k) => (QUICK ? rows.slice().sort((a, b) => b.n - a.n).slice(0, k) : rows);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (QUICK) log('MODE RAPIDE : listes reduites');

  const frPeopleRows = top(await francePeople(), 250);
  const frEventRows = top(await franceEvents(), 100);
  const wEventRows = top(await worldEvents(), 150);
  let vital = await vitalPeopleTitles();
  if (QUICK) vital = vital.filter((_, i) => i % Math.ceil(vital.length / 300) === 0);

  log('Resolution des titres fr.wikipedia...');
  const frPeopleRes = await resolveQids([...new Set(frPeopleRows.map((r) => r.qid))]);
  const frEventRes = await resolveQids([...new Set(frEventRows.map((r) => r.qid))]);
  const wEventRes = await resolveQids([...new Set(wEventRows.map((r) => r.qid))]);
  const vitalRes = await resolveEnTitles(vital);

  const frPeople = attach(frPeopleRows, frPeopleRes, 'person');
  const frEvents = attach(frEventRows, frEventRes, 'event');
  const wEvents = attach(wEventRows, wEventRes, 'event');
  const wPeople = Object.values(vitalRes).map((r) => ({ id: r.id, title: r.title, desc: r.desc, type: 'person', n: 0 }));

  const france = await build('France', dedupe([...frPeople, ...frEvents]));
  const world = await build('Monde', dedupe([...wPeople, ...wEvents, ...frEvents, ...frPeople.filter((p) => p.n >= 60)]));

  // Tier list : les 50 personnalites francaises les plus connues (nombre de
  // langues dans lesquelles l'article existe), avec photo.
  const nByQid = new Map(frPeople.map((p) => [p.id, p.n]));
  const tierlist = france
    .filter((it) => it.type === 'person' && it.img)
    .sort((a, b) => (nByQid.get(b.id) || 0) - (nByQid.get(a.id) || 0))
    .slice(0, TIERLIST_SIZE);

  const write = (file, data) => fs.writeFileSync(path.join(OUT, file), JSON.stringify(data.map(slim), null, 1) + '\n');
  write('france.json', france);
  write('world.json', world);
  write('tierlist.json', tierlist);
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), minViewsPerMonth: MIN_VIEWS,
    counts: { france: france.length, world: world.length, tierlist: tierlist.length }
  }, null, 2) + '\n');
  log('Termine : France ' + france.length + ', Monde ' + world.length + ', Tier list ' + tierlist.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
