// Down Payment Assistance (DPA) products: the lists their questions choose from, reading a product's answers, its amount
// on a Buyer Breakdown, and the qualification checks behind the page's disclaimers. Used by the loan product form
// (/loan-products.js), Settings (a client's own details) and the Buyer Breakdown (pages.html). The API keeps its own
// copy of these lists (api/portal.js: DPA_*), so a change here goes there too.

// Loan Type (DPA LOAN TYPE): what kind of help it is
//   Deferred Silent Second: a second loan with no payment, repaid when the home is sold, refinanced or paid off
//   Forgivable Silent Second: a second loan with no payment, forgiven after the buyer lives there FORGIVEN AFTER YEARS
//   Second Mortgage: a second loan with a monthly payment (SECOND LOAN TERM years, at the first loan's rate or a markup
//     from it: SAME RATE AS FIRST LOAN / SECOND LOAN RATE MARKUP)
//   Grant: money that isn't repaid (no lien), from GRANT TYPE
export const DPA_LOAN_TYPES = ['Deferred Silent Second', 'Forgivable Silent Second', 'Second Mortgage', 'Grant'];
export const GRANT_TYPES = ['Arizona Department of Housing', 'Individual Development Accounts', 'Profession/Group-Specific'];
// SECOND LOAN AMOUNT TYPE: a share of the price (SECOND LOAN LTV MAX) or a set amount (SECOND LOAN FLAT AMOUNT)
export const DPA_AMOUNT_TYPES = ['Percentage', 'Flat Dollar Amount'];
export const PERCENTAGE = 'Percentage', FLAT = 'Flat Dollar Amount';

// Professions and groups a program can be for (ELIGIBLE GROUPS), and a client can belong to (PROFESSION GROUPS)
export const PROFESSION_GROUPS = ['Teacher', 'Firefighter', 'Law Enforcement', 'EMTs',
    'Healthcare Worker (Anyone employed by a healthcare provider)', 'Healthcare Worker (Any clinical role)',
    'Healthcare Professional (Qualified physician)', 'Veteran (With benefits)', 'Veteran (Without benefits)',
    'Legally Disabled', 'Native American'];

// Census designations (a page's CENSUS DESIGNATION)
export const CENSUS_DESIGNATIONS = ['Low', 'Moderate', 'Middle', 'Upper'];

// A program's qualifications (DPA QUALIFICATIONS: JSON [{ TYPE, VALUE }], each type at most once). input: what VALUE is
//   money: dollars (a household's yearly income, or the price)   census: designations ([names])
//   score: a credit score (300-850)   years: whole years   none: no VALUE
export const QUALIFICATIONS = [
    { type: 'Income Limit', input: 'money', label: 'Household Income Limit (a year)' },
    { type: 'Census Designation', input: 'census', label: 'Census Designations Allowed' },
    { type: 'Minimum Credit Score', input: 'score', label: 'Minimum Credit Score' },
    { type: 'First Time Homebuyer', input: 'years', label: 'How long they must NOT have owned a home' },
    { type: 'Homebuyer Education Class', input: 'none', label: '' },
    { type: 'Home Price Maximum', input: 'money', label: 'Maximum Purchase Price' },
];
export const qualificationOf = type => QUALIFICATIONS.find(q => q.type === type) || null;

