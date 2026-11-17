// Title and escrow fees from a title company's filed rates (the admin Title Companies card in settings.html),
// used by that card's Try It box and by the Buyer Breakdown and Seller Net pages.
//
// A company is { escrowTable, escrowOverFee, escrowOverPer, cashSaleAddOn, loanSaleAddOn, cashNoPayoffAddOn,
// sellerEscrowShare, recordingFee, sellerRecordingShare, discounts, otherFees, titleTable, titleOverFee, titleOverPer,
// ownerPolicyPercent, sellerOwnerShare, loanPolicyPercent, simultaneousPercent, simultaneousMinimum, loanEndorsementList,
// titleDiscounts, vaSellerPays, fincenFee, extraLoanEscrowFee, extraLoanPolicyFee, shortSaleTable / reoTable (with
// their OverFee, OverPer and SellerShare), refiEscrowFee, refiRecordingFee, refiTable, refiOverFee, refiOverPer,
// refiPolicyPercent, refiEndorsements }, as the API's titleCompanies action returns it. Tables are [{ upTo, fee }].
// Each table's "add $X per $Y" above its last row can change higher up: escrowOverTiers, titleOverTiers, shortSaleOverTiers,
// reoOverTiers and refiOverTiers are [{ above, fee, per }] (Fidelity: above $5,000,000 the escrow fee adds $14.70 per
// $20,000 instead of $21).

// The fee for an amount from a rate table: the first row it fits under, else the last row plus the over-table charge.
// tiers: [{ above, fee, per }], where the charge changes; each stretch is charged per its own $Y or fraction of it.
export function tableFee(table, overFee, overPer, amount, tiers) {
    const rows = (table || []).filter(r => r.upTo > 0 && r.fee !== null && r.fee !== undefined).sort((a, b) => a.upTo - b.upTo);
    if (!rows.length || !(amount > 0)) return null;
    const row = rows.find(r => amount <= r.upTo);
    if (row) return row.fee;
    const last = rows[rows.length - 1];
    const steps = [{ above: last.upTo, fee: overFee, per: overPer }].concat((tiers || [])
        .filter(t => t && t.above > last.upTo && t.fee !== null && t.fee !== undefined && t.per > 0).sort((a, b) => a.above - b.above));
    let fee = last.fee;
    steps.forEach((s, i) => {
        const end = i + 1 < steps.length ? steps[i + 1].above : Infinity;
        const part = Math.min(amount, end) - s.above;
        if (part > 0 && s.fee && s.per) fee += Math.ceil(part / s.per) * s.fee;
    });
    return Math.round(fee * 100) / 100;
}

// The standard sale escrow fee: { base (the table), cash, loan, sellerCash, sellerLoan, recording, sellerRecording,
// owner, sellerOwner, loanPolicy }. Null without an escrow table or a price.
export function titleQuote(c, price, loanAmount) {
    const base = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price, c.escrowOverTiers);
    if (base === null) return null;
    const share = c.sellerEscrowShare ?? 0.5;
    const cash = base + (c.cashSaleAddOn || 0);
    const loan = base + (c.loanSaleAddOn || 0);
    return {
        base, cash, loan, sellerCash: Math.ceil(cash * share), sellerLoan: Math.ceil(loan * share),
        recording: c.recordingFee || 0, sellerRecording: (c.recordingFee || 0) * (c.sellerRecordingShare ?? 0.5),
        ...titlePolicies(c, price, loanAmount),
    };
}

// Owner's policy = basic rate x owner's percent; loan policy (issued with it) = basic rate on the loan x loan percent x
// the simultaneous percent, at least the minimum. Fractions of a dollar round up.
export function titlePolicies(c, price, loanAmount) {
    const basic = tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, price, c.titleOverTiers);
    if (basic === null) return { owner: null, sellerOwner: null, loanPolicy: null };
    const owner = Math.ceil(basic * (c.ownerPolicyPercent ?? 1));
    let loanPolicy = null;
    if (loanAmount > 0) {
        const full = Math.ceil(tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, loanAmount, c.titleOverTiers) * (c.loanPolicyPercent ?? 1));
        loanPolicy = Math.max(c.simultaneousMinimum || 0, Math.ceil(full * (c.simultaneousPercent ?? 1)));
    }
    return { owner, sellerOwner: owner * (c.sellerOwnerShare ?? 1), loanPolicy };
}

