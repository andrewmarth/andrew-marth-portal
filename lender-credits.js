// A loan product's lender credits: the list a lender sets up in the loan product form (/loan-products.js) and the
// Buyer Breakdown (pages.html) applies. Each credit has a description, when it applies (a condition, and what that
// condition needs), a type (a percent of the loan amount or the purchase price, or a flat dollar amount) and an amount.
// Saved as LENDER CREDITS: JSON [{ NAME, WHEN, VALUE, TYPE, AMOUNT }] (AMOUNT a decimal for a percent, dollars for a
// flat amount; VALUE as the condition needs, or none). The API keeps its own copy of these lists (api/portal.js:
// CREDIT_*), so a change here goes there too.
import { CENSUS_DESIGNATIONS, PROFESSION_GROUPS, groupList, yearsWithoutHome } from '/dpa.js';

// When a credit applies, and what each condition needs (input):
//   none: nothing   census: designations ([names])   money: dollars   score: a credit score (300-850)
//   years: whole years without owning a home   groups: professions / groups ([names])
export const CREDIT_CONDITIONS = [
    { when: 'Always', input: 'none' },
    { when: 'Census Designation', input: 'census', label: 'Census Designations' },
    { when: 'Below Certain Income', input: 'money', label: 'Household Income Limit (a year)' },
    { when: 'Minimum Credit Score', input: 'score', label: 'Minimum Credit Score' },
    { when: 'First Time Homebuyer', input: 'years', label: 'How long they must NOT have owned a home' },
    { when: 'Homebuyer Education Class', input: 'none' },
    { when: 'Home Price Below Certain Amount', input: 'money', label: 'Maximum Purchase Price' },
    { when: 'Profession/Group Specific', input: 'groups', label: 'Professions / Groups' },
];
export const creditConditionOf = when => CREDIT_CONDITIONS.find(c => c.when === when) || null;
export const CREDIT_TYPES = ['Percent Of Loan Amount', 'Percent Of Purchase Price', 'Flat Dollar Amount'];
export const isPercentCredit = type => type !== 'Flat Dollar Amount';
export { CENSUS_DESIGNATIONS, PROFESSION_GROUPS };

