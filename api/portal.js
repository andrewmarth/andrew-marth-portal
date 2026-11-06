// Andrew Marth Client Portal - private data API (Cloud Run function).
//
// The data lives in Firestore (see firestore/LAYOUT.md). Rows come from lib/store.js as { COLUMN: text }.
import { rows, row as getRow, columns, update, add, remove, withLock } from './lib/store.js';
import { verifyPhone, folderFiles, driveImage, createDriveFile, geocode } from './lib/google.js';
import { db } from './lib/store.js';

// The only people who may view a page. The first six are clients (PRIMARY is the buyer); the last is the lender.
const PAGE_PEOPLE_COLUMNS = ['PRIMARY ACCOUNT ID', 'ALT ACCOUNT ID 1', 'ALT ACCOUNT ID 2', 'ALT ACCOUNT ID 3',
  'ALT ACCOUNT ID 4', 'ALT ACCOUNT ID 5'];
const PAGE_LENDER_COLUMN = 'LENDER ACCOUNT ID';
const PAGE_ACCESS_COLUMNS = PAGE_PEOPLE_COLUMNS.concat([PAGE_LENDER_COLUMN]);
// Whether each of those six people is a "Purchaser" or a "Collaborator" (blank counts as Purchaser)
const PAGE_ROLE_COLUMNS = ['PRIMARY ACCOUNT TYPE', 'ALT ACCOUNT TYPE 1', 'ALT ACCOUNT TYPE 2', 'ALT ACCOUNT TYPE 3',
  'ALT ACCOUNT TYPE 4', 'ALT ACCOUNT TYPE 5'];
// TRUE when the buyer is paying cash (no loan)
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
  // Seller Net pages: the seller's loan payoff and the listing agent's commission
  'ORIGINAL LOAN AMOUNT': 'money', 'ORIGINAL LOAN DATE': 'date', 'LOAN INTEREST RATE': 'rate', 'LOAN TERM MONTHS': 'int',
  'LOAN PRINCIPAL BALANCE': 'money', 'PRINCIPAL LOAN BALANCE DATE': 'date',
  'RECORDING FEE': 'money', 'PAYOFF STATEMENT FEE': 'money',
  'PREPAYMENT PENALTY %': 'rate', 'PREPAYMENT PENALTY $': 'money',
  'OTHER LOAN PAYOFF FEES %': 'rate', 'OTHER LOAN PAYOFF FEES $': 'money',
  'LISTING AGENT COMMISSION %': 'rate', 'LISTING AGENT COMMISSION $': 'money',
};

// Checks one submitted setting. Returns the value to write, or null if it isn't allowed. Blank is always allowed.
function cleanSetting_(kind, value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (raw === '') return '';
  if (Array.isArray(kind)) return kind.filter(k => k.toLowerCase() === raw.toLowerCase())[0] || null;
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
  if (kind === 'cents') return n <= 100000000 ? Math.round(n * 100) / 100 : null;
  return n <= 100000000 ? Math.round(n) : null;
}

// LOAN_PRODUCTS columns a lender fills in from the home page's My Loan Products card, in the form's order and sections.
// Kinds as for PAGE_SETTING_FIELDS (rate: a decimal like 0.03 for 3%), plus cents: dollars that may have cents.
// ACCOUNT ID is always the lender's own; any other column that isn't listed here is asked as text under "Other".
// The form (loan-products.js) lays these out with its own yes/no questions and fills in every column before saving.
const LOAN_PRODUCT_FIELDS = (function () {
  const dti = ['<600', '600-620', '620-640', '640-660', '660-680', '680-700', '700-720', '720-740', '740-760', '760-780', '780-800', '800+'];
  const sections = [
    ['Product', [['LOAN PRODUCT NAME', 'text'], ['LENDER NAME', 'text'], ['LOAN TERM', 'int']]],
    ['Loan Limits', [['MAX LTV', 'rate'], ['MIN LOAN AMOUNT', 'money'], ['MAX LOAN AMOUNT', 'money'], ['MAX SELLER CREDIT %', 'rate'],
      ['INCOME LIMIT', 'money'], ['SECOND LOAN LTV MAX', 'rate'], ['SILENT SECOND', 'bool']]],
    ['Property Types', [['ALLOW SINGLE FAMILY', 'bool'], ['ALLOW TOWNHOME', 'bool'], ['ALLOW CONDO', 'bool'], ['ALLOW MOBILE', 'bool'], ['ALLOW LAND', 'bool']]],
    ['Origination & Lender Credits', [['ORIGINATION FEE %', 'rate'], ['ORIGINATION FEE $', 'cents'],
      ['LENDER CREDIT % OF PURCHASE PRICE', 'rate'], ['LENDER CREDIT % OF LOAN AMOUNT', 'rate'], ['LENDER CREDIT FLAT $', 'cents'],
      ['ADDITIONAL LENDER CREDIT', 'cents']]],
    ['Lender Fees', [['APPRAISAL FEE AT CLOSING', 'cents'], ['APPRAISAL DEPOSIT', 'cents'], ['APPRASIAL MANAGEMENT FEE', 'cents'],
      ['CREDIT REPORT FEE', 'cents'], ['FLOOD CERT FEE', 'cents'], ['TAX CERT FEE', 'cents'], ['OTHER FEE', 'cents']]],
    ['Mortgage Insurance', [['PREPAID MORTGAGE INSURANCE RATE 0%-5% DOWN', 'rate'], ['PREPAID MORTGAGE INSURANCE RATE 5%-10% DOWN', 'rate'],
      ['PREPAID MORTGAGE INSURANCE RATE 10%-20% DOWN', 'rate'], ['PREPAID MORTGAGE INSURANCE RATE 20%+ DOWN', 'rate'],
      ['PMI LTV THRESHOLD', 'rate'], ['LOAN PRODUCT PMI RATE', 'rate']]],
    ['Rates', dti.map(s => ['PAR RATE CREDIT SCORE ' + s, 'rate']).concat([['POINT RATE BUYDOWN AMOUNT', 'rate']])],
    ['Max DTI', dti.map(s => ['MAX DTI CREDIT SCORE ' + s, 'rate'])],
    ['Max DTI Housing Only', dti.map(s => ['MAX DTI HOUSING ONLY CREDIT SCORE ' + s, 'rate'])],
    ['Income Qualifying', [['SALARY QUALIFYING %', 'rate'], ['HOURLY QUALIFYING %', 'rate'], ['1099 QUALIFYING %', 'rate'],
      ['TIP QUALIFYING %', 'rate'], ['COMMISSION QUALIFYING %', 'rate'], ['BONUS QUALIFYING %', 'rate']]],
    ['Escrow', [['MONTHS COLLECTED FOR TAXES', 'int'], ['MONTHS COLLECTED FOR INSURANCE', 'int']]],
    ['Census Credit', ['LOW', 'MODERATE', 'MIDDLE', 'UPPER'].reduce((list, d) =>
      list.concat([['CENSUS CREDIT ' + d, 'bool'], ['CENSUS CREDIT % ' + d, 'rate']]), [])],
  ];
  const out = [];
  sections.forEach(s => { s[1].forEach(f => { out.push({ section: s[0], col: f[0], kind: f[1] }); }); });
  return out;
})();

// Allowed values for the commission and bonus interval columns
const INTERVALS = ['Weekly', 'Monthly', 'Quarterly', 'Annually', 'Bi-Annually'];

// One request (body: the parsed JSON; query: the URL's parameters). Returns the reply object.
export async function handle(body, query) {
  try {
    // Documenso's webhook (a document has been completed); its URL carries the secret
    if (query && query.documensoWebhook) return await documensoWebhook_(String(query.documensoWebhook));
    // Website sign-up form: whether a phone number already has an account, asked before a code is texted (yes/no only)
    if (body.action === 'accountExists') {
      const checkId = phoneToId_(body.phone);
      if (checkId.length !== 10) return { ok: false, error: 'invalid_phone' };
      return { ok: true, exists: Boolean(await findAccount_(checkId)) };
    }
    const phone = await verifyPhone(body.idToken);
    if (!phone) return { ok: false, error: 'unauthorized' };

    const id = phoneToId_(phone);
    const found = await findAccount_(id);
    // signup.html: a new phone number adds its own row (before the "must have an account" check below)
    if (body.action === 'signup') return await signup_(id, found, body);
    if (!found) return { ok: false, error: 'not_found' };
    const account = found.row;

    // Settings page: save a new first and last name to this client's own row
    if (body.action === 'updateName') {
      const firstName = cleanText_(body.firstName, 50);
      const lastName = cleanText_(body.lastName, 50);
      if (!firstName || !lastName) return { ok: false, error: 'invalid_name' };
      await update('accounts', found.docId, { 'FIRST NAME': firstName, 'LAST NAME': lastName });
      return { ok: true, id, row: (await findAccount_(id)).row };
    }

    // Settings page: the name they go by (blank clears it, and the portal uses their first name)
    if (body.action === 'updatePreferredName') {
      const preferred = cleanText_(body.preferredName, 50);
      await update('accounts', found.docId, { 'PREFERRED NAME': preferred });
      return { ok: true, id, row: (await findAccount_(id)).row };
    }

    // Settings page: their email (must look like an email)
    if (body.action === 'updateEmail') {
      const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
      if (!/^[^\s@=+]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: 'invalid_email' };
      await update('accounts', found.docId, { 'EMAIL': email });
      return { ok: true, id, row: (await findAccount_(id)).row };
    }

    // Settings page (admins): every client's details, and saving one client's details
    if (body.action === 'adminClients') return await adminClients_(account);
    if (body.action === 'adminUpdateClient') return await adminUpdateClient_(account, body);
    if (body.action === 'adminCreateClient') return await adminCreateClient_(account, body);
    // E-signatures: admins send documents; clients see and sign their own
    if (body.action === 'adminSendForSignature') return await adminSendForSignature_(account, body);
    if (body.action === 'myTasks') return await myTasks_(id);
    if (body.action === 'completeTask') return await completeTask_(id, body);
    if (body.action === 'adminCreateTask') return await adminCreateTask_(account, body);
    if (body.action === 'adminOpenTasks') return await adminOpenTasks_(account);
    if (body.action === 'signingTask') return await signingTask_(id, body);
    if (body.action === 'fileSigned') return await fileSigned_(id, body);

    // pages.html: one PAGES row (its PAGE TYPE decides what the page shows) plus what that type needs
    if (body.action === 'page') return await pageData_(id, account, body.pageId);
    // Home page: the Buyer Breakdown pages this account is listed on (and, for admins, every buyer's)
    if (body.action === 'myPages') return await myPagesData_(id, account);
    if (body.action === 'saveLoanProduct') return await saveLoanProduct_(id, account, body);
    // cum.html: this account's cash flow (CUM accounts only)
    if (body.action === 'cashFlow') return await cashFlow_(id, account);
    if (body.action === 'updateTransaction') return await changeTransaction_(id, account, body, false);
    if (body.action === 'deleteTransaction') return await changeTransaction_(id, account, body, true);
    if (body.action === 'addTransaction') return await addTransaction_(id, account, body);
    if (body.action === 'markTransactionPaid') return await settleTransaction_(id, account, body, true);
    if (body.action === 'moveTransaction') return await settleTransaction_(id, account, body, false);
    if (body.action === 'updateBalance') return await updateBalance_(id, account, body);
    // flip-portal.html: wholesale properties with map positions (admins and FLIPPER BUYER accounts)
    if (body.action === 'wholesaleProperties') return await wholesaleProperties_(account);
    if (body.action === 'wholesalePhotos') return await wholesalePhotos_(account, body);
    if (body.action === 'wholesalePhoto') return await wholesalePhoto_(account, body);
    if (body.action === 'wholesaleCover') return await wholesaleCover_(account, body);
    if (body.action === 'wholesaleCovers') return await wholesaleCovers_(account, body);
    // Home page (admins): add a new property for a buyer
    if (body.action === 'createProperty') return await createProperty_(account, body);
    // pages.html (admins): copy the page into a new version
    if (body.action === 'createVersion') return await createVersion_(id, account, body);
    // pages.html (admins): change who can see the page
    if (body.action === 'updatePageAccess') return await updatePageAccess_(id, account, body);

    // Settings page: save this client's income and debt (adds their row if they don't have one yet)
    if (body.action === 'updateIncome') {
      const error = await saveIncome_(id, body.income || {});
      if (error) return { ok: false, error };
    }

    // Income is extra: if it can't be read, still return the account details
    let income = null;
    try {
      income = await findIncome_(id);
    } catch (incomeErr) {
      console.error(incomeErr);
    }
    return { ok: true, id, row: account, income };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'server_error' };
  }
}

// The account with this ID: { row, docId } or null (ACCOUNT ID is the document ID)
async function findAccount_(id) {
  if (!id) return null;
  const r = (await rows('accounts')).find(a => phoneToId_(a['ACCOUNT ID'] || a._id) === id);
  return r ? { row: r, docId: r._id } : null;
}

// This account's INCOME row, or null
async function findIncome_(id) {
  return (await rows('income')).find(r => phoneToId_(r['ACCOUNT ID'] || r['ID'] || r._id) === id) || null;
}

