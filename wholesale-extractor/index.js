/**
 * Wholesale Deal Extractor (Cloud Run function)
 *
 * Called every 5 minutes by Cloud Scheduler. Looks for new emails under the Gmail label
 * ".WHOLESALE PORTAL" in SUBJECT_EMAIL's mailbox, asks Gemini to pull out the property details,
 * keeps only deals whose zip is a target zip, verifies the address with Google's Address Validation
 * API, and adds each deal to the portal's deals.
 *
 * Everything it reads and writes besides the mail lives in the portal's Firestore database (project
 * andrew-marth-portal), reached as the function's own service account: the target zips (wholesaleZips),
 * the deals (wholesaleDeals), a history entry per email (wholesaleHistory) and each property API's
 * usage (wholesaleStatus, written at the end of every run, even one that fails). Gmail is read as SUBJECT_EMAIL through domain-wide delegation: the service
 * account signs a JWT with the IAM Credentials API (no key file) and exchanges it for a token. Which
 * emails were already handled is kept in a JSON file in Cloud Storage.
 *
 * Environment:
 *   GEMINI_API_KEY, MAPS_API_KEY  - from Secret Manager
 *   RAPIDAPI_KEY                  - from Secret Manager; beds/baths/sqft/taxes lookup (optional)
 *   STATE_BUCKET                  - Cloud Storage bucket for state.json
 *   SUBJECT_EMAIL                 - mailbox to read (default tiffany@andrewmarth.com)
 *   START_AFTER_EPOCH             - first run only handles mail after this time (unix seconds)
 *
 * Call with ?test=1 to run on the newest email in the label and report, without writing anything;
 * add &write=1 to really write that email's rows (once); add &resume=1 as well to skip rows that
 * are already in wholesaleDeals (for finishing an email whose earlier write was interrupted).
 */

const functions = require('@google-cloud/functions-framework');
const { GoogleAuth } = require('google-auth-library');

const CONFIG = {
  SUBJECT_EMAIL: process.env.SUBJECT_EMAIL || 'tiffany@andrewmarth.com',
  GMAIL_LABEL: process.env.GMAIL_LABEL || '.WHOLESALE PORTAL',
  STATE_BUCKET: process.env.STATE_BUCKET,
  STATE_OBJECT: 'state.json',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  TIME_ZONE: 'America/Phoenix',
  START_AFTER_EPOCH: Number(process.env.START_AFTER_EPOCH) || 0, // first run: only mail after this
  LOOKBACK_DAYS_FIRST_RUN: 1,   // on the very first run (no START_AFTER_EPOCH), look back this far
  PROCESSED_RETENTION_DAYS: 14, // how long to remember processed message IDs
  MAX_BODY_CHARS: 30000,
  RUN_BUDGET_MS: 4.5 * 60000,   // stop starting new emails after this; leftovers go to the next run
};

const DELEGATED_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

functions.http('processNewDeals', async (req, res) => {
  try {
    const result = req.query.test
      ? await testOnLatestEmail(req.query.write === '1', req.query.resume === '1')
      : await processNewDeals();
    console.log(JSON.stringify({ message: req.query.test ? 'Test result' : 'Run result', result }));
    res.status(200).json(result);
  } catch (e) {
    console.error(e.stack || e);
    res.status(500).send(String(e.message || e));
  }
});

async function processNewDeals() {
  const started = Date.now();
  const state = await loadState();
  await adoptNewerUsage();
  try {
    return await processWithState(state, started);
  } finally {
    await updateUsageStatus();
  }
}

async function processWithState(state, started) {
  const processed = state.processed || {};
  // First run: start at START_AFTER_EPOCH if set (+3600 cancels the overlap below),
  // otherwise look back LOOKBACK_DAYS_FIRST_RUN days.
  const lastRun = state.lastRunEpoch ||
    (CONFIG.START_AFTER_EPOCH ? CONFIG.START_AFTER_EPOCH + 3600 :
      Math.floor(started / 1000) - CONFIG.LOOKBACK_DAYS_FIRST_RUN * 86400);
  const runStart = Math.floor(started / 1000);

  // Overlap by an hour so delayed mail isn't missed; processed IDs prevent duplicates.
  const labelId = await getLabelId();
  const ids = (await listMessageIds(labelId, lastRun - 3600)).reverse(); // oldest first

  let allowedZips = null; // loaded lazily
  let errors = 0;
  let outOfTime = false;
  const results = [];

  const failuresLogged = state.historyFailuresLogged || {}; // so a stuck email is logged once, not every run
  const history = [];
  for (const id of ids) {
    if (processed[id]) continue;
    if (Date.now() - started > CONFIG.RUN_BUDGET_MS) { outOfTime = true; break; }
    let msg = null;
    let out = null;
    creditsUsed = 0;
    try {
      msg = await getMessage(id);
      if (!allowedZips) allowedZips = await loadAllowedZips();
      // All of an email's deals are added in one write; then the email is marked handled
      // and saved right away, so a timeout can't cause it to be added twice.
      out = await handleMessage(msg, allowedZips, true);
      results.push(out);
      processed[id] = Date.now();
      delete failuresLogged[id];
      // "No properties found" unless at least one deal was actually added.
      const nothingFound = !(out.properties || []).some(p => p.row);
      history.push(historyRow(id, msg, out, nothingFound ? 'No properties found' : 'Success'));
      await saveState({ ...state, processed, historyFailuresLogged: failuresLogged });
    } catch (e) {
      errors++;
      console.error(`Message ${id} failed: ${e.stack || e}`);
      if (!failuresLogged[id]) {
        failuresLogged[id] = Date.now();
        history.push(historyRow(id, msg, out, `Error: ${clean(String(e.message || e)).slice(0, 300)}`));
      }
      // Not marked processed, so it will be retried next run.
    }
  }

  // Forget old IDs so the state file stays small.
  const cutoff = Date.now() - CONFIG.PROCESSED_RETENTION_DAYS * 86400000;
  Object.keys(processed).forEach(k => { if (processed[k] < cutoff) delete processed[k]; });
  Object.keys(failuresLogged).forEach(k => { if (failuresLogged[k] < cutoff) delete failuresLogged[k]; });
  const next = { ...state, processed, historyFailuresLogged: failuresLogged };
  // Only advance the window when everything was handled, so failures/leftovers get retried.
  if (errors === 0 && !outOfTime) next.lastRunEpoch = runStart;
  await saveState(next);
  await appendHistoryRows(history);

  return { emailsInWindow: ids.length, handled: results, errors, outOfTime };
}

/**
 * Runs the pipeline on the newest email in the label and reports what it would do.
 * With write=true (?test=1&write=1) it really adds the rows, once: the email is then marked handled.
 * With resume=true, deals already added (same date, sender and address) are skipped.
 */
async function testOnLatestEmail(write = false, resume = false) {
  const labelId = await getLabelId();
  const ids = await listMessageIds(labelId, null, 1);
  if (!ids.length) return { message: 'No emails found in the label.' };
  const state = await loadState(); // also loads the property-facts cache (only saved when writing)
  const processed = state.processed || {};
  if (write && processed[ids[0]]) {
    return { message: 'Newest email was already handled; nothing written.' };
  }
  try {
    const msg = await getMessage(ids[0]);
    const existing = resume ? await loadExistingRowKeys() : null;
    const out = await handleMessage(msg, await loadAllowedZips(), write, existing);
    if (write) {
      processed[ids[0]] = Date.now();
      await saveState({ ...state, processed });
    }
    return out;
  } finally {
    await updateUsageStatus();
  }
}