// A refinance of loanAmount: { escrow, recording, policy (null without a table), endorsements, fees, total }
// Above its last row (refiOverMode 'basicRate'), a refinance policy is refiOverPercent of the basic rate on the loan amount
// (First American: 30% of its 120% extended loan rate = 36%); otherwise the table's "add $X per $Y".
export function refiQuote(c, loanAmount) {
    if (!(loanAmount > 0)) return null;
    let policy;
    if (c.refiOverMode === 'basicRate' && loanAmount > lastUpTo(c.refiTable)) {
        const basic = tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, loanAmount, c.titleOverTiers);
        policy = basic === null ? null : Math.ceil(basic * (c.refiOverPercent || 0));
    } else {
        const table = tableFee(c.refiTable, c.refiOverFee, c.refiOverPer, loanAmount, c.refiOverTiers);
        policy = table === null ? null : Math.ceil(table * (c.refiPolicyPercent ?? 1));
    }
    const fees = (c.otherFees || []).filter(f => f.when === 'Refinance' && f.amount);
    const escrow = c.refiEscrowFee || 0, recording = c.refiRecordingFee || 0, endorsements = c.refiEndorsements || 0;
    return { escrow, recording, policy, endorsements, fees, total: escrow + recording + (policy || 0) + endorsements + fees.reduce((s, f) => s + f.amount, 0) };
}

// A table's last "up to" amount (0 when empty)
const lastUpTo = table => Math.max(0, ...(table || []).filter(r => r.upTo > 0 && r.fee !== null && r.fee !== undefined).map(r => r.upTo));
// A short sale or REO escrow fee (kind 'shortSale' or 'reo'). Above its last row, '...OverMode' 'standardPlus' means the
// standard escrow table's fee plus OverFee (First American: the basic escrow fee + $1,000); otherwise "add $X per $Y".
export function specialEscrowFee(c, kind, price) {
    if (c[kind + 'OverMode'] === 'standardPlus' && price > lastUpTo(c[kind + 'Table'])) {
        const standard = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price, c.escrowOverTiers);
        return standard === null ? null : standard + (c[kind + 'OverFee'] || 0);
    }
    return tableFee(c[kind + 'Table'], c[kind + 'OverFee'], c[kind + 'OverPer'], price, c[kind + 'OverTiers']);
}

// The ALTA endorsements every title company has (Settings > Title Companies lists them all; an unpriced one counts as $0).
// A company's list matches one by its code ("ALTA 9" isn't "ALTA 9.1"); anything else on the list is an extra.
export const STANDARD_ENDORSEMENTS = [
    { code: 'ALTA 8.1', name: 'ALTA 8.1 Environmental Protection Lien', when: 'Every Loan' },
    { code: 'ALTA 9', name: 'ALTA 9 Restrictions, Encroachments, Minerals', when: 'Every Loan' },
    { code: 'ALTA 4.1', name: 'ALTA 4.1 Condominium', when: 'Condo' },
    { code: 'ALTA 5.1', name: 'ALTA 5.1 Planned Unit Development', when: 'HOA (PUD)' },
    { code: 'ALTA 6', name: 'ALTA 6 Variable Rate Mortgage', when: 'Adjustable Rate' },
    { code: 'ALTA 7.1', name: 'ALTA 7.1 Manufactured Housing', when: 'Manufactured Home' },
];
const codeMatch = (code, name) => new RegExp('^' + code.replace('.', '\\.') + '(?![.\\d])', 'i').test(String(name || '').trim());
// A company's endorsements split into the standard ones (each with its price, or null when it has none) and the extras
export function splitEndorsements(list) {
    const rows = list || [];
    const standard = STANDARD_ENDORSEMENTS.map(s => {
        const found = rows.find(r => codeMatch(s.code, r.name));
        return { ...s, amount: found && found.amount !== undefined ? found.amount : null };
    });
    const extras = rows.filter(r => !STANDARD_ENDORSEMENTS.some(s => codeMatch(s.code, r.name)));
    return { standard, extras };
}
// The standard endorsements a company hasn't priced (counted as $0)
export const unpricedEndorsements = c => splitEndorsements(c.loanEndorsementList).standard.filter(s => s.amount === null || s.amount === undefined || s.amount === '');

