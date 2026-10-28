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
// Cash flow (cum.html), for accounts with CUM = TRUE: projected transactions and bank balances
const CUM_TRANSACTIONS_SHEET_ID = '1cAi5-nh5V7YX88jFcr2ZQhRpx6K9z2UOEeF2JhWFnA4';
const CUM_TRANSACTIONS_SHEET_NAME = 'TRANSACTIONS';
const CUM_BALANCE_SHEET_ID = '1HZv-RQaWEawyiHs2Nrj-o_Nk3ad4L5-c3aW4TGtASAM';
const CUM_BALANCE_SHEET_NAME = 'RECURRING';
// Flip portal map (first tab)
const WHOLESALE_SHEET_ID = '12aIo0maV2qzEylH6nOfJYR-8O9aEUqlE-BywcDZcOlQ';
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

// Sheet reads made during one request (several page versions read the same sheets)
var ROWS_CACHE_ = {};

function doPost(e) {
  try {
    ROWS_CACHE_ = {};
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
    // cum.html: this account's cash flow (CUM accounts only)
    if (body.action === 'cashFlow') return json_(cashFlow_(id, found.row));
    if (body.action === 'updateTransaction') return json_(changeTransaction_(id, found.row, body, false));
    if (body.action === 'deleteTransaction') return json_(changeTransaction_(id, found.row, body, true));
    if (body.action === 'addTransaction') return json_(addTransaction_(id, found.row, body));
    if (body.action === 'updateBalance') return json_(updateBalance_(id, found.row, body));
    // flip-portal.html: wholesale properties with map positions (admins and FLIPPER BUYER accounts)
    if (body.action === 'wholesaleProperties') return json_(wholesaleProperties_(found.row));
    if (body.action === 'wholesalePhotos') return json_(wholesalePhotos_(found.row, body));
    if (body.action === 'wholesalePhoto') return json_(wholesalePhoto_(found.row, body));
    if (body.action === 'wholesaleCover') return json_(wholesaleCover_(found.row, body));
    if (body.action === 'wholesaleCovers') return json_(wholesaleCovers_(found.row, body));
    // Home page (admins): add a new property for a buyer
    if (body.action === 'createProperty') return json_(createProperty_(found.row, body));
    // pages.html (admins): copy the page into a new version
    if (body.action === 'createVersion') return json_(createVersion_(id, found.row, body));
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
// Income levels and the columns each one has in the INCOME sheet ("PRIMARY JOB TITLE", "QUINARY BONUS AMOUNT"...)
const INCOME_LEVELS = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];
const INCOME_LEVEL_FIELDS = ['JOB TITLE', 'WEEKLY SALARY', 'HOURLY RATE', 'WEEKLY HOURS', 'WEEKLY TIPS', 'COMMISSION INTERVAL',
  'COMMISSION AMOUNT', 'BONUS INTERVAL', 'BONUS AMOUNT', '1099 YEARLY INCOME', '1099 INCOME DESCRIPTION'];
// Monthly debts and, beside each, its Yes/No answer (TRUE / FALSE)
const DEBT_AMOUNT_COLUMNS = ['CAR LOAN PAYMENT', 'MORTGAGE PAYMENT', 'CREDIT CARD PAYMENT', 'OTHER PAYMENT'];
const DEBT_FLAG_COLUMNS = ['HAS CAR LOAN', 'HAS MORTGAGE', 'HAS CREDIT CARDS', 'HAS OTHER PAYMENTS'];
// How many of each debt (same order), and the text columns beside each payment. Entry n adds " n" to each name.
const DEBT_MAX = [5, 5, 5, 10];
const DEBT_TEXT_COLUMNS = [['CAR LOAN MAKE', 'CAR LOAN MODEL'], [], ['CREDIT CARD NAME'], ['OTHER PAYMENT NAME']];
const debtCol_ = function (base, n) { return n === 1 ? base : base + ' ' + n; };
// Every debt payment and name column, in sheet order (type, then entry)
function debtEntryColumns_() {
  const out = [];
  DEBT_AMOUNT_COLUMNS.forEach(function (amount, d) {
    for (var n = 1; n <= DEBT_MAX[d]; n++) {
      DEBT_TEXT_COLUMNS[d].forEach(function (t) { out.push(debtCol_(t, n)); });
      out.push(debtCol_(amount, n));
    }
  });
  return out;
}

function saveIncome_(id, submitted) {
  const sheet = getSheet_(INCOME_SHEET_ID, INCOME_SHEET_NAME);
  var headers = readHeaders_(sheet, true);
  // A level's columns are added to the end of the sheet the first time someone saves them (in level, then field order)
  const sent = {};
  Object.keys(submitted || {}).forEach(function (k) { sent[String(k).trim().toUpperCase()] = true; });
  const missing = [];
  INCOME_LEVELS.forEach(function (L) {
    INCOME_LEVEL_FIELDS.forEach(function (f) {
      const name = L + ' ' + f;
      if (sent[name] && !headers.some(function (h) { return h.toUpperCase() === name; })) missing.push(name);
    });
  });
  DEBT_FLAG_COLUMNS.concat(debtEntryColumns_()).forEach(function (name) {
    if (sent[name] && !headers.some(function (h) { return h.toUpperCase() === name; })) missing.push(name);
  });
  if (missing.length) headers = addMissingColumns_(sheet, headers, missing);
  const idCol = idColumn_(headers);

  // Every debt must be answered: FALSE, or TRUE with an amount over $0
  const sentValue = function (name) {
    const k = Object.keys(submitted || {}).filter(function (x) { return String(x).trim().toUpperCase() === name; })[0];
    return k === undefined ? '' : String(submitted[k]).trim();
  };
  for (var d = 0; d < DEBT_FLAG_COLUMNS.length; d++) {
    const flag = sentValue(DEBT_FLAG_COLUMNS[d]).toUpperCase();
    if (flag !== 'TRUE' && flag !== 'FALSE') return 'invalid_debts';
    if (flag === 'TRUE' && !(Number(sentValue(DEBT_AMOUNT_COLUMNS[d]).replace(/[$,\s]/g, '')) > 0)) return 'invalid_debts';
    // Car loans: every payment needs its make and model
    if (flag === 'TRUE' && d === 0) {
      for (var n = 1; n <= DEBT_MAX[d]; n++) {
        if (!(Number(sentValue(debtCol_(DEBT_AMOUNT_COLUMNS[d], n)).replace(/[$,\s]/g, '')) > 0)) continue;
        if (!sentValue(debtCol_('CAR LOAN MAKE', n)) || !sentValue(debtCol_('CAR LOAN MODEL', n))) return 'invalid_debts';
      }
    }
  }

  // A credit score is required with every save
  const scoreKey = Object.keys(submitted || {}).filter(function (k) { return String(k).trim().toUpperCase() === 'CREDIT SCORE'; })[0];
  const score = scoreKey === undefined ? NaN : Number(String(submitted[scoreKey]).trim());
  if (!(Math.floor(score) === score && score >= 300 && score <= 850)) return 'invalid_credit_score';

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

// Whether an account is listed in one of the page's access columns
function isOnPage_(page, id) {
  return PAGE_ACCESS_COLUMNS.some(function (col) { return page[col] && phoneToId_(page[col]) === id; });
}

// Who may open a page: the accounts listed on it, and admins (always)
function canSeePage_(page, id, account) {
  return isAdmin_(account) || isOnPage_(page, id);
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
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
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
// Admins only: a new PAGES row copied from this page (formats included), with the next free PAGE ID,
// the given VERSION TITLE and today's VERSION DATE
function createVersion_(id, account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const title = cleanText_(body.title, 80);
  if (!title) return { ok: false, error: 'missing_title' };
  const found = findPage_(body.pageId);
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
  const sheet = found.sheet;
  const headers = addMissingColumns_(sheet, found.headers, ['VERSION TITLE', 'VERSION DATE']);
  const idCol = colFor_(headers, 'page id');
  const lastRow = sheet.getLastRow();
  const newId = nextPageId_(sheet, idCol);
  const width = Math.max(sheet.getLastColumn(), headers.length);
  // Add the row first: the sheet's grid may end right at the last page
  sheet.insertRowAfter(lastRow);
  const target = lastRow + 1;
  sheet.getRange(found.rowNumber, 1, 1, width).copyTo(sheet.getRange(target, 1, 1, width));
  sheet.getRange(target, idCol).setValue(newId);
  sheet.getRange(target, colFor_(headers, 'version title')).setValue(title);
  sheet.getRange(target, colFor_(headers, 'version date')).setValue(new Date());
  SpreadsheetApp.flush();
  return { ok: true, pageId: String(newId) };
}

// This account's latest bank balance (the newest Date in the balance sheet) and every one of its transactions.
// Column names are matched without regard to case ("Date", "DATE").
function cashFlow_(id, account) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const get = function (row, name) {
    const key = Object.keys(row).filter(function (k) { return k.toUpperCase() === name; })[0];
    return key === undefined ? '' : String(row[key]).trim();
  };
  const mine = function (row) { return phoneToId_(get(row, 'ACCOUNT ID')) === id; };
  const time = function (text) { const t = new Date(text).getTime(); return isNaN(t) ? -Infinity : t; };
  var balance = null;
  allRows_(CUM_BALANCE_SHEET_ID, CUM_BALANCE_SHEET_NAME).filter(mine).forEach(function (row) {
    const next = { date: get(row, 'DATE'), amount: get(row, 'BALANCE') };
    // The newest date wins; on the same date, the lower row (entered later) wins
    if (!balance || time(next.date) >= time(balance.date)) balance = next;
  });
  const transactions = cumTransactionRows_().rows.filter(function (t) { return t.accountId === id; }).map(function (t) {
    return { row: t.rowNumber, date: t.date, description: t.description, amount: t.amount, type: t.type };
  });
  return { ok: true, balance: balance, transactions: transactions };
}

// Every row of the transactions sheet with its sheet row number (blank rows skipped)
function cumTransactionRows_() {
  const sheet = getSheet_(CUM_TRANSACTIONS_SHEET_ID, CUM_TRANSACTIONS_SHEET_NAME);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim().toUpperCase(); });
  const col = { id: headers.indexOf('ACCOUNT ID'), date: headers.indexOf('DATE'), description: headers.indexOf('DESCRIPTION'), amount: headers.indexOf('AMOUNT'), type: headers.indexOf('TYPE') };
  if (col.id < 0 || col.date < 0 || col.description < 0 || col.amount < 0) throw new Error('Transactions sheet is missing a column');
  const rows = [];
  for (var r = 1; r < values.length; r++) {
    if (!values[r].some(function (v) { return String(v).trim() !== ''; })) continue;
    rows.push({
      rowNumber: r + 1,
      accountId: phoneToId_(values[r][col.id]),
      date: String(values[r][col.date]).trim(),
      description: String(values[r][col.description]).trim(),
      amount: String(values[r][col.amount]).trim(),
      type: col.type < 0 ? '' : String(values[r][col.type]).trim(),
    });
  }
  return { sheet: sheet, col: col, rows: rows };
}

