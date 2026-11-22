// roadhouseservers.com: the theater's one shared show schedule for the day. Server leads (SERVER LEAD accounts; portal.js
// checks the role) enter the showings, last call and restroom checks, and assign each showing's rows to servers (SERVER
// accounts): any number of servers per showing, each row to one server at most. Each server sees only their own rows and
// restroom checks (roadhouseAssignments) and marks their own steps done; one server's Drop doesn't change another's.
//
// Saved on roadhouseSchedule/<DAY> (YYYY-MM-DD, Arizona time; a day runs 6 AM to 6 AM, see roadhouse-shows.js): LAST CALL
// ("HH:MM", 24-hour; blank: none), SHOWS ([{ ID, AUDITORIUM, START, END, LAST SHOWING, ASSIGNMENTS: [{ SERVER (account
// ID), ROWS: ['A', ...], OPEN DONE, DROP DONE, PICKUP DONE (ISO times, blank until done) }] }, or a restroom check
// { ID, KIND: 'restroom', TIME, SERVER, CHECK DONE }]), UPDATED AT and UPDATED BY (the lead's account ID).
// shortcut: an earlier day's document is never read again but isn't deleted (one small document a day); add a cleanup if
// that ever matters.
import { db } from './store.js';
import { randomBytes } from 'node:crypto';
import { ROADHOUSE_ROWS, showDay, showMoment } from './roadhouse-shows.js';

const ASSIGNMENT_STEPS = { open: 'OPEN DONE', drop: 'DROP DONE', pickup: 'PICKUP DONE' };
const MAX_ITEMS = 40;
const ref_ = day => db.collection('roadhouseSchedule').doc(day);
const time_ = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);
const isRestroom_ = s => s.KIND === 'restroom';
const newId_ = taken => { let id; do { id = randomBytes(5).toString('hex'); } while (taken.has(id)); return id; };
const doneOf_ = (rec, fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, rec[f] || '']));

