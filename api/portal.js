// Andrew Marth Client Portal - private data API (Cloud Run function).
//
// The data lives in Firestore (see firestore/LAYOUT.md). Rows come from lib/store.js as { COLUMN: text }.
import { rows, row as getRow, columns, update, add, remove, withLock } from './lib/store.js';
import { verifyPhone, folderFiles, driveImage, createDriveFile, geocode } from './lib/google.js';
import { db } from './lib/store.js';
import { lookupPropertyFacts } from './lib/property-facts.js';
import { FieldValue } from 'firebase-admin/firestore';

// The only people who may view a page. The first six are clients (PRIMARY is the buyer); the last is the lender.
const PAGE_PEOPLE_COLUMNS = ['PRIMARY ACCOUNT ID', 'ALT ACCOUNT ID 1', 'ALT ACCOUNT ID 2', 'ALT ACCOUNT ID 3',
  'ALT ACCOUNT ID 4', 'ALT ACCOUNT ID 5'];
const PAGE_LENDER_COLUMN = 'LENDER ACCOUNT ID';
const PAGE_ACCESS_COLUMNS = PAGE_PEOPLE_COLUMNS.concat([PAGE_LENDER_COLUMN]);
// Whether each of those six people is a "Purchaser" or a "Collaborator" (blank counts as Purchaser)
const PAGE_ROLE_COLUMNS = ['PRIMARY ACCOUNT TYPE', 'ALT ACCOUNT TYPE 1', 'ALT ACCOUNT TYPE 2', 'ALT ACCOUNT TYPE 3',
  'ALT ACCOUNT TYPE 4', 'ALT ACCOUNT TYPE 5'];
// Seller Net: each of those six people's title when they sign for an LLC or trust (blank for collaborators)
const PAGE_SIGNER_COLUMNS = ['PRIMARY SIGNER TITLE', 'ALT SIGNER TITLE 1', 'ALT SIGNER TITLE 2', 'ALT SIGNER TITLE 3',
  'ALT SIGNER TITLE 4', 'ALT SIGNER TITLE 5'];
// TRUE when the buyer is paying cash (no loan)
const PAGE_CASH_COLUMN = 'CASH PURCHASE';

// PAGES columns admins can edit from the page's Settings card, and the kind of value each one takes:
//   money / int: whole numbers (no commas)   rate: a decimal like 0.03 for 3%   bool: TRUE / FALSE
//   date: m/d/yyyy   payer: Buyer or Seller   text: any short text   [list]: one of those values
//   cents: a number that may have up to 2 decimals (like 2.5 baths)
const PAGE_SETTING_FIELDS = {
  'PURCHASE PRICE': 'money', 'SELLER CREDIT': 'rate', 'PROPERTY TYPE': ['Single Family', 'Townhome', 'Condo', 'Manufactured'],
  'SQFT': 'int', 'BEDS': 'int', 'BATHS': 'cents', 'YEAR BUILT': 'int', 'HAS POOL': 'bool', 'YEARLY TAXES': 'money',
  'CENSUS DESIGNATION': ['Low', 'Moderate', 'Middle', 'Upper'], 'OFFER ACCEPTANCE DATE': 'date', 'ESCROW DURATION': 'int',
  'EARNEST MONEY DEPOSIT': 'money', 'GIFT FUNDS': 'money',
  'RETAIL LTV': 'rate', 'LENDER POINTS PURCHASED': 'rate', 'PREPAID MI APPLIED': 'bool',
  'ESCROW FEE RATE': 'rate', 'OWNERS TITLE RATE': 'rate', 'ALTA TITLE RATE': 'rate', 'HOMEOWNERS INSURANCE RATE': 'rate',
  // Title & Escrow: the title company (a titleCompanies document ID; blank uses the three rates above) and this sale's details
  'TITLE COMPANY': 'id', 'SALE TYPE': ['Standard', 'Short Sale', 'REO'],
  'BUYER FINANCING': ['Fixed Rate Loan', 'Adjustable Rate Loan', 'VA Loan', 'Cash'], 'SECOND LOAN AMOUNT': 'money',
  'WHO PAYS OWNERS POLICY': 'payer', 'OWNERS TITLE DISCOUNT': 'text', 'SELLER ESCROW DISCOUNT': 'text', 'BUYER ESCROW DISCOUNT': 'text',
  'FINCEN REPORT': 'bool', 'EXTRA TITLE FEES': 'list',
  // Seller Net's Buyer Inputs (the buyer's side of the escrow breakdown): the loan product by name and the buyer's credit
  // score; the rest are the Buyer Breakdown's own columns (RETAIL LTV, EARNEST MONEY DEPOSIT, ...)
  'BUYER LOAN PRODUCT': 'text', 'BUYER CREDIT SCORE': 'int',
  // Who the buyer is (their escrow and owner's policy discounts follow from it)
  'BUYER TYPE': ['Individual', 'Investor', 'Senior', 'Military / First Responder', 'Real Estate Agent', 'Public Servant', 'Church / Non-Profit', 'Corporate Relocation'],
  'HOA TRANSFER FEE': 'money', 'WHO PAYS TRANSFER FEE': 'payer', 'HOA CAP FEE': 'money', 'WHO PAYS CAP FEE': 'payer',
  'HOA DISCLOSURE FEE': 'money', 'HOA OTHER FEE': 'money', 'WHO PAYS OTHER FEE': 'payer',
  'HOA PRIMARY MONTHLY DUES': 'money', 'HOA MASTER MONTHLY DUES': 'money',
  'BUYERS AGENT COMMISSION %': 'rate', 'BUYERS AGENT COMMISSION $': 'money',
  'SELLER PAID BUYER COMMISSION %': 'rate', 'SELLER PAID BUYER COMMISSION $': 'money',
  'HOME INSPECTOR': 'text', 'HOME INSPECTOR POOL': 'bool', 'HOME INSPECTOR SEWER': 'bool', 'HOME INSPECTOR TERMITE': 'bool',
  'SEWER INSPECTOR': 'text', 'TERMITE INSPECTOR': 'text',
  // Seller Net pages: the seller's loan payoff and the listing agent's commission
  'ORIGINAL LOAN AMOUNT': 'money', 'ORIGINAL LOAN DATE': 'date', 'LOAN INTEREST RATE': 'rate', 'LOAN TERM MONTHS': 'int',
  // The agent's guess at the rate, used until the seller enters LOAN INTEREST RATE
  'ESTIMATED INTEREST RATE': 'rate',
  'LOAN PRINCIPAL BALANCE': 'money', 'PRINCIPAL LOAN BALANCE DATE': 'date',
  'LOAN TYPE': ['Conventional', 'FHA', 'VA', 'DSCR', 'Hard Money', 'Jumbo', 'Other', 'No Loan'],
  'ORIGINAL PREPAID MORTGAGE INSURANCE': 'money',
  'PREPAYMENT PENALTY': ['Yes', 'No', 'Unknown'],
  'PREPAYMENT PENALTY TYPE': ['Percent Of Loan Amount', 'Flat Dollar Amount', 'Both', 'Unknown'],
  'OUTSTANDING CONSTRUCTION HOLDBACK': 'money', 'OUTSTANDING INTEREST RESERVE': 'money',
  'DRAW FEE HOLDBACK': 'money', 'OTHER HOLDBACK': 'money',
  // Seller Net: whether each fee is an estimate or the final amount, and whether there's an HOA / master association
  'RECORDING FEE STATUS': ['Estimated', 'Final'], 'PAYOFF STATEMENT FEE STATUS': ['Estimated', 'Final'],
  'OTHER LOAN PAYOFF FEES STATUS': ['Estimated', 'Final'], 'HOA TRANSFER FEE STATUS': ['Estimated', 'Final'],
  'HOA CAP FEE STATUS': ['Estimated', 'Final'], 'HOA DISCLOSURE FEE STATUS': ['Estimated', 'Final'],
  'HOA PRIMARY MONTHLY DUES STATUS': ['Estimated', 'Final'], 'HOA MASTER MONTHLY DUES STATUS': ['Estimated', 'Final'],
  'HAS HOA': ['Yes', 'No'], 'HAS MASTER ASSOCIATION': ['Yes', 'No'],
  'RECORDING FEE': 'money', 'PAYOFF STATEMENT FEE': 'money',
  'PREPAYMENT PENALTY %': 'rate', 'PREPAYMENT PENALTY $': 'money',
  'OTHER LOAN PAYOFF FEES %': 'rate', 'OTHER LOAN PAYOFF FEES $': 'money',
  'LISTING AGENT COMMISSION %': 'rate', 'LISTING AGENT COMMISSION $': 'money',
  'LISTING STATUS': ['Nurturing', 'Prelisting', 'Listed', 'Under Contract', 'Closed'],
  // Seller Net: who is selling (the signer titles come in separately, as body.signerTitles)
  'SELLER TYPE': ['Individual(s)', 'LLC', 'Trust'], 'LLC NAME': 'text', 'TRUST NAME': 'text',
};