// Which loans need an endorsement, and which sales an "other fee" applies to
export const ENDORSEMENT_WHEN = ['Every Loan', 'Condo', 'HOA (PUD)', 'Adjustable Rate', 'Manufactured Home'];
export function endorsementApplies(e, hasLoan, property, loanType) {
    if (!hasLoan) return false;
    return e.when === 'Every Loan' || (e.when === 'Condo' && property === 'condo') || (e.when === 'HOA (PUD)' && property === 'hoa')
        || (e.when === 'Adjustable Rate' && loanType === 'arm') || (e.when === 'Manufactured Home' && property === 'manufactured');
}
// An "other fee"'s WHEN: Every Sale, With a Loan, Manufactured Home (the property), Refinance (refinances only); one of
// SALE_CONDITIONS, from the page's own settings (a Seller Net's Foreign Seller, Septic, 1031 Exchange, Holdback over $0,
// Title Company Electronic Service; either page's Escrow Duration for Accelerated Escrow: at most the fee's maxDays); or
// Sometimes: picked on the page (Other Fees That Apply), for a fee with no setting of its own. [value, label]
export const FEE_WHEN = [['Every Sale', 'Every Sale'], ['With a Loan', 'With a Loan'], ['Manufactured Home', 'Manufactured Home'],
    ['Foreign Seller', 'Foreign Seller (FIRPTA)'], ['Septic', 'Septic System'], ['1031 Exchange', '1031 Exchange'], ['Holdback', 'Holdback'],
    ['Electronic Service', 'Electronic Service'], ['Accelerated Escrow', 'Accelerated Escrow (short escrow)'], ['Refinance', 'Refinance'],
    ['Sometimes', 'Sometimes (picked on the page)']];
export const SALE_CONDITIONS = ['Foreign Seller', 'Septic', '1031 Exchange', 'Holdback', 'Electronic Service', 'Accelerated Escrow'];
// conditions: what the page's settings say ({ 'Foreign Seller': true, ..., escrowDays: 21 }), or null. A condition the
// page doesn't have (a Buyer Breakdown has no Foreign Seller...; no Escrow Duration yet; an Accelerated Escrow fee
// without its days) can't apply on its own there: that fee is picked instead, like a Sometimes one.
const answered = (f, conditions) => Boolean(conditions) && (f.when === 'Accelerated Escrow'
    ? typeof conditions.escrowDays === 'number' && f.maxDays > 0
    : Object.prototype.hasOwnProperty.call(conditions, f.when));
// (Accelerated Escrow: its maxDays in calendar days, or with dayType 'business', in business days: conditions.
// escrowBusinessDays, weekdays from the offer acceptance to the close of escrow)
export const ESCROW_DAY_TYPES = [['calendar', 'calendar days'], ['business', 'business days']];
export function feeApplies(f, hasLoan, property, conditions = null) {
    if (f.when === 'Accelerated Escrow') return answered(f, conditions) && (f.dayType === 'business' ? conditions.escrowBusinessDays : conditions.escrowDays) <= f.maxDays;
    return f.when === 'Every Sale' || (f.when === 'With a Loan' && hasLoan) || (f.when === 'Manufactured Home' && property === 'manufactured')
        || (SALE_CONDITIONS.includes(f.when) && Boolean(conditions && conditions[f.when]));
}
// A fee's amount on this sale: a Holdback fee with ranges ([{ upTo, fee }]; upTo blank: any amount above) charges the
// range the page's holdback falls in (conditions.holdbackAmount; above every range, the last one's fee), otherwise its
// own amount. → { amount, note }
export function feeAmount(f, conditions) {
    const ranges = f.when === 'Holdback' && Array.isArray(f.ranges) ? f.ranges.filter(r => r && typeof r.fee === 'number') : [];
    const held = conditions && typeof conditions.holdbackAmount === 'number' ? conditions.holdbackAmount : null;
    const sorted = ranges.slice().sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    // (no holdback amount here, a Buyer Breakdown: its Amount, or without one the first range's fee)
    if (!ranges.length || held === null) return { amount: f.amount || (sorted.length ? sorted[0].fee : 0), note: '' };
    const hit = sorted.find(r => r.upTo === null || r.upTo === undefined || held <= r.upTo) || sorted[sorted.length - 1];
    return { amount: hit.fee, note: 'For a ' + money(held) + ' holdback' };
}
// The fees a page picks by hand (Other Fees That Apply): Sometimes ones, plus the ones whose setting the page doesn't have
export const isPickableFee = (f, conditions) => f.when === 'Sometimes' || (SALE_CONDITIONS.includes(f.when) && !answered(f, conditions));
export const pickableFees = (c, conditions) => ((c && c.otherFees) || []).filter(f => f.name && isPickableFee(f, conditions));