// Edit (date, description, amount) or delete one of this account's transactions
function changeTransaction_(id, account, body, remove) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const data = cumTransactionRows_();
  const target = data.rows.filter(function (t) { return t.rowNumber === Number(body.row); })[0];
  if (!target || target.accountId !== id) return { ok: false, error: 'not_found' };
  // The row must still say what the person was looking at (otherwise the sheet changed underneath them)
  const original = body.original || {};
  if (String(original.date).trim() !== target.date || String(original.description).trim() !== target.description || String(original.amount).trim() !== target.amount) {
    return { ok: false, error: 'changed' };
  }
  if (remove) {
    data.sheet.deleteRow(target.rowNumber);
    return { ok: true };
  }
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const description = cleanText_(body.description, 100);
  if (!description) return { ok: false, error: 'invalid_description' };
  // A positive amount; Expense rows are saved negative, Income rows positive (anything else keeps the old sign)
  const size = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (!isFinite(size) || size <= 0 || size > 100000000) return { ok: false, error: 'invalid_amount' };
  const type = target.type.toLowerCase();
  const negative = type === 'expense' || (type !== 'income' && Number(target.amount.replace(/[$,\s]/g, '')) < 0);
  const amount = negative ? -size : size;
  data.sheet.getRange(target.rowNumber, data.col.date + 1).setValue(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  data.sheet.getRange(target.rowNumber, data.col.description + 1).setValue(description);
  data.sheet.getRange(target.rowNumber, data.col.amount + 1).setValue(Math.round(amount * 100) / 100);
  return { ok: true };
}

