/**
 * Andrew Marth Client Portal - private data API
 *
 * Returns ONLY the signed-in client's rows from private Google Sheets, and lets them
 * update their own name and income. The sheets themselves stay private
 * (do not "publish to web" or share them publicly).
 *
 * Setup:
 *   1. Go to script.google.com > New project. Paste this file in.
 *   2. Fill in the settings below.
 *   3. Each sheet needs a column headed "ACCOUNT ID" (or "ID") holding each client's
 *      10-digit phone number (e.g. 4805550123).
 *   4. Deploy > New deployment > type "Web app"
 *        Execute as: Me    Who has access: Anyone
 *   5. Copy the Web app URL into PORTAL_API_URL in firebase-config.js.
 *   (After editing this script later: Deploy > Manage deployments > Edit > New version.)
 */

// Same apiKey as firebase-config.js
const FIREBASE_API_KEY = 'AIzaSyDdwjGBP5ZwdtZhlq8wsLHbgn2UwfYKDrQ';

// Account sheet (name and TRUE/FALSE role columns). The long ID in the sheet's URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
const SHEET_ID = '1u0ZFiybLfrJVs3N0Bqm1cAnOotSXvc9iJK0j_rp1etg';
const SHEET_NAME = 'ACCOUNT_LIST';

// Income sheet (jobs and monthly debt payments)
const INCOME_SHEET_ID = '1yOSed7PINGBjqUiAihWgvhKNf8W6spchblTD1jIi2iQ';
const INCOME_SHEET_NAME = 'PAGE_LIST';

// Buyer breakdown sheets
const PAGES_SHEET_ID = '15IiTLTwAaM7ePEWmj7fpaeSoV4-xqAbr6ZTWNnzKuwA';
const PAGES_SHEET_NAME = 'PAGE_LIST';
const LOAN_SHEET_ID = '13hPK8h-UBfPkO0uzjsrPea5C5-3XzrJvc19AQmare7I';
const LOAN_SHEET_NAME = 'LOAN_PRODUCTS';
const RATE_SHEET_ID = '1E8Ob2FBUuoW7VCddMZJcacqqxpcOO8O5ym6agEDTZ8w';
const RATE_SHEET_NAME = 'PAGE_LIST';
// Inspector price lists (first tab of each)
const HOME_INSPECTORS_SHEET_ID = '1UBrhEIC44CsGioc7NvNQsI4G9OzF1DuRoUWifj0HOlU';
const SEWER_INSPECTORS_SHEET_ID = '1mm9zcVYjg4JyzQzAYj3TqTMHZILkW4QYzdgWamHbUd4';
const TERMITE_INSPECTORS_SHEET_ID = '199Yai63C7Fm5L0kNNb2SLCUOULFrDePz65K3Vyo6QwM';
// Admins only: links to other services for the home page's Links card (first tab: TITLE, DESCRIPTION, SECTION, LINK)
const LINKS_SHEET_ID = '16ZhBm5WgywQx8dZlE_7tksz6te26AZC2P8fq8U7A6E8';
// The only people who may view a page. The first six are clients (PRIMARY is the buyer); the last is the lender.
const PAGE_PEOPLE_COLUMNS = ['PRIMARY ACCOUNT ID', 'ALT ACCOUNT ID 1', 'ALT ACCOUNT ID 2', 'ALT ACCOUNT ID 3',
  'ALT ACCOUNT ID 4', 'ALT ACCOUNT ID 5'];
const PAGE_LENDER_COLUMN = 'LENDER ACCOUNT ID';
const PAGE_ACCESS_COLUMNS = PAGE_PEOPLE_COLUMNS.concat([PAGE_LENDER_COLUMN]);
// Whether each of those six people is a "Purchaser" or a "Collaborator" (blank counts as Purchaser).
// These columns are added to the end of the PAGES sheet the first time access is saved.
const PAGE_ROLE_COLUMNS = ['PRIMARY ACCOUNT TYPE', 'ALT ACCOUNT TYPE 1', 'ALT ACCOUNT TYPE 2', 'ALT ACCOUNT TYPE 3',
  'ALT ACCOUNT TYPE 4', 'ALT ACCOUNT TYPE 5'];
// TRUE when the buyer is paying cash (no loan); also added the first time access is saved
const PAGE_CASH_COLUMN = 'CASH PURCHASE';

