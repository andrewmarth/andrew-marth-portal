// Mortgage News Daily's daily rate index (https://www.mortgagenewsdaily.com/mortgage-rates/mnd): the newest row of the
// table on that page. MND updates the index each weekday afternoon, Eastern time (excluding market holidays), with no set
// time (usually around 2 to 4 PM ET). Its rates RSS feed (/rss/rates) is the day's article, which doesn't reliably
// state the rate, so the number comes from the index table: one row per day, newest first, with each product's rate in
// its cell's title ("7.50%").

export const MND_INDEX_URL = 'https://www.mortgagenewsdaily.com/mortgage-rates/mnd';
export const MND_TIME_ZONE = 'America/New_York';
// The product the portal's "today's interest rate" follows
export const MND_MAIN_PRODUCT = '30 Yr. Fixed';

const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The index table's newest day: { date: 'YYYY-MM-DD', rates: { '30 Yr. Fixed': 0.075, '15 Yr. Fixed': 0.0703, ... } }
 * (rates as decimals), or null when the page doesn't have the table it should (or its 30 year rate isn't a believable
 * rate: 1% to 20%).
 */
export function parseMndIndex(html) {
  const tables = [...String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  for (const table of tables) {
    const rowsHtml = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
    // The product names, in column order (each is shown twice: wide and narrow screens; the wide one has colspan)
    const head = rowsHtml.find(r => /product-name/i.test(r));
    if (!head) continue;
    const names = [...head.matchAll(/<th[^>]*colspan="2"[^>]*>([\s\S]*?)<\/th>/gi)].map(m => clean(m[1]));
    if (!names.includes(MND_MAIN_PRODUCT)) continue;
    // The first row that starts with a date is the newest day
    for (const r of rowsHtml) {
      const first = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/i) || [])[1];
      const d = clean(first).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!d) continue;
      const values = [...r.matchAll(/<td[^>]*class="[^"]*\brate\b[^"]*"[^>]*title="([\d.]+)%"/gi)].map(m => Number(m[1]) / 100);
      const rates = {};
      names.forEach((n, i) => { if (isFinite(values[i]) && values[i] > 0) rates[n] = Math.round(values[i] * 1e6) / 1e6; });
      const main = rates[MND_MAIN_PRODUCT];
      if (!(main >= 0.01 && main <= 0.2)) return null;
      return { date: d[3] + '-' + String(d[1]).padStart(2, '0') + '-' + String(d[2]).padStart(2, '0'), rates };
    }
  }
  return null;
}

// Fetches and reads the index page (null when it can't be read)
export async function fetchMndIndex() {
  const res = await fetch(MND_INDEX_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portal-rate-check/1.0)', Accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('mnd_http_' + res.status);
  return parseMndIndex(await res.text());
}

// A date (default now) as YYYY-MM-DD in Eastern time, where MND's days begin and end
export const easternDate = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: MND_TIME_ZONE });

// A moment's Eastern date, hour, minute and weekday ('Mon'...)
const ET_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: MND_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
export function easternParts(d) {
  const p = {};
  ET_PARTS.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}
// "11/13/2026, 4:19:20 PM ET" (how RATE UPDATED AT is written) → that moment, or null
export function easternTextToDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  const hour = (Number(m[4]) % 12) + (/pm/i.test(m[7]) ? 12 : 0);
  // Eastern is 5 hours behind UTC in winter and 4 in summer: the one that reads back as this hour
  for (const offset of [5, 4]) {
    const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], hour + offset, +m[5], +(m[6] || 0)));
    if (easternParts(d).hour === hour) return d;
  }
  return null;
}

// The scheduled checks (Cloud Scheduler job portal-rate-check): weekdays every 15 minutes, 2:00 through 6:45 PM Eastern
export const CHECK_FIRST = 14 * 60, CHECK_LAST = 18 * 60 + 45;   // minutes after midnight, Eastern
const isWeekday = w => w !== 'Sat' && w !== 'Sun';
/**
 * Where the checks stand at now, with savedDate the MND day already saved (YYYY-MM-DD):
 *   state: 'current' (today's is saved), 'before' (a weekday before 2:00 PM ET), 'checking' (in the window, not saved yet),
 *          'missed' (a weekday after the window with nothing posted: a market holiday), 'weekend'
 *   nextCheck: the next check that could save a rate (today's are skipped once it's saved); windowStart / windowEnd:
 *   that day's first and last checks (Dates)
 */
export function rateSchedule(now, savedDate) {
  const p = easternParts(now);
  const mins = p.hour * 60 + p.minute;
  const saved = savedDate === p.date;
  const state = !isWeekday(p.weekday) ? 'weekend' : saved ? 'current' : mins < CHECK_FIRST ? 'before' : mins <= CHECK_LAST ? 'checking' : 'missed';
  // (Eastern minutes line up with UTC's: its offsets are whole hours)
  let t = new Date(Math.floor(now.getTime() / 900000) * 900000 + 900000), next = null;
  for (let i = 0; i < 8 * 96 && !next; i++, t = new Date(t.getTime() + 900000)) {
    const q = easternParts(t), m = q.hour * 60 + q.minute;
    if (isWeekday(q.weekday) && m >= CHECK_FIRST && m <= CHECK_LAST && !(saved && q.date === p.date)) next = t;
  }
  const n = easternParts(next);
  const windowStart = new Date(next.getTime() - (n.hour * 60 + n.minute - CHECK_FIRST) * 60000);
  return { state, today: p.date, nextCheck: next, windowStart, windowEnd: new Date(windowStart.getTime() + (CHECK_LAST - CHECK_FIRST) * 60000) };
}

/**
 * What the daily check should do. stored: the date already saved (YYYY-MM-DD, or ''); index: the newest MND day (or
 * null: couldn't read it); today: today's date in Eastern time.
 *   'done'      today's rate is already saved (nothing to fetch)
 *   'save'      the newest row is today's: save it (even when it's the same rate as yesterday: a flat day is still an update)
 *   'waiting'   MND hasn't posted today's yet (check again in 15 minutes)
 *   'unreadable' the page didn't have the table (check again; nothing is changed)
 */
export function rateCheckStep(stored, index, today) {
  if (stored === today) return 'done';
  if (!index) return 'unreadable';
  return index.date === today ? 'save' : 'waiting';
}