// A new Income or Expense row for this account, under the last filled row (Expense amounts are saved negative)
function addTransaction_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const kind = String(body.type || '').trim().toLowerCase();
  if (kind !== 'income' && kind !== 'expense') return { ok: false, error: 'invalid_type' };
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const description = cleanText_(body.description, 100);
  if (!description) return { ok: false, error: 'invalid_description' };
  const size = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (!isFinite(size) || size <= 0 || size > 100000000) return { ok: false, error: 'invalid_amount' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = cumTransactionRows_();
    const sheet = data.sheet;
    const col = data.col;
    if (col.type < 0) throw new Error('Transactions sheet is missing a TYPE column');
    const last = data.rows.length ? data.rows[data.rows.length - 1].rowNumber : 1;
    const row = last + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowAfter(sheet.getMaxRows());
    const width = sheet.getLastColumn();
    // Same look and dropdowns as the row above it
    if (last >= 2) {
      const above = sheet.getRange(last, 1, 1, width);
      const target = sheet.getRange(row, 1, 1, width);
      above.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      above.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
    // ACCOUNT ID written the way this account's other rows have it (falls back to the plain phone digits)
    const mineRow = data.rows.filter(function (t) { return t.accountId === id; })[0];
    const accountCell = mineRow ? sheet.getRange(mineRow.rowNumber, col.id + 1).getValue() : id;
    // TYPE spelled the way the sheet already spells it ("Income" / "Expense")
    const typeText = (data.rows.filter(function (t) { return t.type.toLowerCase() === kind; })[0] || {}).type
      || (kind === 'income' ? 'Income' : 'Expense');
    sheet.getRange(row, col.id + 1).setValue(accountCell);
    sheet.getRange(row, col.date + 1).setValue(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    sheet.getRange(row, col.description + 1).setValue(description);
    sheet.getRange(row, col.amount + 1).setValue(Math.round((kind === 'expense' ? -size : size) * 100) / 100);
    sheet.getRange(row, col.type + 1).setValue(typeText);
    return { ok: true, row: row };
  } finally {
    lock.releaseLock();
  }
}

// Today's bank balance for this account, added under the last row of the balance sheet.
// The date is the person's own "today" (YYYY-MM-DD), which must be within a day or two of the server's.
function updateBalance_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Math.abs(date.getTime() - Date.now()) > 2 * 86400000) return { ok: false, error: 'invalid_date' };
  const amount = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (String(body.amount).trim() === '' || !isFinite(amount) || Math.abs(amount) > 100000000) return { ok: false, error: 'invalid_amount' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(CUM_BALANCE_SHEET_ID, CUM_BALANCE_SHEET_NAME);
    const values = sheet.getDataRange().getDisplayValues();
    const headers = values[0].map(function (h) { return String(h).trim().toUpperCase(); });
    const col = { id: headers.indexOf('ACCOUNT ID'), date: headers.indexOf('DATE'), balance: headers.indexOf('BALANCE') };
    if (col.id < 0 || col.date < 0 || col.balance < 0) throw new Error('Balance sheet is missing a column');
    var last = 1;
    var accountCell = id;
    for (var r = 1; r < values.length; r++) {
      if (!values[r].some(function (v) { return String(v).trim() !== ''; })) continue;
      last = r + 1;
      // ACCOUNT ID written the way this account's other rows have it
      if (phoneToId_(values[r][col.id]) === id) accountCell = sheet.getRange(r + 1, col.id + 1).getValue();
    }
    const row = last + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowAfter(sheet.getMaxRows());
    if (last >= 2) {
      const width = sheet.getLastColumn();
      sheet.getRange(last, 1, 1, width).copyTo(sheet.getRange(row, 1, 1, width), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
    sheet.getRange(row, col.id + 1).setValue(accountCell);
    sheet.getRange(row, col.date + 1).setValue(date);
    sheet.getRange(row, col.balance + 1).setValue(Math.round(amount * 100) / 100);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// The WHOLESALE PROPERTIES sheet as map pins: only rows with PRODUCTION READY = TRUE and an address. Column names are
// matched without regard to case. The same property listed more than once shows once, with its newest DATE SENT and
// its lowest price (the newest row's other details, filled in from the older rows where it's blank).
// Positions come from Google's geocoder and are remembered in the script properties, so each address is only
// looked up once (new ones are looked up a batch at a time; the rest arrive on the next load).
function wholesaleProperties_(account) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperties();
  const learned = {};
  var lookups = 0;
  var geoError = '';
  const properties = wholesaleGroups_().map(function (listings) {
    const newest = listings[0];
    const pick = function (field) {
      for (var i = 0; i < listings.length; i++) if (listings[i][field]) return listings[i][field];
      return '';
    };
    const prices = listings.map(function (l) { return l.price; }).filter(function (p) { return p !== null; });
    const unit = newest.unit;
    const line1 = newest.street + (unit ? ' ' + (/^(#|unit|apt|ste|suite)/i.test(unit) ? unit : '#' + unit) : '');
    const place = [newest.city, [newest.state, newest.zip].filter(String).join(' ')].filter(String);
    const address = [line1].concat(place).join(', ');
    // The position is found from the street address (units share one spot)
    const geoAddress = [newest.street].concat(place).join(', ');
    const geoKey = 'GEO|' + geoAddress.toUpperCase().replace(/\s+/g, ' ');
    var spot = known[geoKey] || learned[geoKey];
    if (!spot && !geoError && lookups < 60) {
      // Paced, since the geocoder refuses bursts; after an error the rest wait for the next load
      if (lookups++) Utilities.sleep(120);
      try {
        const res = Maps.newGeocoder().geocode(geoAddress);
        const hit = res && res.status === 'OK' && res.results && res.results[0];
        if (hit) spot = JSON.stringify([hit.geometry.location.lat, hit.geometry.location.lng]);
        else if (res && res.status === 'ZERO_RESULTS') spot = 'none';
        else geoError = String(res && res.status);
      } catch (err) {
        geoError = String(err && err.message || err);
      }
      if (spot) learned[geoKey] = spot;
    }
    const position = spot && spot !== 'none' ? JSON.parse(spot) : null;
    return {
      row: newest.row,
      address: address,
      date: newest.date,
      price: prices.length ? Math.min.apply(null, prices) : null,
      bed: pick('bed'),
      bath: pick('bath'),
      sqft: pick('sqft'),
      type: pick('type'),
      // Whether any of its rows links a Google Drive folder of pictures (the folders themselves stay on the server)
      photos: wholesaleFolders_(listings).length > 0,
      lat: position ? position[0] : null,
      lng: position ? position[1] : null,
      located: !!spot,
    };
  });
  if (Object.keys(learned).length) props.setProperties(learned);
  const result = { ok: true, properties: properties };
  if (geoError && isAdmin_(account)) result.geoError = geoError;
  return result;
}

function canSeeWholesale_(account) {
  return isAdmin_(account) || hasRole_(account, 'FLIPPER BUYER');
}

// The ready rows of the WHOLESALE PROPERTIES sheet, one list per property (same street, unit, city, state and zip,
// however they're spelled), each list newest first (on the same date, the lower row is newer)
function wholesaleGroups_() {
  const sheet = SpreadsheetApp.openById(WHOLESALE_SHEET_ID).getSheets()[0];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim().toUpperCase().replace(/\s+/g, ' '); });
  const col = function (names) {
    for (var i = 0; i < names.length; i++) { const c = headers.indexOf(names[i]); if (c >= 0) return c; }
    return -1;
  };
  const c = {
    street: col(['STREET ADDRESS', 'STREET']), unit: col(['UNIT NUMBER', 'UNIT']), city: col(['CITY']), state: col(['STATE']),
    zip: col(['ZIP', 'ZIP CODE']), price: col(['PRICE']), markup: col(['MARKUP']),
    bed: col(['BED', 'BEDS', 'BEDROOMS']), bath: col(['BATH', 'BATHS', 'BATHROOMS']),
    sqft: col(['SQFT', 'SQ FT', 'SQUARE FEET']), type: col(['PROPERTY TYPE', 'TYPE']), date: col(['DATE SENT', 'DATE']),
    ready: col(['PRODUCTION READY']), pictures: col(['PICTURES LINK', 'PICTURES']),
  };
  if (c.street < 0) throw new Error('Wholesale sheet has no STREET ADDRESS column');
  if (c.ready < 0) throw new Error('Wholesale sheet has no PRODUCTION READY column');
  const text = function (row, i) { return i < 0 ? '' : String(row[i]).trim(); };
  const number = function (value) {
    const t = String(value || '').replace(/[$,\s]/g, '');
    const n = Number(t);
    return t !== '' && isFinite(n) ? n : null;
  };
  const time = function (value) {
    const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return new Date(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
    const t = new Date(value).getTime();
    return isNaN(t) ? -Infinity : t;
  };
  const groups = {};
  const order = [];
  for (var r = 1; r < values.length; r++) {
    const row = values[r];
    if (text(row, c.ready).toUpperCase() !== 'TRUE') continue;
    const street = text(row, c.street);
    if (!street) continue;
    const price = number(text(row, c.price));
    const markup = number(text(row, c.markup));
    const listing = {
      row: r + 1,
      street: street,
      unit: text(row, c.unit),
      city: text(row, c.city),
      state: text(row, c.state),
      zip: text(row, c.zip),
      date: text(row, c.date),
      when: time(text(row, c.date)),
      bed: text(row, c.bed),
      bath: text(row, c.bath),
      sqft: text(row, c.sqft),
      type: text(row, c.type),
      pictures: text(row, c.pictures),
      price: price === null ? null : price + (markup || 0),
    };
    const key = wholesaleKey_(listing);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(listing);
  }
  return order.map(function (key) {
    return groups[key].sort(function (a, b) { return (b.when - a.when) || (b.row - a.row); });
  });
}

// Matching key for one property: "123 North Main Street, Unit 4" and "123 N Main St #4" are the same place
function wholesaleKey_(l) {
  const WORDS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
    STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PLACE: 'PL', COURT: 'CT', BOULEVARD: 'BLVD',
    CIRCLE: 'CIR', TRAIL: 'TRL', PARKWAY: 'PKWY', TERRACE: 'TER', HIGHWAY: 'HWY', WAY: 'WAY', LOOP: 'LOOP' };
  const clean = function (s) {
    return String(s || '').toUpperCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(String)
      .map(function (w) { return WORDS[w] || w; }).join(' ');
  };
  const unit = clean(l.unit).replace(/^(UNIT|APT|APARTMENT|STE|SUITE|NO)\s+/, '');
  return [clean(l.street), unit, clean(l.city), clean(l.state), String(l.zip || '').replace(/\D/g, '').slice(0, 5)].join('|');
}

// The unique Google Drive folder IDs in a property's PICTURES LINK cells (other kinds of links are left alone)
function wholesaleFolders_(listings) {
  const ids = [];
  listings.forEach(function (l) {
    const m = String(l.pictures || '').match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/);
    if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
  });
  return ids;
}

// The property whose newest row is body.row, if it's still on the map
function wholesaleGroupFor_(row) {
  return wholesaleGroups_().filter(function (listings) { return listings[0].row === Number(row); })[0] || null;
}

// The pictures in a property's Drive folders: [{ id, name }], newest row's folder first, by name within a folder.
// Remembered for 6 hours so paging through them doesn't list the folders again.
function wholesalePhotoList_(listings) {
  const folders = wholesaleFolders_(listings);
  const cacheKey = 'PHOTOS|' + folders.join('|');
  const cache = CacheService.getScriptCache();
  const hit = folders.length && cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  const photos = [];
  const seen = {};
  folders.forEach(function (folderId) {
    var files;
    try { files = DriveApp.getFolderById(folderId).getFiles(); } catch (err) { return; } // not shared with us, or gone
    const inFolder = [];
    while (files.hasNext() && inFolder.length < 80) {
      const file = files.next();
      if (String(file.getMimeType()).indexOf('image/') !== 0 || seen[file.getId()]) continue;
      seen[file.getId()] = true;
      inFolder.push({ id: file.getId(), name: file.getName() });
    }
    inFolder.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    Array.prototype.push.apply(photos, inFolder);
  });
  if (folders.length) cache.put(cacheKey, JSON.stringify(photos), 21600);
  return photos;
}

// flip-portal.html: the list of a property's pictures
function wholesalePhotos_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  return { ok: true, photos: wholesalePhotoList_(listings).map(function (p) { return { id: p.id }; }) };
}

// flip-portal.html: one picture (only one from that property's own folders), as a web-sized image
function wholesalePhoto_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  const id = String(body.id || '');
  if (!wholesalePhotoList_(listings).some(function (p) { return p.id === id; })) return { ok: false, error: 'not_found' };
  return wholesaleImage_(id, 1280);
}

