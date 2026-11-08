// Beds, baths, sqft, yearly taxes (and property type / year built when known) for an address, from the same RapidAPI
// property APIs the wholesale deal extractor uses (wholesale-extractor/index.js), tried in the same order. For the
// home page's New Seller Net form.
//
// Every request is counted on that API's wholesaleStatus document (the admin Usage card), the same way the extractor
// counts its own: REQUESTS THIS MONTH goes up, and when RapidAPI reports the requests left, USAGE / CAP / USAGE AS OF /
// RESETS AT are set from it. An API that's paused (PAUSED UNTIL) or at its cap is skipped, so no request is wasted.
//
// Environment: RAPIDAPI_KEY (from Secret Manager). Without it, lookups find nothing.
import { db } from './store.js';
import { FieldValue } from 'firebase-admin/firestore';

// Same order and wholesaleStatus names as the extractor's PROPERTY_PROVIDERS
const PROVIDERS = [
  { name: 'Redfin (RapidAPI)', status: 'REDFIN.COM DATA', lookup: a => redfinLookup(a) },
  { name: 'Realtor (RapidAPI)', status: 'REALTOR SEARCH', lookup: a => realtorStyleLookup(a, 'realtor-search.p.rapidapi.com', 'REALTOR SEARCH',
    { path: '/properties/auto-complete', param: 'input' }, { path: '/properties/detail', param: 'propertyId', home: d => d }) },
  { name: 'Redfin Base (RapidAPI)', status: 'REDFIN BASE', lookup: a => redfinBaseLookup(a) },
  { name: 'Realtor API Data (RapidAPI)', status: 'REALTOR API DATA', lookup: a => realtorStyleLookup(a, 'realtor-api-data.p.rapidapi.com', 'REALTOR API DATA',
    { path: '/search/autocomplete', param: 'query' }, { path: '/detail/properties', param: 'id', home: d => d.home }) },
  { name: 'US Realtor (RapidAPI)', status: 'US REALTOR', lookup: a => realtorStyleLookup(a, 'us-realtor.p.rapidapi.com', 'US REALTOR',
    { path: '/api/v1/auto-complete', param: 'query' }, { path: '/api/v1/property/details', param: 'property_id', home: d => d.home }) },
];
const FACTS = ['beds', 'baths', 'sqft', 'taxes'];

class OutOfRequestsError extends Error {}

/**
 * { facts: { beds, baths, sqft, taxes, propertyType, yearBuilt } (blank '' for anything not found), sources: [API names] }.
 * address: { street, city, state, zip } (a unit may be in street as "#12"). Never throws for a lookup problem.
 */
export async function lookupPropertyFacts(address) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const m = clean(address.street).match(/^(.*?)\s*(?:#|\b(?:unit|apt|ste)\b\.?)\s*([\w-]+)$/i);
  const a = { street: m ? clean(m[1]) : clean(address.street), unit: m ? m[2] : '', city: clean(address.city), state: clean(address.state), zip: clean(address.zip).slice(0, 5) };
  const empty = { beds: '', baths: '', sqft: '', taxes: '', propertyType: '', yearBuilt: '' };
  if (!process.env.RAPIDAPI_KEY || !a.street || !a.zip) return { facts: empty, sources: [] };

  const status = {};
  try { (await db.collection('wholesaleStatus').get()).docs.forEach(d => { status[d.id] = d.data(); }); } catch (e) { /* lookups still run */ }
  let found = null;
  const sources = [];
  for (const p of PROVIDERS) {
    if (skip_(status[p.status])) continue;
    try {
      const facts = await p.lookup(a);
      if (!facts) continue;
      sources.push(p.name);
      found = found ? fillBlanks_(found, facts) : facts;
      if (FACTS.every(k => found[k] !== '')) break;
    } catch (e) {
      console.log(`Property facts: ${p.name} failed for ${a.street}: ${e.message}`);
    }
  }
  const facts = { ...empty, ...(found || {}) };
  facts.propertyType = portalPropertyType_(facts.propertyType);
  return { facts, sources };
}

// Paused for being out of requests, or used up (by RapidAPI's count) and not yet reset
function skip_(s) {
  if (!s) return false;
  const now = phoenixStamp_(new Date());
  if (s['PAUSED UNTIL'] && String(s['PAUSED UNTIL']) > now) return true;
  const resetPassed = s['RESETS AT'] && String(s['RESETS AT']) <= now;
  return s['USAGE SOURCE'] === 'RapidAPI' && Number(s.CAP) > 0 && Number(s.USAGE) >= Number(s.CAP) && !resetPassed;
}

const fillBlanks_ = (facts, more) => {
  const out = { ...facts };
  for (const [k, v] of Object.entries(more)) if ((out[k] ?? '') === '' && v !== '') out[k] = v;
  return out;
};

// The page's options: Single Family, Townhome, Condo, Manufactured ('' when it's something else, or unknown)
function portalPropertyType_(v) {
  const t = String(v ?? '').replace(/_/g, ' ').toLowerCase();
  if (/mobile|manufactured/.test(t)) return 'Manufactured';
  if (/town ?(home|house)/.test(t)) return 'Townhome';
  if (/condo|co-?op/.test(t)) return 'Condo';
  if (/multi|duplex|triplex|fourplex|apartment|\bland\b|\blots?\b/.test(t)) return '';
  if (/single[- ]?family|\bhouse\b|\bhome\b|residence|residential/.test(t)) return 'Single Family';
  return '';
}

const toNumber_ = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? '' : n; };
const oneLine_ = a => `${a.street}${a.unit ? ' #' + a.unit : ''}, ${a.city}, ${a.state} ${a.zip}`;