const text = v => String(v === undefined || v === null ? '' : v).trim();
const num = v => { const n = Number(text(v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0; };
const isTrue = v => text(v).toUpperCase() === 'TRUE';

// LENDER CREDITS → [{ name, when, value, type, amount }] (only complete ones)
export function lenderCreditList(raw) {
    let list;
    try { list = JSON.parse(text(raw) || '[]'); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    return list.map(c => {
        const cond = creditConditionOf(text(c && c.WHEN));
        if (!cond || !CREDIT_TYPES.includes(text(c.TYPE))) return null;
        let value = null;
        if (cond.input === 'census') value = groupList(c.VALUE, CENSUS_DESIGNATIONS);
        else if (cond.input === 'groups') value = groupList(c.VALUE);
        else if (cond.input !== 'none') value = num(c.VALUE);
        if (cond.input !== 'none' && !(Array.isArray(value) ? value.length : value > 0)) return null;
        const amount = num(c.AMOUNT);
        return amount > 0 && text(c.NAME) ? { name: text(c.NAME), when: cond.when, value, type: text(c.TYPE), amount } : null;
    }).filter(Boolean);
}

/**
 * A product's lender credits (get(column) → its value): its LENDER CREDITS, or (a product saved before that list) its old
 * columns as credits: LENDER CREDIT % OF PURCHASE PRICE, % OF LOAN AMOUNT and FLAT $, and ADDITIONAL LENDER CREDIT
 * (always), and its census credits (CENSUS CREDIT <designation> with CENSUS CREDIT % <designation>: a percent of the loan
 * amount; designations with the same percent share one credit).
 */
export function productLenderCredits(get) {
    if (text(get('LENDER CREDITS'))) return lenderCreditList(get('LENDER CREDITS'));
    const out = [];
    const always = (name, type, amount) => { if (amount > 0) out.push({ name, when: 'Always', value: null, type, amount }); };
    always('Lender Credit', 'Percent Of Purchase Price', num(get('LENDER CREDIT % OF PURCHASE PRICE')));
    always('Lender Credit', 'Percent Of Loan Amount', num(get('LENDER CREDIT % OF LOAN AMOUNT')));
    always('Lender Credit', 'Flat Dollar Amount', num(get('LENDER CREDIT FLAT $')));
    always('Additional Lender Credit', 'Flat Dollar Amount', num(get('ADDITIONAL LENDER CREDIT')));
    const byPct = new Map();
    CENSUS_DESIGNATIONS.forEach(d => {
        const pct = num(get('CENSUS CREDIT % ' + d.toUpperCase()));
        if (isTrue(get('CENSUS CREDIT ' + d.toUpperCase())) && pct > 0) byPct.set(pct, (byPct.get(pct) || []).concat(d));
    });
    byPct.forEach((designations, pct) => out.push({ name: 'Census Designation Credit', when: 'Census Designation', value: designations, type: 'Percent Of Loan Amount', amount: pct }));
    return out;
}

// What a credit comes to for this loan amount and price
export const creditAmount = (c, { loan, price }) => Math.round((c.type === 'Percent Of Loan Amount' ? loan * c.amount : c.type === 'Percent Of Purchase Price' ? price * c.amount : c.amount) * 100) / 100;

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const pctText = n => String(Number((n * 100).toFixed(3))) + '%';
const listText = list => (list.length < 3 ? list.join(' or ') : list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1]);
// "1.75% of the loan amount", "$500"
export const creditTerms = c => (c.type === 'Flat Dollar Amount' ? money(c.amount) : pctText(c.amount) + ' of the ' + (c.type === 'Percent Of Loan Amount' ? 'loan amount' : 'purchase price'));
// Who it's for, in a few words ('' when it always applies)
export function conditionText(c) {
    const v = c.value;
    switch (c.when) {
        case 'Census Designation': return 'homes in ' + listText(v) + ' census tracts';
        case 'Below Certain Income': return 'households earning ' + money(v) + ' or less a year';
        case 'Minimum Credit Score': return 'credit scores of ' + v + ' or higher';
        case 'First Time Homebuyer': return 'first-time homebuyers (no home owned in ' + v + ' year' + (v === 1 ? '' : 's') + ')';
        case 'Homebuyer Education Class': return 'buyers who take a homebuyer education class';
        case 'Home Price Below Certain Amount': return 'homes priced at ' + money(v) + ' or less';
        case 'Profession/Group Specific': return listText(v);
        default: return '';
    }
}

/**
 * Whether a credit applies to this purchase: { status, note }
 *   'applies'  it does
 *   'pending'  it would once something's filled in or done (note: what)
 *   'no'       it doesn't (note: why)
 * ctx: price, census (the page's designation, '' if not set), purchasers ([{ name, score, groups, lastOwned, education,
 * monthlyIncome }], as for down payment assistance; null on a page without them, like a Seller Net's buyer side, where
 * conditions about the buyers don't apply), score (the credit score the rate uses, for a page without purchasers),
 * thisYear (for first-time homebuyers; default this year)
 */
export function creditCheck(c, { price, census, purchasers = null, score = null, thisYear } = {}) {
    const people = Array.isArray(purchasers) && purchasers.length ? purchasers : null;
    const v = c.value;
    const noBuyers = { status: 'no', note: 'It depends on the buyers, who aren’t on this page' };
    switch (c.when) {
        case 'Always': return { status: 'applies', note: '' };
        case 'Census Designation':
            if (!census) return { status: 'pending', note: 'Applies once the home’s census designation is set (' + listText(v) + ' tracts)' };
            return v.some(d => d.toLowerCase() === census.toLowerCase()) ? { status: 'applies', note: '' } : { status: 'no', note: 'This home’s census tract is ' + census };
        case 'Home Price Below Certain Amount':
            return price <= v ? { status: 'applies', note: '' } : { status: 'no', note: 'The price is over ' + money(v) };
        case 'Below Certain Income': {
            if (!people) return noBuyers;
            if (people.some(p => p.monthlyIncome === null)) return { status: 'pending', note: 'Applies if the household earns ' + money(v) + ' or less a year (not every purchaser’s income is in yet)' };
            const yearly = people.reduce((s, p) => s + p.monthlyIncome, 0) * 12;
            return yearly <= v ? { status: 'applies', note: '' } : { status: 'no', note: 'The household’s ' + money(yearly) + ' yearly income is over ' + money(v) };
        }
        case 'Minimum Credit Score': {
            if (!people) return score !== null && score >= v ? { status: 'applies', note: '' } : { status: 'no', note: 'The ' + (score === null ? 'credit score isn’t known' : score + ' credit score is below ' + v) };
            const low = people.filter(p => p.score !== null && p.score < v);
            if (low.length) return { status: 'no', note: low.map(p => p.name || 'A purchaser').join(' and ') + (low.length > 1 ? ' are' : ' is') + ' below a ' + v + ' credit score' };
            return people.some(p => p.score === null) ? { status: 'pending', note: 'Applies with ' + v + ' credit scores or higher (not every purchaser has one on file)' } : { status: 'applies', note: '' };
        }
        case 'First Time Homebuyer': {
            if (!people) return noBuyers;
            const years = people.map(p => yearsWithoutHome(p.lastOwned, thisYear));
            if (years.some(y => y !== null && y < v)) return { status: 'no', note: 'A purchaser has owned a home in the last ' + v + ' year' + (v === 1 ? '' : 's') };
            return years.some(y => y === null) ? { status: 'pending', note: 'Applies for first-time homebuyers (not every purchaser has said when they last owned a home)' } : { status: 'applies', note: '' };
        }
        case 'Homebuyer Education Class':
            if (!people) return noBuyers;
            return people.some(p => p.education) ? { status: 'applies', note: '' } : { status: 'pending', note: 'Applies once a purchaser takes a homebuyer education class' };
        case 'Profession/Group Specific':
            if (!people) return noBuyers;
            if (people.some(p => (p.groups || []).some(g => v.includes(g)))) return { status: 'applies', note: '' };
            // (nobody has said which groups they're in yet: it could still apply)
            return people.some(p => (p.groups || []).length) ? { status: 'no', note: 'For ' + listText(v) + ' only' }
                : { status: 'pending', note: 'Applies for ' + listText(v) + ' (purchasers add theirs in Settings)' };
        default: return { status: 'no', note: '' };
    }
}