// flip-portal.html list: a small copy of a property's first picture ({ ok, none: true } when it has none)
function wholesaleCover_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  const photos = wholesaleFolders_(listings).length ? wholesalePhotoList_(listings) : [];
  if (!photos.length) return { ok: true, none: true };
  return wholesaleImage_(photos[0].id, 320);
}

// flip-portal.html list: covers for up to 8 properties at once ({ covers: { row: { none } or { type, data } or { error } } })
function wholesaleCovers_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 8).map(Number);
  const byRow = {};
  wholesaleGroups_().forEach(function (listings) { byRow[listings[0].row] = listings; });
  const covers = {};
  rows.forEach(function (row) {
    const listings = byRow[row];
    if (!listings) { covers[row] = { error: 'not_found' }; return; }
    try {
      const photos = wholesaleFolders_(listings).length ? wholesalePhotoList_(listings) : [];
      if (!photos.length) { covers[row] = { none: true }; return; }
      const image = wholesaleImage_(photos[0].id, 320);
      covers[row] = image.ok ? { type: image.type, data: image.data } : { error: image.error };
    } catch (err) {
      covers[row] = { error: 'failed' };
    }
  });
  return { ok: true, covers: covers };
}

// One Drive picture, resized to the given width by Google (the original only if that fails and it's small enough),
// as base64. Small results are remembered for 6 hours.
function wholesaleImage_(id, width) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'PHOTO|' + width + '|' + id;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var blob = null;
  try {
    const res = UrlFetchApp.fetch('https://drive.google.com/thumbnail?sz=w' + width + '&id=' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true,
    });
    if (res.getResponseCode() === 200 && /^image\//.test(String(res.getHeaders()['Content-Type'] || ''))) blob = res.getBlob();
  } catch (err) { /* fall back below */ }
  if (!blob) {
    const file = DriveApp.getFileById(id);
    blob = file.getSize() <= 3000000 ? file.getBlob() : file.getThumbnail();
  }
  if (!blob) return { ok: false, error: 'no_photo' };
  const result = { ok: true, type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
  const text = JSON.stringify(result);
  if (text.length < 95000) cache.put(cacheKey, text, 21600);
  return result;
}