// --- Redfin (ntd119/redfin-com-data): auto-complete (address -> home URL), then details ---
async function redfinLookup(a) {
  const host = 'redfin-com-data.p.rapidapi.com';
  const ac = await rapidApiGet_(host, 'REDFIN.COM DATA', '/properties/auto-complete', { query: oneLine_(a), limit: 10 });
  const houseNumber = (a.street.match(/^\d+/) || [''])[0];
  const homes = (Array.isArray(ac.data) ? ac.data : []).flatMap(g => g.rows || [])
    .filter(r => r.propertyId && r.url && r.url.includes(`/${houseNumber}-`) && r.url.includes(`-${a.zip}/`));
  const unitSlug = a.unit && `/unit-${String(a.unit).toLowerCase()}/`;
  const home = a.unit ? homes.find(r => r.url.toLowerCase().includes(unitSlug)) : homes.find(r => !/\/unit-/i.test(r.url)) || homes[0];
  if (!home) return null;
  const d = (await rapidApiGet_(host, 'REDFIN.COM DATA', '/properties/details', { url: home.url })).data || {};
  return redfinFacts_((d.aboveTheFold && d.aboveTheFold.addressSectionInfo) || {}, (d.belowTheFold && d.belowTheFold.publicRecordsInfo) || {}, d.statsInfo || {});
}

// --- Redfin Base (tvhaudev/redfin-base): detail (address -> home), then public records ---
async function redfinBaseLookup(a) {
  const host = 'redfin-base.p.rapidapi.com';
  const d = (await rapidApiGet_(host, 'REDFIN BASE', '/1.0/redfin/detail', { location: oneLine_(a) })).data || {};
  const info = (d.aboveTheFold && d.aboveTheFold.addressSectionInfo) || {};
  const addr = info.streetAddress || {};
  const houseNumber = (a.street.match(/^\d+/) || [''])[0];
  const sameUnit = String(addr.unitValue || '').toLowerCase() === String(a.unit || '').toLowerCase();
  if (String(addr.streetNumber) !== houseNumber || String(info.zip) !== a.zip || !sameUnit) return null;
  const ids = d.initialInfo || {};
  let records = {};
  if (ids.propertyId) {
    try {
      records = (await rapidApiGet_(host, 'REDFIN BASE', '/redfin/details/public-records-info', { propertyId: ids.propertyId, listingId: ids.listingId || '' })).data || {};
    } catch (e) {
      if (e instanceof OutOfRequestsError) throw e;
    }
  }
  return redfinFacts_(info, records, d.statsInfo || {});
}

const REDFIN_TYPE_CODES = { 3: 'Condo', 4: 'Multi-Family', 6: 'Single Family Residential', 13: 'Townhouse' };
function redfinFacts_(info, records, stats) {
  const basic = records.basicInfo || {};
  const listing = records.latestListingInfo || {};
  const latestTax = (records.allTaxInfo || []).filter(t => Number(t.taxesDue) > 0).sort((x, y) => (y.rollYear || 0) - (x.rollYear || 0))[0];
  const sqft = info.sqFt && typeof info.sqFt === 'object' ? info.sqFt.value : info.sqFt;
  const propertyType = [basic.propertyTypeName, listing.propertyTypeName, stats.propertyTypeDisplay]
    .find(v => typeof v === 'string' && /[a-z]/i.test(v)) || REDFIN_TYPE_CODES[info.propertyType] || '';
  const year = info.yearBuilt && typeof info.yearBuilt === 'object' ? info.yearBuilt.value : info.yearBuilt;
  const facts = {
    beds: toNumber_(info.beds ?? basic.beds),
    baths: toNumber_(info.baths ?? basic.baths),
    sqft: toNumber_(sqft ?? basic.totalSqFt ?? basic.sqFtFinished),
    taxes: latestTax ? Math.round(Number(latestTax.taxesDue)) : '',
    propertyType,
    yearBuilt: toNumber_(year ?? basic.yearBuilt),
  };
  return Object.values(facts).some(v => v !== '') ? facts : null;
}

