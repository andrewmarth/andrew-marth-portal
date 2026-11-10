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
//   titleDiscount: a title discount's name (off the owner's policy)
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
    const sd = discountOf(c.discounts, o.sellerDiscount), bd = discountOf(c.discounts, o.buyerDiscount);
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
        const td = discountOf(c.titleDiscounts, o.titleDiscount);
        const owner = Math.ceil(q.owner * (1 - td));
        const sellerShare = o.ownerPayer === 'Buyer' ? 0 : o.ownerPayer === 'Seller' ? 1 : (c.sellerOwnerShare ?? 1);
        add('Owner’s Title Policy', owner, owner * sellerShare, 'owner', td ? Math.round(td * 100) + '% off: ' + o.titleDiscount : '');
    }
    if (hasLoan && q.loanPolicy !== null) {
        const extraPolicies = Math.max(0, loans - 1) * (c.extraLoanPolicyFee || 0);
        add('Lender’s Title Policy', q.loanPolicy + extraPolicies, 0, 'loanPolicy', second ? 'On both loans (' + money(loanAmount + second) + ')' : '');
        (c.loanEndorsementList || []).filter(e => endorsementApplies(e, hasLoan, property, loanType))
            .forEach(e => add(e.name + (loans > 1 ? ' (both loans)' : ''), (e.amount || 0) * loans, 0, 'endorsement'));
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
    ['loanEndorsementList', 'Lender’s endorsements', 'table'],
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
