// Zillow, through RapidAPI's Zillow API (https://rapidapi.com/rapidapi-org1-rapidapi-org-default/api/zillow191). Used
// only for a listing's Zillow page views and favorites (its property details: GET /v1/property/details?zpid=...).
//
// Every request is counted on apiStatus/ZILLOW (the admin Usage card's Zillow section), the same way the property APIs
// are counted on their wholesaleStatus documents (lib/property-facts.js): REQUESTS THIS MONTH and LAST REQUEST go up,
// and RapidAPI's own numbers (USAGE / CAP / USAGE AS OF / RESETS AT) are saved from each answer. Once the plan's
// requests are used up, no request is sent until it resets.
//
// Environment: RAPIDAPI_KEY (from Secret Manager; the same key as the property APIs, subscribed to the Zillow API).
import { db } from './store.js';
import { rapidApiRequest, rapidApiSkip, OutOfRequestsError } from './property-facts.js';

export const ZILLOW_HOST = 'zillow191.p.rapidapi.com';
const statusRef = () => db.collection('apiStatus').doc('ZILLOW');

// The answer to a GET (path like '/v1/property/details', params like { zpid }). Throws OutOfRequestsError when the
// plan's requests are used up (without sending one), and an Error for no key or a failed request.
export async function zillowGet(path, params) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('no_rapidapi_key');
  const ref = statusRef();
  if (rapidApiSkip((await ref.get()).data())) throw new OutOfRequestsError('Zillow is out of requests until its plan resets');
  return rapidApiRequest(ref, ZILLOW_HOST, path, params);
}

export { OutOfRequestsError };