// Checks one submitted setting. Returns the value to write, or null if it isn't allowed. Blank is always allowed.
function cleanSetting_(kind, value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (raw === '') return '';
  if (Array.isArray(kind)) return kind.filter(k => k.toLowerCase() === raw.toLowerCase())[0] || null;
  if (kind === 'bool') return /^true$/i.test(raw) ? true : /^false$/i.test(raw) ? false : null;
  if (kind === 'payer') return /^buyer$/i.test(raw) ? 'Buyer' : /^seller$/i.test(raw) ? 'Seller' : null;
  if (kind === 'text') return cleanText_(raw, 100);
  // A document ID, or a list of names joined by " | "
  if (kind === 'id') return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
  if (kind === 'list') return cleanText_(raw, 1000);
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
    if (body.action === 'saveRentSplit') return await saveRentSplit_(id, account, body);
    if (body.action === 'saveSplitPayments') return await saveSplitPayments_(id, account, body);
    if (body.action === 'markTransactionPaid') return await settleTransaction_(id, account, body, true);
    if (body.action === 'moveTransaction') return await settleTransaction_(id, account, body, false);
    if (body.action === 'updateBalance') return await updateBalance_(id, account, body);
    // flip-portal.html: wholesale properties with map positions (admins and FLIPPER BUYER accounts)
    if (body.action === 'wholesaleProperties') return await wholesaleProperties_(account);
    if (body.action === 'wholesalePhotos') return await wholesalePhotos_(account, body);
    if (body.action === 'wholesalePhoto') return await wholesalePhoto_(account, body);
    if (body.action === 'wholesaleCover') return await wholesaleCover_(account, body);
    if (body.action === 'wholesaleCovers') return await wholesaleCovers_(account, body);
    // settings.html: the admin Usage card
    if (body.action === 'adminUsage') return await adminUsage_(account);
    if (body.action === 'resumeGemini') return await resumeGemini_(account);
    // settings.html: the admin Marketing Points card (points to customize a seller page with; images go to Drive)
    if (body.action === 'marketingPoints') return await marketingPoints_(account);
    if (body.action === 'saveMarketingPoint') return await saveMarketingPoint_(account, body);
    if (body.action === 'deleteMarketingPoint') return await deleteMarketingPoint_(account, body);
    if (body.action === 'marketingPointImage') return await marketingPointImage_(account, body);
    // settings.html: the admin Title Companies card (each company's filed escrow and title fees)
    if (body.action === 'titleCompanies') return await titleCompanies_(account);
    if (body.action === 'saveTitleCompany') return await saveTitleCompany_(account, body);
    if (body.action === 'deleteTitleCompany') return await deleteTitleCompany_(account, body);
    // Home page (admins): add a new property for a buyer
    if (body.action === 'createProperty') return await createProperty_(account, body);
    // index.html's New Seller Net form (admins): beds, baths, sqft and taxes for an address, from the property APIs
    if (body.action === 'propertyFacts') return await propertyFacts_(account, body);
    // pages.html (admins): copy the page into a new version
    if (body.action === 'createVersion') return await createVersion_(id, account, body);
    // pages.html (admins): change who can see the page
    if (body.action === 'updatePageAccess') return await updatePageAccess_(id, account, body);
    if (body.action === 'saveClientInput') return await saveClientInput_(id, account, body);

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
  // Seller Net: each seller's title for signing for the LLC or trust, from { accountId: title }
  const titles = body.signerTitles && typeof body.signerTitles === 'object' ? body.signerTitles : {};
  if (isSellerNet) people.forEach(p => { p.title = cleanText_(titles[p.id], 60); });
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
    if (isSellerNet) fields[PAGE_SIGNER_COLUMNS[i]] = person && person.type === 'Seller' ? person.title : '';
  });
  if (!isSellerNet) fields[PAGE_LENDER_COLUMN] = lender || '';
  // Seller Net: the other versions (found before saving, while they still have the same sellers as this one)
  const siblings = isSellerNet ? await otherVersions_(found) : [];
  await update('pages', found.docId, fields);
  if (siblings.length) await shareGlobalSettings_(siblings, fields, people.filter(p => p.type === 'Seller'));
  return { ok: true, page: (await findPage_(body.pageId)).row };
}

// --- Seller Net versions ---
// Versions of a Seller Net page are the pages with the same PAGE TYPE, the same home (addressKey_) and the same
// sellers. Global Settings (the home, the seller's loan and HOA, and the sellers) are kept the same on all of them;
// everything else (Version Settings) belongs to one version.
const SELLER_NET_GLOBAL_FIELDS = () => ['SELLER TYPE', 'LLC NAME', 'TRUST NAME', 'LISTING STATUS', 'PROPERTY TYPE', 'YEAR BUILT', 'BEDS', 'BATHS', 'SQFT', 'YEARLY TAXES',
  'ORIGINAL LOAN AMOUNT', 'ORIGINAL LOAN DATE', 'LOAN TERM MONTHS', 'LOAN TYPE'].concat(CLIENT_INPUT_FIELDS);

// The page's sellers (everyone on it who isn't a collaborator), sorted, as one string
function sellerKey_(page) {
  const ids = PAGE_PEOPLE_COLUMNS.map((col, i) => String(page[PAGE_ROLE_COLUMNS[i]] || '').trim().toLowerCase() === 'collaborator' ? '' : phoneToId_(page[col]))
    .filter(Boolean);
  return [...new Set(ids)].sort().join(',');
}
function versionKey_(page) {
  return [String(page['PAGE TYPE'] || '').trim().toLowerCase(), addressKey_(page), sellerKey_(page)].join('#');
}
// Every version of this page, itself included
async function sellerNetVersions_(page) {
  const key = versionKey_(page);
  return (await rows('pages')).filter(p => String(p['PAGE ID'] || '').trim() && versionKey_(p) === key);
}
async function otherVersions_(found) {
  return (await sellerNetVersions_(found.row)).filter(p => p._id !== found.docId);
}

// Copies the Global Settings in fields to the other versions. sellers (when given): the new sellers, who replace
// each version's own; its collaborators stay (minus anyone who is now a seller), up to six people in all.
async function shareGlobalSettings_(siblings, fields, sellers) {
  const shared = {};
  SELLER_NET_GLOBAL_FIELDS().forEach(c => { if (Object.prototype.hasOwnProperty.call(fields, c)) shared[c] = fields[c]; });
  for (const p of siblings) {
    const own = Object.assign({}, shared);
    if (sellers) {
      const sellerIds = sellers.map(s => s.id);
      const collaborators = PAGE_PEOPLE_COLUMNS.map((col, i) => ({ id: phoneToId_(p[col]), role: String(p[PAGE_ROLE_COLUMNS[i]] || '').trim().toLowerCase() }))
        .filter(x => x.id && x.role === 'collaborator' && !sellerIds.includes(x.id))
        .map(x => ({ id: x.id, type: 'Collaborator' }));
      const people = sellers.concat(collaborators).slice(0, PAGE_PEOPLE_COLUMNS.length);
      PAGE_PEOPLE_COLUMNS.forEach((col, i) => {
        own[col] = people[i] ? people[i].id : '';
        own[PAGE_ROLE_COLUMNS[i]] = people[i] ? people[i].type : '';
        own[PAGE_SIGNER_COLUMNS[i]] = people[i] && people[i].type === 'Seller' ? people[i].title || '' : '';
      });
    }
    if (Object.keys(own).length) await update('pages', p._id, own);
  }
}

// Seller Net "Client Input": what the seller fills in themselves (their loan and HOA). Anyone on the page (or an admin)
// can save these, and only these. body: { pageId, fields: { COLUMN: value } } (each checked as in PAGE_SETTING_FIELDS)
const CLIENT_INPUT_FIELDS = ['LOAN TYPE', 'LOAN PRINCIPAL BALANCE', 'PRINCIPAL LOAN BALANCE DATE', 'LOAN INTEREST RATE',
  'LOAN TERM MONTHS', 'ORIGINAL PREPAID MORTGAGE INSURANCE', 'PREPAYMENT PENALTY', 'PREPAYMENT PENALTY TYPE',
  'PREPAYMENT PENALTY %', 'PREPAYMENT PENALTY $', 'OUTSTANDING CONSTRUCTION HOLDBACK', 'OUTSTANDING INTEREST RESERVE',
  'DRAW FEE HOLDBACK', 'OTHER HOLDBACK', 'HAS HOA', 'HOA PRIMARY MONTHLY DUES', 'HOA PRIMARY MONTHLY DUES STATUS',
  'HAS MASTER ASSOCIATION', 'HOA MASTER MONTHLY DUES', 'HOA MASTER MONTHLY DUES STATUS'];