// PAGES columns admins can edit from the page's Settings card, and the kind of value each one takes:
//   money / int: whole numbers (no commas)   rate: a decimal like 0.03 for 3%   bool: TRUE / FALSE
//   date: m/d/yyyy   payer: Buyer or Seller   text: any short text   [list]: one of those values
const PAGE_SETTING_FIELDS = {
  'PURCHASE PRICE': 'money', 'SELLER CREDIT': 'rate', 'PROPERTY TYPE': ['Single Family', 'Townhome', 'Condo', 'Manufactured'],
  'SQFT': 'int', 'YEAR BUILT': 'int', 'HAS POOL': 'bool', 'YEARLY TAXES': 'money',
  'CENSUS DESIGNATION': ['Low', 'Moderate', 'Middle', 'Upper'], 'OFFER ACCEPTANCE DATE': 'date', 'ESCROW DURATION': 'int',
  'EARNEST MONEY DEPOSIT': 'money', 'GIFT FUNDS': 'money',
  'RETAIL LTV': 'rate', 'LENDER POINTS PURCHASED': 'rate', 'PREPAID MI APPLIED': 'bool',
  'ESCROW FEE RATE': 'rate', 'OWNERS TITLE RATE': 'rate', 'ALTA TITLE RATE': 'rate', 'HOMEOWNERS INSURANCE RATE': 'rate',
  'HOA TRANSFER FEE': 'money', 'WHO PAYS TRANSFER FEE': 'payer', 'HOA CAP FEE': 'money', 'WHO PAYS CAP FEE': 'payer',
  'HOA DISCLOSURE FEE': 'money', 'HOA OTHER FEE': 'money', 'WHO PAYS OTHER FEE': 'payer',
  'HOA PRIMARY MONTHLY DUES': 'money', 'HOA MASTER MONTHLY DUES': 'money',
  'BUYERS AGENT COMMISSION %': 'rate', 'BUYERS AGENT COMMISSION $': 'money',
  'SELLER PAID BUYER COMMISSION %': 'rate', 'SELLER PAID BUYER COMMISSION $': 'money',
  'HOME INSPECTOR': 'text', 'HOME INSPECTOR POOL': 'bool', 'HOME INSPECTOR SEWER': 'bool', 'HOME INSPECTOR TERMITE': 'bool',
  'SEWER INSPECTOR': 'text', 'TERMITE INSPECTOR': 'text',
};