// Income levels and the columns each one has in INCOME ("PRIMARY JOB TITLE", "QUINARY BONUS AMOUNT"...)
const INCOME_LEVELS = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];
const INCOME_LEVEL_FIELDS = ['JOB TITLE', 'WEEKLY SALARY', 'HOURLY RATE', 'WEEKLY HOURS', 'WEEKLY TIPS', 'COMMISSION INTERVAL',
  'COMMISSION AMOUNT', 'BONUS INTERVAL', 'BONUS AMOUNT', '1099 YEARLY INCOME', '1099 INCOME DESCRIPTION'];
// Monthly debts and, beside each, its Yes/No answer (TRUE / FALSE)
const DEBT_AMOUNT_COLUMNS = ['CAR LOAN PAYMENT', 'MORTGAGE PAYMENT', 'CREDIT CARD PAYMENT', 'OTHER PAYMENT'];
const DEBT_FLAG_COLUMNS = ['HAS CAR LOAN', 'HAS MORTGAGE', 'HAS CREDIT CARDS', 'HAS OTHER PAYMENTS'];
// How many of each debt (same order), and the text columns beside each payment. Entry n adds " n" to each name.
const DEBT_MAX = [5, 5, 5, 10];
const DEBT_TEXT_COLUMNS = [['CAR LOAN MAKE', 'CAR LOAN MODEL'], [], ['CREDIT CARD NAME'], ['OTHER PAYMENT NAME']];
const debtCol_ = (base, n) => (n === 1 ? base : base + ' ' + n);
// Every debt payment and name column (type, then entry)
function debtEntryColumns_() {
  const out = [];
  DEBT_AMOUNT_COLUMNS.forEach((amount, d) => {
    for (let n = 1; n <= DEBT_MAX[d]; n++) {
      DEBT_TEXT_COLUMNS[d].forEach(t => { out.push(debtCol_(t, n)); });
      out.push(debtCol_(amount, n));
    }
  });
  return out;
}
// Every column the income form may save
function incomeColumns_() {
  const out = ['CREDIT SCORE'];
  INCOME_LEVELS.forEach(L => INCOME_LEVEL_FIELDS.forEach(f => out.push(L + ' ' + f)));
  return out.concat(DEBT_FLAG_COLUMNS, debtEntryColumns_());
}

// Writes the submitted income values to the client's income document. Returns an error code, or '' when saved.
async function saveIncome_(id, submitted) {
  const known = {};
  incomeColumns_().concat(await columns('income')).forEach(c => { known[c.toUpperCase()] = true; });
  delete known['ACCOUNT ID'];
  delete known['ID'];

  // Every debt must be answered: FALSE, or TRUE with an amount over $0
  const sentValue = name => {
    const k = Object.keys(submitted || {}).filter(x => String(x).trim().toUpperCase() === name)[0];
    return k === undefined ? '' : String(submitted[k]).trim();
  };
  for (let d = 0; d < DEBT_FLAG_COLUMNS.length; d++) {
    const flag = sentValue(DEBT_FLAG_COLUMNS[d]).toUpperCase();
    if (flag !== 'TRUE' && flag !== 'FALSE') return 'invalid_debts';
    if (flag === 'TRUE' && !(Number(sentValue(DEBT_AMOUNT_COLUMNS[d]).replace(/[$,\s]/g, '')) > 0)) return 'invalid_debts';
    // Car loans: every payment needs its make and model
    if (flag === 'TRUE' && d === 0) {
      for (let n = 1; n <= DEBT_MAX[d]; n++) {
        if (!(Number(sentValue(debtCol_(DEBT_AMOUNT_COLUMNS[d], n)).replace(/[$,\s]/g, '')) > 0)) continue;
        if (!sentValue(debtCol_('CAR LOAN MAKE', n)) || !sentValue(debtCol_('CAR LOAN MODEL', n))) return 'invalid_debts';
      }
    }
  }

  // A credit score is required with every save
  const scoreKey = Object.keys(submitted || {}).filter(k => String(k).trim().toUpperCase() === 'CREDIT SCORE')[0];
  const score = scoreKey === undefined ? NaN : Number(String(submitted[scoreKey]).trim());
  if (!(Math.floor(score) === score && score >= 300 && score <= 850)) return 'invalid_credit_score';

  // Clean every submitted value; only real income columns are accepted
  const updates = {};
  for (const key in submitted) {
    const header = String(key).trim().toUpperCase();
    if (!known[header]) return 'invalid_field';
    const value = cleanIncomeValue_(header, submitted[key]);
    if (value === null) return 'invalid_value';
    updates[header] = value;
  }

  const existing = await findIncome_(id);
  if (existing) await update('income', existing._id, updates);
  else await add('income', Object.assign({ 'ACCOUNT ID': id }, updates), id);
  return '';
}

// Finds a PAGES document by PAGE ID. Returns { row, docId } or null.
async function findPage_(pageId) {
  const wanted = String(pageId || '').trim().toUpperCase();
  if (!wanted) return null;
  const r = (await rows('pages')).find(p => String(p['PAGE ID']).trim().toUpperCase() === wanted);
  return r ? { row: r, docId: r._id } : null;
}

// Whether an account is listed in one of the page's access columns
function isOnPage_(page, id) {
  return PAGE_ACCESS_COLUMNS.some(col => page[col] && phoneToId_(page[col]) === id);
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

const fullName_ = r => [r['FIRST NAME'], r['LAST NAME']].map(s => String(s || '').trim()).filter(String).join(' ');

// Everyone in ACCOUNT LIST, for the admin's access pickers
async function accountChoices_() {
  return (await rows('accounts')).map(r => ({
    id: phoneToId_(r['ACCOUNT ID']),
    name: fullName_(r),
    isLender: hasRole_(r, 'LENDER'),
    bank: String(r['LENDER BANK'] || '').trim(),
  })).filter(a => a.id);
}

// Admins only: saves the purchasers (first one goes in PRIMARY), then the collaborators, into the six
// account columns with their type beside them, plus one lender (or none)
async function updatePageAccess_(id, account, body) {
  const found = await findPage_(body.pageId);
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
  if (!isAdmin_(account)) return { ok: false, error: 'not_allowed' };

  const known = {};
  (await accountChoices_()).forEach(a => { known[a.id] = a; });

  // Seller Net pages list Sellers instead of Purchasers, and have no cash / loan choice or lender
  const isSellerNet = String(found.row['PAGE TYPE'] || '').trim().toLowerCase() === 'seller net';
  // Real accounts only, nobody listed twice, at least one purchaser (or seller) and six people at most
  const people = [];
  const addAll = (list, type) => {
    (Array.isArray(list) ? list : []).forEach(p => {
      const pid = phoneToId_(p);
      if (pid && known[pid] && !people.some(x => x.id === pid)) people.push({ id: pid, type });
    });
  };
  addAll(body.purchasers, isSellerNet ? 'Seller' : 'Purchaser');
  addAll(body.collaborators, 'Collaborator');
  if (!people.some(p => p.type !== 'Collaborator')) return { ok: false, error: 'need_one_purchaser' };
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
    if (!Object.prototype.hasOwnProperty.call(PAGE_SETTING_FIELDS, column)) return { ok: false, error: 'invalid_field' };
    const value = cleanSetting_(PAGE_SETTING_FIELDS[column], submitted[key]);
    if (value === null) return { ok: false, error: 'invalid_value', field: column };
    fields[column] = value;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'HOA DISCLOSURE FEE')) fields['WHO PAYS DISCLOSURE FEE'] = 'Seller';

  if (!isSellerNet) fields[PAGE_CASH_COLUMN] = cash;
  PAGE_PEOPLE_COLUMNS.forEach((col, i) => {
    const person = people[i];
    fields[col] = person ? person.id : '';
    fields[PAGE_ROLE_COLUMNS[i]] = person ? person.type : '';
  });
  if (!isSellerNet) fields[PAGE_LENDER_COLUMN] = lender || '';
  await update('pages', found.docId, fields);
  return { ok: true, page: (await findPage_(body.pageId)).row };
}

// Admins only: a new PAGES document copied from this page, with the next free PAGE ID,
// the given VERSION TITLE and today's VERSION DATE
async function createVersion_(id, account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const title = cleanText_(body.title, 80);
  if (!title) return { ok: false, error: 'missing_title' };
  const found = await findPage_(body.pageId);
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
  const source = (await db.collection('pages').doc(found.docId).get()).data();
  const newId = await withLock('pages', async () => {
    const next = await nextPageId_();
    const copy = Object.assign({}, source);
    delete copy._order;
    const today = new Date();
    copy['PAGE ID'] = String(next);
    copy['VERSION TITLE'] = title;
    copy['VERSION DATE'] = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    await add('pages', copy, String(next));
    return next;
  });
  return { ok: true, pageId: String(newId) };
}

// This account's latest bank balance (the newest Date) and every one of its transactions.
// Column names are matched without regard to case ("Date", "DATE").
async function cashFlow_(id, account) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const get = (r, name) => {
    const key = Object.keys(r).filter(k => k.toUpperCase() === name)[0];
    return key === undefined ? '' : String(r[key]).trim();
  };
  const mine = r => phoneToId_(get(r, 'ACCOUNT ID')) === id;
  const time = text => { const t = new Date(text).getTime(); return isNaN(t) ? -Infinity : t; };
  let balance = null;
  (await rows('cumBalances')).filter(mine).forEach(r => {
    const next = { date: get(r, 'DATE'), amount: get(r, 'BALANCE') };
    // The newest date wins; on the same date, the later entry wins
    if (!balance || time(next.date) >= time(balance.date)) balance = next;
  });
  // Split invoices name the other person (preferred or first name from the ACCOUNT LIST)
  const names = {};
  // ...and the edit menu's "Split with" choices: everyone else with CUM = TRUE
  const splitPeople = [];
  (await rows('accounts')).forEach(r => {
    const rid = phoneToId_(r['ACCOUNT ID']);
    names[rid] = String(r['PREFERRED NAME'] || r['FIRST NAME'] || '').trim();
    if (rid.length === 10 && rid !== id && hasRole_(r, 'CUM')) splitPeople.push({ id: rid, name: fullName_(r) || rid });
  });
  splitPeople.sort((a, b) => a.name.localeCompare(b.name));
  const transactions = cumEntries_((await cumTransactionRows_()).rows, id).map(e => {
    if (e.part === 'split') e.note = 'Owed to ' + (names[e.ownerId] || 'the account holder');
    if (e.part === 'receive') e.note = 'From ' + (names[e.person] || 'split');
    delete e.ownerId;
    return e;
  });
  return { ok: true, balance, transactions, splitPeople };
}

const CUM_LINE_ITEMS = 20;

// Every transaction with its row number (its _order). Rows can carry up to 20 line
// items (RENT ITEM n ...): each has an amount (positive charges, negative credits), can be split with another account
// (SPLIT ID gets invoiced AMOUNT x SPLIT PERCENT) and can be paid on its own date instead of with the main charge.
// col holds each part's column name ('' when there's no such column).
async function cumTransactionRows_() {
  const all = await rows('cumTransactions');
  const headers = await columns('cumTransactions');
  const upper = headers.map(h => String(h).trim().toUpperCase().replace(/\s+/g, ' '));
  // "SEPERATE" and "SEPARATE" both work
  const find = name => {
    let i = upper.indexOf(name);
    if (i < 0) i = upper.indexOf(name.replace(/SEPERATE/g, 'SEPARATE'));
    return i >= 0 ? headers[i] : '';
  };
  const col = {
    id: find('ACCOUNT ID'), date: find('DATE'), description: find('DESCRIPTION'), amount: find('AMOUNT'), type: find('TYPE'),
    paid: find('PAID'), splitDate: find('SPLIT PERSON DATE'), splitPaid: find('SPLIT PERSON PAID'), receivePaid: find('RECEIVING PERSON PAID'),
    items: [],
  };
  if (!col.id || !col.date || !col.description || !col.amount) throw new Error('Transactions are missing a column');
  for (let n = 1; n <= CUM_LINE_ITEMS; n++) {
    const p = 'RENT ITEM ' + n + ' ';
    col.items.push({
      n, description: find(p + 'DESCRIPTION'), amount: find(p + 'AMOUNT'), splitId: find(p + 'SPLIT ID'), percent: find(p + 'SPLIT PERCENT'),
      separate: find(p + 'PAID SEPERATE'), separateDate: find(p + 'SEPERATE DATE'), separatePaid: find(p + 'SEPERATE PAID'),
    });
  }
  const out = all.filter(line => Object.keys(line).some(k => String(line[k]).trim() !== '')).map(line => {
    const text = c => (!c ? '' : String(line[c]).trim());
    const yes = c => text(c).toUpperCase() === 'TRUE';
    const items = [];
    col.items.forEach(c => {
      if (!c.amount || (text(c.amount) === '' && text(c.description) === '')) return;
      const pct = text(c.percent);
      items.push({
        n: c.n,
        description: text(c.description),
        amount: cumNumber_(text(c.amount)),
        splitId: phoneToId_(text(c.splitId)),
        percent: cumNumber_(pct) / (/%/.test(pct) ? 100 : 1),
        separate: yes(c.separate),
        separateDate: text(c.separateDate),
        separatePaid: yes(c.separatePaid),
      });
    });
    return {
      rowNumber: line._order,
      docId: line._id,
      accountId: phoneToId_(line[col.id]),
      date: text(col.date),
      description: text(col.description),
      amount: text(col.amount),
      type: text(col.type),
      paid: yes(col.paid),
      items,
      splitDate: text(col.splitDate),
      splitPaid: yes(col.splitPaid),
      receivePaid: yes(col.receivePaid),
    };
  });
  return { col, rows: out };
}

