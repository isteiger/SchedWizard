'use strict';
const BASE = 'https://selfservice.uncc.edu/StudentRegistrationSsb/';
const START = BASE + 'ssb/term/termSelection?mode=plan';

chrome.action.onClicked.addListener(async (tab) => {
  const onSite = !!(tab && tab.url && tab.url.startsWith(BASE));
  if (onSite) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SW_TOGGLE' });
      return;
    } catch (e) {
      // Content script not present (tab was open before install) - reload so it injects.
      try { await chrome.tabs.reload(tab.id); return; } catch (e2) { /* fall through */ }
    }
  }
  chrome.tabs.create({ url: START });
});

// ---------------------------------------------------------------- RateMyProfessors lookup
const RMP_URL = 'https://www.ratemyprofessors.com/graphql';
const RMP_SCHOOL_ID = 'U2Nob29sLTEyNTM='; // UNC Charlotte
const RMP_QUERY = 'query($text:String!,$sid:ID!){ newSearch { teachers(query:{text:$text, schoolID:$sid}) { edges { node { legacyId firstName lastName avgRating avgDifficulty wouldTakeAgainPercent numRatings department ratings(first:1){ edges { node { date } } } } } } } }';
const RMP_PREFIX = 'sw_rmp_v1_';
const RMP_HIT_TTL = 3 * 24 * 3600 * 1000;
const RMP_MISS_TTL = 24 * 3600 * 1000;
const RMP_MAX_ENTRIES = 400;
const RMP_CONCURRENCY = 4;
const RMP_ALIASES = {
  'Dave Naylor': 'David Naylor', 'Jim Conrad': 'James Conrad', 'Tom Moyer': 'Thomas Moyer',
  'Sam Shue': 'Samuel Shue', 'Becky Roeder': 'Rebecca Roeder', 'Katie Hogan': 'Kathleen Hogan',
  'Jeff Raquet': 'Jeffrey Raquet', 'Dave Weggel': 'David Weggel', 'Kosta Falaggis': 'Konstantinos Falaggis',
  'Zbyszek Ras': 'Zbigniew Ras',
};
const RMP_ALIASES_NORM = {};
function rmpNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/-/g, ' ').replace(/[^a-z0-9 ']/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}
Object.keys(RMP_ALIASES).forEach((k) => { RMP_ALIASES_NORM[rmpNorm(k)] = RMP_ALIASES[k]; });

// Banner "Last, First" is not used; names arrive as "First [Middle] Last".
function rmpSplit(name) {
  const parts = rmpNorm(name).split(' ').filter(Boolean);
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '', all: parts };
}

function rmpMatches(banner, node) {
  const b = rmpSplit(banner);
  const rf = rmpNorm(node.firstName), rl = rmpNorm(node.lastName);
  if (!b.first || !b.last || !rl) return false;
  const bFull = b.all.join(' '), rFull = (rf + ' ' + rl).trim();
  if (bFull === rFull) return true;
  if (b.first === rl && b.last === rf) return true; // swapped
  const rfirst = rf.split(' ')[0] || '';
  const pre = (a, c) => a.length >= 3 && c.length >= 3 ? a.slice(0, 3) === c.slice(0, 3) : a === c && !!a;
  const firstOk = pre(b.first, rfirst);
  if (b.last === rl && firstOk) return true;
  if (rl.includes(b.last) && firstOk) return true;
  return false;
}

async function rmpFetch(text, useAuth) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth) headers.Authorization = 'Basic dGVzdDp0ZXN0';
  return fetch(RMP_URL, {
    method: 'POST', headers,
    body: JSON.stringify({ query: RMP_QUERY, variables: { text, sid: RMP_SCHOOL_ID } }),
  });
}

async function rmpSearch(text) {
  let resp = await rmpFetch(text, false);
  if (resp.status === 401 || resp.status === 403) resp = await rmpFetch(text, true);
  if (!resp.ok) throw new Error('RMP HTTP ' + resp.status);
  const json = await resp.json();
  const edges = json && json.data && json.data.newSearch && json.data.newSearch.teachers && json.data.newSearch.teachers.edges;
  return (edges || []).map((e) => e && e.node).filter(Boolean);
}

function rmpInfo(node) {
  const re = node.ratings && node.ratings.edges && node.ratings.edges[0];
  const wta = Number(node.wouldTakeAgainPercent);
  return {
    legacyId: node.legacyId, firstName: node.firstName, lastName: node.lastName,
    avgRating: Number(node.avgRating), avgDifficulty: Number(node.avgDifficulty),
    wouldTakeAgainPercent: isFinite(wta) && node.wouldTakeAgainPercent != null ? wta : -1,
    numRatings: Number(node.numRatings) || 0, department: node.department || '',
    lastRatingDate: (re && re.node && re.node.date) || null,
    url: 'https://www.ratemyprofessors.com/professor/' + node.legacyId,
  };
}

// Resolves to RmpInfo or null (no data); throws only on network/HTTP failure.
async function rmpLookup(name) {
  const aliased = RMP_ALIASES_NORM[rmpNorm(name)] || name;
  const { last } = rmpSplit(aliased);
  if (!last) return null;
  const nodes = await rmpSearch(last);
  let best = null;
  for (const n of nodes) {
    if (!rmpMatches(aliased, n)) continue;
    if (!best || (Number(n.numRatings) || 0) > (Number(best.numRatings) || 0)) best = n;
  }
  if (!best || !(Number(best.numRatings) > 0)) return null;
  return rmpInfo(best);
}

function storageGet(keys) {
  return new Promise((res) => { try { chrome.storage.local.get(keys, (r) => { void chrome.runtime.lastError; res(r || {}); }); } catch (e) { res({}); } });
}
function storageSet(obj) {
  return new Promise((res) => { try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); } catch (e) { res(); } });
}

async function rmpPrune() {
  const all = await storageGet(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(RMP_PREFIX));
  if (keys.length <= RMP_MAX_ENTRIES) return;
  keys.sort((a, b) => ((all[a] && all[a].ts) || 0) - ((all[b] && all[b].ts) || 0));
  const drop = keys.slice(0, keys.length - RMP_MAX_ENTRIES);
  await new Promise((res) => { try { chrome.storage.local.remove(drop, () => { void chrome.runtime.lastError; res(); }); } catch (e) { res(); } });
}

async function rmpGetOne(name) {
  const key = RMP_PREFIX + rmpNorm(name);
  try {
    const got = (await storageGet(key))[key];
    if (got && typeof got.ts === 'number') {
      const ttl = got.data ? RMP_HIT_TTL : RMP_MISS_TTL;
      if (Date.now() - got.ts < ttl) return got.data || null;
    }
  } catch (e) { /* fall through to network */ }
  try {
    const data = await rmpLookup(name);
    await storageSet({ [key]: { data, ts: Date.now() } });
    return data;
  } catch (e) {
    return null; // network error: don't cache
  }
}

async function rmpGetMany(names) {
  const uniq = Array.from(new Set((names || []).filter((n) => typeof n === 'string' && n.trim()))).slice(0, 200);
  const results = {};
  let next = 0;
  async function worker() {
    while (next < uniq.length) {
      const name = uniq[next++];
      try { results[name] = await rmpGetOne(name); } catch (e) { results[name] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RMP_CONCURRENCY, uniq.length) }, worker));
  try { await rmpPrune(); } catch (e) { /* ignore */ }
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SW_RMP') return false;
  rmpGetMany(msg.names).then((results) => sendResponse({ results }), () => sendResponse({ results: {} }));
  return true;
});