// Checks one submitted setting. Returns the value to write, or null if it isn't allowed. Blank is always allowed.
function cleanSetting_(kind, value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (raw === '') return '';
  if (Array.isArray(kind)) return kind.filter(function (k) { return k.toLowerCase() === raw.toLowerCase(); })[0] || null;
  if (kind === 'bool') return /^true$/i.test(raw) ? true : /^false$/i.test(raw) ? false : null;
  if (kind === 'payer') return /^buyer$/i.test(raw) ? 'Buyer' : /^seller$/i.test(raw) ? 'Seller' : null;
  if (kind === 'text') return cleanText_(raw, 100);
  if (kind === 'date') {
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 ? (+m[1]) + '/' + (+m[2]) + '/' + m[3] : null;
  }
  const n = Number(raw.replace(/[$,\s]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  if (kind === 'rate') return n <= 1 ? Math.round(n * 1e6) / 1e6 : null;
  return n <= 100000000 ? Math.round(n) : null;
}

// Allowed values for the commission and bonus interval columns
const INTERVALS = ['Weekly', 'Monthly', 'Quarterly', 'Annually', 'Bi-Annually'];

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const phone = verifyPhone_(body.idToken);
    if (!phone) return json_({ ok: false, error: 'unauthorized' });

    const id = phoneToId_(phone);
    const found = findRow_(SHEET_ID, SHEET_NAME, id);
    if (!found) return json_({ ok: false, error: 'not_found' });

    // Settings page: save a new first and last name to this client's own row
    if (body.action === 'updateName') {
      const firstName = cleanText_(body.firstName, 50);
      const lastName = cleanText_(body.lastName, 50);
      if (!firstName || !lastName) return json_({ ok: false, error: 'invalid_name' });
      found.sheet.getRange(found.rowNumber, colFor_(found.headers, 'first name')).setValue(firstName);
      found.sheet.getRange(found.rowNumber, colFor_(found.headers, 'last name')).setValue(lastName);
      return json_({ ok: true, id: id, row: findRow_(SHEET_ID, SHEET_NAME, id).row });
    }

    // pages.html: one PAGES row (its PAGE TYPE decides what the page shows) plus what that type needs
    if (body.action === 'page') return json_(pageData_(id, found.row, body.pageId));
    // Home page: the Buyer Breakdown pages this account is listed on (and, for admins, every buyer's)
    if (body.action === 'myPages') return json_(myPagesData_(id, found.row));
    // pages.html (admins): change who can see the page
    if (body.action === 'updatePageAccess') return json_(updatePageAccess_(id, found.row, body));

    // Settings page: save this client's income and debt (adds their row if they don't have one yet)
    if (body.action === 'updateIncome') {
      const error = saveIncome_(id, body.income || {});
      if (error) return json_({ ok: false, error: error });
    }

    // Income is extra: if that sheet can't be read, still return the account details
    var income = null;
    try {
      const incomeRow = findRow_(INCOME_SHEET_ID, INCOME_SHEET_NAME, id);
      income = incomeRow ? incomeRow.row : null;
    } catch (incomeErr) {
      console.error(incomeErr);
    }
    return json_({ ok: true, id: id, row: found.row, income: income });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

// Writes the submitted income values to the client's income row. Returns an error code, or '' when saved.
function saveIncome_(id, submitted) {
  const sheet = getSheet_(INCOME_SHEET_ID, INCOME_SHEET_NAME);
  const headers = readHeaders_(sheet, true);
  const idCol = idColumn_(headers);

  // Clean every submitted value; only real income columns are accepted
  const updates = {};
  for (const key in submitted) {
    const header = String(key).trim().toUpperCase();
    const col = headers.findIndex(function (h) { return h.toUpperCase() === header; });
    if (col < 0 || col === idCol) return 'invalid_field';
    const value = cleanIncomeValue_(header, submitted[key]);
    if (value === null) return 'invalid_value';
    updates[col] = value;
  }

  const found = findRow_(INCOME_SHEET_ID, INCOME_SHEET_NAME, id);
  const rowNumber = found ? found.rowNumber : sheet.getLastRow() + 1;
  // Start from the row's raw values so untouched cells keep their exact contents
  const values = found
    ? sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]
    : headers.map(function () { return ''; });
  if (!found) values[idCol] = Number(id);
  for (const col in updates) values[col] = updates[col];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  return '';
}

// Finds a PAGES row by PAGE ID. Returns { row, rowNumber, headers, sheet } or null.
function findPage_(pageId) {
  const wanted = String(pageId || '').trim().toUpperCase();
  if (!wanted) return null;
  const sheet = getSheet_(PAGES_SHEET_ID, PAGES_SHEET_NAME);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const col = headers.indexOf('PAGE ID');
  if (col < 0) throw new Error('No "PAGE ID" column found');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][col]).trim().toUpperCase() === wanted) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = values[r][c]; });
      return { row: row, rowNumber: r + 1, headers: headers, sheet: sheet };
    }
  }
  return null;
}

// Only the accounts in the page's access columns may see it - admins included
function isOnPage_(page, id) {
  return PAGE_ACCESS_COLUMNS.some(function (col) { return page[col] && phoneToId_(page[col]) === id; });
}

// Roles are TRUE/FALSE columns in ACCOUNT LIST (BUYER, SELLER, LANDLORD, FLIPPER BUYER, FLIPPER SELLER, ADMIN, LENDER).
// Someone can have several at once.
function hasRole_(account, role) {
  return String(account[role] || '').trim().toUpperCase() === 'TRUE';
}

function isAdmin_(account) {
  return hasRole_(account, 'ADMIN');
}

// Everyone in ACCOUNT LIST, for the admin's access pickers
function accountChoices_() {
  return allRows_(SHEET_ID, SHEET_NAME).map(function (r) {
    return {
      id: phoneToId_(r['ACCOUNT ID']),
      name: [r['FIRST NAME'], r['LAST NAME']].map(function (s) { return String(s || '').trim(); }).filter(String).join(' '),
      isLender: hasRole_(r, 'LENDER'),
      bank: String(r['LENDER BANK'] || '').trim(),
    };
  }).filter(function (a) { return a.id; });
}