/* ------------------------------------------------------------------ */
/* Per-message pipeline                                                */
/* ------------------------------------------------------------------ */

/**
 * Extracts every property for sale in the email and adds a row for each one that passes the
 * zip and address checks, all in one write. Emails that aren't property-for-sale emails
 * are skipped entirely. `existing` (optional) holds keys of deals already added, to skip.
 */
async function handleMessage(msg, allowedZips, write, existing = null) {
  const extracted = await extractWithGemini(msg);
  const out = {
    subject: msg.subject, from: msg.from, isPropertyListing: !!extracted.is_property_listing,
    company: clean(extracted.company) || 'Unknown', individual: clean(extracted.individual) || 'Unknown',
  };

  if (!extracted.is_property_listing) {
    console.log(`Skipped "${msg.subject}": not a property-for-sale email.`);
    return { ...out, status: 'skipped', reason: 'not a property-for-sale email' };
  }
  const properties = extracted.properties || [];
  if (!properties.length) console.log(`Skipped "${msg.subject}": no properties found.`);

  out.properties = [];
  for (const deal of properties) {
    out.properties.push(await handleProperty(msg, extracted, deal, allowedZips, existing));
  }

  const ready = out.properties.filter(p => p.row);
  if (write && ready.length) await appendDealRows(ready.map(p => p.row));
  for (const p of ready) {
    p.status = write ? 'added' : 'would add (test mode)';
    console.log(`${write ? 'Added' : 'Would add'} "${msg.subject}" / ${describeRow(p.row)}`);
  }
  console.log(`"${msg.subject}": ${properties.length} properties found, ` +
    `${ready.length} ${write ? 'added' : 'would be added'}.`);
  return out;
}

/** Checks one property; returns it with a `row` if it should be added, or a skip reason. */
async function handleProperty(msg, sender, deal, allowedZips, existing) {
  const label = `"${msg.subject}" / ${clean(deal.street_address) || '(no address)'}`;
  const res = { property: deal };
  const skip = reason => {
    console.log(`Skipped ${label}: ${reason}.`);
    return { ...res, status: 'skipped', reason };
  };

  if (!deal.street_address) return skip('no street address');
  // Vacant land etc. described as "Adjacent to 123 Main St" has no house number of its own.
  if (!/^\d/.test(clean(deal.street_address))) return skip('street address has no house number');

  const zip = normalizeZip(deal.zip);
  if (!zip || !allowedZips.has(zip)) return skip(`zip "${deal.zip}" is not in the target list`);

  const verification = await verifyAddress(deal.street_address, deal.city, deal.state, zip);
  res.addressCheck = verification;
  if (!verification.valid) return skip(`address not verified (${verification.reason})`);

  const price = parsePrice(deal.price);
  const row = [
    formatDate(msg.date),
    parseFromEmail(msg.from),
    clean(sender.company) || 'Unknown',
    clean(sender.individual) || 'Unknown',
    clean(deal.street_address),
    cleanUnit(deal.unit_number),
    clean(deal.city),
    clean(deal.state).toUpperCase(),
    zip,
    await resolveLink(deal.pictures_link),
    gmailLink(msg.id),
    price !== '', // PRODUCTION READY: only when an asking price was given
    price,
  ];
  if (existing && existing.has(rowKey(row))) return skip('already added (resume)');

  // Looked up last so requests are only spent on rows that are really being added.
  const facts = await getPropertyFacts(deal.street_address, deal.city, deal.state, zip,
    cleanUnit(deal.unit_number)) || {};
  row.push(
    '', // STATUS: filled in by hand
    facts.beds ?? '',
    facts.baths ?? '',
    facts.sqft ?? '',
    facts.taxes ?? '',
    normalizePropertyType(facts.propertyType), // from the property API only; blank if it doesn't say
    markupFor(price),
  );
  res.row = row;
  return res;
}

/** Opens the email in SUBJECT_EMAIL's Gmail (authuser picks that account if several are signed in). */
function gmailLink(messageId) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(CONFIG.SUBJECT_EMAIL)}#all/${messageId}`;
}

/**
 * Always a number or "" (never text): "$185,000" -> 185000, "$185K" -> 185000, "$1.2M" -> 1200000,
 * "$185,000 OBO" -> 185000, "$180k-$190k" -> 180000 (first amount). "", "Call for price" -> "".
 */
function parsePrice(price) {
  const m = clean(price).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(thousand|million|mm|k|m)?(?![a-z])/i);
  if (!m) return '';
  const unit = (m[2] || '').toLowerCase();
  const mult = unit === 'k' || unit === 'thousand' ? 1e3 : unit ? 1e6 : 1;
  const n = Math.round(Number(m[1]) * mult);
  return n > 0 ? n : '';
}

/**
 * At least $10,000, raised so price + markup lands on a whole $1,000:
 * 179,900 -> 10,100 (190,000); 180,000 -> 10,000 (190,000). No price -> the base 10,000.
 */
function markupFor(price) {
  const MIN_MARKUP = 10000;
  if (typeof price !== 'number') return MIN_MARKUP;
  return Math.ceil((price + MIN_MARKUP) / 1000) * 1000 - price;
}

function describeRow(row) {
  return `${row[4]} ${row[5]} ${row[6]}, ${row[7]} ${row[8]}`.replace(/\s+/g, ' ') +
    (row[11] ? '' : ' (no price: PRODUCTION READY = FALSE)');
}

/** Identifies a row by date sent, sender, street, unit and zip. */
function rowKey(row) {
  return [row[0], row[1], row[4], row[5], row[8]].map(v => clean(v).toLowerCase()).join('|');
}

/* ------------------------------------------------------------------ */
/* Google auth                                                         */
/* ------------------------------------------------------------------ */

const adc = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

/** Calls a Google API as the function's own service account. */
async function adcRequest(url, options = {}) {
  const client = await adc.getClient();
  const res = await client.request({ url, ...options });
  return res.data;
}

let serviceAccountEmail = null;
async function getServiceAccountEmail() {
  if (serviceAccountEmail) return serviceAccountEmail;
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
    { headers: { 'Metadata-Flavor': 'Google' } });
  serviceAccountEmail = (await res.text()).trim();
  return serviceAccountEmail;
}

let delegated = null;
/** Access token that acts as SUBJECT_EMAIL (domain-wide delegation, keyless). */
async function getDelegatedToken() {
  if (delegated && delegated.expires > Date.now() + 60000) return delegated.token;
  const sa = await getServiceAccountEmail();
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    iss: sa,
    sub: CONFIG.SUBJECT_EMAIL,
    scope: DELEGATED_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signed = await adcRequest(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signJwt`,
    { method: 'POST', data: { payload } });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signed.signedJwt,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Could not act as ${CONFIG.SUBJECT_EMAIL} (${res.status}: ${JSON.stringify(body)}). ` +
      'Check domain-wide delegation for this service account in the Workspace Admin console.');
  }
  delegated = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return delegated.token;
}

/** Calls Gmail as SUBJECT_EMAIL. */
async function userApi(url, options = {}) {
  const token = await getDelegatedToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url.split('?')[0]} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

/* ------------------------------------------------------------------ */
/* Gmail                                                               */
/* ------------------------------------------------------------------ */

