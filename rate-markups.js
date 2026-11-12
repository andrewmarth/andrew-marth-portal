// Interest rate markups from a lender's 27 quoted rates (a loan product's RATE QUOTES, filled in on the loan product form
// in /loan-products.js and used by pages.html).
//
// The lender quotes a rate for every mix of three credit scores, three debt-to-income ratios and three loan-to-value
// ratios. Each quote's markup is the quote minus today's interest rate when it was quoted (saved with the quotes as
// TODAY). The 27 markups are split into one markup per metric with an additive model (a "main effects" fit, which with
// every mix quoted is just averaging): a metric's markup at one of its levels is the average markup of the 9 quotes at that level
// minus the average of the 9 at its best level. What's left over at the best scenario (800 / 20% / 50%) is the starting
// markup, so a buyer's rate is
//     today's interest rate + starting markup + credit score markup + DTI markup + LTV markup
// Each metric's markup follows a curve through its three quoted levels (curve() below): an exponential curve, the shape
// where each step costs a set percentage more (or less) than the step before; three points in a straight line give a
// straight line. Past the quotes it keeps going both ways:
//   - on the side where the curve flattens out (usually past the best level), it follows the same curve, so the markup
//     keeps falling (a discount) by less and less, toward a floor it never passes;
//   - on the side where it steepens (usually past the worst level), it keeps bending, but evenly: the cost of each step
//     grows by the same amount each time instead of compounding. (Compounding would put a 300 credit score in the
//     hundreds of percent.)
// When the middle level's markup isn't between the other two (the quotes rise and then fall), there's no such curve
// through all three, and it's a straight line through the best and worst levels instead (the fit check shows the miss).
//
// RATE QUOTES: JSON { QUOTES: [27 decimals], TODAY: decimal } in the order of QUOTE_CREDIT x QUOTE_DTI x QUOTE_LTV
// (credit score outermost); quoteIndex(c, d, l) is a quote's place.

export const QUOTE_CREDIT = [800, 700, 660];
export const QUOTE_DTI = [0.20, 0.35, 0.45];
export const QUOTE_LTV = [0.50, 0.80, 0.95];
export const quoteIndex = (c, d, l) => c * 9 + d * 3 + l;

// The rows of the three markup tables: credit scores 300 to 850 by 10, DTI 5% to 70% by 5%, LTV 5% to 100% by 5%
const steps = (from, to, by, scale) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => Math.round((from + i * by) * scale) / scale);
export const CREDIT_STEPS = steps(300, 850, 10, 1);
export const DTI_STEPS = steps(0.05, 0.70, 0.05, 100);
export const LTV_STEPS = steps(0.05, 1.00, 0.05, 100);

// A saved RATE QUOTES value → { quotes: [27 numbers], today: number|null }, or null when there are no quotes
export function rateQuotes(raw) {
    let v = raw;
    if (typeof v === 'string') { if (!v.trim()) return null; try { v = JSON.parse(v); } catch (e) { return null; } }
    if (!v || !Array.isArray(v.QUOTES) || v.QUOTES.length !== 27) return null;
    const quotes = v.QUOTES.map(Number);
    if (quotes.some(q => !isFinite(q) || q <= 0)) return null;
    const today = Number(v.TODAY);
    return { quotes, today: v.TODAY !== undefined && v.TODAY !== null && v.TODAY !== '' && isFinite(today) ? today : null };
}