// Admins only: saves the purchasers (first one goes in PRIMARY), then the collaborators, into the six
// account columns with their type beside them, plus one lender (or none)
function updatePageAccess_(id, account, body) {
  const found = findPage_(body.pageId);
  if (!found || !isOnPage_(found.row, id)) return { ok: false, error: 'page_not_found' };
  if (!isAdmin_(account)) return { ok: false, error: 'not_allowed' };

  const accounts = accountChoices_();
  const known = {};
  accounts.forEach(function (a) { known[a.id] = a; });

  // Real accounts only, nobody listed twice, at least one purchaser and six people at most
  const people = [];
  const addAll = function (list, type) {
    (Array.isArray(list) ? list : []).forEach(function (p) {
      const pid = phoneToId_(p);
      if (pid && known[pid] && !people.some(function (x) { return x.id === pid; })) people.push({ id: pid, type: type });
    });
  };
  addAll(body.purchasers, 'Purchaser');
  addAll(body.collaborators, 'Collaborator');
  if (!people.some(function (p) { return p.type === 'Purchaser'; })) return { ok: false, error: 'need_one_purchaser' };
  if (people.length > PAGE_PEOPLE_COLUMNS.length) return { ok: false, error: 'too_many_people' };

  // Lender: blank for "None", otherwise an account marked LENDER = TRUE.
  // Cash purchase comes from the "Cash" choice in the Loan Product picker.
  const cash = body.cash === true;
  const lender = phoneToId_(body.lender);
  if (lender && !(known[lender] && known[lender].isLender)) return { ok: false, error: 'invalid_lender' };

  // Other settings: only known columns, each in the right format. The seller always pays the HOA disclosure fee.
  const fields = {};
  const submitted = body.fields || {};
  for (const key in submitted) {
    const column = String(key).trim().toUpperCase();
    if (!PAGE_SETTING_FIELDS.hasOwnProperty(column)) return { ok: false, error: 'invalid_field' };
    const value = cleanSetting_(PAGE_SETTING_FIELDS[column], submitted[key]);
    if (value === null) return { ok: false, error: 'invalid_value', field: column };
    fields[column] = value;
  }
  if (fields.hasOwnProperty('HOA DISCLOSURE FEE')) fields['WHO PAYS DISCLOSURE FEE'] = 'Seller';

  const headers = addMissingColumns_(found.sheet, found.headers, PAGE_ROLE_COLUMNS.concat([PAGE_CASH_COLUMN]).concat(Object.keys(fields)));
  found.sheet.getRange(found.rowNumber, colFor_(headers, PAGE_CASH_COLUMN.toLowerCase())).setValue(cash);
  Object.keys(fields).forEach(function (column) {
    found.sheet.getRange(found.rowNumber, colFor_(headers, column.toLowerCase())).setValue(fields[column]);
  });
  PAGE_PEOPLE_COLUMNS.forEach(function (col, i) {
    const person = people[i];
    found.sheet.getRange(found.rowNumber, colFor_(headers, col.toLowerCase())).setValue(person ? Number(person.id) : '');
    found.sheet.getRange(found.rowNumber, colFor_(headers, PAGE_ROLE_COLUMNS[i].toLowerCase())).setValue(person ? person.type : '');
  });
  found.sheet.getRange(found.rowNumber, colFor_(headers, PAGE_LENDER_COLUMN.toLowerCase())).setValue(lender ? Number(lender) : '');

  return { ok: true, page: findPage_(body.pageId).row };
}

// Adds any of the named headers that the sheet doesn't have yet to the end of row 1. Returns the updated headers.
function addMissingColumns_(sheet, headers, names) {
  const out = headers.slice();
  names.forEach(function (name) {
    if (out.some(function (h) { return h.toUpperCase() === name; })) return;
    sheet.getRange(1, out.length + 1).setValue(name);
    out.push(name);
  });
  return out;
}

// A PAGES row for pages.html. Only people listed on the page get it; anyone else is told it doesn't exist.
// The PAGE TYPE column decides what else is sent along.
function pageData_(id, account, pageId) {
  if (!String(pageId || '').trim()) return { ok: false, error: 'missing_page' };
  const found = findPage_(pageId);
  if (!found || !isOnPage_(found.row, id)) return { ok: false, error: 'page_not_found' };
  const page = found.row;
  const isAdmin = isAdmin_(account);

  const result = {
    ok: true,
    page: page,
    pageType: String(page['PAGE TYPE'] || '').trim(),
    isAdmin: isAdmin,
    viewerId: id,
    // Admins get the account list for the access pickers
    accounts: isAdmin ? accountChoices_() : null,
  };
  if (result.pageType.toLowerCase() === 'buyer breakdown') addBuyerBreakdownData_(result, page);
  return result;
}