// --- The Realtor.com wrappers: auto-complete (address -> property ID), then details ---
async function realtorStyleLookup(a, host, status, search, detail) {
  const ac = await rapidApiGet_(host, status, search.path, { [search.param]: oneLine_(a), limit: 10 });
  const houseNumber = (a.street.match(/^\d+/) || [''])[0];
  const line = r => String(r.line || '').replace(/\s+/g, ' ').trim();
  const homes = ((ac.data && ac.data.autocomplete) || []).filter(r => r.area_type === 'address' && r.mpr_id && r.postal_code === a.zip && line(r).startsWith(`${houseNumber} `));
  const hasUnit = r => /\b(unit|apt|ste)\b|#/i.test(r.line);
  const unitRe = a.unit && new RegExp(`(\\b(unit|apt|ste)\\b|#)\\s*${String(a.unit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const home = a.unit ? homes.find(r => unitRe.test(r.line)) : homes.find(r => !hasUnit(r));
  if (!home) return null;
  const d = detail.home((await rapidApiGet_(host, status, detail.path, { [detail.param]: home.mpr_id })).data || {}) || {};
  const desc = d.description || {};
  const latestTax = (d.tax_history || []).filter(t => Number(t.tax) > 0).sort((x, y) => (y.year || 0) - (x.year || 0))[0];
  const facts = {
    beds: toNumber_(desc.beds),
    baths: toNumber_(parseFloat(desc.baths_consolidated ?? desc.baths)),
    sqft: toNumber_(desc.sqft),
    taxes: latestTax ? Math.round(Number(latestTax.tax)) : '',
    propertyType: typeof desc.type === 'string' ? desc.type : '',
    yearBuilt: toNumber_(desc.year_built),
  };
  return Object.values(facts).some(v => v !== '') ? facts : null;
}

// --- RapidAPI requests, counted on the API's wholesaleStatus document ---
async function rapidApiGet_(host, status, path, params) {
  const url = `https://${host}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': host }, signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  // 429 / 403 are turned away before the API: no request spent
  const spent = res.status !== 429 && res.status !== 403;
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  const quota = res.status === 429 && /quota|exceeded|month/i.test(body);
  await recordRequest_(status, spent, quota ? '0' : remaining, res.headers.get('x-ratelimit-requests-limit'), res.headers.get('x-ratelimit-requests-reset'))
    .catch(e => console.log(`Could not count a ${status} request: ${e.message}`));
  if (res.ok) return JSON.parse(body);
  if (res.status === 403 || quota) throw new OutOfRequestsError(`HTTP ${res.status}`);
  throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
}

async function recordRequest_(status, spent, remaining, limit, reset) {
  const ref = db.collection('wholesaleStatus').doc(status);
  const now = new Date();
  const stamp = phoenixStamp_(now);
  const month = stamp.slice(0, 7);
  await db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data() || {};
    const sameMonth = old['COUNT MONTH'] === month;
    const values = {};
    if (spent) {
      values['REQUESTS THIS MONTH'] = sameMonth ? FieldValue.increment(1) : 1;
      if (!sameMonth) { values['COUNT MONTH'] = month; values['COUNTED SINCE'] = old['COUNT MONTH'] ? month + '-01 00:00:00' : stamp; }
      values['LAST REQUEST'] = stamp;
    }
    const left = remaining === null || remaining === '' ? NaN : Number(remaining);
    const cap = limit !== null && limit !== '' && Number(limit) > 0 ? Number(limit) : Number(old.CAP);
    if (Number.isFinite(left) && cap > 0) {
      values.USAGE = Math.max(0, Math.round(cap - left));
      values.CAP = Math.round(cap);
      values['USAGE SOURCE'] = 'RapidAPI';
      values['USAGE AS OF'] = stamp;
      const seconds = reset === null || reset === '' ? NaN : Number(reset);
      if (Number.isFinite(seconds) && seconds >= 0) values['RESETS AT'] = phoenixStamp_(new Date(now.getTime() + seconds * 1000));
    } else if (spent && old['USAGE SOURCE'] !== 'RapidAPI') {
      // An API that doesn't report usage: USAGE is the count
      values.USAGE = sameMonth ? FieldValue.increment(1) : 1;
      values['USAGE SOURCE'] = 'Counted';
      values['USAGE AS OF'] = stamp;
    }
    if (Object.keys(values).length) tx.set(ref, values, { merge: true });
  });
}

// "2026-11-08 12:21:51", Phoenix time (how the portal and the extractor store times)
function phoenixStamp_(date) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