// --- Discounts (escrow and owner's policy) ---
// Who qualifies for a discount (its qualifies: any of them): a profession or group a client can tick (/dpa.js
// PROFESSION_GROUPS), or one of these:
//   Investor              by the discount's investorRule (INVESTOR_RULES): 'owned' (owned investorProperties properties in
//                         the last investorYears years, by their Real Estate Owned), 'current' (owns investorProperties
//                         properties now) or 'certify' (certifies they're an investor: the page's Self-Certify As An
//                         Investor)
//   Church / Non-Profit, Corporate Relocation   set on the page (PAGE_QUALIFIERS)
//   Prior Policy, Other   never on their own: picked on the page (a reissue / short-term rate comes from the property)
export const DISCOUNT_SPECIAL = ['Investor', 'Church / Non-Profit', 'Corporate Relocation'];
export const PAGE_QUALIFIERS = ['Church / Non-Profit', 'Corporate Relocation'];
export const PICKED_QUALIFIERS = ['Prior Policy', 'Other'];
// A discount saved before had one category (a page's old Buyer Type): the groups it covers
const LEGACY_CATEGORY = {
    'Senior': ['Senior (60+)'], 'Real Estate Agent': ['Real Estate Agent'],
    'Military / First Responder': ['Firefighter', 'Law Enforcement', 'EMTs', 'Active Military', 'Veteran (With benefits)', 'Veteran (Without benefits)'],
    'Public Servant': ['Teacher', 'Firefighter', 'Law Enforcement', 'EMTs'],
};
export const qualifiersOf = d => (Array.isArray(d.qualifies) && d.qualifies.length ? d.qualifies
    : d.category ? LEGACY_CATEGORY[d.category] || [d.category] : ['Other']);
