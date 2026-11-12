// Loan product pop-up for the home page's My Loan Products card (lenders).
// LAYOUT below decides the questions: one per LOAN_PRODUCTS column, plus yes/no questions that open more questions
// (when the answer is no, those columns get a set value instead). Every column comes back filled in for submit(values).
// Columns the API sends that LAYOUT doesn't mention are asked under "Other".
// Uses the same pop-up styles as the income editor: a card on wide screens, a swipe-up sheet on phones.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';

const CSS = `
.loan-dialog .income-section .type-fields { margin-top: 2px; }
.loan-dialog .field-label { display: block; font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
.loan-dialog .type-picker.yes-no { grid-template-columns: 1fr 1fr; margin-bottom: 0; min-height: 54px; align-items: center; }
/* (the general ".field label" style would otherwise pull these to the top-left) */
.loan-dialog .type-picker label { display: flex; align-items: center; justify-content: center; margin: 0; min-height: 44px; font-size: 0.95rem; }
.loan-dialog .type-picker.is-invalid { box-shadow: 0 0 0 2px var(--rust); }
.loan-dialog .field input.pct { padding-right: 38px; }
.loan-dialog .pct-wrap { position: relative; }
.loan-dialog .pct-wrap::after { content: '%'; position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.loan-dialog .field[hidden], .loan-dialog .gate-body[hidden] { display: none; }
/* Questions opened by a yes: same two columns as the section */
.loan-dialog .gate-body { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; padding: 4px 0 4px 14px; border-left: 3px solid rgba(78, 81, 62, 0.25); }
.loan-dialog .gate-body .gate-body { border-left-color: rgba(192, 144, 80, 0.45); }
/* Property types: tiles to tick, like the roles on a new client */
.loan-dialog .lp-tiles { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.loan-dialog .lp-tiles-help { grid-column: 1 / -1; margin: -4px 0 0 6px; font-size: 0.86rem; opacity: 0.75; }
.loan-dialog .lp-tile { position: relative; }
.loan-dialog .lp-tile input { position: absolute; opacity: 0; pointer-events: none; }
.loan-dialog .lp-tile label { display: flex; align-items: center; gap: 12px; min-height: 58px; margin: 0; padding: 8px 16px 8px 8px; border: 2px solid rgba(14, 42, 59, 0.35); border-radius: 18px; background: #f7f4f0; color: var(--brown); font-weight: bold; font-size: 0.98rem; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-tile-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #ece5db; color: var(--tan); }
.loan-dialog .lp-tile-icon svg { width: 20px; height: 20px; }
.loan-dialog .lp-tile input:checked + label { background: var(--olive); border-color: var(--olive); color: var(--cream); }
.loan-dialog .lp-tile input:checked + label .lp-tile-icon { background: var(--cream); color: var(--olive); }
.loan-dialog .lp-tile input:focus-visible + label { outline: 3px solid var(--gold); outline-offset: 3px; }
/* Escrow months: - [3] + */
.loan-dialog .lp-stepper { display: flex; align-items: center; gap: 8px; }
.loan-dialog .lp-stepper input { text-align: center; }
.loan-dialog .lp-step { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--navy); background: #f7f4f0; color: var(--olive); font-family: inherit; font-size: 1.4rem; font-weight: bold; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-step:disabled { opacity: 0.35; cursor: default; }
@media (hover: hover) { .loan-dialog .lp-step:not(:disabled):hover { background: var(--olive); color: var(--cream); } }
@media (max-width: 600px) {
    .loan-dialog .gate-body { grid-template-columns: 1fr; }
}
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0; };
const isTrue = v => String(v || '').trim().toUpperCase() === 'TRUE';

const DTI = ['<600', '600-620', '620-640', '640-660', '660-680', '680-700', '700-720', '720-740', '740-760', '760-780', '780-800', '800+'];
const DESIGNATIONS = ['LOW', 'MODERATE', 'MIDDLE', 'UPPER'];
const NO_INCOME_LIMIT = '99999999';
const anyAbove0 = cols => v => cols.some(c => num(v[c]) > 0);

// Items: a column question ({ col, label?, input? }), property tiles ({ tiles }), a column always set to one value
// ({ col, fixed }), or a yes/no ({ gate, label, items, isOn(values), off(col, values)?, col? }). A gate with a col is
// itself that TRUE / FALSE column. When a gate is no, the columns under it get off(col) (else 0, or FALSE for yes/no).
const LAYOUT = [
    { section: 'Product', items: [
        { col: 'LOAN PRODUCT NAME' },
        { col: 'PRODUCT TYPE' },
        { col: 'RATE TYPE' },
        // (no Lender Name question: a product's lender is set by the API from the lender it's under)
        { col: 'LOAN TERM', label: 'Loan Term (Years)', input: 'term' },
    ] },
    { section: 'Loan Limits', items: [
        { col: 'MAX LTV' }, { col: 'MIN LOAN AMOUNT' }, { col: 'MAX LOAN AMOUNT' }, { col: 'MAX SELLER CREDIT %' },
        { gate: 'income', label: 'Is there an income limit?', items: [{ col: 'INCOME LIMIT' }],
            isOn: v => String(v['INCOME LIMIT'] || '').trim() !== '' && num(v['INCOME LIMIT']) < 9999999, off: () => NO_INCOME_LIMIT },
        { gate: 'second', label: 'Is a second loan allowed?', items: [{ col: 'SECOND LOAN LTV MAX' }], isOn: anyAbove0(['SECOND LOAN LTV MAX']) },
        { col: 'SILENT SECOND', fixed: 'TRUE' },
    ] },
    { section: 'Property Types', items: [{ tiles: [
        { col: 'ALLOW SINGLE FAMILY', label: 'Single Family', icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>') },
        { col: 'ALLOW TOWNHOME', label: 'Townhome', icon: ICON('<path d="M2 11 7 6l5 5"/><path d="M12 11l5-5 5 5"/><path d="M4 10v11h16V10"/><path d="M12 11v10"/>') },
        { col: 'ALLOW CONDO', label: 'Condo', icon: ICON('<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M9 14h2M13 14h2"/><path d="M10 22v-4h4v4"/>') },
        { col: 'ALLOW MOBILE', label: 'Mobile', icon: ICON('<rect x="2" y="7" width="16" height="10" rx="1"/><path d="M18 11h3l1 3v3h-4"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>') },
        { col: 'ALLOW LAND', label: 'Land', icon: ICON('<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>') },
    ] }] },
    { section: 'Origination & Lender Credits', items: [
        { col: 'ORIGINATION FEE %' }, { col: 'ORIGINATION FEE $' },
        { gate: 'credit', label: 'Is there a lender credit?',
            items: [{ col: 'LENDER CREDIT % OF PURCHASE PRICE' }, { col: 'LENDER CREDIT % OF LOAN AMOUNT' }, { col: 'LENDER CREDIT FLAT $' }, { col: 'ADDITIONAL LENDER CREDIT' }],
            isOn: anyAbove0(['LENDER CREDIT % OF PURCHASE PRICE', 'LENDER CREDIT % OF LOAN AMOUNT', 'LENDER CREDIT FLAT $', 'ADDITIONAL LENDER CREDIT']) },
    ] },
    { section: 'Lender Fees', items: ['APPRAISAL FEE AT CLOSING', 'APPRAISAL DEPOSIT', 'APPRASIAL MANAGEMENT FEE', 'CREDIT REPORT FEE', 'FLOOD CERT FEE', 'TAX CERT FEE', 'OTHER FEE'].map(col => ({ col })) },
    { section: 'Mortgage Insurance', items: [
        { gate: 'prepaid', label: 'Is there prepaid mortgage insurance?',
            items: ['0%-5%', '5%-10%', '10%-20%', '20%+'].map(d => ({ col: 'PREPAID MORTGAGE INSURANCE RATE ' + d + ' DOWN' })),
            isOn: anyAbove0(['0%-5%', '5%-10%', '10%-20%', '20%+'].map(d => 'PREPAID MORTGAGE INSURANCE RATE ' + d + ' DOWN')) },
        { col: 'PMI LTV THRESHOLD' }, { col: 'LOAN PRODUCT PMI RATE' },
    ] },
    { section: 'Rates', items: DTI.map(s => ({ col: 'PAR RATE CREDIT SCORE ' + s })).concat([{ col: 'POINT RATE BUYDOWN AMOUNT' }]) },
    { section: 'Max DTI', items: DTI.map(s => ({ col: 'MAX DTI CREDIT SCORE ' + s })) },
    // No separate housing-only DTI: each housing-only column gets the matching Max DTI answer
    { section: 'Max DTI Housing Only', items: [
        { gate: 'housing', label: 'Is there a separate metric for housing-only DTI?',
            items: DTI.map(s => ({ col: 'MAX DTI HOUSING ONLY CREDIT SCORE ' + s })),
            isOn: v => DTI.some(s => num(v['MAX DTI HOUSING ONLY CREDIT SCORE ' + s]) !== num(v['MAX DTI CREDIT SCORE ' + s])),
            off: (col, v) => v[col.replace('MAX DTI HOUSING ONLY ', 'MAX DTI ')] },
    ] },
    { section: 'Income Qualifying', items: ['SALARY', 'HOURLY', '1099', 'TIP', 'COMMISSION', 'BONUS'].map(k => ({ col: k + ' QUALIFYING %' })) },
    { section: 'Escrow', items: [{ col: 'MONTHS COLLECTED FOR TAXES', input: 'stepper' }, { col: 'MONTHS COLLECTED FOR INSURANCE', input: 'stepper' }] },
    { section: 'Census Designation Credit', items: [
        { gate: 'census', label: 'Is there any credit given for the Census Designation?',
            items: DESIGNATIONS.map(d => ({ gate: 'census-' + d.toLowerCase(), col: 'CENSUS CREDIT ' + d, label: 'Credit for ' + d.charAt(0) + d.slice(1).toLowerCase() + '?',
                items: [{ col: 'CENSUS CREDIT % ' + d, label: d.charAt(0) + d.slice(1).toLowerCase() + ' Credit %' }], isOn: v => isTrue(v['CENSUS CREDIT ' + d]) })),
            isOn: v => DESIGNATIONS.some(d => isTrue(v['CENSUS CREDIT ' + d])) },
    ] },
];
const ESCROW_DEFAULT = '3';

// "MAX DTI HOUSING ONLY CREDIT SCORE 620-640" in the Max DTI Housing Only section reads "Credit Score 620-640"
const SECTION_PREFIX = { 'Rates': 'PAR RATE ', 'Max DTI': 'MAX DTI ', 'Max DTI Housing Only': 'MAX DTI HOUSING ONLY ' };
const UPPER = ['LTV', 'DTI', 'PMI', 'MI', 'FHA', 'VA', 'USDA', 'LLC', 'ID'];
const LOWER = ['of', 'for', 'at', 'and', 'or', 'to'];
export function labelFor(col, section) {
    let text = col.replace('APPRASIAL', 'APPRAISAL').replace('PREPAID MORTGAGE INSURANCE RATE', 'PREPAID MI RATE');
    const prefix = SECTION_PREFIX[section];
    if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length);
    return text.split(' ').map((w, i) => {
        if (UPPER.includes(w)) return w;
        const lower = w.toLowerCase();
        if (i > 0 && LOWER.includes(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join(' ');
}

// Saved value → what the box shows (rates as percents: 0.0275 → "2.75")
function shown(kind, raw) {
    const v = String(raw === undefined || raw === null ? '' : raw).trim();
    if (v === '' || kind === 'text' || kind === 'bool') return v;
    const n = Number(v.replace(/[$,%\s]/g, ''));
    if (!isFinite(n)) return '';
    if (kind === 'rate') return String(Number((n * 100).toPrecision(10)));
    if (kind === 'int') return String(Math.round(n));
    return withCommas(String(Number(n.toFixed(2))));
}
// "1234567.5" → "1,234,567.5" (the cents part is left as typed)
function withCommas(v) {
    const [whole, cents] = v.split('.');
    const w = whole.replace(/^0+(?=\d)/, '');
    return (w ? Number(w).toLocaleString('en-US') : (cents !== undefined ? '0' : '')) + (cents !== undefined ? '.' + cents : '');
}
// Digits and at most one dot, with at most `places` digits after it
function decimalOnly(v, places) {
    const clean = v.replace(/[^\d.]/g, '');
    const dot = clean.indexOf('.');
    if (dot < 0) return clean;
    return clean.slice(0, dot) + '.' + clean.slice(dot + 1).replace(/\./g, '').slice(0, places);
}

const yesNo = (name, attrs) => '<div class="type-picker yes-no" ' + attrs + '>'
    + '<input type="radio" name="' + name + '" id="' + name + '-yes" value="TRUE"><label for="' + name + '-yes">Yes</label>'
    + '<input type="radio" name="' + name + '" id="' + name + '-no" value="FALSE"><label for="' + name + '-no">No</label></div>';

// One column question (its box picked by the column's kind, or item.input)
function question(item, kind, section, n) {
    const id = 'lp-' + n;
    const label = escapeHtml(item.label || labelFor(item.col, section));
    // A list of choices (Product Type, Rate Type): a dropdown
    if (Array.isArray(kind)) {
        return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-col="' + escapeHtml(item.col) + '" data-kind="choice">'
            + '<option value="">Choose...</option>' + kind.map(c => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('') + '</select></div>';
    }
    const attrs = 'id="' + id + '" data-col="' + escapeHtml(item.col) + '" data-kind="' + kind + '"';
    const box = (cls, mode) => '<input ' + attrs + ' class="' + cls + '" type="text" inputmode="' + mode + '" autocomplete="off">';
    const wrap = (cls, inner) => '<div class="' + cls + '">' + inner + '</div>';
    const field = (inner, span) => '<div class="field' + (span ? ' span-2' : '') + '"' + (item.editOnly ? ' data-edit-only' : '') + '><label for="' + id + '">' + label + '</label>' + inner + '</div>';
    if (item.input === 'term') {
        return field('<select id="' + id + '" data-term><option value="">Choose...</option><option value="30">30</option><option value="15">15</option><option value="other">Other</option></select>')
            + '<div class="field" data-term-other hidden><label for="' + id + '-years">Loan Term (Years)</label><input id="' + id + '-years" data-col="' + escapeHtml(item.col) + '" data-kind="int" class="digits" type="text" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="Years"></div>';
    }
    if (item.input === 'stepper') {
        return field('<div class="lp-stepper"><button type="button" class="lp-step" data-step="-1" aria-label="Fewer months">−</button>'
            + box('digits', 'numeric').replace('autocomplete="off"', 'autocomplete="off" maxlength="2"')
            + '<button type="button" class="lp-step" data-step="1" aria-label="More months">+</button></div>');
    }
    if (kind === 'bool') return '<div class="field"><span class="field-label">' + label + '</span>' + yesNo(id, 'data-col="' + escapeHtml(item.col) + '" data-kind="bool"') + '</div>';
    if (kind === 'rate') return field(wrap('pct-wrap', box('pct', 'decimal')));
    if (kind === 'money') return field(wrap('money-wrap', box('money', 'numeric')));
    if (kind === 'cents') return field(wrap('money-wrap', box('money', 'decimal')));
    if (kind === 'int') return field(box('digits', 'numeric'));
    return field(box('', 'text'), true);
}

let built = null;

/**
 * Opens the loan product pop-up. fields: [{ section, col, kind }] from the API.
 * product: { row, values } to edit one, or null for a new one.
 * submit(values, row) must resolve once it's saved (or throw an Error whose message is the API's error code).
 */
export function openLoanProductForm({ fields, product, submit }) {
    if (!built) built = build();
    built.open({ fields, product, submit });
}

function build() {
    ensureDialogStyles();
    if (!document.getElementById('loan-products-css')) {
        const style = document.createElement('style');
        style.id = 'loan-products-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog loan-dialog';
    dialog.setAttribute('aria-labelledby', 'loan-dialog-title');
    dialog.innerHTML = '<form class="income-form" novalidate>'
        + '<div class="dialog-head"><h2 id="loan-dialog-title">Loan Product</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
        + '<p class="muted">Percentages are entered as percents (2.75 for 2.75%).</p>'
        + '<div class="dialog-scroll" data-sections></div>'
        + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
            + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
            + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span><span data-save-text>Save</span></button></div></div>'
        + '</form>';
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const saveBtn = $('[data-save]');
    const sectionsEl = $('[data-sections]');
    let ctx = null;
    let saving = false;
    let drawnFor = '';
    let layout = [];
    let kinds = {};

    // LAYOUT, minus columns the API doesn't know, plus an "Other" section for columns LAYOUT doesn't mention
    function layoutFor(fields) {
        kinds = {};
        fields.forEach(f => { kinds[f.col] = f.kind; });
        const used = {};
        const keep = items => items.map(it => {
            if (it.tiles) { const tiles = it.tiles.filter(t => kinds[t.col]); tiles.forEach(t => { used[t.col] = true; }); return tiles.length ? { tiles } : null; }
            if (it.gate) { if (it.col) used[it.col] = true; return { ...it, items: keep(it.items) }; }
            used[it.col] = true;
            return kinds[it.col] ? it : null;
        }).filter(Boolean);
        const out = LAYOUT.map(s => ({ section: s.section, items: keep(s.items) })).filter(s => s.items.length);
        const extra = fields.filter(f => !used[f.col]).map(f => ({ col: f.col, optional: f.section === 'Other' && f.kind === 'text' }));
        if (extra.length) out.push({ section: 'Other', items: extra });
        return out;
    }

    function itemsHtml(items, section, counter) {
        return items.map(it => {
            const n = counter.n++;
            if (it.fixed) return '';
            if (it.tiles) {
                return '<p class="lp-tiles-help">Select all that are allowed.</p><div class="lp-tiles">' + it.tiles.map(t => '<div class="lp-tile">'
                    + '<input type="checkbox" id="lp-' + n + '-' + escapeHtml(t.col) + '" data-col="' + escapeHtml(t.col) + '" data-kind="tile">'
                    + '<label for="lp-' + n + '-' + escapeHtml(t.col) + '"><span class="lp-tile-icon">' + t.icon + '</span>' + escapeHtml(t.label) + '</label></div>').join('') + '</div>';
            }
            if (it.gate) {
                return '<div class="field span-2"><span class="field-label">' + escapeHtml(it.label) + '</span>' + yesNo('lp-gate-' + it.gate, 'data-gate="' + it.gate + '"') + '</div>'
                    + '<div class="gate-body" data-gate-body="' + it.gate + '" hidden>' + itemsHtml(it.items, section, counter) + '</div>';
            }
            return question(it, kinds[it.col], section, n);
        }).join('');
    }

    // One fieldset per section, drawn again only when the list of questions changes
    function draw(fields) {
        const key = fields.map(f => f.section + '|' + f.col + '|' + f.kind).join('\n');
        if (key === drawnFor) return;
        drawnFor = key;
        layout = layoutFor(fields);
        const counter = { n: 0 };
        sectionsEl.innerHTML = layout.map(s => '<fieldset class="income-section"><div class="section-head"><h3>' + escapeHtml(s.section) + '</h3></div>'
            + '<div class="type-fields">' + itemsHtml(s.items, s.section, counter) + '</div></fieldset>').join('');
        sectionsEl.querySelectorAll('input[data-kind]').forEach(el => el.addEventListener('input', () => {
            const kind = el.dataset.kind;
            if (kind === 'int') el.value = el.value.replace(/\D/g, '');
            else if (kind === 'money') el.value = withCommas(el.value.replace(/\D/g, ''));
            else if (kind === 'cents') el.value = withCommas(decimalOnly(el.value, 2));
            else if (kind === 'rate') el.value = decimalOnly(el.value, 4);
            if (el.closest('.lp-stepper')) syncStepper(el);
        }));
        sectionsEl.querySelectorAll('[data-gate] input').forEach(r => r.addEventListener('change', showGates));
        const term = sectionsEl.querySelector('[data-term]');
        if (term) term.addEventListener('change', showTerm);
        sectionsEl.querySelectorAll('.lp-step').forEach(b => b.addEventListener('click', () => {
            const input = b.parentElement.querySelector('input');
            input.value = String(Math.max(0, Math.min(99, num(input.value) + Number(b.dataset.step))));
            input.classList.remove('is-invalid');
            syncStepper(input);
        }));
    }

    // No negative months: "−" stops at 0
    function syncStepper(input) {
        input.parentElement.querySelector('[data-step="-1"]').disabled = num(input.value) <= 0;
    }
    function showTerm() {
        const term = sectionsEl.querySelector('[data-term]');
        sectionsEl.querySelector('[data-term-other]').hidden = term.value !== 'other';
    }
    const gateAnswer = key => { const on = sectionsEl.querySelector('[data-gate="' + key + '"] input:checked'); return on ? on.value === 'TRUE' : null; };
    function showGates() {
        sectionsEl.querySelectorAll('[data-gate-body]').forEach(b => { b.hidden = gateAnswer(b.dataset.gateBody) !== true; });
    }

    // Puts a product's values in the boxes (a new product: blank, escrow months at 3, every yes/no unanswered)
    function fill(values, isNew) {
        const setGates = items => items.forEach(it => {
            if (!it.gate) return;
            const on = isNew ? null : it.isOn(values);
            sectionsEl.querySelectorAll('[data-gate="' + it.gate + '"] input').forEach(r => { r.checked = on !== null && r.value === String(on).toUpperCase(); });
            // Columns under a "no" start empty, so a switch to "yes" doesn't show the stand-in values
            if (on === false) clearUnder(it.items);
            setGates(it.items);
        });
        const clearUnder = items => items.forEach(it => { if (it.gate) clearUnder(it.items); else if (it.col) cleared[it.col] = true; });
        const cleared = {};
        layout.forEach(s => setGates(s.items));
        sectionsEl.querySelectorAll('[data-col]').forEach(el => {
            const col = el.dataset.col;
            const kind = el.dataset.kind;
            const raw = cleared[col] ? '' : values[col];
            if (kind === 'tile') el.checked = isTrue(raw);
            else if (kind === 'bool') el.querySelectorAll('input').forEach(r => { r.checked = String(raw || '').trim().toUpperCase() === r.value; });
            else if (kind === 'choice') {
                const pick = [...el.options].find(o => o.value && o.value.toLowerCase() === String(raw || '').trim().toLowerCase());
                el.value = pick ? pick.value : '';
            }
            else el.value = isNew && el.closest('.lp-stepper') ? ESCROW_DEFAULT : shown(kind, raw);
            if (el.closest('.lp-stepper')) syncStepper(el);
        });
        const term = sectionsEl.querySelector('[data-term]');
        if (term) {
            const years = String(values['LOAN TERM'] || '').trim();
            term.value = !years ? '' : years === '30' || years === '15' ? years : 'other';
            sectionsEl.querySelector('[data-term-other] input').value = term.value === 'other' ? shown('int', years) : '';
            showTerm();
        }
        sectionsEl.querySelectorAll('[data-edit-only]').forEach(f => { f.hidden = isNew; });
        showGates();
    }

    // Every field's value to save (rates back to decimals). missing: the first unanswered question shown.
    function read() {
        const values = {};
        const offs = [];
        let missing = null;
        const need = (el, v) => { if (v === '' && !missing) missing = el; };
        const boxValue = el => {
            let v = el.value.trim().replace(/,/g, '');
            if (el.dataset.kind === 'rate' && v !== '') v = String(Number((Number(v) / 100).toPrecision(10)));
            return v;
        };
        const offValue = (col, off) => (off ? off(col, values) : kinds[col] === 'bool' ? 'FALSE' : '0');
        const walk = (items, active, off) => items.forEach(it => {
            if (it.fixed) { values[it.col] = it.fixed; return; }
            if (it.tiles) { it.tiles.forEach(t => { values[t.col] = sectionsEl.querySelector('[data-col="' + t.col + '"]').checked ? 'TRUE' : 'FALSE'; }); return; }
            if (it.gate) {
                const on = active ? gateAnswer(it.gate) : false;
                if (on === null) need(sectionsEl.querySelector('[data-gate="' + it.gate + '"]'), '');
                if (it.col) values[it.col] = on ? 'TRUE' : 'FALSE';
                walk(it.items, on === true, it.off || off);
                return;
            }
            if (!active) { offs.push([it.col, off]); return; }
            // A new product's lender name is the bank on file (the API fills it in)
            if (it.editOnly && !ctx.product) return;
            if (it.input === 'term') {
                const term = sectionsEl.querySelector('[data-term]');
                const other = sectionsEl.querySelector('[data-term-other] input');
                values[it.col] = term.value === 'other' ? other.value.trim() : term.value;
                need(term.value === 'other' ? other : term, values[it.col]);
                return;
            }
            const el = sectionsEl.querySelector('[data-col="' + it.col + '"]');
            values[it.col] = el.dataset.kind === 'bool' ? ((el.querySelector('input:checked') || {}).value || '') : boxValue(el);
            if (!it.optional) need(el, values[it.col]);
        });
        layout.forEach(s => walk(s.items, true, null));
        // After the answers, so "same as Max DTI" can copy them
        offs.forEach(([col, off]) => { values[col] = offValue(col, off); });
        return { values, missing };
    }

    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
    const clear = e => { const el = e.target.closest('[data-col], [data-gate], [data-term]'); if (el) el.classList.remove('is-invalid'); message.textContent = ''; };
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);

    const problem = (el, text) => {
        if (el) {
            el.classList.add('is-invalid');
            const focusable = el.matches('input, select') ? el : el.querySelector('input');
            if (focusable) focusable.focus({ preventScroll: true });
            el.scrollIntoView({ block: 'center' });
        }
        message.textContent = text;
    };
    const ERRORS = {
        duplicate_name: 'You already have a loan product with that name.',
        invalid_value: 'One of the answers isn’t valid. Percentages can’t be over 100.',
        not_found: 'That loan product couldn’t be found. Please refresh and try again.',
        no_lender_bank: 'Your account doesn’t have a lender bank on file yet. Please ask Andrew to add it.',
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        message.textContent = '';
        const { values, missing } = read();
        if (missing) {
            const field = missing.closest('.field');
            const name = field ? field.querySelector('label, .field-label').textContent : 'this question';
            problem(missing, 'Please answer "' + name + '".');
            return;
        }
        const bad = [...sectionsEl.querySelectorAll('input[data-kind="rate"]')].find(el => el.offsetParent && Number(el.value) > 100);
        if (bad) { problem(bad, 'Percentages can’t be over 100.'); return; }
        saving = true;
        saveBtn.disabled = true;
        saveBtn.classList.add('is-loading');
        try {
            await ctx.submit(values, ctx.product ? ctx.product.row : null);
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = ERRORS[err.message] || 'We couldn’t save the loan product. Please try again.';
            if (err.message === 'duplicate_name') problem(sectionsEl.querySelector('[data-col="LOAN PRODUCT NAME"]'), ERRORS.duplicate_name);
        } finally {
            saving = false;
            saveBtn.disabled = false;
            saveBtn.classList.remove('is-loading');
        }
    });

    return {
        open(next) {
            ctx = next;
            draw(ctx.fields);
            dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            message.textContent = '';
            fill(ctx.product ? ctx.product.values : {}, !ctx.product);
            $('#loan-dialog-title').textContent = ctx.product ? 'Edit Loan Product' : 'New Loan Product';
            $('[data-save-text]').textContent = ctx.product ? 'Save Changes' : 'Add Loan Product';
            dialog.showModal();
            lockPageScroll(dialog);
            sectionsEl.scrollTop = 0;
        },
    };
}
