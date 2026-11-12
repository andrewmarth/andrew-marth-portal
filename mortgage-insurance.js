// Mortgage insurance by a loan product's PRODUCT TYPE, for the loan product form (/loan-products.js) and the Buyer
// Breakdown and Seller Net pages (pages.html).
//
//   FHA: every FHA loan has an upfront mortgage insurance premium (UFMIP) of 1.75% of the base loan (set by HUD, not the
//     lender), plus HUD's annual MIP (fhaAnnualMip), paid monthly.
//   VA: no mortgage insurance, but the VA funding fee: a percent of the loan from the VA's chart by down payment, one chart
//     for a veteran's first use of a VA loan and one for any later use (VA_FUNDING_FEES). Whether a purchaser is a
//     veteran and has used a VA loan before is on their account (VETERAN, VA LOAN USED; Settings > Edit Clients > Other).
//   Conventional, and a Jumbo or Non-Conforming product that has mortgage insurance guidelines (NO MI GUIDELINES isn't
//     TRUE): the lender quotes the annual premium (a percent of the loan each year) for 27 scenarios, the same credit
//     scores and DTIs as the rate quotes but LTVs of 85%, 90% and 95% (a loan at 80% LTV or less has no mortgage
//     insurance). MI QUOTES: JSON { QUOTES: [27 decimals] }, in the rate quotes' order (credit score outermost). They're
//     split into a starting premium plus one adjustment per metric, each on a curve, exactly like the rate markups
//     (markupModel in /rate-markups.js). Paying it once at closing instead (the upfront premium) is estimated from the
//     annual premium: the monthly premiums until the loan is expected to reach the removal LTV (upfrontFactor).
//   Jumbo or Non-Conforming with NO MI GUIDELINES = TRUE, and Down Payment Assistance: no mortgage insurance.
// A product saved before this (a Conventional, Jumbo or Non-Conforming one without MI QUOTES) keeps its old columns
// (PREPAID MORTGAGE INSURANCE RATE ... DOWN, PMI LTV THRESHOLD, LOAN PRODUCT PMI RATE): loanMi returns null for it.
import { QUOTE_CREDIT, QUOTE_DTI, CREDIT_STEPS, DTI_STEPS, stepList, markupModel } from '/rate-markups.js';

// --- FHA ---
export const FHA_UFMIP = 0.0175;
// HUD's annual MIP (Mortgagee Letter 2023-05), by the base loan amount, the LTV and the loan term
export const FHA_MIP_LOAN_BREAK = 726200;
export function fhaAnnualMip(baseLoan, ltv, termYears) {
    const big = baseLoan > FHA_MIP_LOAN_BREAK;
    if (!(termYears <= 15)) return big ? (ltv > 0.95 ? 0.0075 : 0.0070) : (ltv > 0.95 ? 0.0055 : 0.0050);
    if (!big) return ltv > 0.90 ? 0.0040 : 0.0015;
    return ltv > 0.90 ? 0.0065 : ltv > 0.78 ? 0.0040 : 0.0015;
}

// --- VA ---
// The funding fee for a purchase, by down payment (a share of the price): under 5%, 5% to under 10%, 10% or more
export const VA_FUNDING_FEES = {
    first: [{ below: 0.05, fee: 0.0215 }, { below: 0.10, fee: 0.015 }, { below: Infinity, fee: 0.0125 }],
    subsequent: [{ below: 0.05, fee: 0.033 }, { below: 0.10, fee: 0.015 }, { below: Infinity, fee: 0.0125 }],
};
export const VA_DOWN_LABELS = ['Less than 5%', '5% to less than 10%', '10% or more'];
export function vaFundingFee(downPct, firstUse) {
    const down = Math.round(downPct * 1e6) / 1e6;
    return VA_FUNDING_FEES[firstUse ? 'first' : 'subsequent'].find(t => down < t.below).fee;
}

// --- Conventional (and Jumbo / Non-Conforming with guidelines) ---
// Mortgage insurance applies to a loan above 80% LTV
export const MI_REQUIRED_ABOVE = 0.80;
export const MI_CREDIT = QUOTE_CREDIT;
export const MI_DTI = QUOTE_DTI;
export const MI_LTV = [0.85, 0.90, 0.95];
// The LTV table's rows: 81% to 100% by 1%
export const MI_LTV_STEPS = stepList(0.81, 1.00, 0.01, 100);
export const MI_GRID = { credit: MI_CREDIT, dti: MI_DTI, ltv: MI_LTV, steps: { credit: CREDIT_STEPS, dti: DTI_STEPS, ltv: MI_LTV_STEPS } };
// The scenario the upfront premium charts hold the other two metrics at (the middle quoted levels)
export const MI_REFERENCE = { credit: 700, dti: 0.35, ltv: 0.90 };
// The most an annual premium can be (a sanity check on the quotes: 10% of the loan a year)
export const MI_MAX_QUOTE = 0.10;

