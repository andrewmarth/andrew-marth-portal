// Copies every Portal sheet into Firestore, following migration/FIRESTORE_LAYOUT.md.
//
//   node migration/copy-sheets.mjs --dry-run          read and convert everything, write nothing (preview in migration/preview.json)
//   node migration/copy-sheets.mjs                    write; fails if a target collection already has documents
//   node migration/copy-sheets.mjs --wipe             empty the target collections first, then write (the cutover re-copy)
//   ... --only accounts,pages                         just those collections
//
// Sheets are read as tiffany@andrewmarth.com through the portal-api service account's domain-wide delegation
// (read-only scope). Firestore is written with your own gcloud sign-in. No npm packages needed (Node 18+).
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const GCLOUD = (process.env.LOCALAPPDATA || '') + '\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
const SA = 'portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com';
const SUBJECT = 'tiffany@andrewmarth.com';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/andrew-marth-portal/databases/(default)/documents';

// Each sheet: its spreadsheet, the collection it goes to, and how documents are named
// (idColumn: that column's value; doc: one fixed document; neither: automatic IDs)
const SOURCES = [
  { sheet: '1u0ZFiybLfrJVs3N0Bqm1cAnOotSXvc9iJK0j_rp1etg', tab: 'ACCOUNT_LIST', collection: 'accounts', idColumn: 'ACCOUNT ID' },
  { sheet: '1yOSed7PINGBjqUiAihWgvhKNf8W6spchblTD1jIi2iQ', tab: 'PAGE_LIST', collection: 'income', idColumn: 'ACCOUNT ID' },
  { sheet: '15IiTLTwAaM7ePEWmj7fpaeSoV4-xqAbr6ZTWNnzKuwA', tab: 'PAGE_LIST', collection: 'pages', idColumn: 'PAGE ID' },
  { sheet: '13hPK8h-UBfPkO0uzjsrPea5C5-3XzrJvc19AQmare7I', tab: 'LOAN_PRODUCTS', collection: 'loanProducts' },
  { sheet: '1E8Ob2FBUuoW7VCddMZJcacqqxpcOO8O5ym6agEDTZ8w', tab: 'PAGE_LIST', collection: 'settings', doc: 'interestRate' },
  { sheet: '1UBrhEIC44CsGioc7NvNQsI4G9OzF1DuRoUWifj0HOlU', tab: 0, collection: 'homeInspectors' },
  { sheet: '1mm9zcVYjg4JyzQzAYj3TqTMHZILkW4QYzdgWamHbUd4', tab: 0, collection: 'sewerInspectors' },
  { sheet: '199Yai63C7Fm5L0kNNb2SLCUOULFrDePz65K3Vyo6QwM', tab: 0, collection: 'termiteInspectors' },
  { sheet: '1cAi5-nh5V7YX88jFcr2ZQhRpx6K9z2UOEeF2JhWFnA4', tab: 'TRANSACTIONS', collection: 'cumTransactions' },
  { sheet: '1HZv-RQaWEawyiHs2Nrj-o_Nk3ad4L5-c3aW4TGtASAM', tab: 'RECURRING', collection: 'cumBalances' },
  { sheet: '12aIo0maV2qzEylH6nOfJYR-8O9aEUqlE-BywcDZcOlQ', tab: 0, collection: 'wholesaleDeals' },
  { sheet: '16ZhBm5WgywQx8dZlE_7tksz6te26AZC2P8fq8U7A6E8', tab: 0, collection: 'links' },
  // One tab per category; a row's CATEGORY says which tab it was on
  { sheet: '1s8ll4sD2TqN6qP7hAp2P9eG0a5G6sTevR-kGYQym_Do', tab: 'all', collection: 'documents', categoryFromTab: true },
  { sheet: '1CikwhTyAJtXr62br7sGSfOIRGTQ9ua9cp7bKNu2Q5oc', tab: 0, collection: 'tasks', idColumn: 'TASK ID' },
  { sheet: '1RXuoPZDbDpwJm3w6wXv-4vV5VNoTVQIS-NwaQ5SA1Lg', tab: 'SIGNATURES', collection: 'signatures' },
];

// Columns that hold a phone number / account ID: stored as the 10-digit text the API uses
// (same rule as api/lib/store.js)
const isAccountColumn = h => /ACCOUNT ID( \d+)?$/.test(h) || /^RENT ITEM \d+ SPLIT ID$/.test(h) || h === 'PHONE NUMBER' || h === 'ASSIGNED';
// Other columns that are text even when they look like numbers
const isTextColumn = h => /\bID\b/.test(h) || /^(ZIP|UNIT NUMBER|STREET ADDRESS|TITLE|TEXT LINE \d+)$/.test(h);