// Home page lists. Everyone: the Buyer Breakdown pages with this account in one of its ACCOUNT ID columns.
// Admins also get every BUYER account and every Buyer Breakdown page (with who is on it) for the "My Buyers" card.
// Newest rows come first.
function myPagesData_(id, account) {
  const pages = allRows_(PAGES_SHEET_ID, PAGES_SHEET_NAME)
    .filter(function (p) {
      return String(p['PAGE ID'] || '').trim() && String(p['PAGE TYPE'] || '').trim().toLowerCase() === 'buyer breakdown';
    })
    .reverse();
  const summary = function (p) {
    return {
      id: String(p['PAGE ID']).trim(),
      street: String(p['STREET ADDRESS'] || '').trim(),
      city: String(p['CITY'] || '').trim(),
      state: String(p['STATE'] || '').trim(),
      zip: String(p['ZIP'] || '').trim(),
      price: String(p['PURCHASE PRICE'] || '').trim(),
    };
  };
  const result = { ok: true, pages: pages.filter(function (p) { return isOnPage_(p, id); }).map(summary) };
  if (isAdmin_(account)) {
    result.buyers = allRows_(SHEET_ID, SHEET_NAME)
      .filter(function (r) { return hasRole_(r, 'BUYER'); })
      .map(function (r) {
        return {
          id: phoneToId_(r['ACCOUNT ID']),
          name: [r['FIRST NAME'], r['LAST NAME']].map(function (s) { return String(s || '').trim(); }).filter(String).join(' '),
        };
      })
      .filter(function (b) { return b.id; })
      .sort(function (a, b) { return (a.name || a.id).localeCompare(b.name || b.id); });
    result.buyerPages = pages.map(function (p) {
      const page = summary(p);
      page.people = PAGE_ACCESS_COLUMNS.map(function (c) { return phoneToId_(p[c]); }).filter(String);
      return page;
    });
    // Links are extra: if that sheet can't be read, the page lists still load
    try {
      result.links = adminLinks_();
    } catch (linksErr) {
      console.error(linksErr);
      result.links = null;
    }
  }
  return result;
}

// Each row of the LINKS sheet that has a web address, in sheet order
function adminLinks_() {
  return firstTabRows_(LINKS_SHEET_ID)
    .map(function (r) {
      return {
        title: String(r['TITLE'] || '').trim(),
        description: String(r['DESCRIPTION'] || '').trim(),
        section: String(r['SECTION'] || '').trim(),
        link: String(r['LINK'] || '').trim(),
      };
    })
    .filter(function (l) { return /^https?:\/\//i.test(l.link); });
}

// Buyer Breakdown pages: every loan product, today's rate (first row) and the buyer's credit score
function addBuyerBreakdownData_(result, page) {
  // Credit score belongs to the page's buyer, not whoever is viewing (e.g. the lender)
  var creditScore = null;
  const buyerId = phoneToId_(page['PRIMARY ACCOUNT ID']);
  if (buyerId) {
    const income = findRow_(INCOME_SHEET_ID, INCOME_SHEET_NAME, buyerId);
    if (income) creditScore = income.row['CREDIT SCORE'] || null;
  }
  result.loanProducts = allRows_(LOAN_SHEET_ID, LOAN_SHEET_NAME);
  result.interestRate = allRows_(RATE_SHEET_ID, RATE_SHEET_NAME)[0] || null;
  result.creditScore = creditScore;
  result.clients = pageClients_(page);
  // The price-list row for each inspector chosen on the page (null when none is chosen or it isn't found)
  result.inspectors = {
    home: inspectorRow_(HOME_INSPECTORS_SHEET_ID, 'HOME INSPECTOR', page['HOME INSPECTOR']),
    sewer: inspectorRow_(SEWER_INSPECTORS_SHEET_ID, 'SEWER INSPECTOR', page['SEWER INSPECTOR']),
    termite: inspectorRow_(TERMITE_INSPECTORS_SHEET_ID, 'TERMITE INSPECTOR', page['TERMITE INSPECTOR']),
  };
  // Admins get every inspector's price list, for the Settings dropdowns and to preview a new pick
  if (result.isAdmin) {
    result.inspectorRows = {
      home: firstTabRows_(HOME_INSPECTORS_SHEET_ID),
      sewer: firstTabRows_(SEWER_INSPECTORS_SHEET_ID),
      termite: firstTabRows_(TERMITE_INSPECTORS_SHEET_ID),
    };
  }
}

// Every non-empty row of a sheet's first tab as { "Column Header": value, ... }
function firstTabRows_(sheetId) {
  const values = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (r) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = r[c]; });
      return row;
    });
}