// One metric's markup curve. levels: the quoted values (best first); marks: the markup at each (0 at the best);
// higherIsWorse: whether a larger value is a riskier loan (DTI, LTV) or a smaller one is (credit score).
// Works in u: 0 at the best level, 1 at the worst. The curve is marks[0] + d * E(u), where d is the worst level's markup
// and E(u) = (e^(ku) - 1) / (e^k - 1), with k picked so it passes through the middle level too (k = 0: a straight line).
// k > 0 steepens toward the worst level, k < 0 toward the best. On the steepening side past the quotes, the curve goes
// on from its slope at the last quote and bends at a steady k (its average bend across the quotes) instead of
// compounding. When the quotes have a sharp kink (nearly flat, then a jump), the curve's own slope and bend there are
// far steeper than the quotes, so the continuation uses no more than twice the slope of the nearest quoted step, and
// no more bend than the change between the two quoted steps' slopes.
function curve(levels, marks, higherIsWorse) {
    const t = levels.map(x => (higherIsWorse ? x : -x));
    const span = t[2] - t[0];
    const alpha = (t[1] - t[0]) / span;
    const d = marks[2] - marks[0];
    const ratio = d ? (marks[1] - marks[0]) / d : NaN;
    // A middle level priced the same as the best (or the worst) is a curve that's flat and then jumps (or jumps and
    // then is flat): as close to that as the curve gets. A middle level outside the other two: a straight line.
    let k = 0;
    const r = Math.min(Math.max(ratio, 1e-6), 1 - 1e-6);
    if (ratio >= -1e-9 && ratio <= 1 + 1e-9) k = solveBend(r, alpha);
    const near0 = Math.abs(k) < 1e-9;
    const E = u => (near0 ? u : Math.expm1(k * u) / Math.expm1(k));
    const slope = u => (near0 ? 1 : k * Math.exp(k * u) / Math.expm1(k));
    // The two quoted steps' slopes (in u) and how much the slope changes from one step's middle to the other's (0.5 apart)
    const step1 = r / alpha, step2 = (1 - r) / (1 - alpha);
    const stepBend = (step2 - step1) / 0.5;
    const worstSlope = Math.min(slope(1), 2 * step2), worstBend = Math.min(k, stepBend);
    const bestSlope = Math.min(slope(0), 2 * step1), bestBend = Math.max(k, stepBend);
    const shape = u => {
        if (k > 1e-9 && u > 1) return 1 + worstSlope * (u - 1) + worstBend * (u - 1) * (u - 1) / 2;
        if (k < -1e-9 && u < 0) return bestSlope * u + bestBend * u * u / 2;
        return E(u);
    };
    const curveAt = x => marks[0] + d * shape(((higherIsWorse ? x : -x) - t[0]) / span);
    curveAt.bend = k;
    return curveAt;
}
// The k where (e^(k*alpha) - 1) / (e^k - 1) = ratio (it falls from 1 to 0 as k rises, and is alpha at k = 0)
function solveBend(ratio, alpha) {
    const g = k => (Math.abs(k) < 1e-12 ? alpha : Math.expm1(k * alpha) / Math.expm1(k));
    let lo = -50, hi = 50;
    if (ratio >= g(lo)) return lo;
    if (ratio <= g(hi)) return hi;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (g(mid) > ratio) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

// Whether a value sits on a quoted level, between them, or past them (the table's "Quoted" / "Between" / "Estimated")
function placeOf(levels, x) {
    if (levels.some(l => Math.abs(l - x) < 1e-9)) return 'quoted';
    const lo = Math.min(...levels), hi = Math.max(...levels);
    return x > lo && x < hi ? 'between' : 'estimated';
}

/**
 * The markups for 27 quotes (decimals, e.g. 0.07125) and today's rate when they were quoted.
 * Returns { start, credit(score), dti(ratio), ltv(ratio), levels: { credit, dti, ltv } (the markup at each quoted level),
 * fitted(c, d, l), worstMiss (the biggest gap between a quote and today + start + its three markups), tables }.
 */
export function markupModel(quotes, today) {
    const m = quotes.map(q => q - today);
    const at = (c, d, l) => m[quoteIndex(c, d, l)];
    const avg = list => list.reduce((s, v) => s + v, 0) / list.length;
    const all = avg(m);
    const idx = [0, 1, 2];
    const effect = pick => idx.map(i => avg(idx.flatMap(a => idx.map(b => pick(i, a, b)))) - all);
    const ce = effect((i, a, b) => at(i, a, b));
    const de = effect((i, a, b) => at(a, i, b));
    const le = effect((i, a, b) => at(a, b, i));
    const rel = e => e.map(v => v - e[0]);
    const levels = { credit: rel(ce), dti: rel(de), ltv: rel(le) };
    const start = all + ce[0] + de[0] + le[0];
    const credit = curve(QUOTE_CREDIT, levels.credit, false);
    const dti = curve(QUOTE_DTI, levels.dti, true);
    const ltv = curve(QUOTE_LTV, levels.ltv, true);
    // What the curves give for each quoted scenario (they pass through every level unless one metric's quotes rise and fall)
    const fitted = (c, d, l) => start + credit(QUOTE_CREDIT[c]) + dti(QUOTE_DTI[d]) + ltv(QUOTE_LTV[l]);
    let worstMiss = 0;
    idx.forEach(c => idx.forEach(d => idx.forEach(l => { worstMiss = Math.max(worstMiss, Math.abs(at(c, d, l) - fitted(c, d, l))); })));
    const table = (stepList, fn, quoted) => stepList.map(x => ({ value: x, markup: fn(x), place: placeOf(quoted, x) }));
    return {
        start, credit, dti, ltv, levels, fitted, worstMiss,
        tables: {
            credit: table(CREDIT_STEPS.slice().reverse(), credit, QUOTE_CREDIT),
            dti: table(DTI_STEPS, dti, QUOTE_DTI),
            ltv: table(LTV_STEPS, ltv, QUOTE_LTV),
        },
    };
}

// A product's markup model from its saved RATE QUOTES (null when it has none)
export function productMarkups(raw) {
    const q = rateQuotes(raw);
    return q && q.today !== null ? markupModel(q.quotes, q.today) : null;
}
