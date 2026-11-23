// roadhouseservers.com: the theater's one shared show schedule, a document per show day. Managers (MANAGER accounts;
// portal.js checks the roles) enter the showings and last call (Showtime Dashboard); server leads (SERVER LEAD) assign
// each showing's rows to servers (SERVER accounts: each row to one server at most) and add restroom checks, one server
// each (Lead Dashboard). Both work on today and the next 4 days. Each server sees only their own rows and restroom checks
// for today (roadhouseAssignments) and marks their own steps done; one server's Drop doesn't change another's.
//
// Saved on roadhouseSchedule/<DAY> (YYYY-MM-DD, Arizona time; a day runs 6 AM to 6 AM, see roadhouse-shows.js): LAST CALL
// ("HH:MM", 24-hour; blank: none), SHOWS ([{ ID, AUDITORIUM, START, END, LAST SHOWING, ASSIGNMENTS: [{ SERVER (account
// ID), ROWS: ['A', ...], OPEN DONE, DROP DONE, PICKUP DONE (ISO times, blank until done) }], LOG: the lead's floorplan
// changes, newest first, the last 20 ([{ AT, BY (the lead's name), ROWS: [{ ROW, FROM, TO (server names; blank: Unassigned) }] }]) }, or a restroom check
// { ID, KIND: 'restroom', TIME, SERVER, CHECK DONE }]), UPDATED AT and UPDATED BY (the account that last changed it).
// Days are kept (a past day is just never shown again).
import { db } from './store.js';
import { randomBytes } from 'node:crypto';
import { ROADHOUSE_ROWS, showDay, showMoment } from './roadhouse-shows.js';

const ASSIGNMENT_STEPS = { open: 'OPEN DONE', drop: 'DROP DONE', pickup: 'PICKUP DONE' };
const MAX_ITEMS = 40;
const LOG_MAX = 20;   // a showing's floorplan changes kept
const DAYS_AHEAD = 4;
const ref_ = day => db.collection('roadhouseSchedule').doc(day);
const time_ = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);
const isRestroom_ = s => s.KIND === 'restroom';
const newId_ = taken => { let id; do { id = randomBytes(5).toString('hex'); } while (taken.has(id)); return id; };
const doneOf_ = (rec, fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, rec[f] || '']));

// The show days that can be opened: today and the next DAYS_AHEAD ("YYYY-MM-DD")
export function scheduleDays(now = Date.now()) {
  const today = showDay(now);
  return Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => new Date(Date.parse(today + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10));
}
// body.day if it's one of those (blank: today), else null
const dayOf_ = (day, now) => { const days = scheduleDays(now); return !day ? days[0] : days.includes(String(day)) ? String(day) : null; };

// The whole day, for managers and leads: { ok, day, days, lastCall, shows: [{ id, kind: 'show', auditorium, start, end,
// last, assignments: [{ server, rows, done }] } or { id, kind: 'restroom', time, server, done: { check } }], servers }
function fullView_(day, d, servers, now) {
  return {
    ok: true, day, days: scheduleDays(now), lastCall: (d && d['LAST CALL']) || '', servers,
    shows: ((d && d.SHOWS) || []).map(s => (isRestroom_(s)
      ? { id: s.ID, kind: 'restroom', time: s.TIME, server: s.SERVER, done: { check: s['CHECK DONE'] || '' } }
      : { id: s.ID, kind: 'show', auditorium: s.AUDITORIUM, start: s.START, end: s.END, last: s['LAST SHOWING'] === true,
        assignments: (s.ASSIGNMENTS || []).map(a => ({ server: a.SERVER, rows: a.ROWS || [], done: doneOf_(a, ASSIGNMENT_STEPS) })),
        log: (s.LOG || []).map(l => ({ at: l.AT, by: l.BY, rows: (l.ROWS || []).map(c => ({ row: c.ROW, from: c.FROM, to: c.TO })) })) })),
  };
}

// One server's part of the day, in the shape the Server Dashboard already uses: { ok, day, lastCall, shows: [{ id,
// kind: 'show', auditorium, start, end, rows (theirs), last, done (theirs) } or { id, kind: 'restroom', time, done }] }
function serverView_(day, d, id) {
  const shows = [];
  ((d && d.SHOWS) || []).forEach(s => {
    if (isRestroom_(s)) {
      if (s.SERVER === id) shows.push({ id: s.ID, kind: 'restroom', time: s.TIME, done: { check: s['CHECK DONE'] || '' } });
      return;
    }
    const a = (s.ASSIGNMENTS || []).find(x => x.SERVER === id);
    if (a) shows.push({ id: s.ID, kind: 'show', auditorium: s.AUDITORIUM, start: s.START, end: s.END, rows: a.ROWS || [],
      last: s['LAST SHOWING'] === true, done: doneOf_(a, ASSIGNMENT_STEPS) });
  });
  return { ok: true, day, lastCall: (d && d['LAST CALL']) || '', shows };
}

