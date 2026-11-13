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
