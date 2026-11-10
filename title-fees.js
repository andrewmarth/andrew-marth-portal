// Title and escrow fees from a title company's filed rates (the admin Title Companies card in settings.html),
// used by that card's Try It box and by the Buyer Breakdown and Seller Net pages.
//
// A company is { escrowTable, escrowOverFee, escrowOverPer, cashSaleAddOn, loanSaleAddOn, cashNoPayoffAddOn,
// sellerEscrowShare, recordingFee, sellerRecordingShare, discounts, otherFees, titleTable, titleOverFee, titleOverPer,
// ownerPolicyPercent, sellerOwnerShare, loanPolicyPercent, simultaneousPercent, simultaneousMinimum, loanEndorsementList,
// titleDiscounts, vaSellerPays, fincenFee, extraLoanEscrowFee, extraLoanPolicyFee, shortSaleTable / reoTable (with
// their OverFee, OverPer and SellerShare), refiEscrowFee, refiRecordingFee, refiTable, refiOverFee, refiOverPer,
// refiPolicyPercent, refiEndorsements }, as the API's titleCompanies action returns it. Tables are [{ upTo, fee }].

// The fee for an amount from a rate table: the first row it fits under, else the last row plus the over-table charge
export function tableFee(table, overFee, overPer, amount) {
    const rows = (table || []).filter(r => r.upTo > 0 && r.fee !== null && r.fee !== undefined).sort((a, b) => a.upTo - b.upTo);
    if (!rows.length || !(amount > 0)) return null;
    const row = rows.find(r => amount <= r.upTo);
    if (row) return row.fee;
    const last = rows[rows.length - 1];
    return last.fee + (overFee && overPer ? Math.ceil((amount - last.upTo) / overPer) * overFee : 0);
}

// The standard sale escrow fee: { base (the table), cash, loan, sellerCash, sellerLoan, recording, sellerRecording,
// owner, sellerOwner, loanPolicy }. Null without an escrow table or a price.
export function titleQuote(c, price, loanAmount) {
    const base = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price);
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
    const basic = tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, price);
    if (basic === null) return { owner: null, sellerOwner: null, loanPolicy: null };
    const owner = Math.ceil(basic * (c.ownerPolicyPercent ?? 1));
    let loanPolicy = null;
    if (loanAmount > 0) {
        const full = Math.ceil(tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, loanAmount) * (c.loanPolicyPercent ?? 1));
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
        const basic = tableFee(c.titleTable, c.titleOverFee, c.titleOverPer, loanAmount);
        policy = basic === null ? null : Math.ceil(basic * (c.refiOverPercent || 0));
    } else {
        const table = tableFee(c.refiTable, c.refiOverFee, c.refiOverPer, loanAmount);
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
        const standard = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price);
        return standard === null ? null : standard + (c[kind + 'OverFee'] || 0);
    }
    return tableFee(c[kind + 'Table'], c[kind + 'OverFee'], c[kind + 'OverPer'], price);
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
export function feeApplies(f, hasLoan, property) {
    return f.when === 'Every Sale' || (f.when === 'With a Loan' && hasLoan) || (f.when === 'Manufactured Home' && property === 'manufactured');
}

const discountOf = (list, name) => (name ? ((list || []).find(d => d.name === name) || {}).percent || 0 : 0);

// What qualifies someone (or the property) for a discount. A page's BUYER TYPE is one of BUYER_TYPES; a discount's category
// is one of DISCOUNT_CATEGORIES.
export const BUYER_TYPES = ['Individual', 'Investor', 'Senior', 'Military / First Responder', 'Real Estate Agent', 'Public Servant', 'Church / Non-Profit', 'Corporate Relocation'];
export const DISCOUNT_CATEGORIES = BUYER_TYPES.slice(1).concat(['Prior Policy', 'Other']);
// Who an owner's policy discount is for, and what it takes off:
//   buyer       the buyer qualifies; the whole policy costs less, whoever pays (WFG 10.2: an investor buying)
//   buyerPays   the buyer qualifies; only the buyer's share of the policy costs less
//   sellerPays  the seller qualifies; only the seller's share costs less
//   eitherPays  either party can qualify; only what that party pays costs less (First American B.6, Fidelity 803)
//   property    the property qualifies (a reissue / short-term rate on the seller's prior policy); the whole policy
export const DISCOUNT_APPLIES = [
    ['buyer', 'Buyer: whole policy'],
    ['buyerPays', 'Buyer: their share only'],
    ['sellerPays', 'Seller: their share only'],
    ['eitherPays', 'Either party: their share only'],
    ['property', 'Prior policy: whole policy'],
];
// The biggest escrow discount a buyer of this type gets (by category), or ''
export const buyerEscrowDiscount = (c, buyerType) => ((c.discounts || []).filter(d => d.category && d.category === buyerType)
    .sort((a, b) => (b.percent || 0) - (a.percent || 0))[0] || {}).name || '';