// New PAGE ID: the highest number in the PAGE ID column plus 1 (raw values, so "4,269" or 4269.0 still count)
function nextPageId_(sheet, idCol) {
  const lastRow = sheet.getLastRow();
  var highest = 0;
  if (lastRow >= 2) {
    sheet.getRange(2, idCol, lastRow - 1, 1).getValues().forEach(function (r) {
      const n = Number(String(r[0]).replace(/,/g, '').trim());
      if (String(r[0]).trim() !== '' && isFinite(n)) highest = Math.max(highest, n);
    });
  }
  return Math.floor(highest) + 1;
}

const PROPERTY_TYPES = ['Single Family', 'Townhome', 'Condo', 'Manufactured'];
const CENSUS_DESIGNATIONS = ['Low', 'Moderate', 'Middle', 'Upper'];

// Admins only: a new Buyer Breakdown row for a buyer, from the home page's New Property form.
// The buyer goes in PRIMARY, then any other purchasers, then collaborators (six people at most).
// Everything the form doesn't ask for starts at a standard placeholder; every other column stays blank.
function createProperty_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const accounts = allRows_(SHEET_ID, SHEET_NAME);
  const byId = {};
  accounts.forEach(function (r) { const aid = phoneToId_(r['ACCOUNT ID']); if (aid) byId[aid] = r; });

  // People
  const clientId = phoneToId_(body.clientId);
  if (!byId[clientId] || !hasRole_(byId[clientId], 'BUYER')) return { ok: false, error: 'bad_client' };
  const people = [{ id: clientId, type: 'Purchaser' }];
  const add = function (list, type, mustBeBuyer) {
    (Array.isArray(list) ? list : []).forEach(function (v) {
      const pid = phoneToId_(v);
      if (!pid || !byId[pid] || (mustBeBuyer && !hasRole_(byId[pid], 'BUYER'))) return;
      if (people.some(function (p) { return p.id === pid; })) return;
      people.push({ id: pid, type: type });
    });
  };
  add(body.purchasers, 'Purchaser', true);
  add(body.collaborators, 'Collaborator', false);
  if (people.length > PAGE_PEOPLE_COLUMNS.length) return { ok: false, error: 'too_many_people' };

  // Answers
  const text = function (v, max) { return cleanText_(v, max || 120); };
  const whole = function (v) {
    const digits = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    return digits === '' ? '' : Number(digits);
  };
  const address = body.address || {};
  const street = text(address.street), city = text(address.city), state = text(address.state, 20), zip = text(address.zip, 10);
  if (!street || !city || !state || !zip) return { ok: false, error: 'missing_address' };
  const propertyType = PROPERTY_TYPES.filter(function (t) { return t === body.propertyType; })[0];
  if (!propertyType) return { ok: false, error: 'bad_property_type' };
  const price = whole(body.purchasePrice);
  if (!(price > 0)) return { ok: false, error: 'missing_price' };
  const product = allRows_(LOAN_SHEET_ID, LOAN_SHEET_NAME)[Number(body.loanProduct)];
  if (!product) return { ok: false, error: 'bad_loan_product' };
  const census = CENSUS_DESIGNATIONS.filter(function (c) { return c === body.census; })[0] || '';
  const pool = body.hasPool === true || String(body.hasPool).toUpperCase() === 'TRUE';
  const hoa = body.hoa || {};

  const today = new Date();
  const dayOnly = function (d, plus) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (plus || 0)); };

  const values = {
    'PAGE TYPE': 'Buyer Breakdown',
    'STREET ADDRESS': street, 'CITY': city, 'STATE': state, 'ZIP': zip,
    'PROPERTY TYPE': propertyType,
    'SQFT': whole(body.sqft),
    'YEAR BUILT': whole(body.yearBuilt),
    'YEARLY TAXES': whole(body.yearlyTaxes),
    'HAS POOL': pool, 'HOME INSPECTOR POOL': pool,
    'PURCHASE PRICE': price,
    'RETAIL LOAN PRODUCT ID': String(product['ACCOUNT ID'] || '').trim(),
    'RETAIL LOAN PRODUCT NAME': String(product['LOAN PRODUCT NAME'] || '').trim(),
    'HOA TRANSFER FEE': whole(hoa.transfer),
    'HOA CAP FEE': whole(hoa.cap),
    'HOA DISCLOSURE FEE': whole(hoa.disclosure),
    'HOA OTHER FEE': whole(hoa.other),
    'HOA PRIMARY MONTHLY DUES': whole(hoa.primary),
    'HOA MASTER MONTHLY DUES': whole(hoa.master),
    'CENSUS DESIGNATION': census,
    // Placeholders
    'SELLER CREDIT': 0,
    'ESCROW FEE RATE': 0.002,
    'OWNERS TITLE RATE': 0,
    'ALTA TITLE RATE': 0.004,
    'HOMEOWNERS INSURANCE RATE': 0.0035,
    'RETAIL LTV': 0.8,
    'WHO PAYS TRANSFER FEE': 'Buyer',
    'WHO PAYS CAP FEE': 'Buyer',
    'WHO PAYS DISCLOSURE FEE': 'Seller',
    'WHO PAYS OTHER FEE': 'Buyer',
    'OFFER ACCEPTANCE DATE': dayOnly(today, 1),
    'ESCROW DURATION': 30,
    'LENDER POINTS PURCHASED': 0,
    'BUYERS AGENT COMMISSION %': 0,
    'BUYERS AGENT COMMISSION $': 0,
    // 1% of the price, to the nearest $100
    'EARNEST MONEY DEPOSIT': Math.round(price * 0.01 / 100) * 100,
    'GIFT FUNDS': 0,
    'PREPAID MI APPLIED': true,
    'CASH PURCHASE': false,
    'HOME INSPECTOR': '22 Home Inspect',
    'HOME INSPECTOR SEWER': false,
    'HOME INSPECTOR TERMITE': true,
    'SEWER INSPECTOR': 'AZ Rooter',
    'SELLER PAID BUYER COMMISSION %': 0.03,
    'VERSION TITLE': 'Initial Version',
    'VERSION DATE': dayOnly(today, 0),
  };
  people.forEach(function (p, i) {
    values[PAGE_PEOPLE_COLUMNS[i]] = p.id;
    values[PAGE_ROLE_COLUMNS[i]] = p.type;
  });

  const sheet = getSheet_(PAGES_SHEET_ID, PAGES_SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  const idCol = colFor_(headers, 'page id');
  const newId = nextPageId_(sheet, idCol);
  values['PAGE ID'] = newId;
  const row = headers.map(function (h) {
    const key = Object.keys(values).filter(function (k) { return k.toUpperCase() === h.toUpperCase(); })[0];
    return key === undefined ? '' : values[key];
  });
  // Add the row first (the sheet's grid may end right at the last page); it takes the formatting of the row above
  const lastRow = sheet.getLastRow();
  sheet.insertRowAfter(lastRow);
  sheet.getRange(lastRow + 1, 1, 1, headers.length).setValues([row]);
  SpreadsheetApp.flush();
  return { ok: true, pageId: String(newId) };
}

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
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
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
  // Newest rows first
  const pagesOfType = function (type) {
    return allRows_(PAGES_SHEET_ID, PAGES_SHEET_NAME)
      .filter(function (p) {
        return String(p['PAGE ID'] || '').trim() && String(p['PAGE TYPE'] || '').trim().toLowerCase() === type;
      })
      .reverse();
  };
  const pages = pagesOfType('buyer breakdown');
  const summary = function (p) {
    return {
      id: String(p['PAGE ID']).trim(),
      street: String(p['STREET ADDRESS'] || '').trim(),
      city: String(p['CITY'] || '').trim(),
      state: String(p['STATE'] || '').trim(),
      zip: String(p['ZIP'] || '').trim(),
      versionDate: String(p['VERSION DATE'] || '').trim(),
    };
  };
  const result = { ok: true, pages: pages.filter(function (p) { return isOnPage_(p, id); }).map(summary) };
  // The Flips card: this account's "Flip" pages (the card itself is only shown to FLIPPER BUYER accounts)
  result.flipPages = pagesOfType('flip').filter(function (p) { return isOnPage_(p, id); }).map(summary);
  if (isAdmin_(account)) {
    // For the New Property form: everyone (collaborators can be anyone) and the loan products, by row
    result.accounts = accountChoices_().map(function (a) { return { id: a.id, name: a.name }; });
    result.loanProducts = allRows_(LOAN_SHEET_ID, LOAN_SHEET_NAME).map(function (p, i) {
      return { index: i, name: String(p['LOAN PRODUCT NAME'] || '').trim(), lender: String(p['LENDER NAME'] || '').trim() };
    });
    // Every account with a role, by name
    const withRole = function (role) {
      return allRows_(SHEET_ID, SHEET_NAME)
        .filter(function (r) { return hasRole_(r, role); })
        .map(function (r) {
          return {
            id: phoneToId_(r['ACCOUNT ID']),
            name: [r['FIRST NAME'], r['LAST NAME']].map(function (s) { return String(s || '').trim(); }).filter(String).join(' '),
          };
        })
        .filter(function (b) { return b.id; })
        .sort(function (a, b) { return (a.name || a.id).localeCompare(b.name || b.id); });
    };
    // Pages with who is on them
    const withPeople = function (p) {
      const page = summary(p);
      page.people = PAGE_ACCESS_COLUMNS.map(function (c) { return phoneToId_(p[c]); }).filter(String);
      return page;
    };
    result.buyers = withRole('BUYER');
    result.buyerPages = pages.map(withPeople);
    // "My Flippers": every FLIPPER BUYER account and every Flip page
    result.flippers = withRole('FLIPPER BUYER');
    result.flipperPages = pagesOfType('flip').map(withPeople);
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
  const own = versionData_(page);
  result.loanProducts = allRows_(LOAN_SHEET_ID, LOAN_SHEET_NAME);
  result.interestRate = allRows_(RATE_SHEET_ID, RATE_SHEET_NAME)[0] || null;
  result.creditScore = own.creditScore;
  result.clients = own.clients;
  result.inspectors = own.inspectors;
  // Every version of this address the viewer can see (this one included), for the version dropdown
  const key = addressKey_(page);
  result.versions = allRows_(PAGES_SHEET_ID, PAGES_SHEET_NAME)
    .filter(function (p) {
      return String(p['PAGE ID'] || '').trim()
        && String(p['PAGE TYPE'] || '').trim().toLowerCase() === 'buyer breakdown'
        && addressKey_(p) === key
        && (result.isAdmin || isOnPage_(p, result.viewerId));
    })
    .map(versionData_);
  // Admins get every inspector's price list, for the Settings dropdowns and to preview a new pick
  if (result.isAdmin) {
    result.inspectorRows = {
      home: firstTabRows_(HOME_INSPECTORS_SHEET_ID),
      sewer: firstTabRows_(SEWER_INSPECTORS_SHEET_ID),
      termite: firstTabRows_(TERMITE_INSPECTORS_SHEET_ID),
    };
  }
}