// The whole schedule, for leads: { ok, day, lastCall, shows: [{ id, kind: 'show', auditorium, start, end, last,
// assignments: [{ server, rows, done }] } or { id, kind: 'restroom', time, server, done: { check } }], servers }
function leadView_(day, d, servers) {
  return {
    ok: true, day, lastCall: (d && d['LAST CALL']) || '', servers,
    shows: ((d && d.SHOWS) || []).map(s => (isRestroom_(s)
      ? { id: s.ID, kind: 'restroom', time: s.TIME, server: s.SERVER, done: { check: s['CHECK DONE'] || '' } }
      : { id: s.ID, kind: 'show', auditorium: s.AUDITORIUM, start: s.START, end: s.END, last: s['LAST SHOWING'] === true,
        assignments: (s.ASSIGNMENTS || []).map(a => ({ server: a.SERVER, rows: a.ROWS || [], done: doneOf_(a, ASSIGNMENT_STEPS) })) })),
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

async function today_(now) {
  const day = showDay(now);
  const snap = await ref_(day).get();
  return { day, d: snap.exists ? snap.data() : null };
}

// Leads: today's schedule and the servers to assign (servers: [{ id, name }])
export async function roadhouseSchedule(servers, now = Date.now()) {
  const { day, d } = await today_(now);
  return leadView_(day, d, servers);
}

// Leads: one change to today's schedule, made against the schedule as it is now (so two leads saving different showings
// don't undo each other). body: one of
//   { lastCall: "HH:MM" or blank }
//   { item: { id (a saved one's; blank: new), auditorium, start, end, last, assignments: [{ server, rows }] } }
//   { item: { id, kind: 'restroom', time, server } }
//   { removeId }
// A showing's assignments: servers from the list (each once), rows from its auditorium, each row to one server at most.
// A server that keeps their place keeps the steps they've done. → the whole schedule again
export async function saveRoadhouseSchedule(leadId, body, servers, now = Date.now()) {
  const day = showDay(now);
  const known = new Set(servers.map(s => s.id));
  let clean = null;
  if (body.item) {
    const s = body.item;
    if (s.kind === 'restroom') {
      const time = time_(s.time);
      if (!time) return { ok: false, error: 'invalid_time' };
      if (!known.has(String(s.server || ''))) return { ok: false, error: 'invalid_server' };
      clean = { KIND: 'restroom', TIME: time, SERVER: String(s.server) };
    } else {
      const auditorium = Number(s.auditorium);
      const allowed = ROADHOUSE_ROWS[auditorium];
      if (!Number.isInteger(auditorium) || !allowed) return { ok: false, error: 'invalid_auditorium' };
      const start = time_(s.start), end = time_(s.end);
      if (!start || !end) return { ok: false, error: 'invalid_time' };
      if (showMoment(day, end) <= showMoment(day, start)) return { ok: false, error: 'end_before_start' };
      const used = new Set(), servedBy = new Set();
      const assignments = [];
      for (const a of Array.isArray(s.assignments) ? s.assignments : []) {
        const server = String((a && a.server) || '');
        if (!known.has(server)) return { ok: false, error: 'invalid_server' };
        if (servedBy.has(server)) return { ok: false, error: 'server_twice' };
        servedBy.add(server);
        const rows = [...new Set((Array.isArray(a.rows) ? a.rows : []).map(r => String(r).trim().toUpperCase()))];
        if (!rows.length || rows.some(r => r.length !== 1 || !allowed.includes(r))) return { ok: false, error: 'invalid_rows' };
        if (rows.some(r => used.has(r))) return { ok: false, error: 'row_taken' };
        rows.forEach(r => used.add(r));
        rows.sort((x, y) => allowed.indexOf(x) - allowed.indexOf(y));
        assignments.push({ SERVER: server, ROWS: rows });
      }
      clean = { AUDITORIUM: auditorium, START: start, END: end, 'LAST SHOWING': s.last === true, ASSIGNMENTS: assignments };
    }
  } else if (body.lastCall === undefined && !body.removeId) return { ok: false, error: 'nothing_to_save' };
  const lastCall = body.lastCall === undefined ? undefined : (body.lastCall ? time_(body.lastCall) : '');
  if (lastCall === null) return { ok: false, error: 'invalid_last_call' };

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref_(day));
    const d = snap.exists ? snap.data() : { DAY: day, 'LAST CALL': '', SHOWS: [] };
    let shows = (d.SHOWS || []).slice();
    if (lastCall !== undefined) d['LAST CALL'] = lastCall;
    if (body.removeId) {
      const before = shows.length;
      shows = shows.filter(x => x.ID !== String(body.removeId));
      if (shows.length === before) return { ok: false, error: 'not_found' };
    }
    if (clean) {
      const id = String(body.item.id || '');
      const at = id ? shows.findIndex(x => x.ID === id) : -1;
      if (id && at < 0) return { ok: false, error: 'not_found' };
      const prev = at >= 0 ? shows[at] : null;
      if (prev && isRestroom_(prev) !== isRestroom_(clean)) return { ok: false, error: 'not_found' };
      if (isRestroom_(clean)) clean['CHECK DONE'] = prev && prev.SERVER === clean.SERVER ? prev['CHECK DONE'] || '' : '';
      else clean.ASSIGNMENTS = clean.ASSIGNMENTS.map(a => {
        const was = prev && (prev.ASSIGNMENTS || []).find(x => x.SERVER === a.SERVER);
        return { ...a, ...Object.fromEntries(Object.values(ASSIGNMENT_STEPS).map(f => [f, was ? was[f] || '' : ''])) };
      });
      const item = { ID: prev ? prev.ID : newId_(new Set(shows.map(x => x.ID))), ...clean };
      if (at >= 0) shows[at] = item;
      else {
        if (shows.length >= MAX_ITEMS) return { ok: false, error: 'invalid_shows' };
        shows.push(item);
      }
    }
    const saved = { DAY: day, 'LAST CALL': d['LAST CALL'] || '', SHOWS: shows, 'UPDATED AT': new Date(now).toISOString(), 'UPDATED BY': String(leadId) };
    tx.set(ref_(day), saved);
    return leadView_(day, saved, servers);
  });
}

// Any account: their own rows and restroom checks today (an empty day when they have none)
export async function roadhouseAssignments(id, now = Date.now()) {
  const { day, d } = await today_(now);
  return serverView_(day, d, String(id));
}

// A server marks one of their own steps done (completeRoadhouseAssignment; done again keeps the first time) or not done
// (undoRoadhouseAssignment). body: { showId, step: 'open' | 'drop' | 'pickup' (a showing) or 'check' (a restroom check) }
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