// "1,707", "$56.70" or "(25)" as a number (blank is 0)
function cumNumber_(text) {
  const t = String(text).trim();
  const n = Number(t.replace(/[$,%\s()]/g, ''));
  if (!isFinite(n)) return 0;
  return /^\(.*\)$/.test(t) ? -Math.abs(n) : n;
}
const cumRound_ = n => Math.round(n * 100) / 100;

// What one account sees from the transactions. Each entry is one row on its page, with a key that names the part
// of the transaction it comes from:
//   main     the transaction itself (its account; hidden once PAID). With line items, the charge is the sum of the
//            items that aren't paid separately, listed under it.
//   item     a line item paid separately, on its own SEPERATE DATE (its account; hidden once SEPERATE PAID)
//   split    what a SPLIT ID person owes: each of their items x its percent, on SPLIT PERSON DATE (hidden once
//            SPLIT PERSON PAID)
//   receive  the same split, coming in to the transaction's account (hidden once RECEIVING PERSON PAID)
function cumEntries_(list, id) {
  const out = [];
  list.forEach(t => {
    const mine = t.accountId === id;
    const entry = (part, extra) => {
      const e = { key: t.rowNumber + ':' + part, row: t.rowNumber, part, date: t.date, description: t.description, type: t.type, lines: [], itemized: t.items.length > 0 };
      Object.keys(extra).forEach(k => { e[k] = extra[k]; });
      return e;
    };
    if (mine && !t.paid) {
      if (!t.items.length) out.push(entry('main', { amount: t.amount }));
      else {
        const inline = t.items.filter(i => !i.separate);
        if (inline.length) {
          out.push(entry('main', {
            amount: String(cumRound_(-inline.reduce((s, i) => s + i.amount, 0))),
            lines: inline.map(i => ({ description: i.description || 'Item ' + i.n, amount: cumRound_(-i.amount) })),
            // Every line item as it's saved, for the edit menu (split percent as 0-100)
            items: t.items.map(i => ({ n: i.n, description: i.description, amount: i.amount, splitId: i.splitId, percent: i.splitId ? cumRound_(i.percent * 100) : '', separate: i.separate, separateDate: i.separateDate })),
          }));
        }
      }
    }
    if (mine) {
      t.items.forEach(i => {
        if (!i.separate || i.separatePaid) return;
        const e = entry('item', { item: i.n, date: i.separateDate || t.date, description: i.description || t.description, amount: String(cumRound_(-i.amount)), note: t.description });
        e.key += ':' + i.n;
        out.push(e);
      });
    }
    // Splits, one per person, from every line item that names them (paid separately or not)
    const people = {};
    t.items.forEach(i => {
      if (!i.splitId || i.splitId === t.accountId || !i.percent) return;
      (people[i.splitId] = people[i.splitId] || []).push(i);
    });
    Object.keys(people).forEach(person => {
      const items = people[person];
      const total = cumRound_(items.reduce((s, i) => s + i.amount * i.percent, 0));
      const lines = sign => items.map(i => ({ description: (i.description || 'Item ' + i.n) + ' (' + cumRound_(i.percent * 100) + '%)', amount: cumRound_(sign * i.amount * i.percent) }));
      if (mine && !t.receivePaid) {
        const e = entry('receive', { date: t.splitDate || t.date, amount: String(total), lines: lines(1), person });
        e.key += ':' + person;
        out.push(e);
      }
      if (person === id && !t.splitPaid) {
        out.push(entry('split', { date: t.splitDate || t.date, amount: String(-total), lines: lines(-1), ownerId: t.accountId }));
      }
    });
  });
  return out;
}

// The columns behind one entry: its date and its paid checkbox
function cumCells_(col, entry) {
  if (entry.part === 'main') return { date: col.date, paid: col.paid };
  if (entry.part === 'item') { const c = col.items[entry.item - 1]; return { date: c.separateDate, paid: c.separatePaid }; }
  return { date: col.splitDate, paid: entry.part === 'split' ? col.splitPaid : col.receivePaid };
}

// Catch up on one entry: it happened (its paid checkbox goes TRUE) or it moves to a new date (body.date, YYYY-MM-DD).
// The entry must still show the date and description the person was looking at.
async function settleTransaction_(id, account, body, paid) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  let date = null;
  if (!paid) {
    const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { ok: false, error: 'invalid_date' };
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return withLock('cumTransactions', async () => {
    const data = await cumTransactionRows_();
    const entry = cumEntries_(data.rows, id).filter(e => e.key === String(body.key))[0];
    if (!entry) return { ok: false, error: 'not_found' };
    const original = body.original || {};
    if (String(original.date).trim() !== entry.date || String(original.description).trim() !== entry.description) return { ok: false, error: 'changed' };
    const cells = cumCells_(data.col, entry);
    const c = paid ? cells.paid : cells.date;
    if (!c) throw new Error('Transactions are missing a ' + (paid ? 'paid' : 'date') + ' column');
    const target = data.rows.find(t => t.rowNumber === entry.row);
    await update('cumTransactions', target.docId, { [c]: paid ? true : date });
    return { ok: true };
  });
}

// Edit (date, description, amount) or delete one of this account's transactions
async function changeTransaction_(id, account, body, removeIt) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const data = await cumTransactionRows_();
  const target = data.rows.filter(t => t.rowNumber === Number(body.row))[0];
  if (!target || target.accountId !== id) return { ok: false, error: 'not_found' };
  // The transaction must still say what the person was looking at (otherwise it changed underneath them)
  // (One with line items has its total worked out from them, so only the date and description are checked and saved)
  const itemized = target.items.length > 0;
  const original = body.original || {};
  if (String(original.date).trim() !== target.date || String(original.description).trim() !== target.description || (!itemized && String(original.amount).trim() !== target.amount)) {
    return { ok: false, error: 'changed' };
  }
  if (removeIt) {
    await remove('cumTransactions', target.docId);
    return { ok: true };
  }
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const description = cleanText_(body.description, 100);
  if (!description) return { ok: false, error: 'invalid_description' };
  const fields = {};
  fields[data.col.date] = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  fields[data.col.description] = description;
  if (itemized) {
    // Line item changes: [{ n, description, amount (negative for a credit), splitId (10 digits or blank), percent (0-100) }]
    const list = Array.isArray(body.items) ? body.items : [];
    for (let k = 0; k < list.length; k++) {
      const it = list[k] || {};
      const c = data.col.items[Number(it.n) - 1];
      if (!c || !c.amount || !target.items.some(i => i.n === Number(it.n))) return { ok: false, error: 'not_found' };
      const itemDescription = cleanText_(it.description, 100);
      if (!itemDescription) return { ok: false, error: 'invalid_item_description' };
      const itemAmount = Number(String(it.amount).replace(/[$,\s]/g, ''));
      if (String(it.amount).trim() === '' || !isFinite(itemAmount) || Math.abs(itemAmount) > 100000000) return { ok: false, error: 'invalid_item_amount' };
      const splitId = String(it.splitId || '').trim() === '' ? '' : phoneToId_(it.splitId);
      if (splitId !== '' && splitId.length !== 10) return { ok: false, error: 'invalid_split_id' };
      const percent = Number(it.percent);
      if (splitId && (String(it.percent).trim() === '' || !isFinite(percent) || percent <= 0 || percent > 100)) return { ok: false, error: 'invalid_split_percent' };
      if (!c.splitId || !c.percent) return { ok: false, error: 'not_found' };
      // Paid separately needs its own date (YYYY-MM-DD)
      const separate = it.separate === true;
      let separateDate = '';
      if (separate) {
        const sd = String(it.separateDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!sd) return { ok: false, error: 'invalid_separate_date' };
        if (!c.separate || !c.separateDate) return { ok: false, error: 'not_found' };
        separateDate = new Date(Number(sd[1]), Number(sd[2]) - 1, Number(sd[3]));
      }
      if (c.description) fields[c.description] = itemDescription;
      fields[c.amount] = Math.round(itemAmount * 100) / 100;
      fields[c.splitId] = splitId;
      fields[c.percent] = splitId ? percent / 100 : '';
      if (c.separate) fields[c.separate] = separate;
      if (c.separateDate) fields[c.separateDate] = separateDate;
    }
    await update('cumTransactions', target.docId, fields);
    return { ok: true };
  }
  // A positive amount; Expense rows are saved negative, Income rows positive (anything else keeps the old sign)
  const size = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (!isFinite(size) || size <= 0 || size > 100000000) return { ok: false, error: 'invalid_amount' };
  const type = target.type.toLowerCase();
  const negative = type === 'expense' || (type !== 'income' && Number(target.amount.replace(/[$,\s]/g, '')) < 0);
  fields[data.col.amount] = Math.round((negative ? -size : size) * 100) / 100;
  await update('cumTransactions', target.docId, fields);
  return { ok: true };
}

// A new Income or Expense transaction for this account, after the others (Expense amounts are saved negative)
async function addTransaction_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const kind = String(body.type || '').trim().toLowerCase();
  if (kind !== 'income' && kind !== 'expense') return { ok: false, error: 'invalid_type' };
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const description = cleanText_(body.description, 100);
  if (!description) return { ok: false, error: 'invalid_description' };
  const size = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (!isFinite(size) || size <= 0 || size > 100000000) return { ok: false, error: 'invalid_amount' };
  return withLock('cumTransactions', async () => {
    const data = await cumTransactionRows_();
    const col = data.col;
    if (!col.type) throw new Error('Transactions are missing a TYPE column');
    // TYPE spelled the way it's already spelled ("Income" / "Expense")
    const typeText = (data.rows.filter(t => t.type.toLowerCase() === kind)[0] || {}).type || (kind === 'income' ? 'Income' : 'Expense');
    const fields = {};
    fields[col.id] = id;
    fields[col.date] = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    fields[col.description] = description;
    fields[col.amount] = Math.round((kind === 'expense' ? -size : size) * 100) / 100;
    fields[col.type] = typeText;
    const made = await add('cumTransactions', fields);
    return { ok: true, row: made.order };
  });
}

// Today's bank balance for this account, added after the others.
// The date is the person's own "today" (YYYY-MM-DD), which must be within a day or two of the server's.
async function updateBalance_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const m = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, error: 'invalid_date' };
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Math.abs(date.getTime() - Date.now()) > 2 * 86400000) return { ok: false, error: 'invalid_date' };
  const amount = Number(String(body.amount).replace(/[$,\s]/g, ''));
  if (String(body.amount).trim() === '' || !isFinite(amount) || Math.abs(amount) > 100000000) return { ok: false, error: 'invalid_amount' };
  const headers = await columns('cumBalances');
  const name = wanted => headers.find(h => h.toUpperCase() === wanted) || wanted;
  await add('cumBalances', { [name('ACCOUNT ID')]: id, [name('DATE')]: date, [name('BALANCE')]: Math.round(amount * 100) / 100 });
  return { ok: true };
}

// Remembered for a while by this copy of the API
const memo = new Map();
function memoGet(key) {
  const hit = memo.get(key);
  if (!hit || hit.until < Date.now()) { memo.delete(key); return null; }
  return hit.value;
}
function memoPut(key, value, seconds) {
  if (memo.size > 2000) memo.clear();
  memo.set(key, { value, until: Date.now() + seconds * 1000 });
}

