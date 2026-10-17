/**
 * Andrew Marth Client Portal - private data API
 *
 * Returns ONLY the signed-in client's row from a private Google Sheet.
 * The sheet itself stays private (do not "publish to web" or share it publicly).
 *
 * Setup:
 *   1. Open the client data Google Sheet > Extensions > Apps Script. Paste this file in.
 *   2. Fill in the three settings below.
 *   3. Make sure the sheet has a column headed "ID" holding each client's
 *      10-digit phone number (e.g. 4805550123). Other columns are shown on the portal.
 *   4. Deploy > New deployment > type "Web app"
 *        Execute as: Me    Who has access: Anyone
 *   5. Copy the Web app URL into PORTAL_API_URL in firebase-config.js.
 *   (After editing this script later: Deploy > Manage deployments > Edit > New version.)
 */

// Same apiKey as firebase-config.js
const FIREBASE_API_KEY = 'AIzaSyDdwjGBP5ZwdtZhlq8wsLHbgn2UwfYKDrQ';
// The long ID in the sheet's URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
const SHEET_ID = '';
// The tab name holding the client rows
const SHEET_NAME = 'Clients';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const phone = verifyPhone_(body.idToken);
    if (!phone) return json_({ ok: false, error: 'unauthorized' });

    const id = phoneToId_(phone);
    const row = findRow_(id);
    if (!row) return json_({ ok: false, error: 'not_found' });

    return json_({ ok: true, id: id, row: row });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

// Asks Firebase who this sign-in token belongs to. Returns their phone number, or null if the token is fake/expired.
function verifyPhone_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_API_KEY),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() !== 200) return null;
  const users = JSON.parse(res.getContentText()).users || [];
  return users.length && users[0].phoneNumber ? users[0].phoneNumber : null;
}

// Phone number without the country code, symbols or spaces (e.g. +14805550123 -> 4805550123)
function phoneToId_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
}

// Finds the row whose "ID" column matches, and returns it as { "Column Header": value, ... }
function findRow_(id) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab not found: ' + SHEET_NAME);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idCol = headers.findIndex(function (h) { return h.toLowerCase() === 'id'; });
  if (idCol < 0) throw new Error('No "ID" column found');

  for (var r = 1; r < values.length; r++) {
    if (phoneToId_(values[r][idCol]) === id) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = values[r][c]; });
      return row;
    }
  }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