// A saved MI QUOTES value → [27 numbers], or null when there are none
export function miQuotes(raw) {
    let v = raw;
    if (typeof v === 'string') { if (!v.trim()) return null; try { v = JSON.parse(v); } catch (e) { return null; } }
    if (!v || !Array.isArray(v.QUOTES) || v.QUOTES.length !== 27) return null;
    const quotes = v.QUOTES.map(Number);
    return quotes.every(q => isFinite(q) && q >= 0) ? quotes : null;
}

/**
 * The annual premium model for 27 quotes: markupModel's { start, credit(score), dti(ratio), ltv(ratio), worstMiss,
 * tables } (start: the premium at 800 / 20% / 85%; each metric's adjustment from there), plus premium(credit, dti, ltv):
 * the annual premium for a scenario (none at 80% LTV or less, and never below 0).
 */
export function miModel(quotes) {
    const m = markupModel(quotes, 0, MI_GRID);
    m.premium = (credit, dti, ltv) => (ltv <= MI_REQUIRED_ABOVE + 1e-9 ? 0 : Math.max(0, m.start + m.credit(credit) + m.dti(dti) + m.ltv(ltv)));
    return m;
}

// --- The upfront premium ---
// The admin's assumptions (settings mortgageInsurance, on the Lenders card): the LTV the mortgage insurance comes off at,
// how much the home gains in value each year, the fewest years it's paid, and the yearly rate future premiums are
// discounted at (what money paid up front could have earned)
export const MI_SETTINGS = [
    { key: 'removalLtv', col: 'MI REMOVAL LTV', label: 'Comes off at', unit: '% LTV', def: 0.80, min: 0.5, max: 0.95, pct: true,
        help: 'Once the balance is this share of the home’s value, the mortgage insurance comes off' },
    { key: 'appreciation', col: 'HOME APPRECIATION', label: 'Home value gain', unit: '% a year', def: 0.03, min: 0, max: 0.2, pct: true,
        help: 'How much the home’s value grows each year' },
    { key: 'minYears', col: 'MI MIN YEARS', label: 'Paid for at least', unit: 'years', def: 2, min: 0, max: 30, pct: false,
        help: 'The fewest years the mortgage insurance is paid (whole years)' },
    { key: 'discount', col: 'MI DISCOUNT RATE', label: 'Discount rate', unit: '% a year', def: 0.05, min: 0, max: 0.3, pct: true,
        help: 'Each later premium is discounted back to closing at this rate (what the money could earn instead)' },
];
// A settings row (or null) → { removalLtv, appreciation, minYears, discount }, each blank or invalid one at its default
export function miSettings(row) {
    const out = {};
    MI_SETTINGS.forEach(s => {
        const raw = row ? String(row[s.col] === undefined || row[s.col] === null ? '' : row[s.col]).trim() : '';
        const n = Number(raw);
        out[s.key] = raw !== '' && isFinite(n) && n >= s.min && n <= s.max ? n : s.def;
    });
    return out;
}

/**
 * How long the mortgage insurance is expected to be paid on a loan starting at this LTV (a share of the home's value),
 * at this interest rate over this many years: until the balance, paid down month by month, is at or below the removal
 * LTV of the home's value as it grows (and at least the fewest years). Returns { months, factor }: factor is the
 * monthly premiums over those months as years of the annual premium, each discounted back to closing, so the upfront
 * premium is the annual premium x factor (both a percent of the loan).
 */
export function upfrontFactor(ltv, rate, termYears, s) {
    if (!(ltv > MI_REQUIRED_ABOVE + 1e-9)) return { months: 0, factor: 0 };
    const n = Math.round((termYears > 0 ? termYears : 30) * 12);
    const i = rate > 0 ? rate / 12 : 0;
    const grow = Math.pow(1 + s.appreciation, 1 / 12), disc = Math.pow(1 + s.discount, 1 / 12);
    const minMonths = Math.round(s.minYears * 12);
    const growth = i ? Math.pow(1 + i, n) : 1;
    const left = m => (i ? (growth - Math.pow(1 + i, m)) / (growth - 1) : 1 - m / n);
    let months = 0, factor = 0;
    while (months < n && (months < minMonths || ltv * left(months) / Math.pow(grow, months) > s.removalLtv + 1e-12)) {
        // This month's premium (the first is paid at closing)
        factor += 1 / 12 / Math.pow(disc, months);
        months++;
    }
    return { months, factor };
}