/** Finds the label by name (case-insensitive; also matches it nested under a parent label). */
async function getLabelId() {
  const { labels = [] } = await userApi(`${GMAIL}/labels`);
  const want = CONFIG.GMAIL_LABEL.trim().toLowerCase();
  const match = labels.find(l => {
    const name = l.name.trim().toLowerCase();
    return name === want || name.endsWith('/' + want);
  });
  if (!match) {
    throw new Error(`Gmail label "${CONFIG.GMAIL_LABEL}" not found. Labels: ` +
      labels.map(l => l.name).join(' | '));
  }
  return match.id;
}

/** Message IDs in the label, newest first. */
async function listMessageIds(labelId, afterEpoch, max = 100) {
  const params = new URLSearchParams({ labelIds: labelId, maxResults: String(max) });
  if (afterEpoch) params.set('q', `after:${afterEpoch}`);
  const { messages = [] } = await userApi(`${GMAIL}/messages?${params}`);
  return messages.map(m => m.id);
}

async function getMessage(id) {
  const m = await userApi(`${GMAIL}/messages/${id}?format=full`);
  const headers = {};
  (m.payload.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });

  let plain = '';
  let html = '';
  (function walk(part) {
    if (!part) return;
    if (part.body && part.body.data && !part.filename) {
      const text = Buffer.from(part.body.data, 'base64url').toString('utf8');
      if (part.mimeType === 'text/plain') plain += text + '\n';
      else if (part.mimeType === 'text/html') html += text + '\n';
    }
    (part.parts || []).forEach(walk);
  })(m.payload);

  return {
    id,
    date: new Date(Number(m.internalDate)),
    from: headers.from || '',
    subject: headers.subject || '',
    plain: plain || htmlToText(html),
    html,
  };
}

function htmlToText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Pull href + anchor text from HTML so "Click here for pictures" links aren't lost. */
function extractLinks(html) {
  if (!html) return [];
  const out = [];
  const seen = {};
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 60) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    if (!/^https?:/i.test(url) || seen[url]) continue;
    seen[url] = true;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ text: text.slice(0, 100) || '(no text)', url });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */

async function extractWithGemini(msg) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const body = (msg.plain || '').slice(0, CONFIG.MAX_BODY_CHARS);
  const links = extractLinks(msg.html);

  const prompt = `You are reading an email that was filed under a label for wholesale real estate deals.

Return ONLY JSON matching the schema. Rules:
1. is_property_listing: true only if the email advertises one or more specific properties that are currently for sale (wholesale deals, off-market listings, assignment contracts, etc.). Set it to false for anything else, such as newsletters or market updates without specific properties for sale, buyer requests ("looking for..."), sold/closed announcements, event or webinar invites, and personal or administrative messages. If false, return an empty properties list.
2. properties: if is_property_listing is true, return EVERY property advertised for sale in the email, one entry per property, in the order they appear. For each property:
   - street_address: house number + street name, WITHOUT any unit. unit_number: the unit separately (if any).
   - city, state (2-letter abbreviation), zip (5 digits). If a field is not present, return an empty string. Do not invent a zip or city that is not stated or clearly implied.
   - price: the asking/advertised price for that property, as a single amount (e.g. "$185,000"). Never ARV, rent, repair costs, earnest money or assignment fee. Empty string if no price is given for it (including "call for price", "make an offer", or a price that only applies to a different property).
   - pictures_link: the URL of photos/pictures of that property (Google Drive, Dropbox, photo gallery, etc.). If one photo link clearly covers all the properties, use it for each. If there is none, return an empty string. Do not return unrelated links (unsubscribe, social media, company website, contracts).
3. individual: the name of the person who sent the email (often in the signature). If none, return "Unknown".
4. company: the name of the company that sent the email. If none, return "Unknown".

EMAIL
From: ${msg.from}
Subject: ${msg.subject}
Date: ${msg.date.toString()}

Body:
${body}

Links found in the email (anchor text -> URL):
${links.length ? links.map(l => `- ${l.text} -> ${l.url}`).join('\n') : '(none)'}`;

  const propertyFields = ['street_address', 'unit_number', 'city', 'state', 'zip', 'price', 'pictures_link'];
  const schema = {
    type: 'OBJECT',
    properties: {
      is_property_listing: { type: 'BOOLEAN' },
      properties: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: Object.fromEntries(propertyFields.map(f => [f, { type: 'STRING' }])),
          required: propertyFields,
        },
      },
      individual: { type: 'STRING' },
      company: { type: 'STRING' },
    },
    required: ['is_property_listing', 'properties', 'individual', 'company'],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned no content: ' + raw.slice(0, 500));
  return JSON.parse(text);
}