// The WHOLESALE PROPERTIES deals as map pins: only ones with PRODUCTION READY = TRUE and an address. Column names are
// matched without regard to case. The same property listed more than once shows once, with its newest DATE SENT and
// its lowest price (the newest listing's other details, filled in from the older ones where it's blank).
// Positions come from Google's geocoder and are remembered in the geocodes collection, so each address is only
// looked up once (new ones are looked up a batch at a time; the rest arrive on the next load).
async function wholesaleProperties_(account) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const known = {};
  (await db.collection('geocodes').get()).docs.forEach(d => { known[d.data().key] = d.data().spot; });
  const learned = {};
  let lookups = 0;
  let geoError = '';
  const admin = isAdmin_(account);
  const properties = [];
  for (const listings of await wholesaleGroups_()) {
    const newest = listings[0];
    const pick = field => {
      for (let i = 0; i < listings.length; i++) if (listings[i][field]) return listings[i][field];
      return '';
    };
    const prices = listings.map(l => l.price).filter(p => p !== null);
    const unit = newest.unit;
    const line1 = newest.street + (unit ? ' ' + (/^(#|unit|apt|ste|suite)/i.test(unit) ? unit : '#' + unit) : '');
    const place = [newest.city, [newest.state, newest.zip].filter(String).join(' ')].filter(String);
    const address = [line1].concat(place).join(', ');
    // The position is found from the street address (units share one spot)
    const geoAddress = [newest.street].concat(place).join(', ');
    const geoKey = 'GEO|' + geoAddress.toUpperCase().replace(/\s+/g, ' ');
    let spot = known[geoKey] || learned[geoKey];
    if (!spot && !geoError && lookups < 60) {
      // Paced, since the geocoder refuses bursts; after an error the rest wait for the next load
      if (lookups++) await new Promise(r => setTimeout(r, 120));
      try {
        const res = await geocode(geoAddress);
        if (res.status === 'OK') spot = JSON.stringify([res.lat, res.lng]);
        else if (res.status === 'ZERO_RESULTS') spot = 'none';
        else geoError = String(res.status);
      } catch (err) {
        geoError = String((err && err.message) || err);
      }
      if (spot) learned[geoKey] = spot;
    }
    const position = spot && spot !== 'none' ? JSON.parse(spot) : null;
    const property = {
      row: newest.row,
      address,
      date: newest.date,
      price: prices.length ? Math.min.apply(null, prices) : null,
      bed: pick('bed'),
      bath: pick('bath'),
      sqft: pick('sqft'),
      type: pick('type'),
      // Whether any of its listings links a Google Drive folder of pictures (the folders themselves stay on the server)
      photos: wholesaleFolders_(listings).length > 0,
      lat: position ? position[0] : null,
      lng: position ? position[1] : null,
      located: !!spot,
    };
    // Admins only: every time the property was sent, newest first (the wholesaler's price, before markup)
    if (admin) property.sends = listings.map(l => ({ company: l.company, individual: l.individual, price: l.sentPrice, date: l.date }));
    properties.push(property);
  }
  if (Object.keys(learned).length) {
    const batch = db.batch();
    const { createHash } = await import('node:crypto');
    Object.keys(learned).forEach(key => {
      batch.set(db.collection('geocodes').doc(createHash('sha1').update(key).digest('hex')), { key, spot: learned[key] });
    });
    await batch.commit();
  }
  const result = { ok: true, properties };
  if (geoError && isAdmin_(account)) result.geoError = geoError;
  return result;
}

function canSeeWholesale_(account) {
  return isAdmin_(account) || hasRole_(account, 'FLIPPER BUYER');
}

// The ready deals, one list per property (same street, unit, city, state and zip, however they're spelled), each list
// newest first (on the same date, the one added later is newer). Each listing's row is its _order.
async function wholesaleGroups_() {
  const all = await rows('wholesaleDeals');
  const headers = await columns('wholesaleDeals');
  const upper = headers.map(h => String(h).trim().toUpperCase().replace(/\s+/g, ' '));
  const col = names => {
    for (let i = 0; i < names.length; i++) { const c = upper.indexOf(names[i]); if (c >= 0) return headers[c]; }
    return '';
  };
  const c = {
    street: col(['STREET ADDRESS', 'STREET']), unit: col(['UNIT NUMBER', 'UNIT']), city: col(['CITY']), state: col(['STATE']),
    zip: col(['ZIP', 'ZIP CODE']), price: col(['PRICE']), markup: col(['MARKUP']),
    bed: col(['BED', 'BEDS', 'BEDROOMS']), bath: col(['BATH', 'BATHS', 'BATHROOMS']),
    sqft: col(['SQFT', 'SQ FT', 'SQUARE FEET']), type: col(['PROPERTY TYPE', 'TYPE']), date: col(['DATE SENT', 'DATE']),
    ready: col(['PRODUCTION READY']), pictures: col(['PICTURES LINK', 'PICTURES']),
    company: col(['COMPANY']), individual: col(['INDIVIDUAL']),
  };
  if (!c.street) throw new Error('Wholesale deals have no STREET ADDRESS column');
  if (!c.ready) throw new Error('Wholesale deals have no PRODUCTION READY column');
  const text = (r, name) => (!name ? '' : String(r[name]).trim());
  const number = value => {
    const t = String(value || '').replace(/[$,\s]/g, '');
    const n = Number(t);
    return t !== '' && isFinite(n) ? n : null;
  };
  const time = value => {
    const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return new Date(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
    const t = new Date(value).getTime();
    return isNaN(t) ? -Infinity : t;
  };
  const groups = {};
  const order = [];
  all.forEach(r => {
    if (text(r, c.ready).toUpperCase() !== 'TRUE') return;
    const street = text(r, c.street);
    if (!street) return;
    const price = number(text(r, c.price));
    const markup = number(text(r, c.markup));
    const listing = {
      row: r._order,
      street,
      unit: text(r, c.unit),
      city: text(r, c.city),
      state: text(r, c.state),
      zip: text(r, c.zip),
      date: text(r, c.date),
      when: time(text(r, c.date)),
      bed: text(r, c.bed),
      bath: text(r, c.bath),
      sqft: text(r, c.sqft),
      type: text(r, c.type),
      pictures: text(r, c.pictures),
      company: text(r, c.company),
      individual: text(r, c.individual),
      sentPrice: price,
      price: price === null ? null : price + (markup || 0),
    };
    const key = wholesaleKey_(listing);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(listing);
  });
  return order.map(key => groups[key].sort((a, b) => (b.when - a.when) || (b.row - a.row)));
}

// Matching key for one property: "123 North Main Street, Unit 4" and "123 N Main St #4" are the same place
function wholesaleKey_(l) {
  const WORDS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
    STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PLACE: 'PL', COURT: 'CT', BOULEVARD: 'BLVD',
    CIRCLE: 'CIR', TRAIL: 'TRL', PARKWAY: 'PKWY', TERRACE: 'TER', HIGHWAY: 'HWY', WAY: 'WAY', LOOP: 'LOOP' };
  const clean = s => String(s || '').toUpperCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(String).map(w => WORDS[w] || w).join(' ');
  const unit = clean(l.unit).replace(/^(UNIT|APT|APARTMENT|STE|SUITE|NO)\s+/, '');
  return [clean(l.street), unit, clean(l.city), clean(l.state), String(l.zip || '').replace(/\D/g, '').slice(0, 5)].join('|');
}

// The unique Google Drive folder IDs in a property's PICTURES LINK cells (other kinds of links are left alone)
function wholesaleFolders_(listings) {
  const ids = [];
  listings.forEach(l => {
    const m = String(l.pictures || '').match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/);
    if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
  });
  return ids;
}

// The property whose newest listing is this row, if it's still on the map
async function wholesaleGroupFor_(row) {
  return (await wholesaleGroups_()).filter(listings => listings[0].row === Number(row))[0] || null;
}

// The pictures in a property's Drive folders: [{ id, name }], newest listing's folder first, by name within a folder.
// Remembered for 6 hours so paging through them doesn't list the folders again.
async function wholesalePhotoList_(listings) {
  const folders = wholesaleFolders_(listings);
  const cacheKey = 'PHOTOS|' + folders.join('|');
  const hit = folders.length && memoGet(cacheKey);
  if (hit) return hit;
  const photos = [];
  const seen = {};
  for (const folderId of folders) {
    const files = await folderFiles(folderId);
    if (!files) continue; // not shared with the Drive user, or gone
    const inFolder = [];
    for (const file of files) {
      if (inFolder.length >= 80) break;
      if (String(file.mimeType).indexOf('image/') !== 0 || seen[file.id]) continue;
      seen[file.id] = true;
      inFolder.push({ id: file.id, name: file.name });
    }
    inFolder.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    photos.push(...inFolder);
  }
  if (folders.length) memoPut(cacheKey, photos, 21600);
  return photos;
}

// flip-portal.html: the list of a property's pictures
async function wholesalePhotos_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = await wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  return { ok: true, photos: (await wholesalePhotoList_(listings)).map(p => ({ id: p.id })) };
}

// flip-portal.html: one picture (only one from that property's own folders), as a web-sized image
async function wholesalePhoto_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = await wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  const photoId = String(body.id || '');
  if (!(await wholesalePhotoList_(listings)).some(p => p.id === photoId)) return { ok: false, error: 'not_found' };
  return wholesaleImage_(photoId, 1280);
}

// flip-portal.html list: a small copy of a property's first picture ({ ok, none: true } when it has none)
async function wholesaleCover_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const listings = await wholesaleGroupFor_(body.row);
  if (!listings) return { ok: false, error: 'not_found' };
  const photos = wholesaleFolders_(listings).length ? await wholesalePhotoList_(listings) : [];
  if (!photos.length) return { ok: true, none: true };
  return wholesaleImage_(photos[0].id, 320);
}

// flip-portal.html list: covers for up to 8 properties at once ({ covers: { row: { none } or { type, data } or { error } } })
async function wholesaleCovers_(account, body) {
  if (!canSeeWholesale_(account)) return { ok: false, error: 'not_allowed' };
  const wanted = (Array.isArray(body.rows) ? body.rows : []).slice(0, 8).map(Number);
  const byRow = {};
  (await wholesaleGroups_()).forEach(listings => { byRow[listings[0].row] = listings; });
  const covers = {};
  await Promise.all(wanted.map(async r => {
    const listings = byRow[r];
    if (!listings) { covers[r] = { error: 'not_found' }; return; }
    try {
      const photos = wholesaleFolders_(listings).length ? await wholesalePhotoList_(listings) : [];
      if (!photos.length) { covers[r] = { none: true }; return; }
      const image = await wholesaleImage_(photos[0].id, 320);
      covers[r] = image.ok ? { type: image.type, data: image.data } : { error: image.error };
    } catch (err) {
      covers[r] = { error: 'failed' };
    }
  }));
  return { ok: true, covers };
}

// One Drive picture, resized to the given width by Google, as base64. Small results are remembered for 6 hours.
async function wholesaleImage_(photoId, width) {
  const cacheKey = 'PHOTO|' + width + '|' + photoId;
  const cached = memoGet(cacheKey);
  if (cached) return cached;
  const image = await driveImage(photoId, width);
  if (!image) return { ok: false, error: 'no_photo' };
  const result = { ok: true, type: image.type || 'image/jpeg', data: image.bytes.toString('base64') };
  if (result.data.length < 95000) memoPut(cacheKey, result, 21600);
  return result;
}

// A new ACCOUNT LIST document for the signed-in phone number. Role columns are TRUE/FALSE from the answers; ADMIN and CUM
// are always FALSE. Thinking of selling adds a "Seller Net" page for their home (price left blank).
const SIGNUP_GOALS = ['buy', 'sell', 'invest', 'other'];
const SIGNUP_ROLES = { mortgage: 'LENDER', hardmoney: 'HARD MONEY LENDER', wholesaler: 'WHOLESALER', other: '' };
async function signup_(id, found, body) {
  if (found) return { ok: false, error: 'exists' };
  const firstName = cleanText_(body.firstName, 50);
  const lastName = cleanText_(body.lastName, 50);
  if (!firstName || !lastName) return { ok: false, error: 'invalid_name' };
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  if (!/^[^\s@=+]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: 'invalid_email' };
  const goals = (Array.isArray(body.goals) ? body.goals : []).filter(g => SIGNUP_GOALS.indexOf(g) >= 0);
  if (!goals.length) return { ok: false, error: 'invalid_goals' };
  const has = g => goals.indexOf(g) >= 0;
  // Roles only count when "Other" was chosen (that's the only time the question is asked)
  const roles = has('other') ? (Array.isArray(body.roles) ? body.roles : []).filter(r => r in SIGNUP_ROLES) : [];
  if (has('other') && !roles.length) return { ok: false, error: 'invalid_roles' };
  let address = null;
  if (has('sell')) {
    const a = body.address || {};
    address = { street: cleanText_(a.street, 120), city: cleanText_(a.city, 80), state: cleanText_(a.state, 20), zip: cleanText_(a.zip, 10) };
    if (!address.street || !address.city || !address.state || !address.zip) return { ok: false, error: 'missing_address' };
  }

  const values = {
    'ACCOUNT ID': id,
    'FIRST NAME': firstName,
    'LAST NAME': lastName,
    'EMAIL': email,
    'BUYER': has('buy'),
    'SELLER': has('sell'),
    // Investors start as PREFLIPPER; the flipper and landlord roles stay off for now
    'PREFLIPPER': has('invest'),
    'FLIPPER BUYER': false,
    'FLIPPER SELLER': false,
    'LANDLORD': false,
    'LENDER': roles.indexOf('mortgage') >= 0,
    'HARD MONEY LENDER': roles.indexOf('hardmoney') >= 0,
    'WHOLESALER': roles.indexOf('wholesaler') >= 0,
    'ADMIN': false,
    'CUM': false,
  };

  // The document ID is the phone number, so a double tap can't add two accounts
  try {
    await add('accounts', values, id);
  } catch (err) {
    if (err.code === 6) return { ok: false, error: 'exists' }; // ALREADY_EXISTS
    throw err;
  }
  if (address) {
    const today = new Date();
    const page = {
      'PAGE TYPE': 'Seller Net',
      'STREET ADDRESS': address.street, 'CITY': address.city, 'STATE': address.state, 'ZIP': address.zip,
      'VERSION TITLE': 'Initial Version',
      'VERSION DATE': new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    };
    page[PAGE_PEOPLE_COLUMNS[0]] = id;
    page[PAGE_ROLE_COLUMNS[0]] = 'Seller';
    await withLock('pages', async () => {
      const next = await nextPageId_();
      page['PAGE ID'] = String(next);
      await add('pages', page, String(next));
    });
  }
  return { ok: true };
}