// Managers and leads: a day's schedule (body.day: one of scheduleDays; blank: today) and the servers to assign
// (servers: [{ id, name }])
export async function roadhouseSchedule(body, servers, now = Date.now()) {
  const day = dayOf_(body.day, now);
  if (!day) return { ok: false, error: 'invalid_day' };
  const snap = await ref_(day).get();
  return fullView_(day, snap.exists ? snap.data() : null, servers, now);
}

// One change to a day's schedule, made in a transaction against the schedule as it is now (so two people saving different
// things don't undo each other). change(shows, d) edits the list (and d) in place, or returns an error code.
async function changeDay_(day, who, servers, now, change) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(day));
    const d = snap.exists ? snap.data() : { DAY: day, 'LAST CALL': '', SHOWS: [] };
    const shows = (d.SHOWS || []).slice();
    const error = change(shows, d);
    if (error) return { ok: false, error };
    const saved = { DAY: day, 'LAST CALL': d['LAST CALL'] || '', SHOWS: shows, 'UPDATED AT': new Date(now).toISOString(), 'UPDATED BY': String(who) };
    tx.set(ref_(day), saved);
    return fullView_(day, saved, servers, now);
  });
}
const showAt_ = (shows, id) => shows.findIndex(x => x.ID === String(id || '') && !isRestroom_(x));

// Managers: a showing or last call (Showtime Dashboard). body: { day } and one of
//   { lastCall: "HH:MM" or blank }
//   { item: { id (a saved one's; blank: new), auditorium, start, end ("HH:MM"; the end after the start), last } }
//   { removeId } (the showing, with every server's rows on it)
// A saved showing keeps its servers; one moved to another auditorium keeps only the rows that one has too.
export async function saveRoadhouseShowtime(who, body, servers, now = Date.now()) {
  const day = dayOf_(body.day, now);
  if (!day) return { ok: false, error: 'invalid_day' };
  if (body.item) {
    const s = body.item;
    const auditorium = Number(s.auditorium);
    const allowed = ROADHOUSE_ROWS[auditorium];
    if (!Number.isInteger(auditorium) || !allowed) return { ok: false, error: 'invalid_auditorium' };
    const start = time_(s.start), end = time_(s.end);
    if (!start || !end) return { ok: false, error: 'invalid_time' };
    if (showMoment(day, end) <= showMoment(day, start)) return { ok: false, error: 'end_before_start' };
    const fields = { AUDITORIUM: auditorium, START: start, END: end, 'LAST SHOWING': s.last === true };
    return changeDay_(day, who, servers, now, shows => {
      if (!s.id) {
        if (shows.length >= MAX_ITEMS) return 'invalid_shows';
        shows.push({ ID: newId_(new Set(shows.map(x => x.ID))), ...fields, ASSIGNMENTS: [] });
        return null;
      }
      const at = showAt_(shows, s.id);
      if (at < 0) return 'not_found';
      const assignments = (shows[at].ASSIGNMENTS || []).map(a => ({ ...a, ROWS: (a.ROWS || []).filter(r => allowed.includes(r)) })).filter(a => a.ROWS.length);
      shows[at] = { ...shows[at], ...fields, ASSIGNMENTS: assignments };
      return null;
    });
  }
  if (body.removeId) {
    return changeDay_(day, who, servers, now, shows => {
      const at = showAt_(shows, body.removeId);
      if (at < 0) return 'not_found';
      shows.splice(at, 1);
      return null;
    });
  }
  if (body.lastCall !== undefined) {
    const lastCall = body.lastCall ? time_(body.lastCall) : '';
    if (lastCall === null) return { ok: false, error: 'invalid_last_call' };
    return changeDay_(day, who, servers, now, (shows, d) => { d['LAST CALL'] = lastCall; return null; });
  }
  return { ok: false, error: 'nothing_to_save' };
}