// Owner's policy discounts the page picks by hand: ones the seller or the property qualifies for
export const pickableTitleDiscounts = c => (c.titleDiscounts || []).filter(d => ['sellerPays', 'eitherPays', 'property'].includes(d.applies || 'property'));
// The owner's policy after the one discount that saves the most: { seller, buyer, note }. sellerPart / buyerPart: each
// side's share before it. The buyer qualifies by BUYER TYPE (buyerType); the seller or the property by the hand pick.
export function ownerPolicyDiscount(c, sellerPart, buyerPart, buyerType, picked) {
    let best = { save: 0, seller: sellerPart, buyer: buyerPart, note: '' };
    (c.titleDiscounts || []).forEach(d => {
        const p = d.percent || 0;
        const applies = d.applies || 'property';
        const buyerQualifies = Boolean(buyerType) && d.category === buyerType;
        const pickedHere = picked && d.name === picked;
        let s = 0, b = 0;
        if (applies === 'buyer' && buyerQualifies) { s = sellerPart * p; b = buyerPart * p; }
        else if (applies === 'buyerPays' && buyerQualifies) b = buyerPart * p;
        else if (applies === 'sellerPays' && pickedHere) s = sellerPart * p;
        else if (applies === 'eitherPays') { if (buyerQualifies) b = buyerPart * p; if (pickedHere) s = sellerPart * p; }
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
//   extraFees: names of the company's "Sometimes" fees that apply to this sale
//   ownerPayer: 'Seller' or 'Buyer' pays the owner's policy (default: the company's custom)
//   sellerDiscount / buyerDiscount: an escrow discount's name (off that person's share of the table rate)
//   buyerType: one of BUYER_TYPES (the buyer's escrow discount and owner's policy discounts follow from it)
//   titleDiscount: an owner's policy discount picked by hand (the seller or the property qualifies)
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
        base = tableFee(c.escrowTable, c.escrowOverFee, c.escrowOverPer, price);
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
    // A discount comes off that person's share of the table rate, not the add-on
    // The seller's escrow discount is picked by hand; the buyer's comes from the buyer type (or an old hand pick)
    const sd = discountOf(c.discounts, o.sellerDiscount), bd = discountOf(c.discounts, o.buyerDiscount || buyerEscrowDiscount(c, o.buyerType));
    let sellerEscrow = Math.ceil(base * share * (1 - sd)) + (total - base) * share;
    let buyerEscrow = Math.ceil(base * (1 - share) * (1 - bd)) + (total - base) * (1 - share);
    if (va) { sellerEscrow += buyerEscrow; buyerEscrow = 0; note += '; VA: the seller pays the buyer’s share'; }
    add('Escrow Fee', sellerEscrow + buyerEscrow, sellerEscrow, 'escrow', note);

    const q = titlePolicies(c, price, hasLoan ? loanAmount + second : 0);
    const recording = c.recordingFee || 0;
    if (recording) add('Recording Service Fee', recording, recording * (c.sellerRecordingShare ?? 0.5), 'recording');
    const extras = o.extraFees || [];
    (c.otherFees || []).filter(f => f.amount && (feeApplies(f, hasLoan, property) || (f.when !== 'Refinance' && extras.includes(f.name))))
        .forEach(f => add(f.name, f.amount, f.amount * (f.sellerShare ?? 0.5), 'fee'));
    if (o.fincen && c.fincenFee) add('FinCEN Report', c.fincenFee, 0, 'fincen', 'Entity or trust buyer paying cash');

    if (q.owner !== null) {
        const sellerShare = o.ownerPayer === 'Buyer' ? 0 : o.ownerPayer === 'Seller' ? 1 : (c.sellerOwnerShare ?? 1);
        const d = ownerPolicyDiscount(c, q.owner * sellerShare, q.owner * (1 - sellerShare), o.buyerType, o.titleDiscount);
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