// Finds an inspector by name in the first tab of a price-list sheet
function inspectorRow_(sheetId, nameColumn, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const values = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const col = headers.findIndex(function (h) { return h.toUpperCase() === nameColumn; });
  if (col < 0) return null;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][col]).trim().toLowerCase() === wanted) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = values[r][c]; });
      return row;
    }
  }
  return null;
}

// Each person on the page (PRIMARY, then ALT 1-5) with their name, Purchaser/Collaborator type and INCOME row
// (null if they have none; it also holds their CREDIT SCORE), for the rate and approval estimate
function pageClients_(page) {
  const names = {};
  allRows_(SHEET_ID, SHEET_NAME).forEach(function (r) {
    names[phoneToId_(r['ACCOUNT ID'])] = [r['FIRST NAME'], r['LAST NAME']].map(function (s) { return String(s || '').trim(); }).filter(String).join(' ');
  });
  const incomes = {};
  allRows_(INCOME_SHEET_ID, INCOME_SHEET_NAME).forEach(function (r) {
    const rid = phoneToId_(r['ACCOUNT ID'] || r['ID']);
    if (rid && !incomes[rid]) incomes[rid] = r;
  });
  const seen = {};
  return PAGE_PEOPLE_COLUMNS.map(function (col, i) {
    const type = String(page[PAGE_ROLE_COLUMNS[i]] || '').trim().toLowerCase() === 'collaborator' ? 'Collaborator' : 'Purchaser';
    return { id: phoneToId_(page[col]), type: type };
  })
    .filter(function (p) { if (!p.id || seen[p.id]) return false; seen[p.id] = true; return true; })
    .map(function (p) { return { id: p.id, type: p.type, name: names[p.id] || '', income: incomes[p.id] || null }; });
}

// Every non-empty row of a tab as { "Column Header": value, ... }
function allRows_(sheetId, sheetName) {
  const values = getSheet_(sheetId, sheetName).getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (r) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = r[c]; });
      return row;
    });
}

// Interval columns must be one of INTERVALS, job titles/descriptions are short text,
// everything else is a dollar amount or number. Returns null when the value isn't allowed.
function cleanIncomeValue_(header, value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '';
  if (/INTERVAL$/.test(header)) {
    const match = INTERVALS.filter(function (i) { return i.toLowerCase() === raw.toLowerCase(); })[0];
    return match || null;
  }
  if (/(JOB TITLE|DESCRIPTION)$/.test(header)) return cleanText_(raw, 100);
  const num = Number(raw.replace(/[$,\s]/g, ''));
  if (!isFinite(num) || num < 0 || num > 100000000) return null;
  return Math.round(num * 100) / 100;
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

// Trims submitted text, drops characters that could start a spreadsheet formula, and caps the length
function cleanText_(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim().slice(0, maxLength);
}

// 1-based column number for a header (e.g. "FIRST NAME"), or an error if the column is missing
function colFor_(headers, name) {
  const i = headers.findIndex(function (h) { return h.toLowerCase() === name; });
  if (i < 0) throw new Error('No "' + name.toUpperCase() + '" column found');
  return i + 1;
}

function getSheet_(sheetId, sheetName) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error('Tab not found: ' + sheetName);
  return sheet;
}

// Header row, trimmed. When saving (strict), duplicate headers would make it ambiguous which cell to write, so they're an error.
function readHeaders_(sheet, strict) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (!strict) return headers;
  const seen = {};
  headers.forEach(function (h) {
    const key = h.toUpperCase();
    if (key && seen[key]) throw new Error('Duplicate column header: ' + h);
    seen[key] = true;
  });
  return headers;
}

function idColumn_(headers) {
  const idCol = headers.findIndex(function (h) { return /^(account )?id$/i.test(h); });
  if (idCol < 0) throw new Error('No "ACCOUNT ID" column found');
  return idCol;
}

// Finds the row whose "ID" column matches. Returns { row: { "Column Header": value, ... }, rowNumber, headers, sheet }
function findRow_(sheetId, sheetName, id) {
  const sheet = getSheet_(sheetId, sheetName);
  const headers = readHeaders_(sheet, false);
  const idCol = idColumn_(headers);
  const values = sheet.getDataRange().getDisplayValues();

  for (var r = 1; r < values.length; r++) {
    if (phoneToId_(values[r][idCol]) === id) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = values[r][c]; });
      return { row: row, rowNumber: r + 1, headers: headers, sheet: sheet };
    }
  }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