// What one version of a Buyer Breakdown page needs besides its own row
function versionData_(page) {
  // Credit score belongs to the page's buyer, not whoever is viewing (e.g. the lender)
  var creditScore = null;
  const buyerId = phoneToId_(page['PRIMARY ACCOUNT ID']);
  if (buyerId) {
    const income = allRows_(INCOME_SHEET_ID, INCOME_SHEET_NAME).filter(function (r) { return phoneToId_(r['ACCOUNT ID'] || r['ID']) === buyerId; })[0];
    if (income) creditScore = income['CREDIT SCORE'] || null;
  }
  return {
    page: page,
    creditScore: creditScore,
    clients: pageClients_(page),
    // The price-list row for each inspector chosen on the page (null when none is chosen or it isn't found)
    inspectors: {
      home: inspectorRow_(HOME_INSPECTORS_SHEET_ID, 'HOME INSPECTOR', page['HOME INSPECTOR']),
      sewer: inspectorRow_(SEWER_INSPECTORS_SHEET_ID, 'SEWER INSPECTOR', page['SEWER INSPECTOR']),
      termite: inspectorRow_(TERMITE_INSPECTORS_SHEET_ID, 'TERMITE INSPECTOR', page['TERMITE INSPECTOR']),
    },
  };
}

// Pages for the same home share a street, city and zip (case, spacing and punctuation ignored)
function addressKey_(page) {
  return ['STREET ADDRESS', 'CITY', 'ZIP'].map(function (c) {
    return String(page[c] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }).join('|');
}

// Every non-empty row of a sheet's first tab as { "Column Header": value, ... }
function firstTabRows_(sheetId) {
  const key = sheetId + '|first';
  if (!ROWS_CACHE_[key]) ROWS_CACHE_[key] = readFirstTab_(sheetId);
  return ROWS_CACHE_[key];
}
function readFirstTab_(sheetId) {
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
  return firstTabRows_(sheetId).filter(function (r) {
    const key = Object.keys(r).filter(function (h) { return h.toUpperCase() === nameColumn; })[0];
    return key && String(r[key]).trim().toLowerCase() === wanted;
  })[0] || null;
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
  const key = sheetId + '|' + sheetName;
  if (!ROWS_CACHE_[key]) ROWS_CACHE_[key] = readRows_(sheetId, sheetName);
  return ROWS_CACHE_[key];
}
function readRows_(sheetId, sheetName) {
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
  // Car make / model, card names and other debt names are short text
  if (/^(CAR LOAN MAKE|CAR LOAN MODEL|CREDIT CARD NAME|OTHER PAYMENT NAME)( \d+)?$/.test(header)) return cleanText_(raw, 100);
  // Yes/No answers are saved as TRUE / FALSE
  if (DEBT_FLAG_COLUMNS.indexOf(header) >= 0) {
    if (raw.toUpperCase() === 'TRUE') return true;
    if (raw.toUpperCase() === 'FALSE') return false;
    return null;
  }
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