// --- Google auth ---
const gcloudToken = () => execSync(`"${GCLOUD}" auth print-access-token`).toString().trim();
async function sheetsToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iss: SA, sub: SUBJECT, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' });
  const signed = await call(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA}:signJwt`, gcloudToken(),
    { method: 'POST', body: JSON.stringify({ payload }) });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + signed.signedJwt });
  const json = await res.json();
  if (!json.access_token) throw new Error('Could not get a Sheets token: ' + JSON.stringify(json));
  return json.access_token;
}
async function call(url, token, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url.split('?')[0]} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// --- Converting one cell ---
const pad = n => String(n).padStart(2, '0');
function convert(header, value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (isAccountColumn(header)) {
    const digits = String(value).replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits || undefined;
  }
  if (isTextColumn(header)) return String(value).trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value).trim();
  if (s === '') return undefined;
  if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase() === 'TRUE';
  // Dates come as the sheet shows them: 11/4/2026, or 11/4/2026 15:04:05 with a time
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ([AP]M))?)?$/i);
  if (m) {
    const date = m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
    if (m[4] === undefined) return date;
    let hour = Number(m[4]);
    if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
    return date + ' ' + pad(hour) + ':' + m[5] + ':' + (m[6] || '00');
  }
  return s;
}

// --- Reading a sheet into documents ---
async function readSource(src, token) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.sheet}?fields=sheets.properties(sheetId,title)`, token);
  const tabs = src.tab === 'all' ? meta.sheets.map(s => s.properties)
    : [meta.sheets.map(s => s.properties).find(p => (typeof src.tab === 'number' ? p.sheetId === src.tab : p.title === src.tab))];
  if (!tabs[0]) throw new Error(`${src.collection}: tab "${src.tab}" not found`);
  const docs = [];
  for (const [t, tab] of tabs.entries()) {
    const range = encodeURIComponent("'" + tab.title + "'");
    const { values = [] } = await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.sheet}/values/${range}` +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING', token);
    const headers = (values[0] || []).map(h => String(h).trim());
    values.slice(1).forEach((row, i) => {
      if (!row.some(v => String(v).trim() !== '')) return;
      const fields = {};
      headers.forEach((h, c) => { const v = h ? convert(h, row[c]) : undefined; if (v !== undefined) fields[h] = v; });
      if (src.categoryFromTab && !fields['CATEGORY']) fields['CATEGORY'] = tab.title;
      // Sheet row number (2 = first row under the headers); tabs after the first follow on after it
      fields._order = t * 100000 + i + 2;
      docs.push(fields);
    });
  }
  const used = new Set();
  return docs.map(fields => {
    let id = src.doc || (src.idColumn ? String(fields[src.idColumn] || '') : randomBytes(15).toString('base64url').replace(/[-_]/g, 'x').slice(0, 20));
    if (!id) throw new Error(`${src.collection}: a row has no ${src.idColumn} (sheet row ${fields._order})`);
    if (used.has(id)) throw new Error(`${src.collection}: two rows have the same ${src.idColumn || 'ID'} "${id}"`);
    used.add(id);
    return { id, fields };
  });
}

// --- Firestore ---
function encode(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
async function listIds(collection, token) {
  const ids = [];
  let pageToken = '';
  do {
    const r = await call(`${FIRESTORE}/${collection}?pageSize=300&mask.fieldPaths=_order${pageToken ? '&pageToken=' + pageToken : ''}`, token);
    (r.documents || []).forEach(d => ids.push(d.name));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return ids;
}
async function commit(writes, token) {
  for (let i = 0; i < writes.length; i += 400) {
    await call(`${FIRESTORE}:commit`, token, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
  }
}

// --- Main ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const wipe = args.includes('--wipe');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') ? new Set(onlyArg.split(',')) : null;
const sources = SOURCES.filter(s => !only || only.has(s.collection));

const sheets = await sheetsToken();
const plan = [];
for (const src of sources) {
  const docs = await readSource(src, sheets);
  plan.push({ src, docs });
  console.log(`${src.collection.padEnd(18)} ${String(docs.length).padStart(4)} documents`);
}
if (dryRun) {
  const preview = {};
  plan.forEach(({ src, docs }) => { preview[src.collection] = docs; });
  writeFileSync(new URL('./preview.json', import.meta.url), JSON.stringify(preview, null, 1));
  console.log('\nDry run: nothing written. Converted data is in migration/preview.json');
  process.exit(0);
}

const fs = gcloudToken();
for (const { src } of plan) {
  const existing = await listIds(src.collection, fs);
  if (!existing.length) continue;
  if (!wipe) throw new Error(`${src.collection} already has ${existing.length} documents. Run with --wipe to replace them.`);
  await commit(existing.map(name => ({ delete: name })), fs);
  console.log(`Wiped ${existing.length} from ${src.collection}`);
}
for (const { src, docs } of plan) {
  const writes = docs.map(({ id, fields }) => ({
    update: { name: `projects/andrew-marth-portal/databases/(default)/documents/${src.collection}/${id}`,
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) },
  }));
  await commit(writes, fs);
  const after = await listIds(src.collection, fs);
  console.log(`Wrote ${src.collection}: ${docs.length} documents (Firestore now has ${after.length})`);
  if (after.length !== docs.length) throw new Error(`${src.collection}: count mismatch`);
}
console.log('\nDone.');
