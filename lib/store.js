/* Stockage de l'historique des tier lists.
 *  - Si SUPABASE_URL et SUPABASE_SERVICE_KEY sont definis : table Supabase `tierlists`
 *    (permanent, a utiliser en production sur Render).
 *  - Sinon : fichier local data/tierlists.local.json (pratique en developpement,
 *    efface a chaque redeploiement sur Render). */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);
const LOCAL_FILE = process.env.TIERLISTS_FILE || path.join(__dirname, '..', 'data', 'tierlists.local.json');

async function sb(pathAndQuery, options) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, Object.assign({}, options, {
    headers: Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, options && options.headers)
  }));
  if (!res.ok) throw new Error('Supabase ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.status === 204 ? null : res.json();
}

function readLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch (e) { return []; }
}

async function list(limit) {
  if (useSupabase) {
    const rows = await sb('tierlists?select=id,player_name,tiers,created_at&order=created_at.desc&limit=' + limit);
    return rows.map((r) => ({ id: r.id, name: r.player_name, tiers: r.tiers, createdAt: r.created_at }));
  }
  return readLocal().slice(-limit).reverse();
}

async function add(name, tiers) {
  if (useSupabase) {
    const rows = await sb('tierlists', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ player_name: name, tiers })
    });
    const r = rows[0];
    return { id: r.id, name: r.player_name, tiers: r.tiers, createdAt: r.created_at };
  }
  const all = readLocal();
  const entry = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), name, tiers, createdAt: new Date().toISOString() };
  all.push(entry);
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(all));
  return entry;
}

module.exports = { list, add, useSupabase };