// Who a discount is for, and what it takes off (the same for escrow and owner's policy discounts):
//   buyer       the buyer qualifies; the whole fee or policy costs less, whoever pays (WFG 10.2: an investor buying)
//   buyerPays   the buyer qualifies; only the buyer's share costs less
//   sellerPays  the seller qualifies; only the seller's share costs less
//   eitherPays  either party can qualify; only what that party pays costs less (First American B.6, Fidelity 803, the
//               escrow discounts of WFG 6.2-6.4)
//   property    the property's prior policy (a reissue / short-term rate: on its own, see priorPolicyDiscounts) or picked
//               on the page ("Other"); the whole fee or policy
export const DISCOUNT_APPLIES = [
    ['buyer', 'Buyer qualifies: the whole fee'],
    ['buyerPays', 'Buyer qualifies: their share only'],
    ['sellerPays', 'Seller qualifies: their share only'],
    ['eitherPays', 'Either qualifies: their share only'],
    ['property', 'Prior policy or picked on the page: the whole fee'],
];
// How many properties someone owned at any time in the last `years` years. owned: [{ purchased, sold }] (YYYY-MM-DD;
// sold blank while they still own it). today: a Date.
export function propertiesOwnedWithin(owned, years, today = new Date()) {
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const start = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
    const from = iso(start), to = iso(today);
    return (owned || []).filter(p => p && p.purchased && p.purchased <= to && (!p.sold || p.sold >= from)).length;
}
// How many properties someone owns today (bought, and not sold yet)
export function propertiesOwnedNow(owned, today = new Date()) {
    const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    return (owned || []).filter(p => p && p.purchased && p.purchased <= iso && (!p.sold || p.sold > iso)).length;
}
// An Investor discount's rule: [value, label]. A discount saved before the rule: 'owned' when it has a number of
// properties, otherwise 'certify'.
export const INVESTOR_RULES = [['owned', 'Owned X properties in the last X years'], ['current', 'Currently owns X properties'], ['certify', 'Certifies they’re an investor']];
export const investorRuleOf = d => (INVESTOR_RULES.some(r => r[0] === d.investorRule) ? d.investorRule : d.investorProperties > 0 ? 'owned' : 'certify');
// Whether a company has an Investor discount people certify for (the page then asks Self-Certify As An Investor)
export const hasCertifyInvestor = c => Boolean(c) && (c.discounts || []).concat(c.titleDiscounts || []).some(d => qualifiersOf(d).includes('Investor') && investorRuleOf(d) === 'certify');
// Whether a party qualifies for a discount. party: { tags: [groups and page qualifiers they have], owned: [each person's
// [{ purchased, sold }] (null: not answered)], certifiedInvestor (the page's Self-Certify As An Investor), today } (any
// one person meeting the investor rule counts). A tag of 'Investor' counts as an investor on its own (an old Seller
// Net's expected buyer, the Try It box).
export function partyQualifies(d, party) {
    if (!party) return false;
    const tags = party.tags || [];
    return qualifiersOf(d).some(q => {
        if (PICKED_QUALIFIERS.includes(q)) return false;
        if (q !== 'Investor') return tags.includes(q);
        if (tags.includes('Investor')) return true;
        const rule = investorRuleOf(d), n = d.investorProperties, y = d.investorYears, today = party.today || new Date();
        if (rule === 'certify') return Boolean(party.certifiedInvestor);
        if (rule === 'current') return n > 0 && (party.owned || []).some(list => propertiesOwnedNow(list, today) >= n);
        return n > 0 && y > 0 && (party.owned || []).some(list => propertiesOwnedWithin(list, y, today) >= n);
    });
}
// Each side's escrow discount (the biggest one that applies to it): { seller, buyer } (each a discount, or null).
// o: { buyer, seller (parties), picked (a discount's name picked on the page) }
export function escrowDiscounts(c, o = {}) {
    let seller = null, buyer = null;
    (c.discounts || []).forEach(d => {
        const p = d.percent || 0;
        if (!(p > 0)) return;
        const applies = d.applies || 'eitherPays';
        const pickedHere = [].concat(o.picked || []).includes(d.name);
        const bq = partyQualifies(d, o.buyer), sq = partyQualifies(d, o.seller) || pickedHere;
        const forSeller = (applies === 'buyer' && bq) || ((applies === 'sellerPays' || applies === 'eitherPays') && sq) || (applies === 'property' && pickedHere);
        const forBuyer = ((applies === 'buyer' || applies === 'buyerPays' || applies === 'eitherPays') && bq) || (applies === 'property' && pickedHere);
        if (forSeller && (!seller || p > seller.percent)) seller = d;
        if (forBuyer && (!buyer || p > buyer.percent)) buyer = d;
    });
    return { seller, buyer };
}
// --- Prior Policy discounts (a reissue or short-term rate) ---
// They apply on their own from the property's last owner's policy (a page's PRIOR POLICY DATE and PRIOR POLICY INSURER).
// A discount's rule: priorCompany 'same' (only when this sale's title company issued it) or 'any' (blank: any), and
// priorYears (issued within that many years; blank: any age).
export const PRIOR_POLICY_COMPANY = [['same', 'Only at the same company'], ['any', 'Any company']];
export const isPriorPolicyDiscount = d => qualifiersOf(d).includes('Prior Policy');
// The names of the company's Prior Policy discounts this sale gets. prior: { issued (a Date), sameCompany (whether this
// sale's title company issued it), today } or null.
export function priorPolicyDiscounts(c, prior) {
    if (!c || !prior || !(prior.issued instanceof Date) || isNaN(prior.issued)) return [];
    const today = prior.today || new Date();
    return (c.discounts || []).concat(c.titleDiscounts || []).filter(d => {
        if (!isPriorPolicyDiscount(d) || !(d.percent > 0)) return false;
        if (d.priorCompany === 'same' && !prior.sameCompany) return false;
        if (d.priorYears > 0) {
            const since = new Date(today.getFullYear() - d.priorYears, today.getMonth(), today.getDate());
            if (prior.issued < since) return false;
        }
        return prior.issued <= today;
    }).map(d => d.name);
}

// Owner's policy discounts the page picks by hand: "Other" ones, plus, on a Buyer Breakdown (sellerToo), ones the seller
// qualifies for (the seller isn't a client there). (Prior Policy ones apply on their own: priorPolicyDiscounts.)
export const pickableTitleDiscounts = (c, sellerToo) => (c.titleDiscounts || []).filter(d => !isPriorPolicyDiscount(d) && ((d.applies || 'property') === 'property'
    || (qualifiersOf(d).some(q => PICKED_QUALIFIERS.includes(q)) && d.applies !== 'buyer' && d.applies !== 'buyerPays')
    || (sellerToo && (d.applies === 'sellerPays' || d.applies === 'eitherPays'))));
