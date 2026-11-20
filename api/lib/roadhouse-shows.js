// Roadhouse show times (roadhouse.html, CUM accounts only; portal.js checks the role). Each account's showings for the
// day it's working: the auditorium (1-14), when the movie starts and ends, the rows it's assigned to there, and whether
// it's the last showing of the night. Each showing keeps when its three steps were done (Theater Open, Drop, Pick Up;
// a last showing's Pick Up is Reset Theater). Restroom checks are in the same list: a time and when it was done.
//
// Saved on roadhouseShows/<account ID>: DAY (YYYY-MM-DD, Arizona time), LAST CALL ("HH:MM", 24-hour; blank: none),
// SHOWS ([{ ID, AUDITORIUM, START, END ("HH:MM", 24-hour), ROWS: ['A', ...], LAST SHOWING (true / false), OPEN DONE,
// DROP DONE, PICKUP DONE (ISO times, blank until done) }, or a restroom check { ID, KIND: 'restroom', TIME, CHECK DONE }])
// and UPDATED AT.
// A day runs from 6:00 AM to 6:00 AM Arizona time (MST all year), so the showings are erased at 6 AM: a list from an
// earlier day is never shown again and is deleted the next time it's read.
import { db } from './store.js';
import { randomBytes } from 'node:crypto';

// The rows in each auditorium (there is no row I in 10)
export const ROADHOUSE_ROWS = {
  1: 'ABCDEF', 2: 'ABCDEFG', 3: 'ABCDEF', 4: 'ABCDE', 5: 'ABCDEF', 6: 'ABCDE', 7: 'ABCD', 8: 'ABCDEF', 9: 'ABCDEF',
  10: 'ABCDEFGHJ', 11: 'ABCDE', 12: 'AB', 13: 'AB', 14: 'AB',
};
// Each kind's steps (step key → the field with when it was done)
const STEP_FIELDS = { show: { open: 'OPEN DONE', drop: 'DROP DONE', pickup: 'PICKUP DONE' }, restroom: { check: 'CHECK DONE' } };
const MAX_ITEMS = 30;
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
const kind_ = s => (s.KIND === 'restroom' ? 'restroom' : 'show');
const doneOf_ = s => Object.fromEntries(Object.entries(STEP_FIELDS[kind_(s)]).map(([k, f]) => [k, s[f] || '']));
const view_ = s => (kind_(s) === 'restroom'
  ? { id: s.ID, kind: 'restroom', time: s.TIME, done: doneOf_(s) }
  : { id: s.ID, kind: 'show', auditorium: s.AUDITORIUM, start: s.START, end: s.END, rows: Array.isArray(s.ROWS) ? s.ROWS : [],
    last: s['LAST SHOWING'] === true, done: doneOf_(s) });
const reply_ = (day, d) => ({ ok: true, day, lastCall: (d && d['LAST CALL']) || '', shows: ((d && d.SHOWS) || []).map(view_) });
const time_ = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);

// Today's list: { ok, day, lastCall, shows: [{ id, kind: 'show', auditorium, start, end, rows, last, done: { open, drop,
// pickup } } or { id, kind: 'restroom', time, done: { check } }] }. An earlier day's list is deleted.
export async function roadhouseShows(id, now = Date.now()) {
  const day = showDay(now);
  const snap = await ref_(id).get();
  const d = snap.exists ? snap.data() : null;
  if (d && d.DAY !== day) await ref_(id).delete();
  return reply_(day, d && d.DAY === day ? d : null);
}