async function saveClientInput_(id, account, body) {
  const found = await findPage_(body.pageId);
  if (!found || !canSeePage_(found.row, id, account)) return { ok: false, error: 'page_not_found' };
  if (String(found.row['PAGE TYPE'] || '').trim().toLowerCase() !== 'seller net') return { ok: false, error: 'not_allowed' };
  const fields = {};
  const submitted = body.fields || {};
  for (const key in submitted) {
    const column = String(key).trim().toUpperCase();
    if (!CLIENT_INPUT_FIELDS.includes(column)) return { ok: false, error: 'invalid_field' };
    const value = cleanSetting_(PAGE_SETTING_FIELDS[column], submitted[key]);
    if (value === null) return { ok: false, error: 'invalid_value', field: column };
    fields[column] = value;
  }
  if (Object.keys(fields).length) {
    // These are Global Settings, so every version of the page gets them
    const siblings = await otherVersions_(found);
    await update('pages', found.docId, fields);
    if (siblings.length) await shareGlobalSettings_(siblings, fields, null);
  }
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
    if (e.paymentLabel) e.note += ' · ' + e.paymentLabel;
    if (e.part === 'receive') e.personName = names[e.person] || '';
    delete e.ownerId;
    delete e.paymentLabel;
    return e;
  });
  return { ok: true, balance, transactions, splitPeople };
}

const CUM_LINE_ITEMS = 20;
// A split person's share can be paid in up to this many set amounts (SPLIT PAYMENT n ...) plus "the rest"
const CUM_SPLIT_PAYMENTS = 10;

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
    items: [], payments: [],
  };
  for (let n = 1; n <= CUM_SPLIT_PAYMENTS; n++) {
    const p = 'SPLIT PAYMENT ' + n + ' ';
    col.payments.push({ n, date: find(p + 'DATE'), amount: find(p + 'AMOUNT'), received: find(p + 'RECEIVED'), paid: find(p + 'PAID') });
  }
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
    const payments = col.payments.filter(c => c.amount && text(c.amount) !== '').map(c => ({
      n: c.n, date: text(c.date), amount: cumNumber_(text(c.amount)), received: yes(c.received), paid: yes(c.paid),
    }));
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
      payments,
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
// A split can also come in as several payments (only when one person is split with): SPLIT PAYMENT n has its own date,
// amount and checkboxes (RECEIVED for the account holder, PAID for the person paying), and "the rest" of the share is the
// split above (SPLIT PERSON DATE and its checkboxes). Each shows and is checked off on its own (key ...:pN).

// The payments of one person's share, in order, the rest last: [{ n ('rest' for the rest), date, amount, locked }]
// (locked: already checked off by either person)
function cumSplitSchedule_(t, total) {
  const parts = t.payments.map(p => ({ n: p.n, date: p.date, amount: cumRound_(p.amount), locked: p.received || p.paid }));
  return parts.concat([{ n: 'rest', date: t.splitDate || t.date, amount: cumRound_(total - t.payments.reduce((s, p) => s + p.amount, 0)), locked: t.receivePaid || t.splitPaid }]);
}

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
            items: t.items.map(i => ({ n: i.n, description: i.description, amount: i.amount, splitId: i.splitId, percent: i.splitId ? cumRound_(i.percent * 100) : '', separate: i.separate, separateDate: i.separateDate, separatePaid: i.separatePaid })),
            // Blank: their share comes in on the rent's date
            splitDate: t.splitDate,
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
    const single = Object.keys(people).length === 1;
    Object.keys(people).forEach(person => {
      const items = people[person];
      const total = cumRound_(items.reduce((s, i) => s + i.amount * i.percent, 0));
      const lines = sign => items.map(i => ({ description: (i.description || 'Item ' + i.n) + ' (' + cumRound_(i.percent * 100) + '%)', amount: cumRound_(sign * i.amount * i.percent) }));
      // Paid in several payments: each one on its own, then the rest (the line breakdown only when it's one payment)
      const schedule = single ? cumSplitSchedule_(t, total) : null;
      const split = schedule && schedule.length > 1;
      const label = k => (split ? 'Payment ' + (k + 1) + ' of ' + schedule.length : '');
      if (mine) {
        // For the edit menu: the whole share and every payment of it
        const extra = { person, total, payments: schedule || [] };
        if (split) {
          t.payments.forEach((p, k) => {
            if (p.received) return;
            const e = entry('receive', Object.assign({ date: p.date, amount: String(cumRound_(p.amount)), payment: p.n, paymentLabel: label(k) }, extra));
            e.key += ':' + person + ':p' + p.n;
            out.push(e);
          });
        }
        if (!t.receivePaid && !(split && schedule[schedule.length - 1].amount === 0)) {
          const rest = split ? schedule[schedule.length - 1].amount : total;
          const e = entry('receive', Object.assign({ date: t.splitDate || t.date, amount: String(rest), lines: split ? [] : lines(1), paymentLabel: label(schedule ? schedule.length - 1 : 0) }, extra));
          e.key += ':' + person;
          out.push(e);
        }
      }
      if (person === id) {
        if (split) {
          t.payments.forEach((p, k) => {
            if (p.paid) return;
            const e = entry('split', { date: p.date, amount: String(cumRound_(-p.amount)), payment: p.n, paymentLabel: label(k), ownerId: t.accountId });
            e.key += ':p' + p.n;
            out.push(e);
          });
        }
        if (!t.splitPaid && !(split && schedule[schedule.length - 1].amount === 0)) {
          const rest = split ? schedule[schedule.length - 1].amount : total;
          out.push(entry('split', { date: t.splitDate || t.date, amount: String(-rest), lines: split ? [] : lines(-1), paymentLabel: label(schedule ? schedule.length - 1 : 0), ownerId: t.accountId }));
        }
      }
    });
  });
  return out;
}