// The owner's policy after the one discount that saves the most: { seller, buyer, note }. sellerPart / buyerPart: each
// side's share before it. o: { buyer, seller, picked }, as for escrowDiscounts.
export function ownerPolicyDiscount(c, sellerPart, buyerPart, o = {}) {
    let best = { save: 0, seller: sellerPart, buyer: buyerPart, note: '' };
    (c.titleDiscounts || []).forEach(d => {
        const p = d.percent || 0;
        const applies = d.applies || 'property';
        const pickedHere = [].concat(o.picked || []).includes(d.name);
        const bq = partyQualifies(d, o.buyer), sq = partyQualifies(d, o.seller) || pickedHere;
        let s = 0, b = 0;
        if (applies === 'buyer' && bq) { s = sellerPart * p; b = buyerPart * p; }
        else if (applies === 'buyerPays' && bq) b = buyerPart * p;
        else if (applies === 'sellerPays' && sq) s = sellerPart * p;
        else if (applies === 'eitherPays') { if (bq) b = buyerPart * p; if (sq) s = sellerPart * p; }
        else if (applies === 'property' && pickedHere) { s = sellerPart * p; b = buyerPart * p; }
        if (s + b > best.save + 0.004) best = { save: s + b, seller: sellerPart - s, buyer: buyerPart - b, note: Math.round(p * 100) + '% off: ' + d.name };
    });
    // (a qualifying buyer whose discount only covers what they pay, when the seller pays it all, gets nothing)
    return best;
}