/** Retries temporary errors (rate limit / overloaded) with increasing waits. */
async function fetchWithRetry(url, options) {
  const waits = [2000, 5000, 15000, 30000];
  let res;
  for (let i = 0; i <= waits.length; i++) {
    res = await fetch(url, options);
    if (res.status !== 429 && res.status < 500) return res;
    // A used-up daily quota won't recover in seconds, so don't spend the run waiting on it.
    if (res.status === 429 && /per ?day|PerDay/i.test(await res.clone().text())) return res;
    if (i < waits.length) await new Promise(r => setTimeout(r, waits[i]));
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Pictures links                                                      */
/* ------------------------------------------------------------------ */

const linkCache = new Map();

/**
 * Follows click-tracking redirects to the real link (e.g. a tracker URL -> the Google Drive
 * folder). Stops before sign-in pages, so a private Drive link stays the Drive link rather than
 * becoming a login URL. Returns the original link if it can't be followed.
 */
async function resolveLink(link) {
  const url = repairLink(clean(link));
  if (!/^https?:\/\//i.test(url)) return url;
  if (linkCache.has(url)) return linkCache.get(url);

  let current = embeddedTarget(url) || url;
  try {
    for (let hop = 0; hop < 10; hop++) {
      const next = await nextHop(current);
      if (!next || next === current || isSignInPage(next)) break;
      current = embeddedTarget(next) || next;
    }
  } catch (e) {
    console.log(`Could not follow pictures link ${url}: ${e.message}`);
  }
  if (current !== url) console.log(`Pictures link resolved: ${url} -> ${current}`);
  linkCache.set(url, current);
  return current;
}

/**
 * Senders sometimes paste text into a link (e.g. "http://3024 S 101stdrive.google.com/drive/...").
 * If the link isn't a valid URL, pull out the photo-host part (Drive, Photos, Dropbox, OneDrive).
 */
function repairLink(url) {
  if (!url) return url;
  try {
    if (!/\s/.test(url)) { new URL(url); return url; }
  } catch (e) { /* fall through to repair */ }
  const m = url.match(/(drive\.google\.com|docs\.google\.com|photos\.google\.com|photos\.app\.goo\.gl|(?:www\.)?dropbox\.com|onedrive\.live\.com|1drv\.ms)\/\S*/i);
  if (!m) return url;
  const fixed = 'https://' + m[0];
  console.log(`Pictures link repaired: ${url} -> ${fixed}`);
  return fixed;
}

/**
 * Some senders wrap links in their own "redirect page" that forwards with JavaScript, e.g.
 * https://justicecribs.com/redirect-page?url=https://www.dropbox.com/scl/fo/...?rlkey=...&dl=0
 * The real link is right there in the URL, so take it (decoded if needed) instead of loading the page.
 * Returns null if the link doesn't carry another link this way.
 */
function embeddedTarget(url) {
  const m = url.match(/[?&](?:url|u|redirect|redirect_?ur[il]|target|dest|destination|link|goto|to|out)=(https?(?::|%3A)[^#]*)/i);
  if (!m) return null;
  let target = m[1];
  // Encoded ("https%3A%2F%2F...") is a single parameter; decode it. Unencoded, the rest of the URL is
  // the target, including its own &-parameters (e.g. Dropbox's &st=...&dl=0).
  if (/^https?%3A/i.test(target)) {
    try { target = decodeURIComponent(target.split('&')[0]); } catch (e) { return null; }
  }
  try { new URL(target); } catch (e) { return null; }
  return target;
}

/** Where one request to `url` sends you next, or null if it doesn't redirect. */
async function nextHop(url) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WholesaleDealExtractor/1.0)' },
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    return location ? new URL(location, url).toString() : null;
  }
  // Some trackers answer with a tiny "redirecting..." page instead of an HTTP redirect.
  const type = res.headers.get('content-type') || '';
  if (res.ok && type.includes('text/html')) {
    const html = await res.text();
    if (html.length > 5000) return null; // a real page, not a redirect stub
    const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=\s*['"]?([^"'>\s]+)/i) ||
      html.match(/location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i) ||
      html.match(/location\.replace\(\s*["'](https?:\/\/[^"']+)["']/i);
    return m ? new URL(m[1].replace(/&amp;/g, '&'), url).toString() : null;
  }
  return null;
}

function isSignInPage(url) {
  const { hostname, pathname } = new URL(url);
  return /^(accounts\.google\.com|login\.|signin\.|auth\.)/i.test(hostname) ||
    /\/(login|signin|sign-in|servicelogin)\b/i.test(pathname);
}

/* ------------------------------------------------------------------ */
/* Property facts: beds, baths, sqft, yearly taxes                     */
/* ------------------------------------------------------------------ */

// Tried in order. If one fails in any way (out of requests, an error, or it doesn't find the home)
// the next one is tried; one that is out of requests is also paused. More can be added later.
// `status` is the provider's wholesaleStatus document (its USAGE and CAP).
const PROPERTY_PROVIDERS = [
  { name: 'Redfin (RapidAPI)', status: 'REDFIN.COM DATA',
    enabled: () => !!process.env.RAPIDAPI_KEY, lookup: lookupRedfinRapidApi },
  { name: 'Realtor (RapidAPI)', status: 'REALTOR SEARCH',
    enabled: () => !!process.env.RAPIDAPI_KEY, lookup: lookupRealtorRapidApi },
  { name: 'Redfin Base (RapidAPI)', status: 'REDFIN BASE',
    enabled: () => !!process.env.RAPIDAPI_KEY, lookup: lookupRedfinBaseRapidApi },
  { name: 'Realtor API Data (RapidAPI)', status: 'REALTOR API DATA',
    enabled: () => !!process.env.RAPIDAPI_KEY, lookup: lookupRealtorApiDataRapidApi },
  { name: 'US Realtor (RapidAPI)', status: 'US REALTOR',
    enabled: () => !!process.env.RAPIDAPI_KEY, lookup: lookupUsRealtorRapidApi },
];
const PROPERTY_CACHE_DAYS = 90;   // the same houses show up in many emails; don't pay for them twice
const NOT_FOUND_CACHE_DAYS = 14;
const QUOTA_PAUSE_HOURS = 24;     // after "out of requests", try that provider again a day later

let propertyCache = {};           // address -> { facts (null = not found), at }; kept in state.json
let providerPausedUntil = {};     // provider name -> epoch ms; kept in state.json
let providerUsage = {};           // provider name -> { remaining, limit, at }; kept in state.json
let creditsUsed = 0;              // RapidAPI requests spent on the email being handled (history log)
let requestsThisRun = {};         // provider name -> { count, last }: requests spent this run (added to wholesaleStatus)
let headersLogged = {};           // provider name -> true once this instance has logged its usage headers
let stateLoaded = false;          // usage is only written once state.json (the RapidAPI-reported usage) is loaded

class OutOfRequestsError extends Error {}

/** { beds, baths, sqft, taxes } from the first provider that knows the home, or null. */
async function getPropertyFacts(street, city, state, zip, unit) {
  const address = `${clean(street)}${unit ? ' #' + unit : ''}, ${clean(city)}, ${clean(state)} ${zip}`;
  const key = address.toLowerCase();
  const hit = propertyCache[key];
  // Entries saved before property type was collected are looked up again.
  const outdated = hit && hit.facts && !('propertyType' in hit.facts);
  if (hit && !outdated && Date.now() - hit.at < cacheMaxAgeMs(hit)) return hit.facts;

  let askedAny = false;
  let found = null;
  for (const p of PROPERTY_PROVIDERS) {
    if (!p.enabled() || (providerPausedUntil[p.name] || 0) > Date.now()) continue;
    try {
      const facts = await p.lookup({ street: clean(street), city: clean(city), state: clean(state), zip, unit });
      askedAny = true;
      if (facts) {
        console.log(`Property facts from ${p.name} for ${address}: ${JSON.stringify(facts)}`);
        // Keep what's already found; a later API only fills in what's still blank.
        found = found ? fillBlanks(found, facts) : facts;
        const missing = missingFacts(found);
        if (!missing.length) break;
        console.log(`No ${missing.join('/')} from ${p.name} for ${address}; asking the next API for them.`);
        continue;
      }
      console.log(`Property facts: ${address} not found on ${p.name}.`);
    } catch (e) {
      if (e instanceof OutOfRequestsError) {
        // Until its quota resets, when RapidAPI said when; otherwise try again in a day
        const resetAt = (providerUsage[p.name] || {}).resetAt;
        providerPausedUntil[p.name] = resetAt > Date.now() ? resetAt : Date.now() + QUOTA_PAUSE_HOURS * 3600000;
        console.log(`${p.name} is out of requests (${e.message}); skipping it until ${formatStoredDateTime(new Date(providerPausedUntil[p.name]))}.`);
      } else {
        console.log(`Property facts lookup on ${p.name} failed for ${address}: ${e.message}`);
      }
    }
  }
  if (found || askedAny) propertyCache[key] = { facts: found, at: Date.now() };
  return found;
}

/** { a: 1, b: '' } + { b: 2 } -> { a: 1, b: 2 }: only blanks are filled. */
function fillBlanks(facts, more) {
  const out = { ...facts };
  for (const [k, v] of Object.entries(more)) if ((out[k] ?? '') === '' && v !== '') out[k] = v;
  return out;
}

// When one of these is blank, the next API is asked for it.
const FACTS_WORTH_ASKING_AGAIN = ['beds', 'baths', 'sqft', 'taxes'];

function missingFacts(facts) {
  return FACTS_WORTH_ASKING_AGAIN.filter(k => (facts[k] ?? '') === '');
}

/** Complete results are kept 90 days; not-found or incomplete ones are retried sooner. */
function cacheMaxAgeMs(entry) {
  const complete = entry.facts && !missingFacts(entry.facts).length;
  return (complete ? PROPERTY_CACHE_DAYS : NOT_FOUND_CACHE_DAYS) * 86400000;
}

/** Remembers the latest "requests left" (and plan limit, when sent) RapidAPI reported for a provider. */
function recordUsage(name, remaining, limitHeader, resetHeader) {
  const prev = providerUsage[name] || {};
  // x-ratelimit-requests-reset: seconds until the quota starts over
  const resetSeconds = resetHeader !== null && resetHeader !== undefined && resetHeader !== '' ? Number(resetHeader) : NaN;
  const resetAt = Number.isFinite(resetSeconds) && resetSeconds >= 0 ? Date.now() + resetSeconds * 1000 : prev.resetAt ?? null;
  const limit = limitHeader !== null && limitHeader !== undefined && limitHeader !== ''
    ? Number(limitHeader) : prev.limit ?? null;
  providerUsage[name] = { remaining, limit, at: Date.now(), resetAt };
}

/**
 * Run at the start of every run (right after state.json loads): an API whose quota has reset since RapidAPI last
 * reported it starts over at 0 used, and is no longer skipped for being out of requests. No request is spent: the
 * reset time came with the last response. The next reset time comes with the next response.
 */
function rollOverResetQuotas() {
  const now = Date.now();
  for (const [name, u] of Object.entries(providerUsage)) {
    if (!u || !u.resetAt || u.resetAt > now) continue;
    console.log(`${name}: its quota reset at ${formatStoredDateTime(new Date(u.resetAt))}; starting over at 0 used.`);
    providerUsage[name] = { remaining: u.limit ?? null, limit: u.limit ?? null, at: u.resetAt, resetAt: null };
    delete providerPausedUntil[name];
  }
}

/**
 * Called at the end of every run (even one that fails): writes each property API's wholesaleStatus document
 * (ID: the provider's `status` name), for the portal's Usage card.
 *   REQUESTS THIS MONTH - requests this function has spent on it this calendar month (Phoenix time), counted by
 *                         the function itself; COUNT MONTH is that month ("2026-11") and COUNTED SINCE when the
 *                         count began (the start of the month, or the first run that counted).
 *   USAGE               - requests used this period: what RapidAPI last reported (limit - requests left), or else
 *                         REQUESTS THIS MONTH for an API that doesn't report it. USAGE SOURCE says which
 *                         ("RapidAPI" / "Counted") and USAGE AS OF when RapidAPI reported it.
 *   CAP                 - the plan's limit: set by hand, or the limit RapidAPI reports.
 *   RESETS AT           - when RapidAPI said the quota starts over (blank when unknown). Once it passes, the next
 *                         run sets USAGE back to 0 without spending a request (see rollOverResetQuotas).
 *   LAST REQUEST, PAUSED UNTIL (blank unless it's out of requests), CHECKED AT (this run).
 * Times are text "YYYY-MM-DD HH:MM:SS", Phoenix time, the way the portal stores them. A missing document is created.
 */
async function updateUsageStatus() {
  if (!stateLoaded) return;
  try {
    const now = new Date();
    const month = formatStoredDateTime(now).slice(0, 7);
    const docs = {};
    (await listDocuments('wholesaleStatus')).forEach(d => { docs[d.id] = d.data; });
    const writes = [];
    for (const p of PROPERTY_PROVIDERS) {
      if (!p.status) continue;
      const old = docs[p.status] || {};
      const ran = requestsThisRun[p.name] || { count: 0, last: 0 };
      const sameMonth = old['COUNT MONTH'] === month;
      const requests = (sameMonth ? Number(old['REQUESTS THIS MONTH']) || 0 : 0) + ran.count;
      // A count that began part way through this month says so; a new month starts at its first day
      const since = sameMonth && old['COUNTED SINCE'] ? old['COUNTED SINCE']
        : old['COUNT MONTH'] ? month + '-01 00:00:00' : formatStoredDateTime(now);
      // (The portal's New Seller Net form counts its requests on these documents too, so this month's count goes up
      // by this run's requests rather than being set)
      const transforms = [];
      const values = { 'COUNT MONTH': month, 'COUNTED SINCE': since, 'CHECKED AT': formatStoredDateTime(now) };
      if (sameMonth) transforms.push({ fieldPath: '`REQUESTS THIS MONTH`', increment: { integerValue: String(ran.count) } });
      else values['REQUESTS THIS MONTH'] = requests;
      const lastRequest = ran.last ? formatStoredDateTime(new Date(ran.last)) : '';
      values['LAST REQUEST'] = [lastRequest, old['LAST REQUEST'] || ''].sort().pop();
      // RapidAPI's own numbers, when it sends them. A provider paused for being out of requests has used its whole limit.
      const paused = (providerPausedUntil[p.name] || 0) > Date.now();
      const reported = providerUsage[p.name] || (paused ? { remaining: 0, limit: null, at: Date.now() } : null);
      const cap = Number(String(old.CAP ?? '').replace(/[^\d.]/g, ''));
      const limit = reported && reported.limit != null ? reported.limit : cap;
      if (reported && reported.remaining == null && Number.isFinite(limit)) reported.remaining = limit; // just reset
      const reportedAt = reported && reported.at ? formatStoredDateTime(new Date(reported.at)) : '';
      const portalNewer = old['USAGE SOURCE'] === 'RapidAPI' && String(old['USAGE AS OF'] || '') > reportedAt;
      if (portalNewer) {
        // Leave USAGE, CAP, USAGE SOURCE, USAGE AS OF and RESETS AT as the portal wrote them
      } else if (reported && Number.isFinite(limit) && limit > 0 && Number.isFinite(reported.remaining)) {
        values['RESETS AT'] = reported.resetAt ? formatStoredDateTime(new Date(reported.resetAt)) : '';
        values.USAGE = Math.round(Math.max(0, limit - reported.remaining));
        values['USAGE SOURCE'] = 'RapidAPI';
        values['USAGE AS OF'] = reportedAt;
        if (reported.limit != null) values.CAP = Math.round(reported.limit);
      } else {
        // Counted: USAGE is this month's count
        if (sameMonth && old['USAGE SOURCE'] === 'Counted') transforms.push({ fieldPath: 'USAGE', increment: { integerValue: String(ran.count) } });
        else values.USAGE = requests;
        values['USAGE SOURCE'] = 'Counted';
        values['USAGE AS OF'] = formatStoredDateTime(now);
        values['RESETS AT'] = '';
      }
      values['PAUSED UNTIL'] = paused ? formatStoredDateTime(new Date(providerPausedUntil[p.name])) : '';
      // Every field named in the mask is written; one left blank is removed
      writes.push({
        update: { name: docName('wholesaleStatus', p.status), fields: fsFields(values) },
        updateMask: { fieldPaths: Object.keys(values).map(k => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + k + '`')) },
        ...(transforms.length ? { updateTransforms: transforms } : {}),
      });
    }
    await commitWrites(writes);
    console.log(`API usage updated: ${PROPERTY_PROVIDERS.map(p => `${p.name} ${(requestsThisRun[p.name] || {}).count || 0} this run`).join(', ')}`);
    // The same instance can serve the next run: start its count over (only once this one is written, so a failed
    // write is carried into the next run instead of lost)
    requestsThisRun = {};
  } catch (e) {
    console.log(`Could not update the API usage: ${e.message}`); // never fails the run
  }
}

/**
 * The portal's New Seller Net form uses these APIs too, and writes what RapidAPI tells it to wholesaleStatus. Where
 * that's newer than what this function last heard, it's taken up here (so an API the portal found has requests again
 * isn't skipped). Times there are Phoenix time, which is always UTC-7.
 */
async function adoptNewerUsage() {
  try {
    const docs = {};
    (await listDocuments('wholesaleStatus')).forEach(d => { docs[d.id] = d.data; });
    for (const p of PROPERTY_PROVIDERS) {
      const d = docs[p.status];
      if (!d || d['USAGE SOURCE'] !== 'RapidAPI' || !d['USAGE AS OF']) continue;
      const at = Date.parse(String(d['USAGE AS OF']).replace(' ', 'T') + '-07:00');
      const mine = providerUsage[p.name] || {};
      if (!Number.isFinite(at) || at <= (mine.at || 0) || !(Number(d.CAP) > 0)) continue;
      const resetAt = d['RESETS AT'] ? Date.parse(String(d['RESETS AT']).replace(' ', 'T') + '-07:00') : NaN;
      providerUsage[p.name] = { remaining: Math.max(0, Number(d.CAP) - Number(d.USAGE || 0)), limit: Number(d.CAP), at,
        resetAt: Number.isFinite(resetAt) ? resetAt : mine.resetAt ?? null };
      if (providerUsage[p.name].remaining > 0) delete providerPausedUntil[p.name];
      console.log(`${p.name}: took up newer usage from the portal (${d.USAGE} of ${d.CAP} used as of ${d['USAGE AS OF']}).`);
    }
  } catch (e) {
    console.log(`Could not read the portal's API usage: ${e.message}`);
  }
}

/** Drops expired cache entries so state.json stays small. */
function prunePropertyCache() {
  const now = Date.now();
  for (const [k, v] of Object.entries(propertyCache)) {
    if (!v.at || now - v.at > cacheMaxAgeMs(v)) delete propertyCache[k];
  }
  return propertyCache;
}

/**
 * Redfin data via RapidAPI (ntd119/redfin-com-data). Two requests per home:
 * properties/auto-complete (address -> Redfin home URL), then properties/details (URL -> facts).
 */
async function lookupRedfinRapidApi({ street, city, state, zip, unit }) {
  const ac = await redfinRapidApi('/properties/auto-complete',
    { query: `${street}${unit ? ' #' + unit : ''}, ${city}, ${state} ${zip}`, limit: 10 });
  // Only accept a home whose Redfin URL has the same house number, zip (and unit, if any);
  // otherwise "did you mean" results could give another house's facts.
  const houseNumber = (street.match(/^\d+/) || [''])[0];
  // A miss comes back as { didYouMean: [...] } (map places, not homes) instead of a list.
  const homes = (Array.isArray(ac.data) ? ac.data : []).flatMap(g => g.rows || [])
    .filter(r => r.propertyId && r.url && r.url.includes(`/${houseNumber}-`) && r.url.includes(`-${zip}/`));
  const unitSlug = unit && `/unit-${String(unit).toLowerCase()}/`;
  const home = unit
    ? homes.find(r => r.url.toLowerCase().includes(unitSlug))
    : homes.find(r => !/\/unit-/i.test(r.url)) || homes[0];
  if (!home) return null;

  const d = (await redfinRapidApi('/properties/details', { url: home.url })).data || {};
  return redfinFacts((d.aboveTheFold && d.aboveTheFold.addressSectionInfo) || {},
    (d.belowTheFold && d.belowTheFold.publicRecordsInfo) || {}, d.statsInfo || {});
}

/**
 * Redfin data via a second RapidAPI wrapper (tvhaudev/redfin-base). Two requests per home:
 * /1.0/redfin/detail (address -> home page data), then public-records-info (-> taxes, type name).
 */
async function lookupRedfinBaseRapidApi({ street, city, state, zip, unit }) {
  const d = (await redfinBaseRapidApi('/1.0/redfin/detail',
    { location: `${street}${unit ? ' #' + unit : ''}, ${city}, ${state} ${zip}` })).data || {};
  const info = (d.aboveTheFold && d.aboveTheFold.addressSectionInfo) || {};
  // It returns its best match for the address, so check it's the same house number, zip and unit.
  const addr = info.streetAddress || {};
  const houseNumber = (street.match(/^\d+/) || [''])[0];
  const sameUnit = String(addr.unitValue || '').toLowerCase() === String(unit || '').toLowerCase();
  if (String(addr.streetNumber) !== houseNumber || String(info.zip) !== zip || !sameUnit) return null;

  const ids = d.initialInfo || {};
  let records = {};
  if (ids.propertyId) {
    try {
      records = (await redfinBaseRapidApi('/redfin/details/public-records-info',
        { propertyId: ids.propertyId, listingId: ids.listingId || '' })).data || {};
    } catch (e) {
      if (e instanceof OutOfRequestsError) throw e;
      console.log(`Redfin Base public records failed for ${street}: ${e.message}`); // keep the rest
    }
  }
  return redfinFacts(info, records, d.statsInfo || {});
}

// Redfin's numeric property types that are certain; others are left to the type name, or blank.
const REDFIN_TYPE_CODES = { 3: 'Condo', 4: 'Multi-Family', 6: 'Single Family Residential', 13: 'Townhouse' };

/** Facts from Redfin's home page data (`info`), public records and stats sections. */
function redfinFacts(info, records, stats) {
  const basic = records.basicInfo || {};
  const listing = records.latestListingInfo || {};
  const latestTax = (records.allTaxInfo || [])
    .filter(t => Number(t.taxesDue) > 0)
    .sort((a, b) => (b.rollYear || 0) - (a.rollYear || 0))[0];
  const sqft = info.sqFt && typeof info.sqFt === 'object' ? info.sqFt.value : info.sqFt;
  // Only this home's own sections (the response also holds comparable homes with their own types).
  const propertyType = [basic.propertyTypeName, listing.propertyTypeName, stats.propertyTypeDisplay]
    .find(v => typeof v === 'string' && /[a-z]/i.test(v)) || REDFIN_TYPE_CODES[info.propertyType] || '';

  const facts = {
    beds: toNumber(info.beds ?? basic.beds),
    baths: toNumber(info.baths ?? basic.baths),
    sqft: toNumber(sqft ?? basic.totalSqFt ?? basic.sqFtFinished),
    taxes: latestTax ? Math.round(Number(latestTax.taxesDue) * 100) / 100 : '',
    propertyType,
  };
  return Object.values(facts).some(v => v !== '') ? facts : null;
}

/**
 * Realtor.com data via RapidAPI (ntd119/realtor-search). Two requests per home:
 * properties/auto-complete (address -> property ID), then properties/detail (ID -> facts).
 */
function lookupRealtorRapidApi(address) {
  return realtorStyleLookup(address, realtorRapidApi,
    { path: '/properties/auto-complete', param: 'input' },
    { path: '/properties/detail', param: 'propertyId', home: data => data });
}

/** Realtor.com data via a second RapidAPI wrapper (nusantaracodedotcom/realtor-api-data). */
function lookupRealtorApiDataRapidApi(address) {
  return realtorStyleLookup(address, realtorApiDataRapidApi,
    { path: '/search/autocomplete', param: 'query' },
    { path: '/detail/properties', param: 'id', home: data => data.home });
}

/** Realtor.com data via a third RapidAPI wrapper (apiheya/us-realtor). */
function lookupUsRealtorRapidApi(address) {
  return realtorStyleLookup(address, usRealtorRapidApi,
    { path: '/api/v1/auto-complete', param: 'query' },
    { path: '/api/v1/property/details', param: 'property_id', home: data => data.home });
}

/** Shared by the Realtor.com wrappers: same responses, different paths and parameter names. */
async function realtorStyleLookup({ street, city, state, zip, unit }, api, search, detail) {
  const ac = await api(search.path,
    { [search.param]: `${street}${unit ? ' #' + unit : ''}, ${city}, ${state} ${zip}`, limit: 10 });
  // Same safety check as Redfin: same house number, zip, and unit (if any), or nothing.
  const houseNumber = (street.match(/^\d+/) || [''])[0];
  const homes = ((ac.data && ac.data.autocomplete) || []).filter(r => r.area_type === 'address' &&
    r.mpr_id && r.postal_code === zip && clean(r.line).startsWith(`${houseNumber} `));
  const hasUnit = r => /\b(unit|apt|ste)\b|#/i.test(r.line);
  const unitRe = unit &&
    new RegExp(`(\\b(unit|apt|ste)\\b|#)\\s*${String(unit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const home = unit ? homes.find(r => unitRe.test(r.line)) : homes.find(r => !hasUnit(r));
  if (!home) return null;

  const d = detail.home((await api(detail.path, { [detail.param]: home.mpr_id })).data || {}) || {};
  const desc = d.description || {};
  const latestTax = (d.tax_history || [])
    .filter(t => Number(t.tax) > 0)
    .sort((a, b) => (b.year || 0) - (a.year || 0))[0];

  const facts = {
    beds: toNumber(desc.beds),
    // baths_consolidated is "2.5" for 2 full + 1 half; plain `baths` would say 3.
    baths: toNumber(parseFloat(desc.baths_consolidated ?? desc.baths)),
    sqft: toNumber(desc.sqft),
    taxes: latestTax ? Math.round(Number(latestTax.tax) * 100) / 100 : '',
    propertyType: typeof desc.type === 'string' ? desc.type : '', // e.g. "single_family"
  };
  return Object.values(facts).some(v => v !== '') ? facts : null;
}

const redfinRapidApi = (path, params) =>
  rapidApiGet('redfin-com-data.p.rapidapi.com', 'Redfin (RapidAPI)', path, params);
const realtorRapidApi = (path, params) =>
  rapidApiGet('realtor-search.p.rapidapi.com', 'Realtor (RapidAPI)', path, params);
const redfinBaseRapidApi = (path, params) =>
  rapidApiGet('redfin-base.p.rapidapi.com', 'Redfin Base (RapidAPI)', path, params);
const realtorApiDataRapidApi = (path, params) =>
  rapidApiGet('realtor-api-data.p.rapidapi.com', 'Realtor API Data (RapidAPI)', path, params);
const usRealtorRapidApi = (path, params) =>
  rapidApiGet('us-realtor.p.rapidapi.com', 'US Realtor (RapidAPI)', path, params);

async function rapidApiGet(host, name, path, params) {
  const url = `https://${host}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': host },
      signal: AbortSignal.timeout(30000),
    });
    // RapidAPI turns away 429 (over a limit) and 403 (not subscribed) before the API: no credit spent.
    if (res.status !== 429 && res.status !== 403) {
      creditsUsed++;
      const r = requestsThisRun[name] || (requestsThisRun[name] = { count: 0, last: 0 });
      r.count++;
      r.last = Date.now();
    }
    const remaining = res.headers.get('x-ratelimit-requests-remaining');
    const limit = res.headers.get('x-ratelimit-requests-limit');
    const reset = res.headers.get('x-ratelimit-requests-reset');
    if (!headersLogged[name]) {
      headersLogged[name] = true;
      const rate = [...res.headers.entries()].filter(([k]) => /ratelimit|quota/i.test(k)).map(([k, v]) => `${k}: ${v}`);
      console.log(`${name} usage headers: ${rate.length ? rate.join(', ') : 'none'}`);
    }
    if (remaining !== null) {
      console.log(`${name} requests left this period: ${remaining}` + (reset !== null ? ` (resets in ${Math.round(Number(reset) / 3600)} hours)` : ''));
      recordUsage(name, Number(remaining), limit, reset);
    }
    const body = await res.text();
    if (res.ok) return JSON.parse(body);
    // 429 is either the monthly quota (stop using this provider) or a per-second limit (wait, retry).
    // 403 means not subscribed / plan disabled: treat like no requests left.
    if (res.status === 403 || (res.status === 429 && /quota|exceeded|month/i.test(body))) {
      if (/quota|exceeded|month/i.test(body)) recordUsage(name, 0, limit, reset);
      throw new OutOfRequestsError(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Maps the API's wording to one of the portal's options: Single Family, Townhome, Condo,
 * Multifamily, Manufactured, Land. Anything else (or nothing) -> "" so the cell stays blank.
 */
function normalizePropertyType(v) {
  const t = clean(String(v ?? '').replace(/_/g, ' ')).toLowerCase(); // "single_family" -> "single family"
  if (!t) return '';
  if (/mobile|manufactured/.test(t)) return 'Manufactured';
  if (/town ?(home|house)/.test(t)) return 'Townhome';
  if (/condo|co-?op/.test(t)) return 'Condo';
  if (/multi|duplex|triplex|fourplex|quadplex|\b[2-4][- ]?(plex|units?)\b|apartment/.test(t)) return 'Multifamily';
  if (/\bland\b|\blots?\b|acreage/.test(t)) return 'Land';
  if (/single[- ]?family|\bsfr?\b|\bhouse\b|\bhome\b|residence|residential/.test(t)) return 'Single Family';
  return '';
}

function toNumber(v) {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? '' : n;
}

/* ------------------------------------------------------------------ */
/* Address Validation API                                              */
/* ------------------------------------------------------------------ */

async function verifyAddress(street, city, state, zip) {
  const apiKey = process.env.MAPS_API_KEY;
  if (!apiKey) throw new Error('MAPS_API_KEY is not set.');

  // Unit number intentionally NOT sent.
  const res = await fetchWithRetry('https://addressvalidation.googleapis.com/v1:validateAddress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      address: {
        regionCode: 'US',
        addressLines: [clean(street), `${clean(city)}, ${clean(state)} ${zip}`],
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Address Validation HTTP ${res.status}: ${raw.slice(0, 500)}`);
  const verdict = JSON.parse(raw).result?.verdict || {};
  // PREMISE / SUB_PREMISE = Google matched the actual building, not just the street or city.
  const granularity = verdict.validationGranularity || 'NONE';
  const valid = granularity === 'PREMISE' || granularity === 'SUB_PREMISE';
  return { valid, reason: `granularity=${granularity}` };
}

/* ------------------------------------------------------------------ */
/* Firestore (the portal's database, project andrew-marth-portal)      */
/* ------------------------------------------------------------------ */

// Collections, with values stored the way the portal stores them
// (see firestore/LAYOUT.md in the portal): dates as text "YYYY-MM-DD" (with " HH:MM:SS" when they have a
// time), zips and units as text, numbers as numbers, blanks left out, and _order to keep entries in the order added.
const FIRESTORE_DOCS = 'https://firestore.googleapis.com/v1/projects/andrew-marth-portal/databases/(default)/documents';
const docName = (collection, id) => `projects/andrew-marth-portal/databases/(default)/documents/${collection}/${id}`;
// wholesaleDeals: one document per deal, with these fields (in this order)
const DEAL_COLUMNS = ['DATE SENT', 'EMAIL', 'COMPANY', 'INDIVIDUAL', 'STREET ADDRESS', 'UNIT NUMBER', 'CITY', 'STATE', 'ZIP',
  'PICTURES LINK', 'EMAIL LINK', 'PRODUCTION READY', 'PRICE', 'STATUS', 'BED', 'BATH', 'SQFT', 'TAXES', 'PROPERTY TYPE', 'MARKUP'];
// wholesaleHistory: one document per email a run handled
const HISTORY_COLUMNS = ['DATE', 'EMAIL', 'COMPANY', 'INDIVIDUAL', 'EMAIL LINK', 'API USED', 'SUCCESS'];
// wholesaleZips: one document per target zip (the zip is its ID); wholesaleStatus: one per property API (its name
// is the ID, e.g. "REDFIN.COM DATA"), see updateUsageStatus

const TEXT_FIELDS = ['ZIP', 'UNIT NUMBER', 'ZIP CODE'];
/** A plain value as a Firestore value (null for blank, which is left out). */
function fsValue(field, v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number' && !TEXT_FIELDS.includes(field)) return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
/** A Firestore value as a plain value. */
function fsPlain(v) {
  if (!v) return '';
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  return v.stringValue ?? '';
}
/** { field: plain value } as Firestore fields (blanks left out). */
function fsFields(values) {
  const fields = {};
  for (const [k, v] of Object.entries(values)) { const f = fsValue(k, v); if (f) fields[k] = f; }
  return fields;
}

/** Every document of a collection: [{ id, data: { field: plain value } }]. */
async function listDocuments(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const r = await adcRequest(`${FIRESTORE_DOCS}/${collection}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
    (r.documents || []).forEach(d => {
      const data = {};
      Object.entries(d.fields || {}).forEach(([k, v]) => { data[k] = fsPlain(v); });
      docs.push({ id: decodeURIComponent(d.name.split('/').pop()), data });
    });
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/** Writes in one commit (all or nothing). */
async function commitWrites(writes) {
  if (writes.length) await adcRequest(`${FIRESTORE_DOCS}:commit`, { method: 'POST', data: { writes } });
}

/** New documents after every existing one, in one commit: rows are { field: value }. */
async function addDocuments(collection, rows) {
  const base = Date.now() * 1000;
  await commitWrites(rows.map((values, i) => ({
    update: { name: docName(collection, newDocId()), fields: { ...fsFields(values), _order: { integerValue: String(base + i) } } },
    currentDocument: { exists: false },
  })));
}
const newDocId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)),
  b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');

/** The target zips (the wholesaleZips documents). */
async function loadAllowedZips() {
  const zips = new Set();
  (await listDocuments('wholesaleZips')).forEach(d => {
    const z = normalizeZip(d.data['ZIP CODE'] || d.id);
    if (z) zips.add(z);
  });
  if (!zips.size) throw new Error('No zip codes found in wholesaleZips.');
  return zips;
}

/**
 * Adds an email's rows (arrays in DEAL_COLUMNS order) as wholesaleDeals documents in one commit, so an email's
 * deals are never half-written. DATE SENT (MM/DD/YYYY from formatDate) is stored as YYYY-MM-DD.
 */
async function appendDealRows(rows) {
  await addDocuments('wholesaleDeals', rows.map(row => {
    const values = {};
    DEAL_COLUMNS.forEach((col, c) => { values[col] = row[c]; });
    const m = String(values['DATE SENT'] || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) values['DATE SENT'] = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return values;
  }));
}

/**
 * One history entry per email a run handled: DATE (when it was handled, Phoenix time) | EMAIL | COMPANY |
 * INDIVIDUAL | EMAIL LINK | API USED | SUCCESS. API USED is the number of RapidAPI credits (requests) spent on it;
 * SUCCESS is "Success", "No properties found", or the error message.
 */
function historyRow(id, msg, out, outcome) {
  return [
    formatStoredDateTime(new Date()),
    msg ? parseFromEmail(msg.from) : '',
    out ? out.company : 'Unknown',
    out ? out.individual : 'Unknown',
    gmailLink(id),
    creditsUsed,
    outcome,
  ];
}

/** Adds the run's history entries; a failure here is logged, never fails the run. */
async function appendHistoryRows(rows) {
  if (!rows.length) return;
  try {
    await addDocuments('wholesaleHistory', rows.map(row => {
      const values = {};
      HISTORY_COLUMNS.forEach((col, c) => { values[col] = row[c]; });
      return values;
    }));
  } catch (e) {
    console.log(`Could not add to the wholesale history: ${e.message}`);
  }
}

/** Keys of every deal already added (for ?resume=1), each from the row it was written from. */
async function loadExistingRowKeys() {
  const keys = new Set();
  (await listDocuments('wholesaleDeals')).forEach(d => {
    const row = DEAL_COLUMNS.map(col => {
      const s = String(d.data[col] ?? '');
      const m = col === 'DATE SENT' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[2]}/${m[3]}/${m[1]}` : s; // back to formatDate's MM/DD/YYYY
    });
    keys.add(rowKey(row));
  });
  return keys;
}

/* ------------------------------------------------------------------ */
/* State (Cloud Storage)                                               */
/* ------------------------------------------------------------------ */

async function loadState() {
  if (!CONFIG.STATE_BUCKET) throw new Error('STATE_BUCKET is not set.');
  try {
    const data = await adcRequest(
      `https://storage.googleapis.com/storage/v1/b/${CONFIG.STATE_BUCKET}/o/${CONFIG.STATE_OBJECT}?alt=media`,
      { responseType: 'text' });
    const state = JSON.parse(data);
    propertyCache = state.propertyCache || {};
    providerPausedUntil = state.providerPausedUntil || {};
    providerUsage = state.providerUsage || {};
    rollOverResetQuotas();
    stateLoaded = true;
    return state;
  } catch (e) {
    if (e.response && e.response.status === 404) { stateLoaded = true; return {}; }
    throw e;
  }
}

/** Cloud Storage allows about one update per second to the same file, so retry when throttled. */
async function saveState(state) {
  state = { ...state, propertyCache: prunePropertyCache(), providerPausedUntil, providerUsage };
  const waits = [1500, 3000, 6000, 12000];
  for (let i = 0; ; i++) {
    try {
      await adcRequest(
        `https://storage.googleapis.com/upload/storage/v1/b/${CONFIG.STATE_BUCKET}/o` +
        `?uploadType=media&name=${encodeURIComponent(CONFIG.STATE_OBJECT)}`,
        { method: 'POST', data: JSON.stringify(state), headers: { 'Content-Type': 'application/json' } });
      return;
    } catch (e) {
      const status = e.response && e.response.status;
      if (i >= waits.length || !(status === 429 || status >= 500)) throw e;
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Cleaning helpers                                                    */
/* ------------------------------------------------------------------ */

function clean(v) {
  return (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
}

/** 5-digit zip from "12345", "12345-6789", 1234 (lost leading zero), etc. */
function normalizeZip(v) {
  const s = clean(v);
  let m = s.match(/^(\d{5})(?:-\d{4})?$/);
  if (m) return m[1];
  m = s.match(/^\d{3,4}$/); // a number cell that dropped leading zeros
  if (m) return s.padStart(5, '0');
  return '';
}

/** "UNIT A320" -> "A320", "Apt #4b" -> "4b", "# 12" -> "12". */
function cleanUnit(v) {
  let s = clean(v);
  if (!s) return '';
  s = s.replace(/^(?:#|no\.?|number|unit|apt\.?|apartment|ste\.?|suite|bldg\.?|building|fl\.?|floor|rm\.?|room|lot|space|spc)\b\.?/gi, ' ');
  s = s.replace(/\b(?:unit|apt|apartment|ste|suite)\b/gi, ' ');
  return s.replace(/[^A-Za-z0-9]/g, '');
}

function parseFromEmail(from) {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** "2026-10-29 11:55:04" in the deals' time zone (how the portal stores a date with a time). */
function formatStoredDateTime(date) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