// The ACCOUNT LIST columns admins can edit on the Settings page (yes/no columns are TRUE/FALSE)
const CLIENT_FIELDS = [
  { col: 'FIRST NAME', type: 'text', required: true }, { col: 'LAST NAME', type: 'text', required: true },
  { col: 'PREFERRED NAME', type: 'text' }, { col: 'EMAIL', type: 'email' },
  { col: 'BUYER', type: 'bool' }, { col: 'SELLER', type: 'bool' }, { col: 'LANDLORD', type: 'bool' },
  { col: 'FLIPPER BUYER', type: 'bool' }, { col: 'FLIPPER SELLER', type: 'bool' },
  { col: 'LENDER', type: 'bool' }, { col: 'LENDER BANK', type: 'text' }, { col: 'WHOLESALER', type: 'bool' },
  { col: 'FLIPPER LLC', type: 'text' }, { col: 'FLIPPER TITLE', type: 'text' },
  { col: 'HARD MONEY LENDER', type: 'bool' }, { col: 'PREFLIPPER', type: 'bool' },
];

// One account's editable details, by column name
function clientValues_(r) {
  const get = name => {
    const key = Object.keys(r).filter(k => k.trim().toUpperCase() === name)[0];
    return key === undefined ? '' : String(r[key]).trim();
  };
  const values = {};
  CLIENT_FIELDS.forEach(f => { values[f.col] = f.type === 'bool' ? get(f.col).toUpperCase() === 'TRUE' : get(f.col); });
  return values;
}

async function adminClients_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const clients = (await rows('accounts'))
    .map(r => {
      const values = clientValues_(r);
      return { id: phoneToId_(r['ACCOUNT ID']), name: [values['FIRST NAME'], values['LAST NAME']].filter(String).join(' '), values };
    })
    .filter(c => c.id)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  return { ok: true, clients };
}

// Saves the given fields for one account (only the CLIENT_FIELDS columns; anything else is ignored)
async function adminUpdateClient_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const clientId = phoneToId_(body.clientId);
  const found = clientId && await findAccount_(clientId);
  if (!found) return { ok: false, error: 'not_found' };
  const given = body.values || {};
  const next = {};
  for (let i = 0; i < CLIENT_FIELDS.length; i++) {
    const f = CLIENT_FIELDS[i];
    if (!(f.col in given)) continue;
    const raw = given[f.col];
    if (f.type === 'bool') {
      next[f.col] = raw === true || String(raw).toUpperCase() === 'TRUE';
    } else if (f.type === 'email') {
      const email = String(raw || '').trim().toLowerCase().slice(0, 120);
      if (email && !/^[^\s@=+]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: 'invalid_email' };
      next[f.col] = email;
    } else {
      const text = cleanText_(raw, 100);
      if (f.required && !text) return { ok: false, error: 'missing_' + f.col.toLowerCase().replace(/ /g, '_') };
      next[f.col] = text;
    }
  }
  if (Object.keys(next).length) await update('accounts', found.docId, next);
  return { ok: true, client: { id: clientId, values: clientValues_((await findAccount_(clientId)).row) } };
}

// Admins: a new ACCOUNT LIST document from the Settings page's New Client form. Every shown answer is required except
// email; Lender Bank only when Lender is yes, Flipper LLC / Title only for flipper buyers or sellers.
// ADMIN and CUM are always FALSE.
async function adminCreateClient_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const id = phoneToId_(body.phone);
  if (!/^\d{10}$/.test(id)) return { ok: false, error: 'invalid_phone' };
  const given = body.values || {};
  const values = {};
  for (let i = 0; i < CLIENT_FIELDS.length; i++) {
    const f = CLIENT_FIELDS[i];
    const raw = given[f.col];
    if (f.type === 'bool') {
      if (raw !== true && raw !== false) return { ok: false, error: 'missing_' + f.col.toLowerCase().replace(/ /g, '_') };
      values[f.col] = raw;
    } else if (f.type === 'email') {
      const email = String(raw || '').trim().toLowerCase().slice(0, 120);
      if (email && !/^[^\s@=+]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: 'invalid_email' };
      values[f.col] = email;
    } else {
      values[f.col] = cleanText_(raw, 100);
    }
  }
  // Text answers that are only asked sometimes
  const asked = {
    'LENDER BANK': values['LENDER'],
    'FLIPPER LLC': values['FLIPPER BUYER'] || values['FLIPPER SELLER'],
    'FLIPPER TITLE': values['FLIPPER BUYER'] || values['FLIPPER SELLER'],
  };
  // Last and preferred names can wait (the home page's quick add asks only for a first name)
  const textCols = ['FIRST NAME', 'LENDER BANK', 'FLIPPER LLC', 'FLIPPER TITLE'];
  for (let j = 0; j < textCols.length; j++) {
    const c = textCols[j];
    if (c in asked && !asked[c]) { values[c] = ''; continue; }
    if (!values[c]) return { ok: false, error: 'missing_' + c.toLowerCase().replace(/ /g, '_') };
  }
  values['ACCOUNT ID'] = id;
  values['ADMIN'] = false;
  values['CUM'] = false;

  try {
    await add('accounts', values, id);
  } catch (err) {
    if (err.code === 6) return { ok: false, error: 'exists' }; // ALREADY_EXISTS
    throw err;
  }
  const saved = clientValues_((await findAccount_(id)).row);
  return { ok: true, client: { id, name: [saved['FIRST NAME'], saved['LAST NAME']].filter(String).join(' '), values: saved } };
}

// --- E-signatures (Documenso at sign.andrewmarth.com) ---
// The API key is DOCUMENSO_API_TOKEN (from Secret Manager). Documents are sent with Documenso's emails off: each signer
// gets a Signature task (see addTasks_) and signs inside the portal. Each signer of each document is one document in
// the signatures collection. Once everyone has signed, each signed PDF and the certificate are saved to the
// SIGNED_FOLDER_ID Drive folder and each PDF gets a document in the documents collection (its CATEGORY says which log).
// That happens the moment the last signer finishes: Documenso's DOCUMENT_COMPLETED webhook calls this API.
const DOCUMENSO_URL = 'https://sign.andrewmarth.com';
const SIGNED_FOLDER_ID = '1KdVqHpueNlMt2lOjl-tNLc2UvpwOsctw';
const SIGNATURE_FIELD_TYPES = ['SIGNATURE', 'INITIALS', 'NAME', 'DATE', 'TEXT'];
// Every Documenso email switched off (distribution NONE covers the signers; these cover the owner)
const DOCUMENSO_NO_EMAIL = {
  recipientSigningRequest: false, recipientRemoved: false, recipientSigned: false, documentPending: false,
  documentCompleted: false, documentDeleted: false, ownerDocumentCompleted: false, ownerRecipientExpired: false,
  ownerDocumentCreated: false,
};