// --- A product's mortgage insurance ---
const JUMBO_LIKE = ['jumbo', 'non-conforming'];
// What a product's mortgage insurance follows: 'fha', 'va', 'quotes' (the lender's annual premiums), 'none', or
// 'legacy' (a product saved before MI QUOTES: its old columns). get(column) → the product's value.
export function productMiKind(get) {
    const type = String(get('PRODUCT TYPE') || '').trim().toLowerCase();
    if (type === 'fha') return 'fha';
    if (type === 'va') return 'va';
    if (type === 'down payment assistance') return 'none';
    const quotes = miQuotes(get('MI QUOTES'));
    if (JUMBO_LIKE.includes(type)) {
        const none = String(get('NO MI GUIDELINES') || '').trim().toUpperCase();
        if (none === 'TRUE') return 'none';
        return quotes ? 'quotes' : 'legacy';
    }
    return quotes ? 'quotes' : 'legacy';
}

const pctText = v => String(Number((v * 100).toFixed(3))) + '%';
/**
 * A loan's mortgage insurance from its product (get(column) → the product's value), or null for a 'legacy' product.
 * opts: { baseLoan (before any financed premium), price, rate, termYears, credit, dti, settings (a settings row),
 * vaUse: { firstUse, known } (the purchasers' VA use; unknown counts as a first use), upfront (TRUE: a conventional
 * premium paid once at closing instead of monthly) }.
 * Returns { kind, upfront (a share of the base loan, paid at closing or financed), upfrontLabel, upfrontNote, annual
 * (a share of the loan each year, paid monthly), annualNote }.
 */
export function loanMi(get, opts) {
    const kind = productMiKind(get);
    if (kind === 'legacy') return null;
    const { baseLoan, price, rate, termYears } = opts;
    const ltv = price ? baseLoan / price : 0;
    const down = price ? (price - baseLoan) / price : 0;
    const out = { kind, upfront: 0, upfrontLabel: 'Upfront Mortgage Insurance', upfrontNote: '', annual: 0, annualNote: '' };
    if (kind === 'fha') {
        out.upfront = FHA_UFMIP;
        out.upfrontLabel = 'Upfront Mortgage Insurance (UFMIP)';
        out.upfrontNote = pctText(FHA_UFMIP) + ' of the base loan (every FHA loan)';
        out.annual = baseLoan > 0 ? fhaAnnualMip(baseLoan, ltv, termYears) : 0;
        out.annualNote = 'FHA annual MIP: ' + pctText(out.annual) + ' a year';
        return out;
    }
    if (kind === 'va') {
        const use = opts.vaUse || { firstUse: true, known: false };
        out.upfront = vaFundingFee(down, use.firstUse);
        out.upfrontLabel = 'VA Funding Fee';
        const tier = VA_DOWN_LABELS[VA_FUNDING_FEES.first.findIndex(t => Math.round(down * 1e6) / 1e6 < t.below)];
        out.upfrontNote = pctText(out.upfront) + ': ' + (use.firstUse ? 'first' : 'subsequent') + ' VA use, ' + tier.toLowerCase() + ' down'
            + (use.known ? '' : ' (first use assumed)');
        return out;
    }
    if (kind === 'none') return out;
    // The lender's annual premiums
    if (ltv <= MI_REQUIRED_ABOVE + 1e-9) { out.annualNote = 'None at ' + Math.round(MI_REQUIRED_ABOVE * 100) + '% LTV or less'; return out; }
    const annual = miModel(miQuotes(get('MI QUOTES'))).premium(opts.credit, opts.dti, ltv);
    if (opts.upfront) {
        const s = miSettings(opts.settings);
        const f = upfrontFactor(ltv, rate, termYears, s);
        out.upfront = annual * f.factor;
        out.upfrontNote = pctText(out.upfront) + ' of the loan, instead of ' + pctText(annual) + ' a year (estimated)';
        return out;
    }
    out.annual = annual;
    out.annualNote = pctText(annual) + ' a year, until about ' + Math.round(miSettings(opts.settings).removalLtv * 100) + '% LTV';
    return out;
}