// Leads: a showing's servers, or a restroom check (Lead Dashboard). body: { day } and one of
//   { assign: { showId, assignments: [{ server, rows }] } } (servers from the list, each once; rows from the showing's
//     auditorium, each row to one server at most; a server who keeps their place keeps the steps they've done)
//   { item: { id (blank: new), kind: 'restroom', time, server } }
//   { removeId } (a restroom check)
export async function saveRoadhouseSchedule(who, body, servers, now = Date.now(), whoName = '') {
  const day = dayOf_(body.day, now);
  if (!day) return { ok: false, error: 'invalid_day' };
  const known = new Set(servers.map(s => s.id));
  if (body.assign) {
    const list = Array.isArray(body.assign.assignments) ? body.assign.assignments : [];
    return changeDay_(day, who, servers, now, shows => {
      const at = showAt_(shows, body.assign.showId);
      if (at < 0) return 'not_found';
      const allowed = ROADHOUSE_ROWS[shows[at].AUDITORIUM] || '';
      const used = new Set(), servedBy = new Set();
      const assignments = [];
      for (const a of list) {
        const server = String((a && a.server) || '');
        if (!known.has(server)) return 'invalid_server';
        if (servedBy.has(server)) return 'server_twice';
        servedBy.add(server);
        const rows = [...new Set((Array.isArray(a.rows) ? a.rows : []).map(r => String(r).trim().toUpperCase()))];
        if (!rows.length || rows.some(r => r.length !== 1 || !allowed.includes(r))) return 'invalid_rows';
        if (rows.some(r => used.has(r))) return 'row_taken';
        rows.forEach(r => used.add(r));
        rows.sort((x, y) => allowed.indexOf(x) - allowed.indexOf(y));
        const was = (shows[at].ASSIGNMENTS || []).find(x => x.SERVER === server);
        assignments.push({ SERVER: server, ROWS: rows, ...Object.fromEntries(Object.values(ASSIGNMENT_STEPS).map(f => [f, was ? was[f] || '' : ''])) });
      }
      // The change log: each row whose server changed (names as they are now), newest first, the last LOG_MAX kept
      const nameOf = id => (id ? (servers.find(s => s.id === id) || {}).name || 'Removed server' : '');
      const serverOf = (list, r) => (list.find(x => (x.ROWS || []).includes(r)) || {}).SERVER || '';
      const rowChanges = allowed.split('').map(r => ({ ROW: r, FROM: nameOf(serverOf(shows[at].ASSIGNMENTS || [], r)), TO: nameOf(serverOf(assignments, r)) }))
        .filter(c => c.FROM !== c.TO);
      const log = shows[at].LOG || [];
      shows[at] = { ...shows[at], ASSIGNMENTS: assignments,
        LOG: rowChanges.length ? [{ AT: new Date(now).toISOString(), BY: whoName || '', ROWS: rowChanges }].concat(log).slice(0, LOG_MAX) : log };
      return null;
    });
  }
  if (body.item) {
    const s = body.item;
    const time = time_(s.time);
    if (!time) return { ok: false, error: 'invalid_time' };
    if (!known.has(String(s.server || ''))) return { ok: false, error: 'invalid_server' };
    return changeDay_(day, who, servers, now, shows => {
      const at = s.id ? shows.findIndex(x => x.ID === String(s.id) && isRestroom_(x)) : -1;
      if (s.id && at < 0) return 'not_found';
      const prev = at >= 0 ? shows[at] : null;
      const item = { ID: prev ? prev.ID : newId_(new Set(shows.map(x => x.ID))), KIND: 'restroom', TIME: time, SERVER: String(s.server),
        'CHECK DONE': prev && prev.SERVER === String(s.server) ? prev['CHECK DONE'] || '' : '' };
      if (prev) shows[at] = item;
      else {
        if (shows.length >= MAX_ITEMS) return 'invalid_shows';
        shows.push(item);
      }
      return null;
    });
  }
  if (body.removeId) {
    return changeDay_(day, who, servers, now, shows => {
      const at = shows.findIndex(x => x.ID === String(body.removeId) && isRestroom_(x));
      if (at < 0) return 'not_found';
      shows.splice(at, 1);
      return null;
    });
  }
  return { ok: false, error: 'nothing_to_save' };
}

// Any account: their own rows and restroom checks today (an empty day when they have none)
export async function roadhouseAssignments(id, now = Date.now()) {
  const day = showDay(now);
  const snap = await ref_(day).get();
  return serverView_(day, snap.exists ? snap.data() : null, String(id));
}

// A server marks one of their own steps done (completeRoadhouseAssignment; done again keeps the first time) or not done
// (undoRoadhouseAssignment), today. body: { showId, step: 'open' | 'drop' | 'pickup' (a showing) or 'check' (a restroom
// check) }
export const completeRoadhouseAssignment = (id, body, now = Date.now()) => setAssignmentStep_(String(id), body, now, true);
export const undoRoadhouseAssignment = (id, body, now = Date.now()) => setAssignmentStep_(String(id), body, now, false);
async function setAssignmentStep_(id, body, now, done) {
  const day = showDay(now);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(day));
    const d = snap.exists ? snap.data() : null;
    if (!d) return { ok: false, error: 'shows_cleared' };
    const shows = d.SHOWS || [];
    const s = shows.find(x => x.ID === String(body.showId || ''));
    // (only the server it's assigned to)
    const rec = !s ? null : isRestroom_(s) ? (s.SERVER === id ? s : null) : (s.ASSIGNMENTS || []).find(a => a.SERVER === id);
    if (!rec) return { ok: false, error: 'not_found' };
    const field = isRestroom_(s) ? (body.step === 'check' ? 'CHECK DONE' : null) : ASSIGNMENT_STEPS[body.step];
    if (!field) return { ok: false, error: 'invalid_step' };
    const was = rec[field] || '';
    const next = done ? was || new Date(now).toISOString() : '';
    if (next !== was) {
      rec[field] = next;
      tx.update(ref_(day), { SHOWS: shows, 'UPDATED AT': new Date(now).toISOString() });
    }
    return serverView_(day, d, id);
  });
}