// One call to Documenso's API. body: an object (sent as JSON) or, with isForm, a { name: string | Blob | [Blob, ...] }
// form for uploads. asFile: return the response's bytes (downloads) instead of parsed JSON.
async function documenso_(method, path, body, isForm, asFile) {
  const token = process.env.DOCUMENSO_API_TOKEN;
  if (!token) throw new Error('DOCUMENSO_API_TOKEN is not set');
  const options = { method: method.toUpperCase(), headers: { Authorization: token } };
  if (body !== undefined) {
    if (isForm) {
      const form = new FormData();
      Object.keys(body).forEach(name => {
        [].concat(body[name]).forEach(value => {
          if (typeof value === 'string') form.append(name, value);
          else form.append(name, value.blob, value.name);
        });
      });
      options.body = form;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }
  const res = await fetch(DOCUMENSO_URL + '/api/v2' + path, options);
  if (!res.ok) throw new Error('Documenso ' + method + ' ' + path + ' failed (' + res.status + '): ' + (await res.text()).slice(0, 300));
  if (asFile) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// The categories a document can be sent under. Property documents carry a property address; General ones don't.
const SIGNATURE_CATEGORIES = ['Property', 'General'];

// Every signer, as { COLUMN: text } with docId (column names upper-cased)
async function signatureRows_() {
  return (await rows('signatures')).map(r => {
    const out = { docId: r._id };
    Object.keys(r).forEach(k => { out[k.trim().toUpperCase()] = String(r[k]).trim(); });
    return out;
  });
}

// Admins: send PDFs for signature, all in one envelope. body: { title, category, street, city, state, zip (Property only),
//   pdfs: [{ name, data (base64) }], signers: [{ accountId, fields: [{ type, doc, page, x, y, w, h }] }] }
// doc is the field's PDF (its place in pdfs); positions are percentages of the page (x/y from the top-left corner).
const MAX_SIGNATURE_PDFS = 5;
async function adminSendForSignature_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const title = cleanText_(body.title, 200);
  if (!title) return { ok: false, error: 'missing_title' };
  const category = SIGNATURE_CATEGORIES.filter(c => c === String(body.category || ''))[0];
  if (!category) return { ok: false, error: 'bad_category' };
  let address = { street: '', city: '', state: '', zip: '' };
  if (category === 'Property') {
    address = { street: cleanText_(body.street, 200), city: cleanText_(body.city, 100), state: cleanText_(body.state, 30), zip: cleanText_(body.zip, 10) };
    if (!address.street || !address.city || !address.state || !/^\d{5}$/.test(address.zip)) return { ok: false, error: 'bad_address' };
  }
  const pdfList = Array.isArray(body.pdfs) ? body.pdfs : [];
  if (!pdfList.length || pdfList.some(p => !p || !String(p.data || ''))) return { ok: false, error: 'missing_pdf' };
  if (pdfList.length > MAX_SIGNATURE_PDFS) return { ok: false, error: 'too_many_pdfs' };
  let totalBytes = 0;
  const files = pdfList.map((p, i) => {
    const bytes = Buffer.from(String(p.data), 'base64');
    totalBytes += bytes.length;
    const name = (cleanText_(p.name, 150) || title).replace(/[^\w .()&,-]+/g, '').trim() || 'Document ' + (i + 1);
    return { name: name + '.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) };
  });
  if (totalBytes > 25 * 1024 * 1024) return { ok: false, error: 'pdf_too_large' };
  const signers = Array.isArray(body.signers) ? body.signers : [];
  if (!signers.length || signers.length > 10) return { ok: false, error: 'bad_signers' };

  const byId = {};
  (await rows('accounts')).forEach(r => { const aid = phoneToId_(r['ACCOUNT ID']); if (aid) byId[aid] = r; });
  const num = (v, min, max) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
  const recipients = [];
  const seen = {};
  for (let i = 0; i < signers.length; i++) {
    const accountId = phoneToId_(signers[i].accountId);
    const r = byId[accountId];
    if (!r || seen[accountId]) return { ok: false, error: 'bad_signers' };
    seen[accountId] = true;
    const name = fullName_(r) || accountId;
    // Signing happens only in the portal, so Documenso never gets a client's real email: every signer has an address
    // on clients.andrewmarth.com, which doesn't exist and can't receive mail (Documenso's emails are switched off too)
    const email = accountId + '@clients.andrewmarth.com';
    const fields = (Array.isArray(signers[i].fields) ? signers[i].fields : []).map(f => {
      const type = String(f.type || '').toUpperCase();
      if (SIGNATURE_FIELD_TYPES.indexOf(type) < 0) return null;
      const doc = Math.round(Number(f.doc || 0));
      const page = Math.round(Number(f.page));
      const x = num(f.x, 0, 100), y = num(f.y, 0, 100), w = num(f.w, 1, 100), h = num(f.h, 1, 100);
      if (!(doc >= 0 && doc < files.length) || !(page >= 1) || x === null || y === null || w === null || h === null) return null;
      return { type, identifier: doc, page, positionX: x, positionY: y, width: w, height: h };
    });
    if (!fields.length || fields.some(f => !f)) return { ok: false, error: 'bad_fields' };
    if (!fields.some(f => f.type === 'SIGNATURE' || f.type === 'INITIALS')) return { ok: false, error: 'needs_signature' };
    recipients.push({ accountId, name, email, fields });
  }

  const meta = {
    distributionMethod: 'NONE',
    emailSettings: DOCUMENSO_NO_EMAIL,
    timezone: 'America/Phoenix',
    dateFormat: 'MM/dd/yyyy', // Date fields show just the date signed (Documenso's default adds the time)
    typedSignatureEnabled: true, drawSignatureEnabled: true, uploadSignatureEnabled: false,
  };
  const created = await documenso_('post', '/envelope/create', {
    payload: JSON.stringify({
      type: 'DOCUMENT',
      title,
      recipients: recipients.map(r => ({ name: r.name, email: r.email, role: 'SIGNER', fields: r.fields })),
      meta,
    }),
    files,
  }, true);
  const sent = await documenso_('post', '/envelope/distribute', { envelopeId: created.id, meta: { distributionMethod: 'NONE', emailSettings: DOCUMENSO_NO_EMAIL } });

  const sentBy = fullName_(account);
  const now = new Date();
  for (const r of recipients) {
    const rec = (sent.recipients || []).filter(x => String(x.email).toLowerCase() === r.email)[0] || {};
    await add('signatures', {
      'ENVELOPE ID': created.id, 'TITLE': title, 'SENT DATE': now, 'SENT BY': sentBy, 'ACCOUNT ID': r.accountId,
      'NAME': r.name, 'EMAIL': r.email, 'RECIPIENT ID': rec.id || '', 'RECIPIENT TOKEN': rec.token || '',
      'SIGNING STATUS': 'NOT_SIGNED', 'DOCUMENT STATUS': 'PENDING', 'CATEGORY': category,
      'STREET ADDRESS': address.street, 'CITY': address.city, 'STATE': address.state, 'ZIP': address.zip,
    });
  }
  await addTasks_(recipients.map(r => ({
    'ASSIGNED': r.accountId, 'SECTION': 'Signature', 'TYPE': 'Signature', 'TITLE': 'Signature Request',
    'DESCRIPTION': 'You have been requested to sign ' + title, 'LINK': SIGN_PAGE_URL + encodeURIComponent(created.id),
  })));
  return { ok: true, envelopeId: created.id };
}

const dayOf_ = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Brings one envelope's signers up to date with Documenso (who has signed, and whether it's finished).
// skipFiling: leave a finished document for Documenso's webhook to file (so the signing page isn't kept waiting).
async function refreshEnvelope_(data, envelopeId, skipFiling) {
  const env = await documenso_('get', '/envelope/' + encodeURIComponent(envelopeId));
  const byToken = {};
  (env.recipients || []).forEach(r => { byToken[r.token] = r; });
  for (const r of data.filter(x => x['ENVELOPE ID'] === envelopeId)) {
    const rec = byToken[r['RECIPIENT TOKEN']];
    const changes = {};
    const set = (col, value, shown) => {
      if (String(r[col] || '') !== String(shown === undefined ? value : shown)) { changes[col] = value; r[col] = String(shown === undefined ? value : shown); }
    };
    if (rec) {
      set('SIGNING STATUS', rec.signingStatus || r['SIGNING STATUS']);
      if (rec.signedAt && !r['SIGNED DATE']) { const d = dayOf_(new Date(rec.signedAt)); set('SIGNED DATE', d, (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear()); }
    }
    set('DOCUMENT STATUS', env.status || r['DOCUMENT STATUS']);
    if (Object.keys(changes).length) await update('signatures', r.docId, changes);
  }
  // Signers who are done (or whose document is no longer waiting) lose their Signature task
  const done = data.filter(r => r['ENVELOPE ID'] === envelopeId && (r['SIGNING STATUS'] === 'SIGNED' || r['SIGNING STATUS'] === 'REJECTED'
    || (r['DOCUMENT STATUS'] !== 'PENDING' && r['DOCUMENT STATUS'] !== ''))).map(r => r['ACCOUNT ID']);
  if (done.length) await completeSignatureTasks_(envelopeId, done);
  const unlogged = data.some(r => r['ENVELOPE ID'] === envelopeId && !r['LOGGED']);
  if (env.status === 'COMPLETED' && unlogged && !skipFiling) await logSignedEnvelope_(env);
  return env;
}

// A finished document: its signed PDFs and certificate go to the Drive folder, and it gets a documents entry.
// Claimed first (a filingClaims document only one request can create): Documenso gives up on a webhook call after
// ~12 seconds and retries while the first one is still filing.
async function logSignedEnvelope_(env) {
  const fresh = await signatureRows_();
  const signers = fresh.filter(r => r['ENVELOPE ID'] === env.id);
  if (!signers.length || signers.some(r => r['LOGGED'])) return;
  const claim = db.collection('filingClaims').doc(env.id);
  try {
    await claim.create({ at: Date.now() });
  } catch (err) {
    if (err.code === 6) return; // ALREADY_EXISTS: another request is filing it (or did)
    throw err;
  }
  try {
    await fileSignedEnvelope_(env, signers);
  } catch (err) {
    await claim.delete();
    throw err;
  }
}

// Saves each signed PDF and the certificate to Drive, adds a documents entry per PDF and marks the signers LOGGED
async function fileSignedEnvelope_(env, signers) {
  const first = signers[0];
  const title = first['TITLE'] || env.title || 'Document';
  const items = (env.envelopeItems || []).slice().sort((a, b) => a.order - b.order);
  const docFiles = [];
  for (const item of items) {
    const pdf = await documenso_('get', '/envelope/item/' + encodeURIComponent(item.id) + '/download?version=signed', undefined, false, true);
    const name = items.length > 1 ? title + ' - ' + String(item.title || '').replace(/\.pdf$/i, '') : title;
    docFiles.push(await createDriveFile(SIGNED_FOLDER_ID, name + ' - Signed.pdf', 'application/pdf', pdf));
  }
  let certFile = null;
  try {
    const cert = await documenso_('get', '/envelope/' + encodeURIComponent(env.id) + '/certificate/download', undefined, false, true);
    certFile = await createDriveFile(SIGNED_FOLDER_ID, title + ' - Certificate.pdf', 'application/pdf', cert);
  } catch (err) { console.error(err); }
  // Where each signer signed from, in signer order
  const ipByEmail = {};
  try {
    ((await documenso_('get', '/envelope/' + encodeURIComponent(env.id) + '/audit-log?perPage=100')).data || []).forEach(e => {
      if (e.type === 'DOCUMENT_RECIPIENT_COMPLETED' && e.email && e.ipAddress) ipByEmail[String(e.email).toLowerCase()] = e.ipAddress;
    });
  } catch (err) { console.error(err); }
  const download = file => 'https://drive.google.com/uc?export=download&id=' + file.id;
  const values = {
    'DATE SIGNED': dayOf_(env.completedAt ? new Date(env.completedAt) : new Date()), 'CATEGORY': first['CATEGORY'],
    'STREET ADDRESS': first['STREET ADDRESS'], 'CITY': first['CITY'], 'STATE': first['STATE'], 'ZIP': first['ZIP'],
    'EXECUTED': true,
    'IP ADDRESS': signers.map(r => ipByEmail[String(r['EMAIL']).toLowerCase()] || '').filter(String).join(', '),
    'DOCUMENSO FILE ID': env.id,
    'CERTIFICATE DRIVE FILE ID': certFile ? certFile.id : '', 'CERTIFICATE VIEW LINK': certFile ? certFile.url : '',
    'CERTIFICATE DOWNLOAD LINK': certFile ? download(certFile) : '',
  };
  signers.slice(0, 10).forEach((r, i) => { values['SIGNER ACCOUNT ID ' + (i + 1)] = r['ACCOUNT ID']; });
  // One entry per PDF; the envelope's PDFs share its certificate
  for (const docFile of docFiles) {
    await add('documents', Object.assign({}, values, {
      'DOCUMENT DRIVE FILE ID': docFile.id, 'DOCUMENT VIEW LINK': docFile.url, 'DOCUMENT DOWNLOAD LINK': download(docFile),
    }));
  }
  for (const r of signers) await update('signatures', r.docId, { 'LOGGED': docFiles.length ? docFiles[0].id : 'no files' });
}

// Documenso says a document is finished: bring every open document up to date, filing the finished ones
async function documensoWebhook_(secret) {
  const expected = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!expected || secret !== expected) return { ok: false, error: 'unauthorized' };
  await checkSignatures();
  return { ok: true };
}

// Brings unfinished documents up to date, filing any that have just been completed
export async function checkSignatures() {
  const data = await signatureRows_();
  const open = {};
  data.forEach(r => {
    if (r['DOCUMENT STATUS'] === 'PENDING' || r['DOCUMENT STATUS'] === '' || (r['DOCUMENT STATUS'] === 'COMPLETED' && !r['LOGGED'])) open[r['ENVELOPE ID']] = true;
  });
  for (const envelopeId of Object.keys(open)) {
    try { await refreshEnvelope_(data, envelopeId); } catch (err) { console.error(err); }
  }
}

// The signing session for one of the signed-in client's own documents
async function signingTask_(id, body) {
  const envelopeId = String(body.envelopeId || '');
  const data = await signatureRows_();
  const r = data.filter(x => x['ENVELOPE ID'] === envelopeId && phoneToId_(x['ACCOUNT ID']) === id)[0];
  if (!r) return { ok: false, error: 'not_found' };
  try { await refreshEnvelope_(data, envelopeId, true); } catch (err) { console.error(err); }
  return {
    ok: true,
    title: r['TITLE'],
    token: r['RECIPIENT TOKEN'],
    signingStatus: r['SIGNING STATUS'],
    documentStatus: r['DOCUMENT STATUS'],
    signUrl: DOCUMENSO_URL + '/embed/sign/' + encodeURIComponent(r['RECIPIENT TOKEN']),
  };
}

// The signing page, the moment a signer finishes: if that was the last signature, the document is filed right away
// (signed PDFs and certificate to Drive, plus its documents entry). Documenso can take a few seconds after the last
// signature to finish the document, so while every signer is done but it isn't COMPLETED yet, this waits (~25s at most).
// Signing only happens in the portal, so this files every document as soon as it's finished.
async function fileSigned_(id, body) {
  const envelopeId = String(body.envelopeId || '');
  const mine = (await signatureRows_()).some(r => r['ENVELOPE ID'] === envelopeId && phoneToId_(r['ACCOUNT ID']) === id);
  if (!mine) return { ok: false, error: 'not_found' };
  for (let attempt = 0; attempt < 10; attempt++) {
    const env = await refreshEnvelope_(await signatureRows_(), envelopeId);
    if (env.status === 'COMPLETED') return { ok: true, filed: true };
    if (env.status !== 'PENDING') return { ok: true, filed: false };
    // Someone still has to sign: their signature will file it instead
    if ((env.recipients || []).some(r => r.role === 'SIGNER' && r.signingStatus !== 'SIGNED' && r.signingStatus !== 'REJECTED')) {
      return { ok: true, filed: false, waiting: true };
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  return { ok: true, filed: false };
}

// --- Tasks (the home page's Current Tasks card) ---
// One document per task (its document ID is its TASK ID). ASSIGNED is the account the task belongs to;
// it shows on their home page, grouped by SECTION, until COMPLETED is TRUE.
const SIGN_PAGE_URL = 'https://portal.andrewmarth.com/sign?id=';
const TEXT_LINE_COUNT = 15;

// Every task, as { COLUMN: text } with docId (column names upper-cased)
async function taskRows_() {
  return (await rows('tasks')).map(r => {
    const out = { docId: r._id };
    Object.keys(r).forEach(k => { out[k.trim().toUpperCase()] = String(r[k]).trim(); });
    return out;
  });
}

// Adds one task per entry (each entry is { COLUMN: value }), numbered on from the highest TASK ID and dated today.
// The lock keeps two requests from handing out the same TASK ID.
async function addTasks_(tasks) {
  await withLock('tasks', async () => {
    let highest = 0;
    (await taskRows_()).forEach(r => {
      const n = Number(String(r['TASK ID']).replace(/,/g, ''));
      if (isFinite(n) && n > highest) highest = n;
    });
    const today = dayOf_(new Date());
    for (let i = 0; i < tasks.length; i++) {
      const taskId = String(highest + 1 + i);
      await add('tasks', Object.assign({ 'TASK ID': taskId, 'COMPLETED': false, 'DATE': today }, tasks[i]), taskId);
    }
  }, { wait: 30000 });
}

// When a task is due: its DATE ("11/7/2026" or "11/7/2026 15:30:00", Phoenix time), or null when it has none
function taskWhen_(r, column) {
  const m = String(r[column || 'DATE'] || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
const isoLocal_ = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

// What a contingent task is waiting on: the open task its CONTINGENT names (that task, or null once it's completed
// or gone). Tasks can wait on tasks that are themselves waiting, so a chain shows one task at a time.
function waitingOn_(r, byId) {
  const before = byId[String(r['CONTINGENT'] || '').trim()];
  return before && String(before['COMPLETED']).toUpperCase() !== 'TRUE' ? before : null;
}

// The signed-in account's tasks:
//   tasks      open ones that are due (their date and time have passed, and any task they wait on is completed),
//              oldest first: the Current Tasks card
//   upcoming   open ones that aren't due yet, soonest first (waitingOn says which task a contingent one waits for)
//   completed  the 25 most recently completed, newest first
// Each has its title, description, type and when it's due ("YYYY-MM-DDTHH:MM", Phoenix time), plus what its buttons
// need: who to text (textTo) and the message, or who to call (callTo), each with their name when they have an account.
const COMPLETED_SHOWN = 25;
async function myTasks_(id) {
  const data = await taskRows_();
  const byId = {};
  data.forEach(r => { byId[r['TASK ID']] = r; });
  const names = {};
  (await rows('accounts')).forEach(a => { names[phoneToId_(a['ACCOUNT ID'])] = fullName_(a); });
  const person = phone => ({ phone, name: names[phone] || '' });
  const now = Date.now();
  const shape = r => {
    // The text message: MESSAGE as typed (line breaks kept), or for older tasks one line per TEXT LINE column
    // (blank ones kept as empty lines, stopping at the last filled one)
    let message = r['MESSAGE'] || '';
    if (!message) {
      const lines = [];
      for (let n = 1; n <= TEXT_LINE_COUNT; n++) lines.push(r['TEXT LINE ' + n] || '');
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      message = lines.join('\n');
    }
    const when = taskWhen_(r);
    const completed = taskWhen_(r, 'COMPLETED DATE');
    const type = String(r['TYPE'] || '').toLowerCase();
    const textTo = String(r['TEXT TO'] || '').split(',').map(phoneToId_).filter(String);
    const phone = phoneToId_(r['PHONE NUMBER']);
    return {
      taskId: r['TASK ID'], section: r['SECTION'], type: r['TYPE'], title: r['TITLE'],
      description: r['DESCRIPTION'], date: r['DATE'], when: when ? isoLocal_(when) : '', link: r['LINK'], phone: r['PHONE NUMBER'],
      message,
      textTo: textTo.length ? textTo.map(person) : (type === 'text' && phone ? [person(phone)] : []),
      callTo: type === 'call' && phone ? person(phone) : null,
      completedAt: completed ? isoLocal_(completed) : '',
      waitingOn: (w => (w ? { taskId: w['TASK ID'], title: w['TITLE'] } : null))(waitingOn_(r, byId)),
    };
  };
  const mine = data.filter(r => phoneToId_(r['ASSIGNED']) === id);
  const open = mine.filter(r => String(r['COMPLETED']).toUpperCase() !== 'TRUE');
  const time = r => { const w = taskWhen_(r); return w ? w.getTime() : 0; };
  const due = r => time(r) <= now && !waitingOn_(r, byId);
  const doneTime = r => { const w = taskWhen_(r, 'COMPLETED DATE'); return w ? w.getTime() : time(r); };
  return {
    ok: true,
    tasks: open.filter(due).map(shape),
    upcoming: open.filter(r => !due(r)).sort((a, b) => time(a) - time(b)).map(shape),
    completed: mine.filter(r => String(r['COMPLETED']).toUpperCase() === 'TRUE')
      .sort((a, b) => doneTime(b) - doneTime(a)).slice(0, COMPLETED_SHOWN).map(shape),
  };
}

// Admins: a new task from the home page's New Task form. body: { type, assignedTo (10 digits), title, description,
// textTo ([10 digits], Send Text), message (Send Text), callTo (10 digits, Call), date (YYYY-MM-DD), time (HH:MM, 24h),
// contingentOn (a TASK ID, optional) }. It shows on the assigned account's Current Tasks once its date and time
// (Phoenix) have passed and, if it's contingent, once that task is completed.
const TASK_TYPES = ['General', 'Send Text', 'Call', 'Errand'];
async function adminCreateTask_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const type = TASK_TYPES.filter(t => t === String(body.type || ''))[0];
  if (!type) return { ok: false, error: 'bad_type' };
  const assigned = phoneToId_(body.assignedTo);
  if (!(await findAccount_(assigned))) return { ok: false, error: 'bad_assigned' };
  const title = cleanText_(body.title, 100);
  if (!title) return { ok: false, error: 'missing_title' };
  const description = cleanText_(body.description, 300);
  const d = String(body.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(body.time || '').match(/^(\d{2}):(\d{2})$/);
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return { ok: false, error: 'bad_when' };
  const when = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (isNaN(when) || when.getMonth() !== +d[2] - 1) return { ok: false, error: 'bad_when' };
  const task = { 'ASSIGNED': assigned, 'SECTION': type, 'TYPE': type, 'TITLE': title, 'DESCRIPTION': description, 'DATE': when };
  if (body.contingentOn) {
    const before = (await taskRows_()).filter(r => r['TASK ID'] === String(body.contingentOn))[0];
    if (!before || String(before['COMPLETED']).toUpperCase() === 'TRUE') return { ok: false, error: 'bad_contingent' };
    task['CONTINGENT'] = before['TASK ID'];
  }
  if (type === 'Send Text') {
    const phones = [];
    (Array.isArray(body.textTo) ? body.textTo : []).forEach(p => { const n = phoneToId_(p); if (phones.indexOf(n) < 0) phones.push(n); });
    if (!phones.length || phones.length > 10 || phones.some(n => n.length !== 10)) return { ok: false, error: 'bad_text_to' };
    // The message keeps its line breaks (blank lines too); only the very start and end are trimmed
    const message = String(body.message || '').replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, 2000);
    if (!message) return { ok: false, error: 'missing_message' };
    task['TEXT TO'] = phones.join(', ');
    task['MESSAGE'] = message;
  }
  if (type === 'Call') {
    const phone = phoneToId_(body.callTo);
    if (phone.length !== 10) return { ok: false, error: 'bad_call_to' };
    task['PHONE NUMBER'] = phone;
  }
  await addTasks_([task]);
  return { ok: true };
}

// Admins: every task that isn't completed yet (anyone's), for the New Task form's "Contingent" question:
// [{ taskId, title, description, assignedTo, assignedName, when, waitingOn }], soonest first
async function adminOpenTasks_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const data = await taskRows_();
  const byId = {};
  data.forEach(r => { byId[r['TASK ID']] = r; });
  const names = {};
  (await rows('accounts')).forEach(a => { names[phoneToId_(a['ACCOUNT ID'])] = fullName_(a); });
  const time = r => { const w = taskWhen_(r); return w ? w.getTime() : 0; };
  return {
    ok: true,
    tasks: data.filter(r => String(r['COMPLETED']).toUpperCase() !== 'TRUE').sort((a, b) => time(a) - time(b)).map(r => {
      const w = taskWhen_(r);
      const waiting = waitingOn_(r, byId);
      const assigned = phoneToId_(r['ASSIGNED']);
      return {
        taskId: r['TASK ID'], title: r['TITLE'], description: r['DESCRIPTION'], assignedTo: assigned, assignedName: names[assigned] || '',
        when: w ? isoLocal_(w) : '', waitingOn: waiting ? { taskId: waiting['TASK ID'], title: waiting['TITLE'] } : null,
      };
    }),
  };
}

// "Clear this task": marks one of the signed-in account's own tasks COMPLETED. Signature tasks close themselves
// once the document is signed, so they can't be cleared here.
async function completeTask_(id, body) {
  const data = await taskRows_();
  const r = data.filter(x => x['TASK ID'] === String(body.taskId || '') && phoneToId_(x['ASSIGNED']) === id)[0];
  if (!r) return { ok: false, error: 'not_found' };
  if (String(r['TYPE']).toUpperCase() === 'SIGNATURE') return { ok: false, error: 'signature_task' };
  await update('tasks', r.docId, { 'COMPLETED': true, 'COMPLETED DATE': new Date() });
  return { ok: true };
}

// Marks these accounts' Signature tasks for one document COMPLETED
async function completeSignatureTasks_(envelopeId, accountIds) {
  const link = SIGN_PAGE_URL + encodeURIComponent(envelopeId);
  const ids = accountIds.map(phoneToId_);
  for (const r of await taskRows_()) {
    if (String(r['TYPE']).toUpperCase() !== 'SIGNATURE' || r['LINK'] !== link) continue;
    if (ids.indexOf(phoneToId_(r['ASSIGNED'])) < 0 || String(r['COMPLETED']).toUpperCase() === 'TRUE') continue;
    await update('tasks', r.docId, { 'COMPLETED': true, 'COMPLETED DATE': new Date() });
  }
}

// New PAGE ID: the highest PAGE ID plus 1 (call inside the "pages" lock)
async function nextPageId_() {
  let highest = 0;
  (await rows('pages')).forEach(p => {
    const raw = String(p['PAGE ID']).replace(/,/g, '').trim();
    const n = Number(raw);
    if (raw !== '' && isFinite(n)) highest = Math.max(highest, n);
  });
  return Math.floor(highest) + 1;
}

const PROPERTY_TYPES = ['Single Family', 'Townhome', 'Condo', 'Manufactured'];
const CENSUS_DESIGNATIONS = ['Low', 'Moderate', 'Middle', 'Upper'];

// Admins only: a new Buyer Breakdown page for a buyer (or, with pageType "Seller Net", a Seller Net page for a seller),
// from the home page's New Property form.
// The buyer (seller) goes in PRIMARY, then any other purchasers (sellers), then collaborators (six people at most).
// Everything the form doesn't ask for starts at a standard placeholder; every other column stays blank.
async function createProperty_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const isSellerNet = String(body.pageType || '').trim().toLowerCase() === 'seller net';
  const role = isSellerNet ? 'SELLER' : 'BUYER';
  const byId = {};
  (await rows('accounts')).forEach(r => { const aid = phoneToId_(r['ACCOUNT ID']); if (aid) byId[aid] = r; });

  // People
  const clientId = phoneToId_(body.clientId);
  if (!byId[clientId] || !hasRole_(byId[clientId], role)) return { ok: false, error: 'bad_client' };
  const people = [{ id: clientId, type: isSellerNet ? 'Seller' : 'Purchaser' }];
  const addPeople = (list, type, mustHaveRole) => {
    (Array.isArray(list) ? list : []).forEach(v => {
      const pid = phoneToId_(v);
      if (!pid || !byId[pid] || (mustHaveRole && !hasRole_(byId[pid], role))) return;
      if (people.some(p => p.id === pid)) return;
      people.push({ id: pid, type });
    });
  };
  addPeople(body.purchasers, isSellerNet ? 'Seller' : 'Purchaser', true);
  addPeople(body.collaborators, 'Collaborator', false);
  if (people.length > PAGE_PEOPLE_COLUMNS.length) return { ok: false, error: 'too_many_people' };

  // Answers
  const text = (v, max) => cleanText_(v, max || 120);
  const whole = v => {
    const digits = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    return digits === '' ? '' : Number(digits);
  };
  const address = body.address || {};
  const street = text(address.street), city = text(address.city), state = text(address.state, 20), zip = text(address.zip, 10);
  if (!street || !city || !state || !zip) return { ok: false, error: 'missing_address' };
  const propertyType = PROPERTY_TYPES.filter(t => t === body.propertyType)[0];
  if (!propertyType) return { ok: false, error: 'bad_property_type' };
  const price = whole(body.purchasePrice);
  if (!(price > 0)) return { ok: false, error: 'missing_price' };
  const product = isSellerNet ? null : (await rows('loanProducts'))[Number(body.loanProduct)];
  if (!isSellerNet && !product) return { ok: false, error: 'bad_loan_product' };
  const census = CENSUS_DESIGNATIONS.filter(c => c === body.census)[0] || '';
  const pool = body.hasPool === true || String(body.hasPool).toUpperCase() === 'TRUE';
  const hoa = body.hoa || {};

  const today = new Date();
  const dayOnly = (d, plus) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + (plus || 0));

  // Seller Net: the sale, the HOA, and the seller's costs (the loan payoff is filled in later from Settings)
  const values = isSellerNet ? {
    'PAGE TYPE': 'Seller Net',
    'STREET ADDRESS': street, 'CITY': city, 'STATE': state, 'ZIP': zip,
    'PROPERTY TYPE': propertyType,
    'YEAR BUILT': whole(body.yearBuilt),
    'YEARLY TAXES': whole(body.yearlyTaxes),
    'PURCHASE PRICE': price,
    'HOA TRANSFER FEE': whole(hoa.transfer),
    'HOA CAP FEE': whole(hoa.cap),
    'HOA DISCLOSURE FEE': whole(hoa.disclosure),
    'HOA OTHER FEE': whole(hoa.other),
    'HOA PRIMARY MONTHLY DUES': whole(hoa.primary),
    'HOA MASTER MONTHLY DUES': whole(hoa.master),
    // Placeholders: the seller pays every HOA fee, and both commissions start at 2.5%
    'SELLER CREDIT': 0,
    'ESCROW FEE RATE': 0.002,
    'OWNERS TITLE RATE': 0.0045,
    'WHO PAYS TRANSFER FEE': 'Seller',
    'WHO PAYS CAP FEE': 'Seller',
    'WHO PAYS DISCLOSURE FEE': 'Seller',
    'WHO PAYS OTHER FEE': 'Seller',
    'OFFER ACCEPTANCE DATE': dayOnly(today, 1),
    'ESCROW DURATION': 30,
    'SELLER PAID BUYER COMMISSION %': 0.025,
    'SELLER PAID BUYER COMMISSION $': 0,
    'LISTING AGENT COMMISSION %': 0.025,
    'LISTING AGENT COMMISSION $': 0,
    'VERSION TITLE': 'Initial Version',
    'VERSION DATE': dayOnly(today, 0),
  } : {
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
  people.forEach((p, i) => {
    values[PAGE_PEOPLE_COLUMNS[i]] = p.id;
    values[PAGE_ROLE_COLUMNS[i]] = p.type;
  });

  const newId = await withLock('pages', async () => {
    const next = await nextPageId_();
    values['PAGE ID'] = String(next);
    await add('pages', values, String(next));
    return next;
  });
  return { ok: true, pageId: String(newId) };
}

// A PAGES row for pages.html. Only people listed on the page get it; anyone else is told it doesn't exist.
// The PAGE TYPE column decides what else is sent along.
async function pageData_(id, account, pageId) {
  if (!String(pageId || '').trim()) return { ok: false, error: 'missing_page' };
  const found = await findPage_(pageId);
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
  const page = found.row;
  const isAdmin = isAdmin_(account);

  const result = {
    ok: true,
    page,
    pageType: String(page['PAGE TYPE'] || '').trim(),
    isAdmin,
    viewerId: id,
    // Admins get the account list for the access pickers
    accounts: isAdmin ? await accountChoices_() : null,
  };
  if (result.pageType.toLowerCase() === 'buyer breakdown') await addBuyerBreakdownData_(result, page);
  return result;
}

// Home page lists. Everyone: the Buyer Breakdown pages with this account in one of its ACCOUNT ID columns.
// Admins also get every BUYER account and every Buyer Breakdown page (with who is on it) for the "My Buyers" card.
// Newest pages come first.
async function myPagesData_(id, account) {
  const allPages = await rows('pages');
  // Newest first
  const pagesOfType = type => allPages
    .filter(p => String(p['PAGE ID'] || '').trim() && String(p['PAGE TYPE'] || '').trim().toLowerCase() === type)
    .slice().reverse();
  const pages = pagesOfType('buyer breakdown');
  const summary = p => ({
    id: String(p['PAGE ID']).trim(),
    street: String(p['STREET ADDRESS'] || '').trim(),
    city: String(p['CITY'] || '').trim(),
    state: String(p['STATE'] || '').trim(),
    zip: String(p['ZIP'] || '').trim(),
    versionDate: String(p['VERSION DATE'] || '').trim(),
  });
  const accounts = await rows('accounts');
  const result = { ok: true, pages: pages.filter(p => isOnPage_(p, id)).map(summary) };
  // The Flips card: this account's "Flip" pages (the card itself is only shown to FLIPPER BUYER accounts)
  result.flipPages = pagesOfType('flip').filter(p => isOnPage_(p, id)).map(summary);
  // The Seller Net Sheets card: this account's "Seller Net" pages (the card itself is only shown to SELLER accounts)
  result.sellerNetPages = pagesOfType('seller net').filter(p => isOnPage_(p, id)).map(summary);
  // Lenders' "My Buyers": the BUYER accounts on the Buyer Breakdowns this lender is on, and those pages
  if (hasRole_(account, 'LENDER')) {
    const lenderPages = pages.filter(p => isOnPage_(p, id));
    const onLenderPages = {};
    lenderPages.forEach(p => {
      PAGE_PEOPLE_COLUMNS.forEach(c => { const pid = phoneToId_(p[c]); if (pid && pid !== id) onLenderPages[pid] = true; });
    });
    result.lenderBuyers = accounts
      .filter(r => hasRole_(r, 'BUYER') && onLenderPages[phoneToId_(r['ACCOUNT ID'])])
      .map(r => ({ id: phoneToId_(r['ACCOUNT ID']), name: fullName_(r) }))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    result.lenderBuyerPages = lenderPages.map(p => {
      const page = summary(p);
      page.people = PAGE_PEOPLE_COLUMNS.map(c => phoneToId_(p[c])).filter(String);
      return page;
    });
    // "My Loan Products": this lender's LOAN_PRODUCTS rows and the questions the form asks
    result.myLoanProducts = await lenderLoanProducts_(id);
    result.loanProductFields = loanProductFields_(await columns('loanProducts'));
  }
  if (isAdmin_(account)) {
    // For the New Property form: everyone (collaborators can be anyone) and the loan products, by row
    result.accounts = (await accountChoices_()).map(a => ({ id: a.id, name: a.name }));
    result.loanProducts = (await rows('loanProducts')).map((p, i) => ({
      index: i, name: String(p['LOAN PRODUCT NAME'] || '').trim(), lender: String(p['LENDER NAME'] || '').trim(),
    }));
    // Every account with a role, by name
    const withRole = role => accounts
      .filter(r => hasRole_(r, role))
      .map(r => ({ id: phoneToId_(r['ACCOUNT ID']), name: fullName_(r) }))
      .filter(b => b.id)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    // Pages with who is on them
    const withPeople = p => {
      const page = summary(p);
      page.people = PAGE_ACCESS_COLUMNS.map(c => phoneToId_(p[c])).filter(String);
      return page;
    };
    result.buyers = withRole('BUYER');
    result.buyerPages = pages.map(withPeople);
    // "My Sellers": every SELLER account and every Seller Net page
    result.sellers = withRole('SELLER');
    result.sellerPages = pagesOfType('seller net').map(withPeople);
    // "My Flippers": every FLIPPER BUYER account and every Flip page
    result.flippers = withRole('FLIPPER BUYER');
    result.flipperPages = pagesOfType('flip').map(withPeople);
    // Links are extra: if they can't be read, the page lists still load
    try {
      result.links = await adminLinks_();
    } catch (linksErr) {
      console.error(linksErr);
      result.links = null;
    }
  }
  return result;
}

// The questions for a LOAN_PRODUCTS row: LOAN_PRODUCT_FIELDS, then any other column as text (not ACCOUNT ID)
function loanProductFields_(headers) {
  const known = {};
  LOAN_PRODUCT_FIELDS.forEach(f => { known[f.col] = true; });
  return LOAN_PRODUCT_FIELDS.concat(headers
    .map(h => String(h).trim().toUpperCase())
    .filter(h => h && h !== 'ACCOUNT ID' && !known[h])
    .map(h => ({ section: 'Other', col: h, kind: 'text' })));
}

// This lender's LOAN_PRODUCTS rows (ACCOUNT ID is theirs): each one's row number (_order) and its values as text
async function lenderLoanProducts_(id) {
  return (await rows('loanProducts')).filter(r => phoneToId_(r['ACCOUNT ID']) === id).map(r => {
    const product = {};
    Object.keys(r).forEach(h => { const key = h.trim().toUpperCase(); if (key && key !== 'ACCOUNT ID') product[key] = r[h]; });
    return { row: r._order, values: product, docId: r._id };
  });
}

// Lenders only: saves one of their own LOAN_PRODUCTS rows (body.row, its row number), or adds a new one (no row).
// body.values: { column: value } for every question; each is checked like a Settings value and none may be blank
// (except the extra text columns). A new product's LENDER NAME is the lender's bank on file, and SILENT SECOND is
// always TRUE. Returns the lender's products again.
async function saveLoanProduct_(id, account, body) {
  if (!hasRole_(account, 'LENDER')) return { ok: false, error: 'not_allowed' };
  const rowNumber = body.row ? Number(body.row) : 0;
  const submitted = Object.assign({}, body.values || {}, { 'SILENT SECOND': 'TRUE' });
  if (!rowNumber) {
    submitted['LENDER NAME'] = String(account['LENDER BANK'] || '').trim();
    if (!submitted['LENDER NAME']) return { ok: false, error: 'no_lender_bank' };
  }
  return withLock('loanProducts', async () => {
    const fields = loanProductFields_(await columns('loanProducts'));
    const clean = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const value = cleanSetting_(f.kind, submitted[f.col]);
      if (value === null || (value === '' && f.section !== 'Other')) return { ok: false, error: 'invalid_value', field: f.col };
      clean[f.col] = value;
    }
    const mine = await lenderLoanProducts_(id);
    const target = rowNumber ? mine.find(p => p.row === rowNumber) : null;
    if (rowNumber && !target) return { ok: false, error: 'not_found' };
    // Pages pick a product by name, so one lender can't have two with the same name
    const name = String(clean['LOAN PRODUCT NAME']).toLowerCase();
    if (mine.some(p => p.row !== rowNumber && String(p.values['LOAN PRODUCT NAME'] || '').trim().toLowerCase() === name)) {
      return { ok: false, error: 'duplicate_name' };
    }
    if (target) await update('loanProducts', target.docId, clean);
    else await add('loanProducts', Object.assign({ 'ACCOUNT ID': id }, clean));
    return { ok: true, products: (await lenderLoanProducts_(id)).map(p => ({ row: p.row, values: p.values })) };
  });
}

// Each LINKS entry that has a web address, in order
async function adminLinks_() {
  return (await rows('links'))
    .map(r => ({
      title: String(r['TITLE'] || '').trim(),
      description: String(r['DESCRIPTION'] || '').trim(),
      section: String(r['SECTION'] || '').trim(),
      link: String(r['LINK'] || '').trim(),
    }))
    .filter(l => /^https?:\/\//i.test(l.link));
}

// Buyer Breakdown pages: every loan product, today's rate and the buyer's credit score
async function addBuyerBreakdownData_(result, page) {
  const own = await versionData_(page);
  result.loanProducts = await rows('loanProducts');
  result.interestRate = (await rows('settings')).find(r => r._id === 'interestRate') || null;
  result.creditScore = own.creditScore;
  result.clients = own.clients;
  result.inspectors = own.inspectors;
  // Every version of this address the viewer can see (this one included), for the version dropdown
  const key = addressKey_(page);
  const versions = (await rows('pages')).filter(p => String(p['PAGE ID'] || '').trim()
    && String(p['PAGE TYPE'] || '').trim().toLowerCase() === 'buyer breakdown'
    && addressKey_(p) === key
    && (result.isAdmin || isOnPage_(p, result.viewerId)));
  result.versions = [];
  for (const p of versions) result.versions.push(await versionData_(p));
  // Admins get every inspector's price list, for the Settings dropdowns and to preview a new pick
  if (result.isAdmin) {
    result.inspectorRows = {
      home: await rows('homeInspectors'),
      sewer: await rows('sewerInspectors'),
      termite: await rows('termiteInspectors'),
    };
  }
}

// What one version of a Buyer Breakdown page needs besides its own row
async function versionData_(page) {
  // Credit score belongs to the page's buyer, not whoever is viewing (e.g. the lender)
  let creditScore = null;
  const buyerId = phoneToId_(page['PRIMARY ACCOUNT ID']);
  if (buyerId) {
    const income = await findIncome_(buyerId);
    if (income) creditScore = income['CREDIT SCORE'] || null;
  }
  return {
    page,
    creditScore,
    clients: await pageClients_(page),
    // The price-list row for each inspector chosen on the page (null when none is chosen or it isn't found)
    inspectors: {
      home: await inspectorRow_('homeInspectors', 'HOME INSPECTOR', page['HOME INSPECTOR']),
      sewer: await inspectorRow_('sewerInspectors', 'SEWER INSPECTOR', page['SEWER INSPECTOR']),
      termite: await inspectorRow_('termiteInspectors', 'TERMITE INSPECTOR', page['TERMITE INSPECTOR']),
    },
  };
}

// Pages for the same home share a street, city and zip (case, spacing and punctuation ignored)
function addressKey_(page) {
  return ['STREET ADDRESS', 'CITY', 'ZIP'].map(c => String(page[c] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|');
}

// Finds an inspector by name in a price list
async function inspectorRow_(collection, nameColumn, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return (await rows(collection)).filter(r => {
    const key = Object.keys(r).filter(h => h.toUpperCase() === nameColumn)[0];
    return key && String(r[key]).trim().toLowerCase() === wanted;
  })[0] || null;
}

// Each person on the page (PRIMARY, then ALT 1-5) with their name, Purchaser/Collaborator type and INCOME row
// (null if they have none; it also holds their CREDIT SCORE), for the rate and approval estimate
async function pageClients_(page) {
  const names = {};
  (await rows('accounts')).forEach(r => { names[phoneToId_(r['ACCOUNT ID'])] = fullName_(r); });
  const incomes = {};
  (await rows('income')).forEach(r => {
    const rid = phoneToId_(r['ACCOUNT ID'] || r['ID'] || r._id);
    if (rid && !incomes[rid]) incomes[rid] = r;
  });
  const seen = {};
  return PAGE_PEOPLE_COLUMNS.map((col, i) => {
    const type = String(page[PAGE_ROLE_COLUMNS[i]] || '').trim().toLowerCase() === 'collaborator' ? 'Collaborator' : 'Purchaser';
    return { id: phoneToId_(page[col]), type };
  })
    .filter(p => { if (!p.id || seen[p.id]) return false; seen[p.id] = true; return true; })
    .map(p => ({ id: p.id, type: p.type, name: names[p.id] || '', income: incomes[p.id] || null }));
}

// Interval columns must be one of INTERVALS, job titles/descriptions are short text,
// everything else is a dollar amount or number. Returns null when the value isn't allowed.
function cleanIncomeValue_(header, value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '';
  if (/INTERVAL$/.test(header)) return INTERVALS.filter(i => i.toLowerCase() === raw.toLowerCase())[0] || null;
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

// Phone number without the country code, symbols or spaces (e.g. +14805550123 -> 4805550123)
function phoneToId_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
}

// Trims submitted text, drops characters that could start a formula (if exported to a spreadsheet), and caps the length
function cleanText_(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim().slice(0, maxLength);
}