// The columns behind one entry: its date and its paid checkbox
function cumCells_(col, entry) {
  if (entry.part === 'main') return { date: col.date, paid: col.paid };
  if (entry.part === 'item') { const c = col.items[entry.item - 1]; return { date: c.separateDate, paid: c.separatePaid }; }
  if (entry.payment) { const c = col.payments[entry.payment - 1]; return { date: c.date, paid: entry.part === 'split' ? c.paid : c.received }; }
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
    const fields = { [c]: paid ? true : date };
    // Moving the payment itself: the splits and separately paid items that were following its date (their own date
    // is blank) stay on the old date, so they keep their own catch-up question instead of moving along with it
    if (!paid && entry.part === 'main') {
      const d = String(target.date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const old = d ? new Date(Number(d[3]), Number(d[1]) - 1, Number(d[2])) : null;
      if (old) {
        const hasSplits = target.items.some(i => i.splitId && i.splitId !== target.accountId && i.percent);
        if (hasSplits && data.col.splitDate && !target.splitDate) fields[data.col.splitDate] = old;
        target.items.forEach(i => {
          const ic = data.col.items[i.n - 1];
          if (i.separate && !i.separateDate && ic && ic.separateDate) fields[ic.separateDate] = old;
        });
      }
    }
    await update('cumTransactions', target.docId, fields);
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

// Add (no body.row) or edit (body.row + body.original { date, description }) one of this account's rent splits: a "Rent"
// transaction made of line items, each split with another account by a percent and paid with the rent or on its own day.
// body: { description, date (YYYY-MM-DD), splitDate (YYYY-MM-DD, or '' for the rent's date),
//         items: [{ n (its number when editing, else blank), description, amount (negative for a credit),
//                   splitId (10 digits or ''), percent (0-100), separate (true/false), separateDate (YYYY-MM-DD) }] }
// The items are saved as RENT ITEM 1..n in the order given; columns past the last item are cleared. Paid checkboxes stay.
async function saveRentSplit_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const day = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const date = day(body.date);
  if (!date) return { ok: false, error: 'invalid_date' };
  const splitDate = String(body.splitDate || '').trim() === '' ? '' : day(body.splitDate);
  if (splitDate === null) return { ok: false, error: 'invalid_date' };
  const description = cleanText_(body.description, 100);
  if (!description) return { ok: false, error: 'invalid_description' };
  const list = Array.isArray(body.items) ? body.items : [];
  if (!list.length || list.length > CUM_LINE_ITEMS) return { ok: false, error: 'invalid_items' };
  const items = [];
  for (const it of list) {
    const d = cleanText_((it || {}).description, 100);
    if (!d) return { ok: false, error: 'invalid_item_description' };
    const amount = Number(String(it.amount).replace(/[$,\s]/g, ''));
    if (String(it.amount).trim() === '' || !isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000) return { ok: false, error: 'invalid_item_amount' };
    const percent = it.percent == null || String(it.percent).trim() === '' ? 0 : Number(it.percent);
    if (!isFinite(percent) || percent < 0 || percent > 100) return { ok: false, error: 'invalid_split_percent' };
    const splitId = percent > 0 ? phoneToId_(it.splitId || '') : '';
    if (percent > 0 && (splitId.length !== 10 || splitId === id)) return { ok: false, error: 'invalid_split_id' };
    const separate = it.separate === true;
    const separateDate = separate ? day(it.separateDate) : '';
    if (separateDate === null) return { ok: false, error: 'invalid_separate_date' };
    items.push({ n: Number(it.n) || 0, description: d, amount: Math.round(amount * 100) / 100, splitId, percent: percent / 100, separate, separateDate });
  }
  return withLock('cumTransactions', async () => {
    const data = await cumTransactionRows_();
    const col = data.col;
    if (!col.type || !col.splitDate || col.items.some(c => !c.description || !c.amount || !c.splitId || !c.percent || !c.separate || !c.separateDate || !c.separatePaid)) {
      throw new Error('Transactions are missing a rent split column');
    }
    let target = null;
    if (body.row) {
      target = data.rows.filter(t => t.rowNumber === Number(body.row))[0];
      if (!target || target.accountId !== id || !target.items.length) return { ok: false, error: 'not_found' };
      const original = body.original || {};
      if (String(original.date).trim() !== target.date || String(original.description).trim() !== target.description) return { ok: false, error: 'changed' };
    }
    const fields = {};
    fields[col.date] = date;
    fields[col.description] = description;
    fields[col.splitDate] = splitDate;
    col.items.forEach((c, k) => {
      const it = items[k];
      // A separately paid item that was already paid stays paid (when it's still the same item, paid separately)
      const before = it && target ? target.items.filter(i => i.n === it.n)[0] : null;
      fields[c.description] = it ? it.description : '';
      fields[c.amount] = it ? it.amount : '';
      fields[c.splitId] = it ? it.splitId : '';
      fields[c.percent] = it && it.splitId ? it.percent : '';
      fields[c.separate] = it ? it.separate : '';
      fields[c.separateDate] = it ? it.separateDate : '';
      fields[c.separatePaid] = it ? (it.separate ? !!(before && before.separate && before.separatePaid) : false) : '';
    });
    if (target) {
      await update('cumTransactions', target.docId, fields);
      return { ok: true, row: target.rowNumber };
    }
    fields[col.id] = id;
    fields[col.amount] = '';
    fields[col.type] = (data.rows.filter(t => t.type.toLowerCase() === 'rent')[0] || {}).type || 'Rent';
    if (col.paid) fields[col.paid] = false;
    const made = await add('cumTransactions', fields);
    return { ok: true, row: made.order };
  });
}

// The account holder splits one person's share of a transaction into payments, each on its own day and checked off on
// its own. body: { row, person (10 digits), original (the payments as the edit menu got them, JSON),
//   payments: [{ date (YYYY-MM-DD), amount }] (set amounts), restDate (YYYY-MM-DD: the day the rest comes in) }
// Payments already checked off by either person stay as they are; the others are replaced. The rest is whatever the
// share comes to beyond the set amounts, so it follows the line items if they change later.
async function saveSplitPayments_(id, account, body) {
  if (!hasRole_(account, 'CUM')) return { ok: false, error: 'not_allowed' };
  const day = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const restDate = day(body.restDate);
  if (!restDate) return { ok: false, error: 'invalid_date' };
  const list = Array.isArray(body.payments) ? body.payments : [];
  const payments = [];
  for (const p of list) {
    const date = day((p || {}).date);
    if (!date) return { ok: false, error: 'invalid_date' };
    const amount = Math.round(Number(String(p.amount).replace(/[$,\s]/g, '')) * 100) / 100;
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid_payment_amount' };
    payments.push({ date, amount });
  }
  const person = phoneToId_(body.person || '');
  return withLock('cumTransactions', async () => {
    const data = await cumTransactionRows_();
    const col = data.col;
    if (!col.splitDate || col.payments.some(c => !c.date || !c.amount || !c.received || !c.paid)) throw new Error('Transactions are missing a split payment column');
    const target = data.rows.filter(r => r.rowNumber === Number(body.row))[0];
    if (!target || target.accountId !== id) return { ok: false, error: 'not_found' };
    // The share as it is now must be what the edit menu showed
    const entry = cumEntries_([target], id).filter(e => e.part === 'receive' && e.person === person)[0];
    if (!entry) return { ok: false, error: 'not_found' };
    if (JSON.stringify(entry.payments) !== String(body.original)) return { ok: false, error: 'changed' };
    const restBefore = entry.payments[entry.payments.length - 1];
    if (restBefore.locked) return { ok: false, error: 'rest_locked' };
    const kept = target.payments.filter(p => p.received || p.paid);
    const free = col.payments.filter(c => !kept.some(p => p.n === c.n));
    if (payments.length > free.length) return { ok: false, error: 'too_many_payments' };
    const rest = cumRound_(entry.total - kept.reduce((s, p) => s + p.amount, 0) - payments.reduce((s, p) => s + p.amount, 0));
    if (rest <= 0) return { ok: false, error: 'payments_too_big' };
    const fields = { [col.splitDate]: restDate };
    free.forEach((c, k) => {
      const p = payments[k];
      fields[c.date] = p ? p.date : '';
      fields[c.amount] = p ? p.amount : '';
      fields[c.received] = p ? false : '';
      fields[c.paid] = p ? false : '';
    });
    await update('cumTransactions', target.docId, fields);
    return { ok: true };
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

// The admin Usage card. propertyApis: each wholesaleStatus document (one per property API the wholesale deal
// extractor uses, written by it at the end of every run), in the order the extractor tries them. Values are as
// stored; times are text "YYYY-MM-DD HH:MM:SS", Phoenix time.
const PROPERTY_API_ORDER = ['REDFIN.COM DATA', 'REALTOR SEARCH', 'REDFIN BASE', 'REALTOR API DATA', 'US REALTOR'];
async function adminUsage_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const snap = await db.collection('wholesaleStatus').get();
  const place = id => { const i = PROPERTY_API_ORDER.indexOf(id); return i < 0 ? PROPERTY_API_ORDER.length : i; };
  const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const str = v => (v === undefined || v === null ? '' : String(v));
  const propertyApis = snap.docs.map(d => {
    const f = d.data();
    return {
      name: d.id, usage: num(f['USAGE']), cap: num(f['CAP']), source: str(f['USAGE SOURCE']), usageAsOf: str(f['USAGE AS OF']),
      requestsThisMonth: num(f['REQUESTS THIS MONTH']), countMonth: str(f['COUNT MONTH']), countedSince: str(f['COUNTED SINCE']),
      lastRequest: str(f['LAST REQUEST']), pausedUntil: str(f['PAUSED UNTIL']), checkedAt: str(f['CHECKED AT']),
      resetsAt: str(f['RESETS AT']),
    };
  }).sort((a, b) => place(a.name) - place(b.name) || a.name.localeCompare(b.name));
  // The extractor's Gemini usage and out-of-credits pause (apiStatus/GEMINI, written at the end of every run)
  const g = (await db.collection('apiStatus').doc('GEMINI').get()).data() || null;
  const gemini = g && {
    status: str(g['STATUS']), pausedUntil: str(g['PAUSED UNTIL']), outOfCreditsSince: str(g['OUT OF CREDITS SINCE']),
    requestsThisMonth: num(g['REQUESTS THIS MONTH']), inputTokensThisMonth: num(g['INPUT TOKENS THIS MONTH']),
    outputTokensThisMonth: num(g['OUTPUT TOKENS THIS MONTH']), countMonth: str(g['COUNT MONTH']),
    lastRequest: str(g['LAST REQUEST']), lastError: str(g['LAST ERROR']), lastErrorAt: str(g['LAST ERROR AT']),
    model: str(g['MODEL']), checkedAt: str(g['CHECKED AT']), retryRequestedAt: str(g['RETRY REQUESTED AT']),
  };
  return { ok: true, propertyApis, gemini };
}

// Settings > Gemini API > Try Again Now (after adding credits): ends the out-of-credits pause, so the extractor's
// next run (within 5 minutes) tries Gemini again. If the credits are still used up, it pauses again.
async function resumeGemini_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  await db.collection('apiStatus').doc('GEMINI').set({
    'PAUSED UNTIL': FieldValue.delete(),
    'RETRY REQUESTED AT': `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
  }, { merge: true });
  return { ok: true };
}

// --- Title Companies (settings.html, admins) ---
// One titleCompanies document per title / escrow company: its fees as filed with the state (Arizona: the company's
// "Manual of Escrow and Settlement Services" and its title insurance rate manual). Tables are lists of
// { 'UP TO': price, 'FEE': dollars }, lowest first; a price above the last row adds OVER TABLE FEE per OVER TABLE PER
// (or fraction). Shares are decimals (0.5 = half). Written straight to Firestore (the tables are lists of maps).
// Title insurance: OWNERS TITLE TABLE is the title rate manual's Basic Rate Table. The owner's policy is OWNERS POLICY
// PERCENT of it (on the price); a buyer's loan policy is LOAN POLICY PERCENT of it (on the loan amount), times
// SIMULTANEOUS LOAN PERCENT when issued with the owner's policy (at least SIMULTANEOUS LOAN MINIMUM), plus the lender's
// endorsements: LOAN ENDORSEMENT LIST [{ NAME, AMOUNT, WHEN }], WHEN saying which loans need it (every loan, a condo, a home in
// an HOA, an adjustable rate, a manufactured home). VA SELLER PAYS BUYER FEES: on a VA loan the seller pays the buyer's share
// of the escrow and recording fees. FINCEN FEE (+ FINCEN EXTRA ENTITY FEE): a FinCEN report for an entity or trust buying with
// cash. EXTRA LOAN ESCROW FEE / EXTRA LOAN POLICY FEE: per loan over one on a sale. CASH NO PAYOFF ADD ON: a cash sale's
// add-on when the seller has no loan to pay off (blank: the cash sale add-on). SHORT SALE / REO ESCROW TABLE (+ OVER FEE,
// OVER PER, SELLER SHARE): those sales' escrow fees, in place of the table and add-on (blank: the standard rate).
// The pages' TITLE COMPANY setting is a company's document ID; the fee math is in /title-fees.js.
// Refinance: a flat REFINANCE ESCROW FEE and REFINANCE RECORDING FEE, and the loan policy from REFINANCE TITLE TABLE (its own
// table, on the loan amount) times REFINANCE POLICY PERCENT, plus REFINANCE ENDORSEMENTS.
const TITLE_MONEY_MAX = 100000000;
function titleMoney_(v) {
  const s = String(v === null || v === undefined ? '' : v).replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 && n <= TITLE_MONEY_MAX ? Math.round(n * 100) / 100 : NaN;
}
function titleShare_(v, max = 1) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1e6) / 1e6 : NaN;
}
// A rate table: [{ 'UP TO', 'FEE' }] sorted by price, or an error code
function titleTable_(list, name) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, 100)) {
    const upTo = titleMoney_(r && r.upTo);
    const fee = titleMoney_(r && r.fee);
    if (upTo === null && fee === null) continue;
    if (!(upTo > 0) || fee === null || isNaN(fee)) return 'invalid_' + name;
    out.push({ 'UP TO': upTo, 'FEE': fee });
  }
  out.sort((a, b) => a['UP TO'] - b['UP TO']);
  if (out.some((r, i) => i && r['UP TO'] === out[i - 1]['UP TO'])) return 'invalid_' + name;
  return out;
}
// The rates a company can't be saved without (the Title Companies card's TITLE_REQUIRED, in /title-fees.js)
const TITLE_REQUIRED_COLUMNS = ['RATE MANUAL DATE', 'ESCROW RATE TABLE', 'ESCROW OVER TABLE FEE', 'ESCROW OVER TABLE PER', 'CASH SALE ADD ON',
  'LOAN SALE ADD ON', 'CASH NO PAYOFF ADD ON', 'SELLER SHARE OF ESCROW FEE', 'RECORDING SERVICE FEE', 'SELLER SHARE OF RECORDING FEE',
  'TITLE MANUAL DATE', 'OWNERS TITLE TABLE', 'OWNERS TITLE OVER TABLE FEE', 'OWNERS TITLE OVER TABLE PER', 'OWNERS POLICY PERCENT',
  'SELLER SHARE OF OWNERS POLICY', 'LOAN POLICY PERCENT', 'SIMULTANEOUS LOAN PERCENT', 'SIMULTANEOUS LOAN MINIMUM',
  'EXTRA LOAN ESCROW FEE', 'EXTRA LOAN POLICY FEE', 'FINCEN FEE', 'FINCEN EXTRA ENTITY FEE', 'SHORT SALE ESCROW TABLE', 'SHORT SALE OVER FEE',
  'SHORT SALE OVER PER', 'SHORT SALE SELLER SHARE', 'REO ESCROW TABLE', 'REO OVER FEE', 'REO OVER PER', 'REO SELLER SHARE',
  'REFINANCE ESCROW FEE', 'REFINANCE RECORDING FEE', 'REFINANCE TITLE TABLE', 'REFINANCE TITLE OVER FEE', 'REFINANCE TITLE OVER PER',
  'REFINANCE POLICY PERCENT', 'REFINANCE ENDORSEMENTS'];
// Who qualifies for a discount (a page's BUYER TYPE is one of the first seven), and whose share an owner's policy discount
// comes off (the same lists as /title-fees.js)
const BUYER_TYPES = ['Individual', 'Investor', 'Senior', 'Military / First Responder', 'Real Estate Agent', 'Public Servant', 'Church / Non-Profit', 'Corporate Relocation'];
const TITLE_DISCOUNT_CATEGORIES = BUYER_TYPES.slice(1).concat(['Prior Policy', 'Other']);
const TITLE_DISCOUNT_APPLIES = ['buyer', 'buyerPays', 'sellerPays', 'eitherPays', 'property'];
const TITLE_FEE_WHEN = ['Every Sale', 'With a Loan', 'Manufactured Home', 'Refinance', 'Sometimes'];
const TITLE_ENDORSEMENT_WHEN = ['Every Loan', 'Condo', 'HOA (PUD)', 'Adjustable Rate', 'Manufactured Home'];

function titleCompanyOut_(doc) {
  const f = doc.data();
  const num = v => (typeof v === 'number' ? v : v === undefined || v === null || v === '' ? null : Number(v));
  const table = t => (Array.isArray(t) ? t.map(r => ({ upTo: num(r['UP TO']), fee: num(r['FEE']) })) : []);
  return {
    id: doc.id,
    name: String(f['NAME'] || ''),
    manualDate: String(f['RATE MANUAL DATE'] || ''),
    notes: String(f['NOTES'] || ''),
    escrowTable: table(f['ESCROW RATE TABLE']),
    escrowOverFee: num(f['ESCROW OVER TABLE FEE']),
    escrowOverPer: num(f['ESCROW OVER TABLE PER']),
    cashSaleAddOn: num(f['CASH SALE ADD ON']),
    loanSaleAddOn: num(f['LOAN SALE ADD ON']),
    sellerEscrowShare: num(f['SELLER SHARE OF ESCROW FEE']),
    recordingFee: num(f['RECORDING SERVICE FEE']),
    sellerRecordingShare: num(f['SELLER SHARE OF RECORDING FEE']),
    // A discount's CATEGORY says who qualifies (a page's BUYER TYPE, or Prior Policy / Other); a title discount's APPLIES
    // says whose share it comes off (see /title-fees.js)
    discounts: Array.isArray(f['DISCOUNTS']) ? f['DISCOUNTS'].map(d => ({ name: String(d['NAME'] || ''), percent: num(d['PERCENT']), category: String(d['CATEGORY'] || '') })) : [],
    titleManualDate: String(f['TITLE MANUAL DATE'] || ''),
    ownerPolicyPercent: num(f['OWNERS POLICY PERCENT']),
    sellerOwnerShare: num(f['SELLER SHARE OF OWNERS POLICY']),
    loanPolicyPercent: num(f['LOAN POLICY PERCENT']),
    simultaneousPercent: num(f['SIMULTANEOUS LOAN PERCENT']),
    simultaneousMinimum: num(f['SIMULTANEOUS LOAN MINIMUM']),
    // (pages saved before the list had one flat LOAN ENDORSEMENTS amount, for every loan)
    loanEndorsementList: Array.isArray(f['LOAN ENDORSEMENT LIST'])
      ? f['LOAN ENDORSEMENT LIST'].map(d => ({ name: String(d['NAME'] || ''), amount: num(d['AMOUNT']), when: String(d['WHEN'] || '') }))
      : num(f['LOAN ENDORSEMENTS']) ? [{ name: 'Lender’s endorsements', amount: num(f['LOAN ENDORSEMENTS']), when: 'Every Loan' }] : [],
    vaSellerPays: f['VA SELLER PAYS BUYER FEES'] === true,
    fincenFee: num(f['FINCEN FEE']), fincenExtraFee: num(f['FINCEN EXTRA ENTITY FEE']),
    extraLoanEscrowFee: num(f['EXTRA LOAN ESCROW FEE']), extraLoanPolicyFee: num(f['EXTRA LOAN POLICY FEE']),
    cashNoPayoffAddOn: num(f['CASH NO PAYOFF ADD ON']),
    shortSaleTable: table(f['SHORT SALE ESCROW TABLE']), shortSaleOverFee: num(f['SHORT SALE OVER FEE']),
    shortSaleOverPer: num(f['SHORT SALE OVER PER']), shortSaleSellerShare: num(f['SHORT SALE SELLER SHARE']),
    reoTable: table(f['REO ESCROW TABLE']), reoOverFee: num(f['REO OVER FEE']), reoOverPer: num(f['REO OVER PER']),
    reoSellerShare: num(f['REO SELLER SHARE']),
    shortSaleNoRate: f['SHORT SALE NO SEPARATE RATE'] === true, reoNoRate: f['REO NO SEPARATE RATE'] === true,
    // Above the last row: 'per' (add OVER FEE per OVER PER), 'standardPlus' (the standard escrow fee + OVER FEE) or, for a
    // refinance, 'basicRate' (REFINANCE OVER PERCENT of the basic rate on the loan amount)
    shortSaleOverMode: String(f['SHORT SALE OVER MODE'] || 'per'), reoOverMode: String(f['REO OVER MODE'] || 'per'),
    refiOverMode: String(f['REFINANCE OVER MODE'] || 'per'), refiOverPercent: num(f['REFINANCE OVER PERCENT']),
    refiEscrowFee: num(f['REFINANCE ESCROW FEE']),
    refiRecordingFee: num(f['REFINANCE RECORDING FEE']),
    refiTable: table(f['REFINANCE TITLE TABLE']),
    refiOverFee: num(f['REFINANCE TITLE OVER FEE']),
    refiOverPer: num(f['REFINANCE TITLE OVER PER']),
    refiPolicyPercent: num(f['REFINANCE POLICY PERCENT']),
    refiEndorsements: num(f['REFINANCE ENDORSEMENTS']),
    titleDiscounts: Array.isArray(f['TITLE DISCOUNTS']) ? f['TITLE DISCOUNTS'].map(d => ({ name: String(d['NAME'] || ''), percent: num(d['PERCENT']),
      category: String(d['CATEGORY'] || ''), applies: String(d['APPLIES'] || 'property') })) : [],
    otherFees: Array.isArray(f['OTHER FEES']) ? f['OTHER FEES'].map(d => ({ name: String(d['NAME'] || ''), amount: num(d['AMOUNT']), sellerShare: num(d['SELLER SHARE']), when: String(d['WHEN'] || '') })) : [],
    titleTable: table(f['OWNERS TITLE TABLE']),
    titleOverFee: num(f['OWNERS TITLE OVER TABLE FEE']),
    titleOverPer: num(f['OWNERS TITLE OVER TABLE PER']),
    order: Number(f._order) || 0,
  };
}
async function titleCompanyList_() {
  const snap = await db.collection('titleCompanies').get();
  return snap.docs.map(titleCompanyOut_).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

async function titleCompanies_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  return { ok: true, companies: await titleCompanyList_() };
}

// Adds a company (no id) or replaces one's fees. body.company: the card's form, as titleCompanyOut_ gives it.
async function saveTitleCompany_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const c = body.company || {};
  const name = cleanText_(c.name, 100);
  if (!name) return { ok: false, error: 'missing_name' };
  const manualDate = String(c.manualDate || '').trim();
  if (manualDate && !/^\d{4}-\d{2}-\d{2}$/.test(manualDate)) return { ok: false, error: 'invalid_manual_date' };
  const escrowTable = titleTable_(c.escrowTable, 'escrow_table');
  if (typeof escrowTable === 'string') return { ok: false, error: escrowTable };
  if (!escrowTable.length) return { ok: false, error: 'missing_escrow_table' };
  const titleTable = titleTable_(c.titleTable, 'title_table');
  if (typeof titleTable === 'string') return { ok: false, error: titleTable };
  const refiTable = titleTable_(c.refiTable, 'refi_table');
  if (typeof refiTable === 'string') return { ok: false, error: refiTable };
  const shortSaleTable = titleTable_(c.shortSaleTable, 'short_sale_table');
  if (typeof shortSaleTable === 'string') return { ok: false, error: shortSaleTable };
  const reoTable = titleTable_(c.reoTable, 'reo_table');
  if (typeof reoTable === 'string') return { ok: false, error: reoTable };
  const fields = { 'NAME': name, 'ESCROW RATE TABLE': escrowTable, 'OWNERS TITLE TABLE': titleTable, 'REFINANCE TITLE TABLE': refiTable,
    'SHORT SALE ESCROW TABLE': shortSaleTable, 'REO ESCROW TABLE': reoTable };
  const moneyFields = { escrowOverFee: 'ESCROW OVER TABLE FEE', escrowOverPer: 'ESCROW OVER TABLE PER', cashSaleAddOn: 'CASH SALE ADD ON',
    loanSaleAddOn: 'LOAN SALE ADD ON', recordingFee: 'RECORDING SERVICE FEE', titleOverFee: 'OWNERS TITLE OVER TABLE FEE',
    titleOverPer: 'OWNERS TITLE OVER TABLE PER', simultaneousMinimum: 'SIMULTANEOUS LOAN MINIMUM',
    refiEscrowFee: 'REFINANCE ESCROW FEE', refiRecordingFee: 'REFINANCE RECORDING FEE', refiOverFee: 'REFINANCE TITLE OVER FEE',
    refiOverPer: 'REFINANCE TITLE OVER PER', refiEndorsements: 'REFINANCE ENDORSEMENTS',
    fincenFee: 'FINCEN FEE', fincenExtraFee: 'FINCEN EXTRA ENTITY FEE', extraLoanEscrowFee: 'EXTRA LOAN ESCROW FEE',
    extraLoanPolicyFee: 'EXTRA LOAN POLICY FEE', cashNoPayoffAddOn: 'CASH NO PAYOFF ADD ON',
    shortSaleOverFee: 'SHORT SALE OVER FEE', shortSaleOverPer: 'SHORT SALE OVER PER', reoOverFee: 'REO OVER FEE', reoOverPer: 'REO OVER PER' };
  for (const [k, col] of Object.entries(moneyFields)) {
    const v = titleMoney_(c[k]);
    if (Number.isNaN(v)) return { ok: false, error: 'invalid_' + k };
    fields[col] = v === null ? FieldValue.delete() : v;
  }
  // How each table charges above its last row (see titleCompanyOut_)
  const modes = {
    shortSale: c.shortSaleOverMode === 'standardPlus' ? 'standardPlus' : 'per',
    reo: c.reoOverMode === 'standardPlus' ? 'standardPlus' : 'per',
    refi: c.refiOverMode === 'basicRate' ? 'basicRate' : 'per',
  };
  const modeOf_ = col => (/^SHORT SALE/.test(col) ? modes.shortSale : /^REO/.test(col) ? modes.reo : /^REFINANCE/.test(col) ? modes.refi : 'per');
  if (modes.refi === 'basicRate' && (c.refiOverPercent === null || c.refiOverPercent === undefined || c.refiOverPercent === '')) return { ok: false, error: 'missing_rates', missing: ['REFINANCE OVER PERCENT'] };
  // Shares are 0-100%; the policy percents of the basic rate can be more than 100% (110% for a homeowner's policy)
  const shareFields = { sellerEscrowShare: ['SELLER SHARE OF ESCROW FEE', 1], sellerRecordingShare: ['SELLER SHARE OF RECORDING FEE', 1],
    sellerOwnerShare: ['SELLER SHARE OF OWNERS POLICY', 1], ownerPolicyPercent: ['OWNERS POLICY PERCENT', 3],
    loanPolicyPercent: ['LOAN POLICY PERCENT', 3], simultaneousPercent: ['SIMULTANEOUS LOAN PERCENT', 1],
    refiPolicyPercent: ['REFINANCE POLICY PERCENT', 3], shortSaleSellerShare: ['SHORT SALE SELLER SHARE', 1], reoSellerShare: ['REO SELLER SHARE', 1] };
  for (const [k, [col, max]] of Object.entries(shareFields)) {
    const v = titleShare_(c[k], max);
    if (Number.isNaN(v)) return { ok: false, error: 'invalid_' + k };
    fields[col] = v === null ? FieldValue.delete() : v;
  }
  // "Add $20 per $20,000" needs both numbers (or neither)
  for (const [fee, per] of [['ESCROW OVER TABLE FEE', 'ESCROW OVER TABLE PER'], ['OWNERS TITLE OVER TABLE FEE', 'OWNERS TITLE OVER TABLE PER'],
    ['REFINANCE TITLE OVER FEE', 'REFINANCE TITLE OVER PER'], ['SHORT SALE OVER FEE', 'SHORT SALE OVER PER'], ['REO OVER FEE', 'REO OVER PER']]) {
    const hasFee = typeof fields[fee] === 'number', hasPer = typeof fields[per] === 'number';
    // ($0 per $0 means no extra charge above the table; the other "above the last row" choices don't use $ per $)
    if (modeOf_(fee) !== 'per') continue;
    if (hasFee !== hasPer || (hasPer && !(fields[per] > 0) && fields[fee] !== 0)) return { ok: false, error: 'invalid_' + fee.toLowerCase().replace(/ /g, '_') };
  }
  fields['RATE MANUAL DATE'] = manualDate || FieldValue.delete();
  const titleManualDate = String(c.titleManualDate || '').trim();
  if (titleManualDate && !/^\d{4}-\d{2}-\d{2}$/.test(titleManualDate)) return { ok: false, error: 'invalid_manual_date' };
  fields['TITLE MANUAL DATE'] = titleManualDate || FieldValue.delete();
  const notes = String(c.notes || '').replace(/\r\n?/g, '\n').trim().replace(/^[=+\-@]+/, '').slice(0, 2000);
  fields['NOTES'] = notes || FieldValue.delete();
  const discounts = [];
  for (const d of (Array.isArray(c.discounts) ? c.discounts : []).slice(0, 30)) {
    const dn = cleanText_(d && d.name, 100);
    const pct = titleShare_(d && d.percent);
    if (!dn && pct === null) continue;
    if (!dn || pct === null || Number.isNaN(pct)) return { ok: false, error: 'invalid_discount' };
    discounts.push({ 'NAME': dn, 'PERCENT': pct, 'CATEGORY': TITLE_DISCOUNT_CATEGORIES.includes(d.category) ? d.category : 'Other' });
  }
  fields['DISCOUNTS'] = discounts;
  const titleDiscounts = [];
  for (const d of (Array.isArray(c.titleDiscounts) ? c.titleDiscounts : []).slice(0, 30)) {
    const dn = cleanText_(d && d.name, 100);
    const pct = titleShare_(d && d.percent);
    if (!dn && pct === null) continue;
    if (!dn || pct === null || Number.isNaN(pct)) return { ok: false, error: 'invalid_title_discount' };
    titleDiscounts.push({ 'NAME': dn, 'PERCENT': pct, 'CATEGORY': TITLE_DISCOUNT_CATEGORIES.includes(d.category) ? d.category : 'Other',
      'APPLIES': TITLE_DISCOUNT_APPLIES.includes(d.applies) ? d.applies : 'property' });
  }
  fields['TITLE DISCOUNTS'] = titleDiscounts;
  const otherFees = [];
  for (const d of (Array.isArray(c.otherFees) ? c.otherFees : []).slice(0, 50)) {
    const dn = cleanText_(d && d.name, 100);
    const amount = titleMoney_(d && d.amount);
    const share = titleShare_(d && d.sellerShare);
    if (!dn && amount === null) continue;
    if (!dn || amount === null || Number.isNaN(amount) || share === null || Number.isNaN(share)) return { ok: false, error: 'invalid_other_fee' };
    const when = TITLE_FEE_WHEN.includes(d.when) ? d.when : 'Sometimes';
    otherFees.push({ 'NAME': dn, 'AMOUNT': amount, 'SELLER SHARE': share, 'WHEN': when });
  }
  fields['OTHER FEES'] = otherFees;
  const endorsements = [];
  for (const d of (Array.isArray(c.loanEndorsementList) ? c.loanEndorsementList : []).slice(0, 30)) {
    const dn = cleanText_(d && d.name, 100);
    const amount = titleMoney_(d && d.amount);
    if (!dn) { if (amount === null) continue; return { ok: false, error: 'invalid_endorsement' }; }
    // (no price: the standard endorsement shows, counted as $0)
    if (Number.isNaN(amount) || !TITLE_ENDORSEMENT_WHEN.includes(d.when)) return { ok: false, error: 'invalid_endorsement' };
    endorsements.push({ 'NAME': dn, 'AMOUNT': amount, 'WHEN': d.when });
  }
  fields['LOAN ENDORSEMENT LIST'] = endorsements;
  fields['LOAN ENDORSEMENTS'] = FieldValue.delete();
  fields['VA SELLER PAYS BUYER FEES'] = c.vaSellerPays === true;

  // The "above the last row" choices
  fields['SHORT SALE OVER MODE'] = modes.shortSale;
  fields['REO OVER MODE'] = modes.reo;
  fields['REFINANCE OVER MODE'] = modes.refi;
  const refiOverPercent = titleShare_(c.refiOverPercent);
  if (Number.isNaN(refiOverPercent)) return { ok: false, error: 'invalid_refiOverPercent' };
  fields['REFINANCE OVER PERCENT'] = refiOverPercent === null ? FieldValue.delete() : refiOverPercent;
  // A short sale or REO with no separate rate uses the standard escrow fee (its table and share aren't needed)
  fields['SHORT SALE NO SEPARATE RATE'] = c.shortSaleNoRate === true;
  fields['REO NO SEPARATE RATE'] = c.reoNoRate === true;
  // Every rate is required (0 counts: none)
  const missing = TITLE_REQUIRED_COLUMNS.filter(col => {
    if ((c.shortSaleNoRate === true && /^SHORT SALE /.test(col)) || (c.reoNoRate === true && /^REO /.test(col))) return false;
    // "Standard fee plus $X" needs no "per"; "% of the basic rate" needs only its percent
    if (/ OVER (TABLE )?PER$/.test(col) && modeOf_(col) === 'standardPlus') return false;
    if (/^REFINANCE TITLE OVER /.test(col) && modes.refi === 'basicRate') return false;
    const v = fields[col];
    return Array.isArray(v) ? !v.length : v === undefined || v === null || v instanceof FieldValue;
  });
  if (missing.length) return { ok: false, error: 'missing_rates', missing };

  let id = String(c.id || '');
  if (id) {
    const ref = db.collection('titleCompanies').doc(id);
    if (!(await ref.get()).exists) return { ok: false, error: 'not_found' };
    await ref.update(fields);
  } else {
    const ref = db.collection('titleCompanies').doc();
    const data = {};
    Object.entries(fields).forEach(([k, v]) => { if (!(v instanceof FieldValue)) data[k] = v; });
    data._order = Date.now() * 1000;
    await ref.create(data);
    id = ref.id;
  }
  return { ok: true, id, companies: await titleCompanyList_() };
}

async function deleteTitleCompany_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const ref = db.collection('titleCompanies').doc(String(body.id || 'x'));
  if (!body.id || !(await ref.get()).exists) return { ok: false, error: 'not_found' };
  await ref.delete();
  return { ok: true, companies: await titleCompanyList_() };
}

// --- Marketing Points (settings.html, admins) ---
// One marketingPoints document per point: TITLE, DESCRIPTION, LINK and LINK TEXT (optional) and an optional image, saved in the
// Marketing Points Drive folder (IMAGE DRIVE FILE ID, IMAGE NAME). In the order they were added.
const MARKETING_FOLDER_ID = process.env.MARKETING_FOLDER_ID || '1Z4PRK8FDbLXMJNUQ-Iyf056X0hJjL-UX';
const MARKETING_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };
const MARKETING_IMAGE_MAX = 10 * 1024 * 1024;

async function marketingPointList_() {
  return (await rows('marketingPoints')).map(r => ({
    id: r._id,
    title: String(r['TITLE'] || '').trim(),
    description: String(r['DESCRIPTION'] || '').trim(),
    link: String(r['LINK'] || '').trim(),
    linkText: String(r['LINK TEXT'] || '').trim(),
    imageId: String(r['IMAGE DRIVE FILE ID'] || '').trim(),
    imageName: String(r['IMAGE NAME'] || '').trim(),
  }));
}

async function marketingPoints_(account) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  return { ok: true, points: await marketingPointList_() };
}

// Adds a point (no id) or changes one. image: { name, type, data (base64) } for a new picture; removeImage: true drops
// the picture from the point (the file stays in the Drive folder).
async function saveMarketingPoint_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const title = cleanText_(body.title, 100);
  // The description keeps its line breaks
  const description = String(body.description || '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().replace(/^[=+\-@]+/, '').slice(0, 2000);
  let link = String(body.link || '').trim().slice(0, 500);
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (!title) return { ok: false, error: 'missing_title' };
  if (!description) return { ok: false, error: 'missing_description' };
  if (link && !/^https?:\/\/[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(link)) return { ok: false, error: 'invalid_link' };
  // The words shown as the link (blank: the page shows the web address)
  const linkText = cleanText_(body.linkText, 100);
  if (linkText && !link) return { ok: false, error: 'missing_link' };

  const existing = body.id ? await getRow('marketingPoints', String(body.id)) : null;
  if (body.id && !existing) return { ok: false, error: 'not_found' };

  const fields = { 'TITLE': title, 'DESCRIPTION': description, 'LINK': link, 'LINK TEXT': linkText };
  if (body.image && body.image.data) {
    const type = String(body.image.type || '').toLowerCase();
    const ext = MARKETING_IMAGE_TYPES[type];
    if (!ext) return { ok: false, error: 'invalid_image' };
    const bytes = Buffer.from(String(body.image.data), 'base64');
    if (!bytes.length || bytes.length > MARKETING_IMAGE_MAX) return { ok: false, error: 'image_too_big' };
    const safeTitle = title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60).trim() || 'Marketing Point';
    const name = safeTitle + ' ' + new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }) + '.' + ext;
    const file = await createDriveFile(MARKETING_FOLDER_ID, name, type, bytes);
    fields['IMAGE DRIVE FILE ID'] = file.id;
    fields['IMAGE NAME'] = name;
  } else if (body.removeImage) {
    fields['IMAGE DRIVE FILE ID'] = '';
    fields['IMAGE NAME'] = '';
  }
  let id = existing ? existing._id : '';
  if (existing) await update('marketingPoints', id, fields);
  else id = (await add('marketingPoints', fields)).id;
  return { ok: true, id, points: await marketingPointList_() };
}

// Deletes a point (its picture stays in the Drive folder)
async function deleteMarketingPoint_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const existing = body.id ? await getRow('marketingPoints', String(body.id)) : null;
  if (!existing) return { ok: false, error: 'not_found' };
  await remove('marketingPoints', existing._id);
  return { ok: true, points: await marketingPointList_() };
}

// A point's picture, web-sized (only pictures that belong to a point)
async function marketingPointImage_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const imageId = String(body.imageId || '');
  if (!imageId || !(await marketingPointList_()).some(p => p.imageId === imageId)) return { ok: false, error: 'not_found' };
  return wholesaleImage_(imageId, Math.min(1600, Math.max(200, Number(body.width) || 640)));
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

// Admins: what the property APIs know about an address (body.address: { street, city, state, zip })
async function propertyFacts_(account, body) {
  if (!isAdmin_(account)) return { ok: false, error: 'not_admin' };
  const a = body.address || {};
  const address = { street: cleanText_(a.street, 120), city: cleanText_(a.city, 120), state: cleanText_(a.state, 20), zip: cleanText_(a.zip, 10) };
  if (!address.street || !address.zip) return { ok: false, error: 'missing_address' };
  const { facts, sources } = await lookupPropertyFacts(address);
  return { ok: true, facts, sources };
}

// Seller Net: everything the net sheet needs that isn't the seller's own (Client Input) or asked above (address, type,
// sale price), sent by the New Seller Net form as body.fields and checked as in PAGE_SETTING_FIELDS. All are required.
// (The HOA fees are only needed once the seller says there's an HOA, so they're filled in later from Settings.)
// LOAN TYPE "No Loan": the loan payoff answers (SELLER_NET_LOAN_FIELDS) aren't asked, and aren't saved.
const SELLER_NET_LOAN_FIELDS = ['ORIGINAL LOAN AMOUNT', 'ORIGINAL LOAN DATE', 'LOAN TERM MONTHS', 'ESTIMATED INTEREST RATE',
  'RECORDING FEE', 'RECORDING FEE STATUS', 'PAYOFF STATEMENT FEE', 'PAYOFF STATEMENT FEE STATUS',
  'OTHER LOAN PAYOFF FEES %', 'OTHER LOAN PAYOFF FEES $', 'OTHER LOAN PAYOFF FEES STATUS'];
const SELLER_NET_CREATE_FIELDS = ['BEDS', 'BATHS', 'SQFT', 'YEAR BUILT', 'YEARLY TAXES', 'SELLER CREDIT',
  'OFFER ACCEPTANCE DATE', 'ESCROW DURATION', 'LOAN TYPE'].concat(SELLER_NET_LOAN_FIELDS, ['TITLE COMPANY', 'SELLER PAID BUYER COMMISSION %', 'SELLER PAID BUYER COMMISSION $',
  'LISTING AGENT COMMISSION %', 'LISTING AGENT COMMISSION $']);

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

  // Seller Net from the New Seller Net form: every required answer, checked
  const asked = {};
  if (isSellerNet && body.fields) {
    const noLoan = cleanSetting_(PAGE_SETTING_FIELDS['LOAN TYPE'], body.fields['LOAN TYPE']) === 'No Loan';
    for (const column of SELLER_NET_CREATE_FIELDS) {
      if (noLoan && SELLER_NET_LOAN_FIELDS.includes(column)) continue;
      const v = cleanSetting_(PAGE_SETTING_FIELDS[column], body.fields[column]);
      if (v === null) return { ok: false, error: 'invalid_' + column.toLowerCase().replace(/[^a-z0-9]+/g, '_') };
      if (v === '') return { ok: false, error: 'missing_' + column.toLowerCase().replace(/[^a-z0-9]+/g, '_') };
      asked[column] = v;
    }
  }

  // Seller Net: the sale, the HOA, and the seller's costs (the loan payoff is filled in later from Settings)
  // The title company: the form's pick (Seller Net) or the first one (Buyer Breakdown); none on file keeps the old rates
  const companies = await titleCompanyList_();
  const defaultTitleCompany = companies.length ? companies[0].id : '';
  if (isSellerNet && !companies.some(c => c.id === asked['TITLE COMPANY'])) return { ok: false, error: 'invalid_title_company' };
  const values = isSellerNet ? {
    'PAGE TYPE': 'Seller Net',
    // A new seller always starts out Nurturing
    'LISTING STATUS': 'Nurturing',
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
    // Placeholders: the seller pays every HOA fee, and both commissions start at 2.5%; escrow and title come from the
    // title company the form asks for, assuming a buyer with a fixed-rate loan
    'SELLER CREDIT': 0,
    'SALE TYPE': 'Standard',
    'BUYER FINANCING': 'Fixed Rate Loan',
    // Buyer Inputs (the buyer's side): the first loan product, 80% loan, the Buyer Breakdown's insurance placeholder
    'BUYER LOAN PRODUCT': String(((await rows('loanProducts'))[0] || {})['LOAN PRODUCT NAME'] || '').trim(),
    'RETAIL LTV': 0.8,
    'HOMEOWNERS INSURANCE RATE': 0.0035,
    'LENDER POINTS PURCHASED': 0,
    'EARNEST MONEY DEPOSIT': 0,
    'GIFT FUNDS': 0,
    'BUYERS AGENT COMMISSION %': 0,
    'BUYERS AGENT COMMISSION $': 0,
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
    ...asked,
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
    // Escrow and title come from the first title company (Settings), for a standard sale
    ...(defaultTitleCompany ? { 'TITLE COMPANY': defaultTitleCompany, 'SALE TYPE': 'Standard' }
      : { 'ESCROW FEE RATE': 0.002, 'OWNERS TITLE RATE': 0, 'ALTA TITLE RATE': 0.004 }),
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
  // Buyer Breakdown and Seller Net: every title company's filed rates (they're public filings)
  if (['buyer breakdown', 'seller net'].includes(result.pageType.toLowerCase())) {
    try {
      result.titleCompanies = (await titleCompanyList_()).map(({ notes, order, ...c }) => c);
    } catch (err) {
      console.error(err);
      result.titleCompanies = [];
    }
  }
  // Seller Net: every version the viewer can see (this one included), for the version dropdown
  if (result.pageType.toLowerCase() === 'seller net') {
    // The buyer's side of the escrow breakdown: the loan products and today's rate, like a Buyer Breakdown
    result.loanProducts = await rows('loanProducts');
    result.interestRate = (await rows('settings')).find(r => r._id === 'interestRate') || null;
    result.versions = (await sellerNetVersions_(page)).filter(p => isAdmin || isOnPage_(p, id)).map(p => ({ page: p }));
  }
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
    result.titleCompanies = (await titleCompanyList_()).map(c => ({ id: c.id, name: c.name }));
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
