// Firestore, read and written for the API.
//
// rows(collection) gives every document as a "row": { COLUMN: text } with every known column present ('' when the
// document has no value), as display text: numbers as plain text ("495000", "0.025"), yes/no as
// "TRUE" / "FALSE", dates as "11/4/2026". Each row also carries two hidden (non-enumerable) properties: _id, the
// document ID, and _order, its place in the list.
//
// Writes take ordinary values (numbers, true/false, text, Date objects) and store them as real types:
// dates become "YYYY-MM-DD", account IDs become 10-digit text, and blank values remove the field.
// See firestore/LAYOUT.md.
// "Today", dates and times are Phoenix time (servers otherwise run on UTC)
process.env.TZ = process.env.TZ || 'America/Phoenix';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const PROJECT_ID = 'andrew-marth-portal';
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
export const db = getFirestore();

// Each collection's usual columns, in order (columns added later in the console are picked up too)
const COLUMNS = JSON.parse(readFileSync(new URL('./columns.json', import.meta.url)));

// Columns that hold a phone number / account ID, and other columns that are always text
export const isAccountColumn = h => /ACCOUNT ID( \d+)?$/.test(h) || /^RENT ITEM \d+ SPLIT ID$/.test(h) || h === 'PHONE NUMBER' || h === 'ASSIGNED';
const isTextColumn = h => /\bID\b/.test(h) || /^(ZIP|UNIT NUMBER|STREET ADDRESS|TITLE|TEXT LINE \d+)$/.test(h);

// --- Per-request cache (one request reads a collection once, unless it writes to it) ---
const requestStore = new AsyncLocalStorage();
export const inRequest = fn => requestStore.run(new Map(), fn);
const cache = () => requestStore.getStore() || new Map();

// --- Values ---
const pad = n => String(n).padStart(2, '0');

// Stored value -> its display text
function display(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v && typeof v.toDate === 'function') v = v.toDate();
  if (v instanceof Date) return (v.getMonth() + 1) + '/' + v.getDate() + '/' + v.getFullYear();
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return s;
  const date = Number(m[2]) + '/' + Number(m[3]) + '/' + m[1];
  return m[4] === undefined ? date : date + ' ' + Number(m[4]) + ':' + m[5] + ':' + m[6];
}

// Any value the code writes -> what Firestore stores (FieldValue.delete() for blank)
export function stored(column, value) {
  if (value === undefined || value === null || value === '') return FieldValue.delete();
  if (value instanceof Date) {
    const date = value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
    const midnight = !value.getHours() && !value.getMinutes() && !value.getSeconds();
    return midnight ? date : date + ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes()) + ':' + pad(value.getSeconds());
  }
  if (isAccountColumn(column)) {
    const digits = String(value).replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits || FieldValue.delete();
  }
  if (isTextColumn(column)) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value);
  if (/^(TRUE|FALSE)$/i.test(s.trim())) return s.trim().toUpperCase() === 'TRUE';
  // "11/4/2026" (the Settings card's date format) -> "2026-11-04"
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
  return s;
}

function toRow(collection, doc) {
  const data = doc.data();
  const row = {};
  (COLUMNS[collection] || []).forEach(c => { row[c] = ''; });
  Object.keys(data).forEach(k => { if (k !== '_order') row[k] = display(data[k]); });
  Object.defineProperty(row, '_id', { value: doc.id, enumerable: false });
  Object.defineProperty(row, '_order', { value: Number(data._order) || 0, enumerable: false });
  return row;
}

// --- Reading ---
// Every document of a collection as a row, in _order (oldest first)
export async function rows(collection) {
  const c = cache();
  if (!c.has(collection)) {
    c.set(collection, db.collection(collection).get().then(snap =>
      snap.docs.map(d => toRow(collection, d)).sort((a, b) => a._order - b._order)));
  }
  return c.get(collection);
}

// One document as a row, or null
export async function row(collection, id) {
  if (!id) return null;
  const all = await rows(collection);
  return all.find(r => r._id === String(id)) || null;
}

// The collection's column names: the usual ones, then any others its documents have
export async function columns(collection) {
  const out = (COLUMNS[collection] || []).slice();
  (await rows(collection)).forEach(r => Object.keys(r).forEach(k => { if (!out.includes(k)) out.push(k); }));
  return out;
}

// --- Writing (each write forgets that collection's cached rows) ---
const forget = collection => cache().delete(collection);
const storedFields = fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, stored(k, v)]));

export async function update(collection, id, fields) {
  forget(collection);
  await db.collection(collection).doc(String(id)).update(storedFields(fields));
}

// A new document after the existing ones. id: a chosen document ID (else automatic). Returns { id, order }.
export async function add(collection, fields, id) {
  forget(collection);
  const order = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const data = {};
  Object.entries(fields).forEach(([k, v]) => {
    const s = stored(k, v);
    if (!(s instanceof FieldValue)) data[k] = s;
  });
  data._order = order;
  const ref = id ? db.collection(collection).doc(String(id)) : db.collection(collection).doc();
  await ref.create(data);
  return { id: ref.id, order };
}

export async function remove(collection, id) {
  forget(collection);
  await db.collection(collection).doc(String(id)).delete();
}

// --- Locks ---
// Only one holder at a time across every running copy of the API. A lock left by a crashed request expires after 60s.
// wait: how long to keep trying (ms). Returns false if it couldn't be had in time (when wait is given as "try").
const LOCK_LEASE = 60000;
export async function withLock(name, fn, { wait = 20000, tryOnly = false } = {}) {
  const ref = db.collection('locks').doc(name);
  const token = Math.random().toString(36).slice(2);
  const deadline = Date.now() + wait;
  for (;;) {
    const got = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().until > Date.now()) return false;
      tx.set(ref, { until: Date.now() + LOCK_LEASE, token });
      return true;
    });
    if (got) break;
    if (Date.now() > deadline) {
      if (tryOnly) return false;
      throw new Error('Timed out waiting for the ' + name + ' lock');
    }
    await new Promise(r => setTimeout(r, 150 + Math.random() * 200));
  }
  try {
    return await fn();
  } finally {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().token === token) tx.delete(ref);
    }).catch(err => console.error('Could not release the ' + name + ' lock', err));
  }
}