// Saves today's list (the whole list; it can be empty) and last call. body.shows: [{ id (a saved one's, to keep its done
// steps), auditorium, start, end ("HH:MM", 24-hour; the end after the start), rows: ['A', ...] (at least one, from that
// auditorium), last (true: the last showing of the night) } or { id, kind: 'restroom', time }]; body.lastCall: "HH:MM"
// or blank for none
export async function saveRoadhouseShows(id, body, now = Date.now()) {
  const list = Array.isArray(body.shows) ? body.shows : [];
  if (list.length > MAX_ITEMS) return { ok: false, error: 'invalid_shows' };
  const lastCall = body.lastCall ? time_(body.lastCall) : '';
  if (lastCall === null) return { ok: false, error: 'invalid_last_call' };
  const day = showDay(now);
  const clean = [];
  for (const s of list) {
    if (s && s.kind === 'restroom') {
      const time = time_(s.time);
      if (!time) return { ok: false, error: 'invalid_time' };
      clean.push({ id: String(s.id || ''), KIND: 'restroom', TIME: time });
      continue;
    }
    const auditorium = Number(s && s.auditorium);
    const allowed = ROADHOUSE_ROWS[auditorium];
    if (!Number.isInteger(auditorium) || !allowed) return { ok: false, error: 'invalid_auditorium' };
    const start = time_(s.start), end = time_(s.end);
    if (!start || !end) return { ok: false, error: 'invalid_time' };
    if (showMoment(day, end) <= showMoment(day, start)) return { ok: false, error: 'end_before_start' };
    const rows = [...new Set((Array.isArray(s.rows) ? s.rows : []).map(r => String(r).trim().toUpperCase()))];
    if (!rows.length || rows.some(r => r.length !== 1 || !allowed.includes(r))) return { ok: false, error: 'invalid_rows' };
    rows.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
    clean.push({ id: String(s.id || ''), AUDITORIUM: auditorium, START: start, END: end, ROWS: rows, 'LAST SHOWING': s.last === true });
  }
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(id));
    const d = snap.exists ? snap.data() : null;
    const old = {};
    if (d && d.DAY === day) (d.SHOWS || []).forEach(s => { old[s.ID] = s; });
    const used = new Set();
    const shows = clean.map(({ id: was, ...c }) => {
      // (a saved one keeps its done steps, unless it's been changed into the other kind)
      const prev = was && old[was] && !used.has(was) && kind_(old[was]) === kind_(c) ? old[was] : null;
      let ID = prev ? was : '';
      while (!ID || (!prev && (used.has(ID) || old[ID]))) ID = randomBytes(5).toString('hex');
      used.add(ID);
      const done = {};
      Object.values(STEP_FIELDS[kind_(c)]).forEach(f => { done[f] = prev ? prev[f] || '' : ''; });
      return { ID, ...c, ...done };
    });
    const saved = { 'ACCOUNT ID': String(id), DAY: day, 'LAST CALL': lastCall, SHOWS: shows, 'UPDATED AT': new Date(now).toISOString() };
    tx.set(ref_(id), saved);
    return reply_(day, saved);
  });
}

// Marks one showing's (or restroom check's) step done (completeRoadhouseStep; done again keeps the first time) or not
// done (undoRoadhouseStep). body: { showId, step: 'open' | 'drop' | 'pickup' (a showing) or 'check' (a restroom check) }
export const completeRoadhouseStep = (id, body, now = Date.now()) => setStep_(id, body, now, true);
export const undoRoadhouseStep = (id, body, now = Date.now()) => setStep_(id, body, now, false);
async function setStep_(id, body, now, done) {
  const day = showDay(now);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(id));
    const d = snap.exists ? snap.data() : null;
    if (!d || d.DAY !== day) return { ok: false, error: 'shows_cleared' };
    const shows = d.SHOWS || [];
    const s = shows.find(x => x.ID === String(body.showId || ''));
    if (!s) return { ok: false, error: 'not_found' };
    const field = STEP_FIELDS[kind_(s)][body.step];
    if (!field) return { ok: false, error: 'invalid_step' };
    const was = s[field] || '';
    const next = done ? was || new Date(now).toISOString() : '';
    if (next !== was) {
      s[field] = next;
      tx.update(ref_(id), { SHOWS: shows, 'UPDATED AT': new Date(now).toISOString() });
    }
    return reply_(day, d);
  });
}
