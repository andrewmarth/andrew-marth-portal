// Google services the API uses besides Firestore: Firebase sign-in tokens, Google Drive (as tiffany@andrewmarth.com,
// through the portal-api service account's domain-wide delegation, the same access the Apps Script had) and the
// geocoder for the wholesale map.
import { GoogleAuth } from 'google-auth-library';
import { getAuth } from 'firebase-admin/auth';
import './store.js'; // starts firebase-admin

export const SERVICE_ACCOUNT = process.env.PORTAL_SERVICE_ACCOUNT || 'portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com';
export const DRIVE_USER = process.env.DRIVE_USER || 'tiffany@andrewmarth.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const adc = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

// --- Sign-in ---
// The phone number a Firebase sign-in token belongs to, or null if the token is fake or expired
export async function verifyPhone(idToken) {
  if (!idToken) return null;
  try {
    const decoded = await getAuth().verifyIdToken(String(idToken));
    return decoded.phone_number || null;
  } catch (err) {
    return null;
  }
}

// --- Acting as the Drive user ---
// A token for DRIVE_USER: the service account signs a JWT (IAM Credentials, no key file) and Google swaps it for a token
let delegated = null;
async function driveToken() {
  if (delegated && delegated.expires > Date.now() + 60000) return delegated.token;
  const client = await adc.getClient();
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iss: SERVICE_ACCOUNT, sub: DRIVE_USER, scope: DRIVE_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const signed = await client.request({
    url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:signJwt`,
    method: 'POST', data: { payload },
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + signed.data.signedJwt,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Drive sign-in failed: ' + JSON.stringify(json).slice(0, 300));
  delegated = { token: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return delegated.token;
}

async function drive(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + await driveToken(), ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Drive ${options.method || 'GET'} ${url.split('?')[0]} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

// The files in a folder: [{ id, name, mimeType }] (null if the folder isn't shared with the Drive user, or is gone)
export async function folderFiles(folderId) {
  const files = [];
  let pageToken = '';
  try {
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const res = await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)` +
        `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? '&pageToken=' + pageToken : ''}`);
      const json = await res.json();
      files.push(...(json.files || []));
      pageToken = json.nextPageToken || '';
    } while (pageToken);
  } catch (err) {
    return null;
  }
  return files;
}

// One picture resized to the given width by Google (the original only if that fails and it's small enough):
// { type, bytes } or null
export async function driveImage(id, width) {
  try {
    const res = await fetch('https://drive.google.com/thumbnail?sz=w' + width + '&id=' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + await driveToken() }, redirect: 'follow',
    });
    const type = res.headers.get('content-type') || '';
    if (res.ok && /^image\//.test(type)) return { type, bytes: Buffer.from(await res.arrayBuffer()) };
  } catch (err) { /* fall back below */ }
  const meta = await (await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=size,mimeType,thumbnailLink&supportsAllDrives=true`)).json();
  if (Number(meta.size) <= 3000000) {
    const res = await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    return { type: meta.mimeType || 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) };
  }
  if (meta.thumbnailLink) {
    const res = await fetch(meta.thumbnailLink, { headers: { Authorization: 'Bearer ' + await driveToken() } });
    if (res.ok) return { type: res.headers.get('content-type') || 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}

// Saves a file into a folder. Returns { id, url } (url: the file's Drive page, like Apps Script's file.getUrl())
export async function createDriveFile(folderId, name, mimeType, bytes) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId], mimeType })], { type: 'application/json' }));
  form.append('file', new Blob([bytes], { type: mimeType }), name);
  const res = await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
    { method: 'POST', body: form });
  const json = await res.json();
  return { id: json.id, url: json.webViewLink || 'https://drive.google.com/file/d/' + json.id + '/view' };
}

// --- Geocoder (wholesale map) ---
// { status: 'OK', lat, lng } | { status: 'ZERO_RESULTS' } | { status: <error> }
export async function geocode(address) {
  const key = process.env.MAPS_API_KEY;
  if (!key) return { status: 'MAPS_API_KEY is not set' };
  const res = await fetch('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(address) + '&key=' + encodeURIComponent(key));
  const json = await res.json().catch(() => ({}));
  const hit = json.status === 'OK' && json.results && json.results[0];
  if (hit) return { status: 'OK', lat: hit.geometry.location.lat, lng: hit.geometry.location.lng };
  return { status: json.status || 'HTTP ' + res.status };
}