// A sale's title and escrow fees: { items: [{ name, total, seller, buyer, kind, note }], seller, buyer, ... } or null
// (no escrow table, or no price). Options:
//   property: 'sfr' (no HOA), 'hoa' (a planned unit development), 'condo' or 'manufactured'
//   loanType: 'fixed', 'arm' or 'va' (with a loanAmount); saleType: 'Standard', 'Short Sale' or 'REO'
//   secondLoan: a second loan's amount (its policy is priced on the combined amount, plus the company's per-policy fee)
//   sellerHasPayoff: false when the seller owns the home free and clear (some companies charge less on a cash sale then)
//   fincen: the buyer is an entity or trust paying cash, so a FinCEN report is filed
//   extraFees: names of the company's fees picked on the page ("Sometimes" ones; see pickableFees)
//   conditions: the page's settings the other fees follow (see feeApplies), or null when it has none
//   ownerPayer: 'Seller' or 'Buyer' pays the owner's policy (default: the company's custom)
//   buyer / seller: who each side is, for the escrow and owner's policy discounts (see partyQualifies)
//   titleDiscount: a discount picked by hand on the page ("Other", or one the seller qualifies for; a Prior Policy one
//     picked before they applied on their own no longer counts)
//   priorPolicy: the property's last owner's policy, for the Prior Policy discounts (see priorPolicyDiscounts)
// On a VA loan (when the company says so) the seller pays the buyer's share of the escrow fee: VA doesn't let a veteran pay
// escrow or closing fees (38 CFR 36.4313). Recording fees and title insurance are allowed, so the buyer still pays those.
export function saleFees(c, price, loanAmount, o = {}) {
    if (!c || !(price > 0)) return null;
    const property = o.property || 'sfr';
    const loanType = o.loanType || 'fixed';
    const saleType = o.saleType || 'Standard';
    const hasLoan = loanAmount > 0;
    const second = hasLoan && o.secondLoan > 0 ? o.secondLoan : 0;
    const loans = hasLoan ? (second ? 2 : 1) : 0;
    const va = hasLoan && loanType === 'va' && Boolean(c.vaSellerPays);
    const items = [];
    const add = (name, total, seller, kind, note) => items.push({ name, total, seller, buyer: total - seller, kind, note: note || '' });

    // Escrow: a short sale or REO has its own table, unless the company has no separate rate (shortSaleNoRate /
    // reoNoRate, or a table of $0 rows); otherwise the table plus an add-on
    const filed = kind => !c[kind + 'NoRate'] && (c[kind + 'Table'] || []).some(r => r.fee > 0);
    const special = saleType === 'Short Sale' && filed('shortSale') ? 'shortSale' : saleType === 'REO' && filed('reo') ? 'reo' : '';
    let base, total, share, note;
    if (special) {
        base = specialEscrowFee(c, special, price);
        total = base;
        share = c[special + 'SellerShare'] ?? c.sellerEscrowShare ?? 0.5;
        note = (special === 'reo' ? 'REO' : 'Short sale') + ' escrow rate';
    } else {
        base = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price, c.escrowOverTiers);
        if (base === null) return null;
        const addOn = hasLoan ? (c.loanSaleAddOn || 0)
            : !o.sellerHasPayoff && o.sellerHasPayoff !== undefined && c.cashNoPayoffAddOn !== null && c.cashNoPayoffAddOn !== undefined ? c.cashNoPayoffAddOn
            : (c.cashSaleAddOn || 0);
        const extraLoans = Math.max(0, loans - 1) * (c.extraLoanEscrowFee || 0);
        total = base + addOn + extraLoans;
        share = c.sellerEscrowShare ?? 0.5;
        note = 'Rate table ' + money(base) + (addOn ? ' + ' + money(addOn) + (hasLoan ? ' with a loan' : ' cash sale') : '') + (extraLoans ? ' + ' + money(extraLoans) + ' second loan' : '');
    }
    if (base === null) return null;
    // A discount comes off the table rate (that person's share of it, or both shares for a whole-fee discount), not the
    // add-on; each side gets the biggest one it qualifies for
    const handPicked = (c.discounts || []).concat(c.titleDiscounts || []).some(d => d.name === o.titleDiscount && isPriorPolicyDiscount(d)) ? [] : [o.titleDiscount].filter(Boolean);
    const parties = { buyer: o.buyer, seller: o.seller, picked: handPicked.concat(priorPolicyDiscounts(c, o.priorPolicy)) };
    const ed = escrowDiscounts(c, parties);
    const sd = ed.seller ? ed.seller.percent : 0, bd = ed.buyer ? ed.buyer.percent : 0;
    if (ed.seller) note += '; ' + Math.round(sd * 100) + '% off the seller’s share: ' + ed.seller.name;
    if (ed.buyer) note += '; ' + Math.round(bd * 100) + '% off the buyer’s share: ' + ed.buyer.name;
    let sellerEscrow = Math.ceil(base * share * (1 - sd)) + (total - base) * share;
    let buyerEscrow = Math.ceil(base * (1 - share) * (1 - bd)) + (total - base) * (1 - share);
    if (va) { sellerEscrow += buyerEscrow; buyerEscrow = 0; note += '; VA: the seller pays the buyer’s share'; }
    add('Escrow Fee', sellerEscrow + buyerEscrow, sellerEscrow, 'escrow', note);

    const q = titlePolicies(c, price, hasLoan ? loanAmount + second : 0);
    const recording = c.recordingFee || 0;
    if (recording) add('Recording Service Fee', recording, recording * (c.sellerRecordingShare ?? 0.5), 'recording');
    const extras = o.extraFees || [];
    const conditions = o.conditions || null;
    (c.otherFees || []).filter(f => feeApplies(f, hasLoan, property, conditions) || (isPickableFee(f, conditions) && extras.includes(f.name)))
        .forEach(f => { const { amount, note } = feeAmount(f, conditions); if (amount) add(f.name, amount, amount * (f.sellerShare ?? 0.5), 'fee', note); });
    if (o.fincen && c.fincenFee) add('FinCEN Report', c.fincenFee, 0, 'fincen', 'Entity or trust buyer paying cash');

    if (q.owner !== null) {
        const sellerShare = o.ownerPayer === 'Buyer' ? 0 : o.ownerPayer === 'Seller' ? 1 : (c.sellerOwnerShare ?? 1);
        const d = ownerPolicyDiscount(c, q.owner * sellerShare, q.owner * (1 - sellerShare), parties);
        const seller = d.save ? Math.ceil(d.seller) : d.seller, buyer = d.save ? Math.ceil(d.buyer) : d.buyer;
        add('Owner’s Title Policy', seller + buyer, seller, 'owner', d.note);
    }
    if (hasLoan && q.loanPolicy !== null) {
        const extraPolicies = Math.max(0, loans - 1) * (c.extraLoanPolicyFee || 0);
        add('Lender’s Title Policy', q.loanPolicy + extraPolicies, 0, 'loanPolicy', second ? 'On both loans (' + money(loanAmount + second) + ')' : '');
        const { standard, extras } = splitEndorsements(c.loanEndorsementList);
        standard.concat(extras).filter(e => endorsementApplies(e, hasLoan, property, loanType))
            .forEach(e => add(e.name + (loans > 1 ? ' (both loans)' : ''), (e.amount || 0) * loans, 0, 'endorsement', e.amount === null ? 'Not priced, counted as $0' : ''));
    }
    const sum = k => items.reduce((s, i) => s + i[k], 0);
    return { items, base, total, va, hasLoan, owner: q.owner, loanPolicy: q.loanPolicy, special, seller: sum('seller'), buyer: sum('buyer') };
}

