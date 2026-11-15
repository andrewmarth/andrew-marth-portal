// Roadhouse show times (roadhouse.html, CUM accounts only; portal.js checks the role). Each account's showings for the
// day it's working: the auditorium (1-14), when the movie starts and ends, and the rows it's assigned to there. Each
// showing keeps when its three steps were done (Theater Open, Drop, Pick Up).
//
// Saved on roadhouseShows/<account ID>: DAY (YYYY-MM-DD, Arizona time), SHOWS ([{ ID, AUDITORIUM, START, END ("HH:MM",
// 24-hour), ROWS: ['A', ...], OPEN DONE, DROP DONE, PICKUP DONE (ISO times, blank until done) }]) and UPDATED AT.
// A day runs from 6:00 AM to 6:00 AM Arizona time (MST all year), so the showings are erased at 6 AM: a list from an
// earlier day is never shown again and is deleted the next time it's read.
import { db } from './store.js';
import { randomBytes } from 'node:crypto';

// The rows in each auditorium (there is no row I in 10)
export const ROADHOUSE_ROWS = {
  1: 'ABCDEF', 2: 'ABCDEFG', 3: 'ABCDEF', 4: 'ABCDE', 5: 'ABCDEF', 6: 'ABCDE', 7: 'ABCD', 8: 'ABCDEF', 9: 'ABCDEF',
  10: 'ABCDEFGHJ', 11: 'ABCDE', 12: 'AB', 13: 'AB', 14: 'AB',
};
const STEP_FIELDS = { open: 'OPEN DONE', drop: 'DROP DONE', pickup: 'PICKUP DONE' };
const MAX_SHOWS = 20;
const AZ_OFFSET_MS = 7 * 3600e3;
const DAY_START_HOUR = 6;

// The show day a moment falls in (it starts at 6 AM Arizona time)
export const showDay = (ms = Date.now()) => new Date(ms - AZ_OFFSET_MS - DAY_START_HOUR * 3600e3).toISOString().slice(0, 10);
// A time of day ("HH:MM") on a show day, as a moment: times before 6 AM are after midnight (the next date)
export function showMoment(day, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return Date.parse(day + 'T00:00:00Z') + AZ_OFFSET_MS + (h * 60 + m) * 60000 + (h < DAY_START_HOUR ? 864e5 : 0);
}

const ref_ = id => db.collection('roadhouseShows').doc(String(id));
const view_ = s => ({
  id: s.ID, auditorium: s.AUDITORIUM, start: s.START, end: s.END, rows: Array.isArray(s.ROWS) ? s.ROWS : [],
  done: { open: s['OPEN DONE'] || '', drop: s['DROP DONE'] || '', pickup: s['PICKUP DONE'] || '' },
});
const time_ = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);

// Today's showings: { ok, day, shows: [{ id, auditorium, start, end, rows, done: { open, drop, pickup } }] }. An earlier
// day's list is deleted.
export async function roadhouseShows(id, now = Date.now()) {
  const day = showDay(now);
  const snap = await ref_(id).get();
  const d = snap.exists ? snap.data() : null;
  if (d && d.DAY !== day) await ref_(id).delete();
  return { ok: true, day, shows: d && d.DAY === day ? (d.SHOWS || []).map(view_) : [] };
}

// Saves today's showings (the whole list). body.shows: [{ id (a saved showing's, to keep its done steps), auditorium,
// start, end ("HH:MM", 24-hour; the end after the start), rows: ['A', ...] (at least one, from that auditorium) }]
export async function saveRoadhouseShows(id, body, now = Date.now()) {
  const list = Array.isArray(body.shows) ? body.shows : [];
  if (!list.length || list.length > MAX_SHOWS) return { ok: false, error: 'invalid_shows' };
  const day = showDay(now);
  const clean = [];
  for (const s of list) {
    const auditorium = Number(s && s.auditorium);
    const allowed = ROADHOUSE_ROWS[auditorium];
    if (!Number.isInteger(auditorium) || !allowed) return { ok: false, error: 'invalid_auditorium' };
    const start = time_(s.start), end = time_(s.end);
    if (!start || !end) return { ok: false, error: 'invalid_time' };
    if (showMoment(day, end) <= showMoment(day, start)) return { ok: false, error: 'end_before_start' };
    const rows = [...new Set((Array.isArray(s.rows) ? s.rows : []).map(r => String(r).trim().toUpperCase()))];
    if (!rows.length || rows.some(r => r.length !== 1 || !allowed.includes(r))) return { ok: false, error: 'invalid_rows' };
    rows.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
    clean.push({ id: String(s.id || ''), AUDITORIUM: auditorium, START: start, END: end, ROWS: rows });
  }
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(id));
    const d = snap.exists ? snap.data() : null;
    const old = {};
    if (d && d.DAY === day) (d.SHOWS || []).forEach(s => { old[s.ID] = s; });
    const used = new Set();
    const shows = clean.map(({ id: was, ...c }) => {
      const prev = was && old[was] && !used.has(was) ? old[was] : null;
      let ID = prev ? was : '';
      while (!ID || (!prev && (used.has(ID) || old[ID]))) ID = randomBytes(5).toString('hex');
      used.add(ID);
      const done = {};
      Object.values(STEP_FIELDS).forEach(f => { done[f] = prev ? prev[f] || '' : ''; });
      return { ID, ...c, ...done };
    });
    tx.set(ref_(id), { 'ACCOUNT ID': String(id), DAY: day, SHOWS: shows, 'UPDATED AT': new Date(now).toISOString() });
    return { ok: true, day, shows: shows.map(view_) };
  });
}

// Marks one showing's step done. body: { showId, step: 'open' | 'drop' | 'pickup' }
export async function completeRoadhouseStep(id, body, now = Date.now()) {
  const field = STEP_FIELDS[body.step];
  if (!field) return { ok: false, error: 'invalid_step' };
  const day = showDay(now);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(id));
    const d = snap.exists ? snap.data() : null;
    if (!d || d.DAY !== day) return { ok: false, error: 'shows_cleared' };
    const shows = d.SHOWS || [];
    const s = shows.find(x => x.ID === String(body.showId || ''));
    if (!s) return { ok: false, error: 'not_found' };
    if (!s[field]) {
      s[field] = new Date(now).toISOString();
      tx.update(ref_(id), { SHOWS: shows, 'UPDATED AT': new Date(now).toISOString() });
    }
    return { ok: true, day, shows: shows.map(view_) };
  });
}
