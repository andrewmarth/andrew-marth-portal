// HTTP entry point (Cloud Run function "portalApi"). The portal's pages POST JSON as text/plain (no CORS preflight);
// Documenso's webhook (unused for now) could POST here with ?documensoWebhook=<secret>.
// Cloud Scheduler POSTs ?rateCheck every 15 minutes on weekday afternoons (job portal-rate-check, Eastern time) to pull
// Mortgage News Daily's rate; it's only run for a Google-signed token from the portal-api service account.
import functions from '@google-cloud/functions-framework';
import { OAuth2Client } from 'google-auth-library';
import { handle, checkTodayRate } from './portal.js';
import { inRequest } from './lib/store.js';

// The scheduled rate check's caller: an OIDC token Cloud Scheduler makes for this account, with this audience
const RATE_CHECK_ACCOUNT = process.env.RATE_CHECK_ACCOUNT || 'portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com';
const RATE_CHECK_AUDIENCE = 'portal-api-rate-check';
const oidc = new OAuth2Client();
async function fromScheduler(req) {
  const m = String(req.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return false;
  try {
    const p = (await oidc.verifyIdToken({ idToken: m[1], audience: RATE_CHECK_AUDIENCE })).getPayload();
    return Boolean(p && p.email === RATE_CHECK_ACCOUNT && p.email_verified);
  } catch (err) {
    return false;
  }
}

// Pages that may call the API from a browser (anything else gets no CORS header, so browsers block the reply)
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portal.andrewmarth.com,http://127.0.0.1:5175,http://localhost:5175').split(',');

functions.http('portalApi', async (req, res) => {
  const origin = req.get('origin');
  if (origin && ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }
  if (req.query && req.query.rateCheck !== undefined) {
    if (!(await fromScheduler(req))) { res.status(403).json({ ok: false, error: 'unauthorized' }); return; }
    res.status(200).json(await inRequest(() => checkTodayRate()));
    return;
  }
  let body = {};
  try {
    const text = req.rawBody ? req.rawBody.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    body = text ? JSON.parse(text) : {};
  } catch (err) {
    // The webhook's body isn't needed (it only says "something finished"); a bad body from anyone else is just empty
    body = {};
  }
  const reply = await inRequest(() => handle(body || {}, req.query || {}));
  res.status(200).json(reply);
});