const money = n => '$' + Math.round(n).toLocaleString('en-US');

// Every rate a company needs (the Title Companies card won't save one without them). 0 counts: it means none. A short sale
// or REO rate isn't needed when the company has no separate rate (shortSaleNoRate / reoNoRate). [key, label, kind]; kind 'table' needs a
// complete row, 'over' is an "add $X per $Y" pair (key + 'Fee' and key + 'Per'), everything else needs a value.
export const TITLE_REQUIRED = [
    ['manualDate', 'Escrow rates effective', 'date'],
    ['escrowTable', 'Escrow fee table', 'table'],
    ['escrowOver', 'Escrow fee above the table', 'over'],
    ['cashSaleAddOn', 'Cash sale add-on', 'value'],
    ['loanSaleAddOn', 'Loan sale add-on', 'value'],
    ['cashNoPayoffAddOn', 'Cash sale with no payoff add-on', 'value'],
    ['sellerEscrowShare', 'Seller’s share of the escrow fee', 'value'],
    ['recordingFee', 'Recording service fee', 'value'],
    ['sellerRecordingShare', 'Seller’s share of recording', 'value'],
    ['titleManualDate', 'Title rates effective', 'date'],
    ['titleTable', 'Basic rate table', 'table'],
    ['titleOver', 'Basic rate above the table', 'over'],
    ['ownerPolicyPercent', 'Owner’s policy percent', 'value'],
    ['sellerOwnerShare', 'Seller’s share of the owner’s policy', 'value'],
    ['loanPolicyPercent', 'Loan policy percent', 'value'],
    ['simultaneousPercent', 'Loan policy with the owner’s policy', 'value'],
    ['simultaneousMinimum', 'Loan policy minimum', 'value'],
    ['extraLoanEscrowFee', 'Escrow fee per extra loan', 'value'],
    ['extraLoanPolicyFee', 'Fee per extra lender’s policy', 'value'],
    ['fincenFee', 'FinCEN report fee', 'value'],
    ['fincenExtraFee', 'FinCEN fee per extra entity', 'value'],
    ['shortSaleTable', 'Short sale escrow table', 'table'],
    ['shortSaleOver', 'Short sale fee above the table', 'over'],
    ['shortSaleSellerShare', 'Seller’s share of a short sale', 'value'],
    ['reoTable', 'REO escrow table', 'table'],
    ['reoOver', 'REO fee above the table', 'over'],
    ['reoSellerShare', 'Seller’s share of an REO', 'value'],
    ['refiEscrowFee', 'Refinance escrow fee', 'value'],
    ['refiRecordingFee', 'Refinance recording fee', 'value'],
    ['refiTable', 'Refinance policy table', 'table'],
    ['refiOver', 'Refinance policy above the table', 'over'],
    ['refiPolicyPercent', 'Refinance policy percent', 'value'],
    ['refiEndorsements', 'Refinance endorsements', 'value'],
];
// The over-table pairs' field names, by key
export const OVER_FIELDS = { escrowOver: ['escrowOverFee', 'escrowOverPer'], titleOver: ['titleOverFee', 'titleOverPer'],
    shortSaleOver: ['shortSaleOverFee', 'shortSaleOverPer'], reoOver: ['reoOverFee', 'reoOverPer'], refiOver: ['refiOverFee', 'refiOverPer'] };
const blank = v => v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v));
// The keys of TITLE_REQUIRED a company is missing
export function missingRates(c) {
    return TITLE_REQUIRED.filter(([key, , kind]) => {
        if ((c.shortSaleNoRate && /^shortSale/.test(key)) || (c.reoNoRate && /^reo/.test(key))) return false;
        if (kind === 'table') return !(c[key] || []).some(r => (r.upTo > 0 || r.name) && !blank(r.fee ?? r.amount));
        if (kind === 'over') {
            // "Standard fee plus $X" needs only $X; "% of the basic rate" only the percent
            const mode = c[key + 'Mode'];
            if (mode === 'standardPlus') return blank(c[OVER_FIELDS[key][0]]);
            if (mode === 'basicRate') return blank(c.refiOverPercent);
            return OVER_FIELDS[key].some(k => blank(c[k]));
        }
        return blank(c[key]);
    }).map(([key]) => key);
}