const text = v => String(v === undefined || v === null ? '' : v).trim();
const num = v => { const n = Number(text(v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0; };
const isTrue = v => text(v).toUpperCase() === 'TRUE';
const parse = raw => { try { return JSON.parse(text(raw) || 'null'); } catch (e) { return null; } };

// A JSON list of names (ELIGIBLE GROUPS, PROFESSION GROUPS) → the known names in it, in the list's own order
export function groupList(raw, known = PROFESSION_GROUPS) {
    const list = Array.isArray(raw) ? raw : parse(raw);
    if (!Array.isArray(list)) return [];
    const picked = new Set(list.map(text));
    return known.filter(g => picked.has(g));
}

// DPA QUALIFICATIONS → [{ type, value }] (value: a number, a list of designations, or null), in QUALIFICATIONS' order
export function dpaQualifications(raw) {
    const list = parse(raw);
    if (!Array.isArray(list)) return [];
    const out = [];
    QUALIFICATIONS.forEach(q => {
        const found = list.find(r => r && text(r.TYPE) === q.type);
        if (!found) return;
        if (q.input === 'none') out.push({ type: q.type, value: null });
        else if (q.input === 'census') { const v = groupList(found.VALUE, CENSUS_DESIGNATIONS); if (v.length) out.push({ type: q.type, value: v }); }
        else if (num(found.VALUE) > 0) out.push({ type: q.type, value: num(found.VALUE) });
    });
    return out;
}

// A DPA product's answers (get(column) → its value). A product saved before these questions reads as a deferred silent
// second for a share of the price that can't go past the price, with no rate markup and no qualifications.
export function dpaInfo(get) {
    const loanType = DPA_LOAN_TYPES.includes(text(get('DPA LOAN TYPE'))) ? text(get('DPA LOAN TYPE')) : DPA_LOAN_TYPES[0];
    const grantType = loanType === 'Grant' && GRANT_TYPES.includes(text(get('GRANT TYPE'))) ? text(get('GRANT TYPE')) : '';
    const groupSpecific = loanType === 'Grant' ? grantType === 'Profession/Group-Specific' : (loanType !== 'Second Mortgage' && isTrue(get('GROUP SPECIFIC')));
    return {
        loanType, grantType,
        isGrant: loanType === 'Grant',
        hasPayment: loanType === 'Second Mortgage',
        adjustable: isTrue(get('SECOND LOAN ADJUSTABLE BY CLIENT')),
        flat: text(get('SECOND LOAN AMOUNT TYPE')) === FLAT,
        ltvMax: num(get('SECOND LOAN LTV MAX')),
        flatAmount: num(get('SECOND LOAN FLAT AMOUNT')),
        canExceed: isTrue(get('COMBINED LOANS CAN EXCEED PRICE')),
        refund: isTrue(get('COMBINED LOANS CAN EXCEED PRICE')) && isTrue(get('EXCESS REFUNDED TO BUYER')),
        rateMarkup: isTrue(get('AFFECTS FIRST LOAN RATE')) ? num(get('FIRST LOAN RATE MARKUP')) : 0,
        forgivenYears: loanType === 'Forgivable Silent Second' ? num(get('FORGIVEN AFTER YEARS')) : 0,
        termYears: loanType === 'Second Mortgage' ? num(get('SECOND LOAN TERM')) : 0,
        // (a markup can be negative: a lower rate than the first loan's)
        secondMarkup: loanType === 'Second Mortgage' && !isTrue(get('SAME RATE AS FIRST LOAN')) ? Number(text(get('SECOND LOAN RATE MARKUP'))) || 0 : 0,
        matchRatio: grantType === 'Individual Development Accounts' ? num(get('IDA MATCH RATIO')) : 0,
        groups: groupSpecific ? groupList(get('ELIGIBLE GROUPS')) : [],
        quals: dpaQualifications(get('DPA QUALIFICATIONS')),
    };
}

// The most it can be for this price: its share of the price, or its flat amount
export const dpaMax = (info, price) => (info.flat ? info.flatAmount : Math.round(price * info.ltvMax));

// A client's LAST OWNED HOME: 'Never', or the year they last owned one ('' when they haven't said)
export function yearsWithoutHome(raw, thisYear = new Date().getFullYear()) {
    const v = text(raw);
    if (!v) return null;
    if (v.toLowerCase() === 'never') return Infinity;
    const y = Number(v);
    return Number.isInteger(y) && y > 1900 ? Math.max(0, thisYear - y) : null;
}

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const nameOf = p => p.name || 'A purchaser';
const listText = list => (list.length < 3 ? list.join(' or ') : list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1]);

/**
 * The program's qualifications this purchase doesn't meet (or can't be checked yet), as disclaimers. buyer:
 *   price, census (the page's designation, '' if not set)
 *   purchasers: [{ name, score (null: none on file), groups: [names], lastOwned (LAST OWNED HOME), education (bool),
 *     monthlyIncome (null: not entered) }] (none on a page that can't tell: only the price and census checks run)
 */
export function dpaDisclaimers(info, { price, census, purchasers = null, thisYear } = {}) {
    const out = [];
    const people = Array.isArray(purchasers) ? purchasers : null;
    if (info.groups.length && people) {
        if (!people.some(p => p.groups.some(g => info.groups.includes(g)))) {
            out.push('For ' + listText(info.groups) + ' only, and no purchaser has said they’re in one of those groups');
        }
    }
    info.quals.forEach(q => {
        if (q.type === 'Home Price Maximum' && price > q.value) out.push('The price is over this program’s ' + money(q.value) + ' maximum');
        if (q.type === 'Census Designation') {
            if (!census) out.push('Only for homes in ' + listText(q.value) + ' census tracts, and this home’s census designation isn’t set');
            else if (!q.value.some(d => d.toLowerCase() === census.toLowerCase())) out.push('Only for homes in ' + listText(q.value) + ' census tracts (this one is ' + census + ')');
        }
        if (!people) return;
        if (q.type === 'Income Limit') {
            if (people.some(p => p.monthlyIncome === null)) out.push('Has a ' + money(q.value) + ' household income limit, and not every purchaser’s income is in yet');
            else {
                const yearly = people.reduce((s, p) => s + p.monthlyIncome, 0) * 12;
                if (yearly > q.value) out.push('The household’s ' + money(yearly) + ' yearly income is over this program’s ' + money(q.value) + ' limit');
            }
        }
        if (q.type === 'Minimum Credit Score') {
            const low = people.filter(p => p.score !== null && p.score < q.value);
            if (low.length) out.push(low.map(nameOf).join(' and ') + (low.length > 1 ? ' are' : ' is') + ' below this program’s ' + q.value + ' minimum credit score');
            else if (people.some(p => p.score === null)) out.push('Needs a ' + q.value + ' credit score or higher, and not every purchaser has one on file');
        }
        if (q.type === 'First Time Homebuyer') {
            const years = people.map(p => yearsWithoutHome(p.lastOwned, thisYear));
            const owned = people.filter((p, i) => years[i] !== null && years[i] < q.value);
            if (owned.length) out.push('For first-time homebuyers (no home owned in the last ' + q.value + ' year' + (q.value === 1 ? '' : 's') + '), and ' + owned.map(nameOf).join(' and ') + (owned.length > 1 ? ' have' : ' has') + ' owned one since');
            else if (years.some(y => y === null)) out.push('For first-time homebuyers (no home owned in the last ' + q.value + ' year' + (q.value === 1 ? '' : 's') + '), and not every purchaser has said when they last owned one');
        }
        if (q.type === 'Homebuyer Education Class' && !people.some(p => p.education)) out.push('Requires a homebuyer education class, which no purchaser has taken yet');
    });
    return out;
}

// What kind of help it is, in a few words (for notes and pickers)
export function dpaKindText(info) {
    if (info.isGrant) return info.grantType ? info.grantType + ' grant' : 'Grant';
    if (info.loanType === 'Forgivable Silent Second') return 'Forgivable silent second' + (info.forgivenYears ? ', forgiven after ' + info.forgivenYears + ' years' : '');
    if (info.loanType === 'Second Mortgage') return 'Second mortgage' + (info.termYears ? ' over ' + info.termYears + ' years' : '');
    return 'Deferred silent second';
}
