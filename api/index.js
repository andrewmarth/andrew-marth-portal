// HTTP entry point (Cloud Run function "portalApi"). The portal's pages POST JSON as text/plain (no CORS preflight);
// Documenso's webhook (unused for now) could POST here with ?documensoWebhook=<secret>.
import functions from '@google-cloud/functions-framework';
import { handle } from './portal.js';
import { inRequest } from './lib/store.js';

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
