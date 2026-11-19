// "New Property" for the home page's My Sellers card (admins): a new Seller Net sheet, one question at a time.
// Asks who's selling, the address, the property's details (one question: looked up from the property APIs once the
// address is chosen, to check or change), the sale price, the seller's loan (Agent Loan Input's questions, so they're all
// filled in) and the title company. Everything else starts at the API's defaults (createProperty_), changed on the page;
// the seller's own questions (Client Loan / HOA Input) they answer on the page.
// Uses the income editor's pop-up styles: a card on wide screens, a swipe-up sheet on phones, which (on phones) stays
// above the on-screen keyboard and keeps the box being typed in in view.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';
import { ensurePickerStyles, multiPicker, loadPlaces } from '/new-property.js';

const MAX_OTHERS = 5; // six people on a page: the seller plus five more
const PROPERTY_TYPES = ['Single Family', 'Townhome', 'Condo', 'Manufactured'];
// The page's loan types (pages.html LOAN_TYPES). No Loan skips every loan question.
const LOAN_TYPES = ['Conventional', 'FHA', 'VA', 'DSCR', 'Hard Money', 'Jumbo', 'Other', 'No Loan'];
// Loan Term (as pages.html's): the loan type's usual terms ([months, name]), or Other, typed in years (Hard Money: months)
const termInMonths = type => type === 'Hard Money';
const loanTermPresets = type => (type === 'Hard Money' ? [6, 9, 12, 18, 24].map(m => [String(m), m + ' Months'])
    : type === 'DSCR' ? [['360', '30 Years'], ['480', '40 Years']] : [['360', '30 Years'], ['180', '15 Years']]);
// The property details the lookup fills in (the bundled question's boxes, after the property type)
const FACTS = [
    { key: 'beds', label: 'Bedrooms', format: 'int', placeholder: '3', name: 'number of bedrooms' },
    { key: 'baths', label: 'Bathrooms', format: 'decimal', placeholder: '2', name: 'number of bathrooms', help: 'Half baths count as .5 (2.5 for two full and one half).' },
    { key: 'sqft', label: 'Square Feet', format: 'int', commas: true, placeholder: '1,800', name: 'square feet' },
    { key: 'yearBuilt', label: 'Year Built', format: 'year', placeholder: '1995', name: 'year built' },
    { key: 'taxes', label: 'Yearly Property Taxes', format: 'money', placeholder: '2,400', name: 'yearly taxes' },
];

const CSS = `
.snw-dialog .snw-progress { display: flex; align-items: center; gap: 12px; padding: 0 28px 14px 28px; }
.snw-dialog .snw-bar { flex: 1; height: 6px; border-radius: 999px; background: #efe9e1; overflow: hidden; }
.snw-dialog .snw-bar span { display: block; height: 100%; border-radius: inherit; background: var(--olive); transform-origin: left; transition: transform 0.35s var(--ease); }
.snw-dialog .snw-count { font-size: 0.8rem; font-weight: bold; opacity: 0.6; white-space: nowrap; }
.snw-dialog .dialog-scroll { padding-top: 22px; padding-bottom: 22px; min-height: 260px; }
.snw-dialog .snw-step { animation: snwIn 0.3s var(--ease); }
.snw-dialog .snw-step.is-back { animation-name: snwBack; }
@keyframes snwIn { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
@keyframes snwBack { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
.snw-dialog .snw-eyebrow { display: block; margin-bottom: 6px; font-size: 0.72rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.snw-dialog .snw-question { font-family: 'Bricolage Grotesque', sans-serif; font-size: 1.45rem; line-height: 1.2; color: var(--navy); }
.snw-dialog .snw-help { margin: 8px 0 0 0; font-size: 0.92rem; opacity: 0.72; }
.snw-dialog .snw-unit { margin-top: 14px; max-width: 220px; }
.snw-dialog .snw-other { max-width: 260px; }
.snw-dialog .snw-other[hidden] { display: none; }
.snw-dialog .snw-body { margin-top: 18px; display: grid; gap: 14px; }
/* One box per line, never side by side */
.snw-dialog .snw-facts { display: grid; gap: 16px; }
.snw-dialog .snw-facts .field-help { margin: 6px 0 0 8px; }
.snw-dialog .field input[type="date"] { font-family: inherit; font-size: 1rem; color: var(--brown); }
.snw-dialog .suffix-wrap { position: relative; }
.snw-dialog .suffix-wrap input { padding-right: 84px; }
.snw-dialog .suffix-wrap span { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.snw-dialog .type-picker.snw-choice { grid-template-columns: repeat(var(--n, 2), 1fr); margin: 0; border-radius: 22px; }
.snw-dialog .type-picker.snw-choice label { display: flex; align-items: center; justify-content: center; min-height: 48px; margin: 0; border-radius: 18px; text-align: center; font-size: 0.95rem; }
/* The property APIs' answer */
.snw-dialog .snw-found { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 14px; font-size: 0.88rem; font-weight: bold; background: #eef3e6; color: var(--olive); }
.snw-dialog .snw-found + .snw-found { margin-top: 8px; }
.snw-dialog .snw-found.is-pending { background: #f4efe8; color: var(--brown); font-weight: normal; }
.snw-dialog .snw-found.is-missing { background: #fdf6e9; color: var(--brown); font-weight: normal; border: 1px dashed rgba(192, 144, 80, 0.7); }
.snw-dialog .snw-found svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.snw-dialog .snw-spin { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; border-radius: 50%; border: 3px solid rgba(78, 81, 62, 0.2); border-top-color: var(--olive); animation: spin 0.8s linear infinite; }
/* Other holdbacks: a card per holdback (its name, then its amount) */
.snw-dialog .snw-lines { display: grid; gap: 14px; }
.snw-dialog .snw-line { display: grid; gap: 12px; padding: 14px; border-radius: 16px; background: #fbf9f6; border: 1px solid rgba(78, 81, 62, 0.15); }
/* Review */
.snw-dialog .snw-review { list-style: none; display: grid; gap: 0; margin: 0; padding: 0; }
.snw-dialog .snw-review li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 4px; border-bottom: 1px solid rgba(78, 81, 62, 0.12); }
.snw-dialog .snw-review .k { flex: 0 0 auto; font-weight: bold; font-size: 0.92rem; }
.snw-dialog .snw-review .v { flex: 1; min-width: 0; text-align: right; overflow-wrap: anywhere; font-size: 0.92rem; }
.snw-dialog .snw-review button { flex: 0 0 auto; padding: 4px 2px; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: bold; color: var(--rust); text-decoration: underline; text-underline-offset: 3px; }
.snw-dialog .snw-review .snw-review-head { min-height: 0; padding: 16px 4px 4px 4px; border: none; font-size: 0.72rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.snw-dialog .snw-review .snw-review-head:first-child { padding-top: 0; }
.snw-dialog .snw-defaults { margin: 18px 0 0 0; padding: 12px 14px; border-radius: 14px; background: #f4efe8; font-size: 0.88rem; line-height: 1.45; }
.snw-dialog .dialog-foot .form-actions { justify-content: space-between; }
.snw-dialog .dialog-foot .form-actions .btn[hidden] { display: none; }
.snw-dialog .snw-spacer { flex: 1; }
@media (max-width: 600px) {
    .snw-dialog .snw-question { font-size: 1.25rem; }
    .snw-dialog .type-picker.snw-choice { grid-template-columns: 1fr 1fr; }
    .snw-dialog .snw-progress { padding: 0 20px 12px 20px; }
    .snw-dialog .dialog-scroll { min-height: 0; padding-top: 18px; padding-bottom: 18px; }
    /* Back and Next side by side, so the footer takes one row (more room above the keyboard) */
    .snw-dialog .dialog-foot .form-actions { flex-direction: row; gap: 10px; margin-top: 0; }
    .snw-dialog .dialog-foot .form-actions .btn { width: auto; flex: 1; min-height: 50px; padding-top: 10px; padding-bottom: 10px; }
    .snw-dialog .dialog-foot .form-actions .btn-secondary { flex: 0 0 auto; padding-left: 22px; padding-right: 22px; }
    .snw-dialog .snw-spacer { display: none; }
    /* While the on-screen keyboard is up: the sheet sits on top of it, sized to what's left of the screen. It moves and
       resizes together, with the keyboard's own easing (fast, then settling), so it glides up alongside it; nothing
       inside it changes size. */
    .snw-dialog { translate: 0 calc(-1 * var(--snw-kb, 0px)); transition: translate 0.3s cubic-bezier(0.2, 0, 0, 1); }
    .snw-dialog .income-form { transition: max-height 0.3s cubic-bezier(0.2, 0, 0, 1); }
    .snw-dialog.is-keyboard .income-form { max-height: calc(var(--snw-vh, 100dvh) - 10px); }
}
@media (prefers-reduced-motion: reduce) { .snw-dialog .snw-step { animation: none; } .snw-dialog, .snw-dialog .income-form { transition: none; } }
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const INFO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatPhone = id => (id.length === 10 ? '(' + id.slice(0, 3) + ') ' + id.slice(3, 6) + '-' + id.slice(6) : id);
const nameOf = a => a.name || formatPhone(a.id);
const digits = v => String(v ?? '').replace(/\D/g, '');
const commas = n => (n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString('en-US'));
const money = n => '$' + commas(Math.round(Number(n) || 0));
// "2.5" (typed) <-> 0.025 (stored)
const pctOf = rate => (rate === '' || rate === null || rate === undefined ? '' : String(Math.round(Number(rate) * 100 * 10000) / 10000));
const rateOf = typed => { const s = String(typed).replace(/[%\s,]/g, ''); return s === '' || !isFinite(Number(s)) ? '' : Math.round(Number(s) / 100 * 1e6) / 1e6; };
const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mdy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : ''; };
const niceDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
// A term in months for the review: "30 years", "2.5 years", "12 months"
const termText = (months, type) => {
    const m = Number(months);
    if (!m) return '';
    if (termInMonths(type) || m < 12) return m + (m === 1 ? ' month' : ' months');
    const y = Math.round(m / 12 * 100) / 100;
    return y + (y === 1 ? ' year' : ' years');
};
const listText = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

// How the sheet fits an on-screen keyboard. layoutHeight: the page's full height (window.innerHeight, which the keyboard
// doesn't change); visibleHeight and offsetTop: the part of it showing (window.visualViewport) and how far down that part
// is, once the browser has scrolled the page to show the box being typed in (as Chrome does when a box is tapped again
// while the sheet is down at the bottom). → { up: a keyboard is showing (the visible part is over 80px shorter, more than
// any browser toolbar; however far it's scrolled), lift: how far the sheet moves up to sit on it (what the keyboard covers
// of the page's bottom, less what the scroll already brought into view) }
export function keyboardFit(layoutHeight, visibleHeight, offsetTop) {
    const up = layoutHeight - visibleHeight > 80;
    return { up, lift: up ? Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop)) : 0 };
}

/**
 * Opens the form for one seller. client: { id, name }; sellers: the other SELLER accounts; accounts: everyone (for
 * collaborators); titleCompanies: [{ id, name }]; lookup(address) resolves to { facts, sources } (the propertyFacts API);
 * submit(answers) resolves once the page is saved (or throws).
 */
let built = null;
export function openNewSellerNetForm(ctx) {
    if (!built) built = build();
    built.open(ctx);
}

function build() {
    ensureDialogStyles();
    ensurePickerStyles();
    if (!document.getElementById('new-seller-net-css')) {
        const style = document.createElement('style');
        style.id = 'new-seller-net-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog property-dialog snw-dialog';
    dialog.setAttribute('aria-labelledby', 'snw-title');
    dialog.innerHTML = '<form class="income-form" novalidate>'
        + '<div class="dialog-head"><h2 id="snw-title">New Seller Net Sheet</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
        + '<div class="snw-progress"><div class="snw-bar"><span></span></div><span class="snw-count"></span></div>'
        + '<div class="dialog-scroll" aria-live="polite"></div>'
        + '<div class="dialog-foot"><p class="form-message" role="alert"></p><div class="form-actions">'
            + '<button type="button" class="btn btn-secondary" data-back>Back</button><span class="snw-spacer"></span>'
            + '<button type="submit" class="btn" data-next><span class="btn-spinner" aria-hidden="true"></span><span data-next-text>Next</span></button>'
        + '</div></div></form>';
    document.body.append(dialog);
    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const scroll = $('.dialog-scroll');
    const message = $('.form-message');
    const backBtn = $('[data-back]');
    const nextBtn = $('[data-next]');

    let ctx = null;
    let a = {};          // the answers
    let touched = {};    // facts typed in by hand (a new lookup won't replace them)
    let lookup = null;   // { key, state: 'pending' | 'done' | 'failed', facts, sources }
    let index = 0;
    let fromReview = false;
    let current = null;  // the shown step's { read() -> error text or '', refill?() }
    let saving = false;

    // No Loan: nothing to pay off
    const hasLoan = () => a.loanType !== 'No Loan';
    const isDscr = () => a.loanType === 'DSCR';
    const isHardMoney = () => a.loanType === 'Hard Money';
    const ioPeriod = () => isDscr() && a.ioPeriod === 'Yes';

    // --- The questions, in order. show(): asked only when it returns true. answered(): it has an answer (for going back
    // to the review after a change: a question that change opened and still needs one comes first). ---
    const has = key => () => a[key] !== undefined && a[key] !== '';
    const STEPS = [
        { id: 'sellers', group: 'People', title: 'Who else is selling?', help: 'Anyone else on the title. Leave it empty if it’s just the seller.', kind: 'people', which: 'sellers' },
        { id: 'collaborators', group: 'People', title: 'Anyone else who should see this sheet?', help: 'Collaborators can view the page but aren’t selling. Up to six people in all.', kind: 'people', which: 'collaborators' },
        { id: 'address', group: 'Property', title: 'What’s the property address?', help: 'Add the unit number for a condo, townhome or apartment.', kind: 'address' },
        { id: 'facts', group: 'Property', title: 'Check the property details', help: 'Looked up from the property APIs. Change anything that’s wrong.', kind: 'facts',
            answered: () => Boolean(a.propertyType) && FACTS.every(f => has(f.key)()) },
        { id: 'price', group: 'Sale', title: 'What’s the expected sale price?', kind: 'number', key: 'price', format: 'money', placeholder: '450,000', answered: has('price') },
        // The seller's loan: Agent Loan Input's questions
        { id: 'loanType', group: 'Loan Payoff', title: 'What kind of loan does the seller have?', help: 'Choose No Loan if the home is paid off.', kind: 'choice', key: 'loanType', options: LOAN_TYPES, answered: has('loanType') },
        { id: 'loanAmount', group: 'Loan Payoff', title: 'What was the original loan amount?', help: 'The seller’s mortgage when it was taken out.', kind: 'number', key: 'loanAmount', format: 'money', placeholder: '360,000', show: hasLoan, answered: has('loanAmount') },
        { id: 'loanDate', group: 'Loan Payoff', title: 'When was the loan taken out?', kind: 'date', key: 'loanDate', show: hasLoan, answered: has('loanDate') },
        { id: 'loanTerm', group: 'Loan Payoff', title: 'What was the original loan term?', kind: 'term', key: 'loanTermMonths', show: hasLoan, answered: has('loanTermMonths') },
        { id: 'loanRate', group: 'Loan Payoff', title: 'What’s the estimated interest rate?', help: 'Used to estimate the loan balance until the seller enters their actual rate.', kind: 'number', key: 'estRate', format: 'percent', placeholder: '6.5', show: hasLoan, answered: has('estRate') },
        { id: 'ioPeriod', group: 'Loan Payoff', title: 'Is there an interest only period?', kind: 'choice', key: 'ioPeriod', options: ['Yes', 'No'], show: isDscr, answered: has('ioPeriod') },
        { id: 'dueAfter', group: 'Loan Payoff', title: 'Does the loan become due after the interest only period?', kind: 'choice', key: 'dueAfter', options: ['Yes', 'No'], show: ioPeriod, answered: has('dueAfter') },
        { id: 'ioYears', group: 'Loan Payoff', title: 'How long is the interest only period?', kind: 'number', key: 'ioYears', format: 'decimal', suffix: 'years', placeholder: '10',
            show: () => ioPeriod() && a.dueAfter === 'No', answered: has('ioYears') },
        { id: 'construction', group: 'Loan Payoff', title: 'How much is the lender holding back for construction?', help: 'What’s left of the construction holdback, credited back at closing. Enter 0 for none.', kind: 'number', key: 'construction', format: 'money', placeholder: '0', show: isHardMoney, answered: has('construction') },
        { id: 'reserve', group: 'Loan Payoff', title: 'How much is in the interest reserve?', help: 'Money the lender is holding for interest payments, credited back at closing. Enter 0 for none.', kind: 'number', key: 'reserve', format: 'money', placeholder: '0', show: isHardMoney, answered: has('reserve') },
        { id: 'holdbacks', group: 'Loan Payoff', title: 'Any other holdbacks?', help: 'Anything else the lender is holding back, each with its amount.', kind: 'holdbacks', show: isHardMoney, answered: has('hasOtherHoldbacks') },
        // (its choices are the title companies in Settings, filled in when the form opens)
        { id: 'titleCompany', group: 'Costs', title: 'Which title company?', help: 'Its filed rates price the escrow fee, recording and owner’s title policy. You can change it on the page.', kind: 'choice', key: 'titleCompanyName', options: [], answered: has('titleCompanyName') },
        { id: 'review', group: 'Review', title: 'Look it over', kind: 'review' },
    ];
    const shown = () => STEPS.filter(s => !s.show || s.show());

    // --- Pieces ---
    // "Apt 4B", "#4b", "Unit 4B" -> "4B"
    const cleanUnit = v => String(v || '').trim().replace(/^(#|(unit|apt|apartment|ste|suite|no\.?|number)\b)\s*#?\s*/i, '').replace(/\s+/g, '').toUpperCase();
    const UNIT_AT_END = /^(.*?\S)\s*,?\s*((?:#|\b(?:unit|apt|apartment|ste|suite)\b\.?)\s*#?\s*(?:[\w-]*\d[\w-]*|[a-z]))$/i;
    const field = (label, inner, id) => '<div class="field">' + (label ? '<label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' : '') + inner + '</div>';
    // (enterkeyhint: the phone keyboard's Enter key says Next, and moves on: to the next box, or the next question)
    const input = (id, { format, placeholder = '', value = '', suffix } = {}) => {
        const mode = format === 'decimal' || format === 'percent' ? 'decimal' : format === 'text' ? 'text' : 'numeric';
        const box = '<input id="' + id + '" type="text" inputmode="' + mode + '" enterkeyhint="next" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '"' + (format === 'money' ? ' class="money"' : '') + '>';
        if (format === 'money') return '<div class="money-wrap">' + box + '</div>';
        if (format === 'percent' || suffix) return '<div class="suffix-wrap">' + box + '<span>' + (format === 'percent' ? '%' : esc(suffix)) + '</span></div>';
        return box;
    };
    // Commas while typing money and big whole numbers; digits only for years; digits and one dot for the rest
    const liveFormat = (el, format, withCommas) => el.addEventListener('input', () => {
        if (format === 'money' || withCommas) { const d = digits(el.value).replace(/^0+(?=\d)/, ''); el.value = d ? Number(d).toLocaleString('en-US') : ''; }
        else if (format === 'int' || format === 'year') el.value = digits(el.value).slice(0, format === 'year' ? 4 : 9);
        else el.value = el.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    });
    const choice = (name, options, value, labels) => '<div class="type-picker snw-choice" style="--n:' + Math.min(options.length, 4) + '" role="radiogroup">'
        + options.map((o, i) => '<input type="radio" name="' + name + '" id="' + name + '-' + i + '" value="' + esc(o) + '"' + (o === value ? ' checked' : '') + '><label for="' + name + '-' + i + '">' + esc(labels ? labels[i] : o) + '</label>').join('') + '</div>';
    const picked = name => { const r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };
    // A typed number by its format, or { error }
    function readNumber(raw, format, name) {
        const t = String(raw).trim();
        if (t === '') return { error: 'Please enter the ' + name + (format === 'money' ? ' (0 counts).' : '.') };
        if (format === 'percent') { const v = rateOf(t); return v === '' || v > 1 ? { error: 'Please enter a percent between 0 and 100.' } : { v }; }
        if (format === 'decimal') { const v = Number(t); return !isFinite(v) || v < 0 || v > 50 ? { error: 'Please enter a number like 2 or 2.5.' } : { v: Math.round(v * 100) / 100 }; }
        const v = Number(digits(t));
        if (format === 'year') { const last = new Date().getFullYear() + 1; if (v < 1850 || v > last) return { error: 'Please enter a year between 1850 and ' + last + '.' }; }
        return { v };
    }

    // What the property APIs said, for the bundled property details
    function factsNote() {
        if (!lookup || lookup.state === 'pending') return '<div class="snw-found is-pending"><span class="snw-spin" aria-hidden="true"></span><span>Looking this home up in the property APIs…</span></div>';
        if (lookup.state === 'failed') return '<div class="snw-found is-missing">' + INFO_ICON + '<span>The property lookup didn’t work this time. Please enter the details.</span></div>';
        const f = lookup.facts || {};
        const gap = k => f[k] === '' || f[k] === undefined || f[k] === null;
        const missing = [{ key: 'propertyType', name: 'property type' }].concat(FACTS).filter(x => gap(x.key) && !touched[x.key]).map(x => x.name);
        const found = ['propertyType'].concat(FACTS.map(x => x.key)).some(k => !gap(k));
        const sources = (lookup.sources || []).map(s => s.replace(/\s*\(RapidAPI\)$/, ''));
        return (found ? '<div class="snw-found">' + CHECK_ICON + '<span>Found ' + esc(sources.length ? 'on ' + listText(sources) : 'automatically') + '. Change anything that’s wrong.</span></div>' : '')
            + (missing.length ? '<div class="snw-found is-missing">' + INFO_ICON + '<span>The property APIs didn’t have the ' + esc(listText(missing)) + '. Please enter ' + (missing.length === 1 ? 'it' : 'them') + '.</span></div>' : '');
    }

    // Fills in what the lookup found, unless it was typed in by hand
    function applyLookup() {
        if (!lookup || lookup.state !== 'done') return;
        const f = lookup.facts || {};
        ['propertyType'].concat(FACTS.map(x => x.key)).forEach(key => {
            if (!touched[key] && f[key] !== '' && f[key] !== undefined && f[key] !== null) a[key] = key === 'propertyType' ? f[key] : String(Math.round(Number(f[key]) * (key === 'baths' ? 100 : 1)) / (key === 'baths' ? 100 : 1));
        });
    }
    function startLookup() {
        const addr = a.address;
        const key = addr ? [addr.street, addr.city, addr.state, addr.zip].join('|').toLowerCase() : '';
        if (!key || (lookup && lookup.key === key)) return;
        // A new address: what the last one found no longer applies
        if (lookup && lookup.state === 'done') {
            const f = lookup.facts || {};
            ['propertyType'].concat(FACTS.map(x => x.key)).forEach(k => { if (!touched[k] && f[k] !== '' && f[k] !== undefined) a[k] = ''; });
        }
        const mine = lookup = { key, state: 'pending', facts: null, sources: [] };
        Promise.resolve(ctx.lookup(addr)).then(res => {
            if (lookup !== mine) return;
            mine.state = 'done';
            mine.facts = res.facts || {};
            mine.sources = res.sources || [];
            applyLookup();
        }).catch(err => {
            console.error('Property lookup failed:', err);
            if (lookup === mine) mine.state = 'failed';
        }).finally(() => {
            // The property details question, if it's showing: fill in its boxes (nothing typed is replaced, and the box
            // being typed in keeps its place)
            if (lookup === mine && dialog.open && STEPS[index].kind === 'facts' && current && current.refill) current.refill();
        });
    }

    // --- Each kind of question: draws itself into body, returns { read() -> error text or '' } ---
    const KINDS = {
        people(step, body) {
            body.innerHTML = '<span class="sr-only" id="snw-people-label">' + esc(step.title) + '</span><div data-people></div>';
            // The people chosen on the other question, plus the ones picked here
            const others = () => (step.which === 'sellers' ? a.collaborators || [] : a.sellers || []).length;
            const picker = multiPicker(body.querySelector('[data-people]'), {
                labelId: 'snw-people-label',
                placeholder: step.which === 'sellers' ? 'Just ' + nameOf(ctx.client) : 'No collaborators',
                items: () => step.which === 'sellers'
                    ? ctx.sellers.filter(s => s.id !== ctx.client.id)
                    : ctx.accounts.filter(p => p.id !== ctx.client.id && !(a.sellers || []).includes(p.id)),
                canAdd: () => others() + picker.value().length < MAX_OTHERS,
                onChange: () => {},
            });
            // What was chosen before (Back, or changing it from the review)
            picker.set(a[step.which] || []);
            return { read() { a[step.which] = picker.value(); if (step.which === 'sellers') a.collaborators = (a.collaborators || []).filter(id => !a.sellers.includes(id)); return ''; } };
        },
        address(step, body) {
            const ad = a.address || {};
            // ad.line1: the street without the unit (ad.street has both, "123 Main St #4")
            const line1 = ad.line1 ?? ad.street ?? '';
            body.innerHTML = '<div data-search>' + field('', '<input id="snw-address" type="text" placeholder="Start typing the address" autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="snw-address-list" aria-label="Property address" value="' + esc(line1) + '">')
                + '<div class="addr-suggestions" id="snw-address-list" role="listbox"></div>'
                + '<p class="addr-selected"' + (ad.city ? '' : ' hidden') + '>' + CHECK_ICON + '<span>' + esc([ad.city, ((ad.state || '') + ' ' + (ad.zip || '')).trim()].filter(Boolean).join(', ')) + '</span></p></div>'
                + '<div class="addr-manual" hidden>'
                    + '<div class="field span-2" style="grid-column: 1 / -1"><label for="snw-street">Street Address</label><input id="snw-street" type="text" enterkeyhint="next" autocomplete="off" placeholder="123 Main St"></div>'
                    + field('City', '<input id="snw-city" type="text" enterkeyhint="next" autocomplete="off" placeholder="Phoenix">', 'snw-city')
                    + field('State', '<input id="snw-state" type="text" enterkeyhint="next" autocomplete="off" maxlength="20" placeholder="AZ">', 'snw-state')
                    + field('Zip', '<input id="snw-zip" type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off" maxlength="10" placeholder="85251">', 'snw-zip')
                + '</div>'
                + '<div class="snw-unit">' + field('Unit (optional)', '<input id="snw-unit" type="text" enterkeyhint="next" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="e.g. 204" value="' + esc(ad.unit || '') + '">', 'snw-unit') + '</div>'
                + '<button type="button" class="addr-toggle">Can’t find it? Enter the address manually</button>';
            const unitBox = body.querySelector('#snw-unit');
            const search = body.querySelector('#snw-address');
            const list = body.querySelector('.addr-suggestions');
            const selected = body.querySelector('.addr-selected');
            const manual = body.querySelector('.addr-manual');
            const searchWrap = body.querySelector('[data-search]');
            const toggle = body.querySelector('.addr-toggle');
            const parts = { street: body.querySelector('#snw-street'), city: body.querySelector('#snw-city'), state: body.querySelector('#snw-state'), zip: body.querySelector('#snw-zip') };
            let chosen = ad.city ? { ...ad, street: line1 } : null;
            let places = null, session = null, results = [], highlighted = -1, timer = null, req = 0;
            const showManual = on => {
                manual.hidden = !on;
                searchWrap.hidden = on;
                toggle.textContent = on ? 'Search for the address instead' : 'Can’t find it? Enter the address manually';
                if (on && chosen) Object.keys(parts).forEach(k => { parts[k].value = chosen[k] || ''; });
                (on ? parts.street : search).focus();
            };
            toggle.addEventListener('click', () => showManual(manual.hidden));
            const closeList = () => { list.classList.remove('is-open'); search.setAttribute('aria-expanded', 'false'); highlighted = -1; };
            const drawList = () => {
                if (!results.length) { closeList(); return; }
                list.innerHTML = results.map((s, i) => {
                    const p = s.placePrediction;
                    return '<div class="addr-option' + (i === highlighted ? ' is-active' : '') + '" role="option" data-i="' + i + '">' + PIN_ICON
                        + '<span class="addr-option-text"><span class="addr-main">' + esc(p.mainText ? p.mainText.text : p.text.text) + '</span>'
                        + '<span class="addr-secondary">' + esc(p.secondaryText ? p.secondaryText.text : '') + '</span></span></div>';
                }).join('') + '<div class="addr-credit">Google Maps</div>';
                list.querySelectorAll('.addr-option').forEach(o => {
                    o.addEventListener('pointerdown', e => e.preventDefault());
                    o.addEventListener('click', () => choose(Number(o.dataset.i)));
                });
                list.classList.add('is-open');
                search.setAttribute('aria-expanded', 'true');
                // (on a phone, the suggestions can open under the keyboard)
                keepInView(list);
            };
            const fetchList = async text => {
                const id = ++req;
                try {
                    places = places || await loadPlaces();
                    session = session || new places.AutocompleteSessionToken();
                    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                        input: text, sessionToken: session, includedRegionCodes: ['us'],
                        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
                        locationBias: { center: { lat: 33.4484, lng: -112.074 }, radius: 50000 },
                    });
                    if (id !== req) return;
                    results = (suggestions || []).filter(s => s.placePrediction).slice(0, 4);
                    highlighted = -1;
                    drawList();
                } catch (err) {
                    console.error('Google address suggestions unavailable:', err);
                    closeList();
                    showManual(true);
                    parts.street.value = parts.street.value || search.value.trim();
                }
            };
            const choose = async i => {
                const s = results[i];
                if (!s) return;
                closeList();
                const p = s.placePrediction;
                search.value = p.mainText ? p.mainText.text : p.text.text;
                try {
                    const place = p.toPlace();
                    await place.fetchFields({ fields: ['addressComponents'] });
                    const get = (type, short) => { const c = (place.addressComponents || []).find(c => c.types.includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
                    const line1 = [get('street_number'), get('route', true)].filter(Boolean).join(' ');
                    // Google's unit (when the suggestion had one) goes in the Unit box
                    const unit = get('subpremise');
                    if (unit) unitBox.value = unit;
                    chosen = {
                        street: line1 || search.value,
                        city: get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3'),
                        state: get('administrative_area_level_1', true),
                        zip: get('postal_code'),
                    };
                    search.value = chosen.street;
                    selected.querySelector('span').textContent = [chosen.city, (chosen.state + ' ' + chosen.zip).trim()].filter(Boolean).join(', ');
                    selected.hidden = false;
                    search.classList.remove('is-invalid');
                } catch (err) {
                    console.error('Could not load address details:', err);
                    chosen = null;
                }
                session = null;
            };
            search.addEventListener('input', () => {
                clearTimeout(timer);
                if (chosen) { chosen = null; selected.hidden = true; }
                const text = search.value.trim();
                if (text.length < 3) { results = []; closeList(); return; }
                timer = setTimeout(() => fetchList(text), 220);
            });
            search.addEventListener('keydown', e => {
                if (!list.classList.contains('is-open')) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
                    drawList();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    choose(highlighted >= 0 ? highlighted : 0);
                } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(); }
            });
            search.addEventListener('blur', () => setTimeout(closeList, 150));
            return {
                read() {
                    const addr = manual.hidden ? chosen : Object.fromEntries(Object.entries(parts).map(([k, el]) => [k, el.value.trim()]));
                    if (!addr) { search.classList.add('is-invalid'); return 'Please choose the address from the suggestions, or enter it manually.'; }
                    const missing = ['street', 'city', 'state', 'zip'].find(k => !addr[k]);
                    if (missing) { (manual.hidden ? search : parts[missing]).classList.add('is-invalid'); return 'Please fill in the full address (street, city, state and zip).'; }
                    // A unit typed into the street ("123 Main St Apt 4") moves to the Unit box
                    let street = addr.street.replace(/\s+/g, ' ').trim();
                    let unit = cleanUnit(unitBox.value);
                    const inStreet = street.match(UNIT_AT_END);
                    if (inStreet) { street = inStreet[1].replace(/[\s,]+$/, ''); unit = unit || cleanUnit(inStreet[2]); }
                    // The page keeps the unit in the street address ("123 Main St #4"), like the property APIs expect
                    a.address = { ...addr, line1: street, unit, street: unit ? street + ' #' + unit : street };
                    startLookup();
                    return '';
                },
            };
        },
        // The property's type, bedrooms, bathrooms, square feet, year built and yearly taxes, one per line, filled in from
        // the property lookup (which may still be running when this shows)
        facts(step, body) {
            const shownValue = f => (f.format === 'money' || f.commas ? commas(a[f.key]) : (a[f.key] ?? ''));
            body.innerHTML = '<div data-note>' + factsNote() + '</div><div class="snw-facts">'
                + field('Property Type', choice('snw-type', PROPERTY_TYPES, a.propertyType))
                + FACTS.map(f => field(f.label, input('snw-' + f.key, { format: f.format, placeholder: f.placeholder, value: shownValue(f) })
                    + (f.help ? '<p class="field-help">' + esc(f.help) + '</p>' : ''), 'snw-' + f.key)).join('')
                + '</div>';
            const boxes = {};
            FACTS.forEach(f => {
                const el = body.querySelector('#snw-' + f.key);
                boxes[f.key] = el;
                liveFormat(el, f.format, f.commas);
                el.addEventListener('input', () => { touched[f.key] = true; });
            });
            body.querySelectorAll('input[name="snw-type"]').forEach(r => r.addEventListener('change', () => { touched.propertyType = true; }));
            return {
                // The lookup finished: its note, and its answers in the boxes nothing's been typed in
                refill() {
                    body.querySelector('[data-note]').innerHTML = factsNote();
                    FACTS.forEach(f => { if (!touched[f.key] && boxes[f.key].value.trim() === '' && a[f.key]) boxes[f.key].value = shownValue(f); });
                    if (!touched.propertyType && a.propertyType && !picked('snw-type')) {
                        const r = [...body.querySelectorAll('input[name="snw-type"]')].find(x => x.value === a.propertyType);
                        if (r) r.checked = true;
                    }
                },
                read() {
                    const type = picked('snw-type');
                    let problem = type ? '' : 'Please choose the property type.';
                    const values = {};
                    FACTS.forEach(f => {
                        const { v, error } = readNumber(boxes[f.key].value, f.format, f.name);
                        const bad = error || (f.key === 'sqft' && !(v > 0) ? 'Please enter the square feet.' : '');
                        if (bad) { boxes[f.key].classList.add('is-invalid'); problem = problem || bad; } else values[f.key] = String(v);
                    });
                    if (problem) {
                        const first = body.querySelector('.is-invalid');
                        if (first) first.focus({ preventScroll: true });
                        if (first) keepInView(first);
                        return problem;
                    }
                    a.propertyType = type;
                    Object.assign(a, values);
                    return '';
                },
            };
        },
        choice(step, body) {
            body.innerHTML = choice('snw-' + step.id, step.options, a[step.key]);
            return {
                read() {
                    const v = picked('snw-' + step.id);
                    if (!v) return 'Please choose one.';
                    // A new loan type: a term that's in months for one and years for the other (Hard Money) doesn't carry over
                    if (step.key === 'loanType' && a.loanType !== v) {
                        const t = a.loanTermMonths;
                        if (t && termInMonths(v) !== termInMonths(a.loanType) && !loanTermPresets(v).some(([m]) => m === t)) a.loanTermMonths = '';
                    }
                    a[step.key] = v;
                    return '';
                },
            };
        },
        number(step, body) {
            const shownValue = step.format === 'percent' ? pctOf(a[step.key]) : step.format === 'money' ? commas(a[step.key]) : (a[step.key] ?? '');
            body.innerHTML = field('', input('snw-in', { format: step.format, placeholder: step.placeholder || (step.format === 'percent' ? '0' : ''), value: shownValue, suffix: step.suffix }));
            const el = body.querySelector('#snw-in');
            el.setAttribute('aria-label', step.title);
            liveFormat(el, step.format);
            return {
                read() {
                    const bad = text => { el.classList.add('is-invalid'); return text; };
                    const names = { price: 'sale price', loanAmount: 'original loan amount', estRate: 'interest rate', ioYears: 'number of years' };
                    const { v, error } = readNumber(el.value, step.format, names[step.key] || 'amount');
                    if (error) return bad(error);
                    if (step.key === 'price' && !(v > 0)) return bad('Please enter the sale price.');
                    if (step.key === 'loanAmount' && !(v > 0)) return bad('Please enter the original loan amount (or go back and choose No Loan).');
                    if (step.key === 'ioYears' && !(v > 0)) return bad('Please enter the number of years.');
                    a[step.key] = String(v);
                    return '';
                },
            };
        },
        date(step, body) {
            body.innerHTML = field('', '<input id="snw-in" type="date" value="' + esc(a[step.key] || '') + '">');
            const el = body.querySelector('#snw-in');
            el.setAttribute('aria-label', step.title);
            return { read() { if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) { el.classList.add('is-invalid'); return 'Please choose a date.'; } a[step.key] = el.value; return ''; } };
        },
        // Loan Term: the loan type's usual terms, or Other with a box (years; Hard Money: months). Saved in months.
        term(step, body) {
            const type = a.loanType;
            const presets = loanTermPresets(type);
            const inMonths = termInMonths(type);
            const v = a[step.key] || '';
            const preset = presets.some(([m]) => m === v) ? v : v ? 'other' : '';
            const yearsOf = m => String(Math.round(Number(m) / 12 * 100) / 100);
            body.innerHTML = choice('snw-term', presets.map(([m]) => m).concat(['other']), preset, presets.map(([, n]) => n).concat(['Other']))
                + '<div class="snw-other"' + (preset === 'other' ? '' : ' hidden') + '>'
                + field(inMonths ? 'Months' : 'Years', input('snw-term-n', { format: inMonths ? 'int' : 'decimal', placeholder: inMonths ? '12' : '20', value: preset === 'other' ? (inMonths ? v : yearsOf(v)) : '', suffix: inMonths ? 'months' : 'years' }), 'snw-term-n') + '</div>';
            const other = body.querySelector('.snw-other');
            const box = body.querySelector('#snw-term-n');
            liveFormat(box, inMonths ? 'int' : 'decimal');
            body.querySelectorAll('input[name="snw-term"]').forEach(r => r.addEventListener('change', () => {
                other.hidden = picked('snw-term') !== 'other';
                if (!other.hidden) box.focus();
            }));
            return {
                read() {
                    const p = picked('snw-term');
                    if (!p) return 'Please choose the loan term.';
                    if (p !== 'other') { a[step.key] = p; return ''; }
                    const n = Number(box.value.trim());
                    const months = inMonths ? Math.round(n) : Math.round(n * 12);
                    if (box.value.trim() === '' || !isFinite(n) || !(months >= 1 && months <= 600)) {
                        box.classList.add('is-invalid');
                        return inMonths ? 'Please enter the loan term in months.' : 'Please enter the loan term in years (up to 50).';
                    }
                    a[step.key] = String(months);
                    return '';
                },
            };
        },
        // Hard Money's other holdbacks: Yes / No, then with Yes a card per holdback (its name, then its amount)
        holdbacks(step, body) {
            let answer = a.hasOtherHoldbacks || '';
            let rows = (a.otherHoldbacks || []).map(r => ({ ...r }));
            const blank = () => ({ name: '', amount: '' });
            function draw(focusAt) {
                body.innerHTML = choice('snw-hb', ['Yes', 'No'], answer)
                    + (answer === 'Yes' ? '<div class="snw-lines">' + rows.map((r, i) => '<div class="snw-line" data-i="' + i + '">'
                        + '<div class="ie-entry-head"><span>Holdback ' + (i + 1) + '</span>'
                        + (rows.length > 1 ? '<button type="button" class="ie-remove" data-remove="' + i + '" aria-label="Remove holdback ' + (i + 1) + '">' + TRASH_ICON + 'Remove</button>' : '') + '</div>'
                        + field('Name', input('snw-hb-name-' + i, { format: 'text', placeholder: 'Draw fee holdback', value: r.name }), 'snw-hb-name-' + i)
                        + field('Amount', input('snw-hb-amt-' + i, { format: 'money', placeholder: '0', value: commas(r.amount) }), 'snw-hb-amt-' + i)
                        + '</div>').join('')
                        + '<button type="button" class="ie-add-entry" data-add>' + PLUS_ICON + 'Add another holdback</button></div>' : '');
                body.querySelectorAll('input[name="snw-hb"]').forEach(r => r.addEventListener('change', () => {
                    answer = r.value;
                    if (answer === 'Yes' && !rows.length) rows.push(blank());
                    draw(answer === 'Yes' ? 0 : null);
                }));
                rows.forEach((r, i) => {
                    const name = body.querySelector('#snw-hb-name-' + i);
                    const amt = body.querySelector('#snw-hb-amt-' + i);
                    name.maxLength = 100;
                    name.setAttribute('autocapitalize', 'words');
                    name.addEventListener('input', () => { r.name = name.value; });
                    liveFormat(amt, 'money');
                    amt.addEventListener('input', () => { r.amount = digits(amt.value); });
                });
                body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { rows.splice(Number(b.dataset.remove), 1); draw(); }));
                const add = body.querySelector('[data-add]');
                if (add) add.addEventListener('click', () => { rows.push(blank()); draw(rows.length - 1); });
                if (focusAt !== null && focusAt !== undefined) { const el = body.querySelector('#snw-hb-name-' + focusAt); if (el) setTimeout(() => { el.focus({ preventScroll: true }); keepInView(el.closest('.snw-line')); }, 30); }
            }
            draw();
            return {
                read() {
                    if (!answer) return 'Please choose Yes or No.';
                    if (answer === 'Yes') {
                        const kept = rows.filter(r => r.name.trim() || r.amount !== '');
                        const unnamed = rows.findIndex(r => !r.name.trim() && r.amount !== '');
                        if (unnamed >= 0) { body.querySelector('#snw-hb-name-' + unnamed).classList.add('is-invalid'); return 'Please name each holdback.'; }
                        if (!kept.length) { const el = body.querySelector('#snw-hb-name-0'); if (el) el.classList.add('is-invalid'); return 'Please add each holdback and its amount, or choose No.'; }
                        const noAmount = rows.findIndex(r => r.name.trim() && r.amount === '');
                        if (noAmount >= 0) { body.querySelector('#snw-hb-amt-' + noAmount).classList.add('is-invalid'); return 'Please enter each holdback’s amount.'; }
                        a.otherHoldbacks = kept.map(r => ({ name: r.name.trim(), amount: r.amount }));
                    } else a.otherHoldbacks = [];
                    a.hasOtherHoldbacks = answer;
                    return '';
                },
            };
        },
        review(step, body) {
            const ppl = ids => (ids || []).map(id => { const p = ctx.accounts.find(x => x.id === id) || ctx.sellers.find(x => x.id === id); return p ? nameOf(p) : formatPhone(id); }).join(', ');
            const pct = r => (r === '' || r === undefined ? '' : pctOf(r) + '%');
            const ad = a.address || {};
            const ioText = a.ioPeriod !== 'Yes' ? 'No' : a.dueAfter === 'Yes' ? 'Yes, then the loan comes due' : 'Yes, ' + a.ioYears + (Number(a.ioYears) === 1 ? ' year' : ' years');
            const rows = [
                ['People'],
                ['Sellers', [nameOf(ctx.client), ppl(a.sellers)].filter(Boolean).join(', '), 'sellers'],
                ['Collaborators', ppl(a.collaborators) || 'None', 'collaborators'],
                ['Property'],
                ['Address', [ad.street, ad.city, ((ad.state || '') + ' ' + (ad.zip || '')).trim()].filter(Boolean).join(', '), 'address'],
                ['Details', [a.propertyType, a.beds + ' bd', a.baths + ' ba', commas(a.sqft) + ' sq ft', 'built ' + a.yearBuilt].join(' · '), 'facts'],
                ['Yearly Taxes', money(a.taxes), 'facts'],
                ['Sale'],
                ['Sale Price', money(a.price), 'price'],
                ['Loan Payoff'],
                ['Loan Type', a.loanType, 'loanType'],
                ...(hasLoan() ? [
                    ['Original Loan', money(a.loanAmount), 'loanAmount'],
                    ['Loan Date', niceDate(a.loanDate), 'loanDate'],
                    ['Loan Term', termText(a.loanTermMonths, a.loanType), 'loanTerm'],
                    ['Estimated Rate', pct(a.estRate), 'loanRate'],
                ] : []),
                ...(isDscr() ? [['Interest Only', ioText, 'ioPeriod']] : []),
                ...(isHardMoney() ? [
                    ['Construction Holdback', money(a.construction), 'construction'],
                    ['Interest Reserve', money(a.reserve), 'reserve'],
                    ['Other Holdbacks', a.hasOtherHoldbacks === 'Yes' ? (a.otherHoldbacks || []).map(h => h.name + ' ' + money(h.amount)).join(', ') : 'None', 'holdbacks'],
                ] : []),
                ['Costs'],
                ['Title Company', a.titleCompanyName, 'titleCompany'],
            ];
            const accepted = new Date();
            accepted.setDate(accepted.getDate() + 60);
            body.innerHTML = '<ul class="snw-review">' + rows.map(r => r.length === 1 ? '<li class="snw-review-head">' + esc(r[0]) + '</li>'
                : '<li><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span><button type="button" data-go="' + r[2] + '" aria-label="Change ' + esc(r[0]) + '">Change</button></li>').join('') + '</ul>'
                + '<p class="snw-defaults">Everything else starts at the usual defaults, which you can change on the page: no seller credit, the offer accepted '
                + esc(niceDate(isoDay(accepted))) + ' with a 30-day escrow, $0 payoff fees, 2.5% commissions, no HOA, and a conventional buyer loan at 80% of the price. '
                + 'The seller adds their own loan and HOA details on the page.</p>';
            body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
                fromReview = true;
                index = STEPS.findIndex(s => s.id === b.dataset.go);
                draw(-1);
            }));
            return { read: () => '' };
        },
    };

    // --- Drawing a question ---
    function draw(direction) {
        const step = STEPS[index];
        const list = shown();
        const at = list.indexOf(step);
        $('.snw-bar span').style.transform = 'scaleX(' + ((at + 1) / list.length) + ')';
        $('.snw-count').textContent = step.kind === 'review' ? 'Review' : 'Question ' + (at + 1) + ' of ' + (list.length - 1);
        message.textContent = '';
        scroll.innerHTML = '<div class="snw-step' + (direction < 0 ? ' is-back' : '') + '"><span class="snw-eyebrow">' + esc(step.group) + '</span>'
            + '<h3 class="snw-question">' + esc(step.title) + '</h3>' + (step.help ? '<p class="snw-help">' + esc(step.help) + '</p>' : '')
            + '<div class="snw-body"></div></div>';
        current = KINDS[step.kind](step, scroll.querySelector('.snw-body'));
        backBtn.hidden = at === 0 && !fromReview;
        backBtn.textContent = fromReview && step.kind !== 'review' ? 'Back To Review' : 'Back';
        $('[data-next-text]').textContent = step.kind === 'review' ? 'Create Seller Net Sheet' : fromReview ? 'Save' : 'Next';
        scroll.scrollTop = 0;
        // The one box a question asks for is ready to type in. (Not the property details: they're filled in from the
        // lookup, and opening the keyboard over them would hide them.)
        const first = step.kind === 'facts' ? null : scroll.querySelector('input:not([type="radio"]):not([type="date"]), .mp-btn');
        if (first && direction !== 0) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }
    const move = by => {
        const list = shown();
        const at = list.indexOf(STEPS[index]);
        const next = list[Math.max(0, Math.min(list.length - 1, at + by))];
        index = STEPS.indexOf(next);
        draw(by);
    };

    // --- Phones: the on-screen keyboard ---
    // The sheet is pinned to the bottom of the screen, which the keyboard covers (it shrinks only the visible part of the
    // page; the browser's autofill bar on top of the keyboard is counted too). So while it's up, the sheet moves up to sit
    // on top of it (--snw-kb), sized to what's left (--snw-vh), and the box being typed in is scrolled into view.
    const vv = window.visualViewport;
    const phone = window.matchMedia('(max-width: 600px)');
    const touch = window.matchMedia('(pointer: coarse)');
    // The keyboard's height the last time it was up (0: not yet seen), and while the sheet has moved up ahead of the
    // keyboard, the timer that settles it back if no keyboard comes
    let lastKeyboard = 0;
    let expecting = null;
    // Scrolls the questions so el is in view (a little room around it); smooth: a gentle scroll instead of a jump
    function keepInView(el, smooth) {
        if (!el || !scroll.contains(el)) return;
        const box = el.getBoundingClientRect();
        const area = scroll.getBoundingClientRect();
        const room = 16;
        const by = box.bottom > area.bottom - room ? Math.min(box.bottom - area.bottom + room, box.top - area.top - room)
            : box.top < area.top + room ? -(area.top + room - box.top) : 0;
        if (by) scroll.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
    }
    function setFit(up, lift, visible) {
        dialog.style.setProperty('--snw-kb', lift + 'px');
        dialog.style.setProperty('--snw-vh', Math.round(visible) + 'px');
        dialog.classList.toggle('is-keyboard', up);
    }
    function fitKeyboard() {
        if (!dialog.open || !vv) return;
        const { up, lift } = phone.matches ? keyboardFit(window.innerHeight, vv.height, vv.offsetTop) : { up: false, lift: 0 };
        // (the sheet moved up ahead of the keyboard: a resize before the keyboard arrives doesn't drop it back down)
        if (!up && expecting) return;
        if (up) { lastKeyboard = Math.round(window.innerHeight - vv.height); clearTimeout(expecting); expecting = null; }
        setFit(up, lift, vv.height);
        // (once the sheet has settled)
        if (up) setTimeout(() => keepInView(document.activeElement, true), 320);
    }
    if (vv) { vv.addEventListener('resize', fitKeyboard); vv.addEventListener('scroll', fitKeyboard); }
    // A tap on a box (the keyboard opens): the sheet starts moving up right away, by the keyboard's last height (or, the
    // first time, a typical keyboard's), so it rises with the keyboard instead of after it, and the browser doesn't have
    // to scroll the page to show the box. The keyboard's real size, once it's up, corrects it; if none comes (a hardware
    // keyboard), it settles back.
    form.addEventListener('click', e => {
        if (!vv || !dialog.open || !phone.matches || !touch.matches || dialog.classList.contains('is-keyboard')) return;
        if (!e.target.matches('input[type="text"], textarea')) return;
        const kb = lastKeyboard || Math.round(window.innerHeight * 0.4);
        setFit(true, kb, window.innerHeight - kb);
        clearTimeout(expecting);
        expecting = setTimeout(() => { expecting = null; fitKeyboard(); }, 900);
    });
    // A box tapped while the keyboard is already up (or as it comes up) comes into view
    form.addEventListener('focusin', e => {
        if (!e.target.matches('input:not([type="radio"]), select, textarea')) return;
        setTimeout(() => { if (document.activeElement === e.target && dialog.classList.contains('is-keyboard')) keepInView(e.target, true); }, 320);
    });
    // The keyboard's Enter (Next) moves to the question's next box; from the last one, on to the next question
    form.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.defaultPrevented || !e.target.matches('input[type="text"]')) return;
        const boxes = [...scroll.querySelectorAll('input[type="text"]')].filter(b => b.offsetParent);
        const i = boxes.indexOf(e.target);
        if (i >= 0 && i < boxes.length - 1) { e.preventDefault(); boxes[i + 1].focus({ preventScroll: true }); keepInView(boxes[i + 1]); }
    });

    form.addEventListener('input', e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; });
    form.addEventListener('change', () => { message.textContent = ''; });
    backBtn.addEventListener('click', () => {
        if (saving) return;
        if (fromReview && STEPS[index].kind !== 'review') { index = STEPS.findIndex(s => s.kind === 'review'); draw(1); return; }
        if (STEPS[index].kind === 'review') fromReview = false;
        move(-1);
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (saving) return;
        const step = STEPS[index];
        const problem = current.read();
        if (problem) { message.textContent = problem; return; }
        if (step.kind !== 'review') {
            // Back to the review after a change (unless it opened a question that still needs an answer, like a DSCR loan's
            // interest only questions after changing the loan type)
            if (fromReview) {
                const unanswered = shown().find(s => s.answered && !s.answered());
                index = unanswered ? STEPS.indexOf(unanswered) : STEPS.findIndex(s => s.kind === 'review');
                draw(1);
            } else move(1);
            return;
        }
        await save();
    });

    async function save() {
        const ad = a.address;
        const fields = {
            'BEDS': a.beds, 'BATHS': a.baths, 'SQFT': a.sqft, 'YEAR BUILT': a.yearBuilt, 'YEARLY TAXES': a.taxes,
            'LOAN TYPE': a.loanType,
            // Agent Loan Input (No Loan: none of it)
            ...(hasLoan() ? {
                'ORIGINAL LOAN AMOUNT': a.loanAmount, 'ORIGINAL LOAN DATE': mdy(a.loanDate),
                'LOAN TERM MONTHS': a.loanTermMonths, 'ESTIMATED INTEREST RATE': a.estRate,
            } : {}),
            ...(isDscr() ? {
                'INTEREST ONLY PERIOD': a.ioPeriod,
                ...(a.ioPeriod === 'Yes' ? { 'DUE AFTER INTEREST ONLY': a.dueAfter } : {}),
                ...(a.ioPeriod === 'Yes' && a.dueAfter === 'No' ? { 'INTEREST ONLY MONTHS': String(Math.round(Number(a.ioYears) * 12)) } : {}),
            } : {}),
            ...(isHardMoney() ? {
                'OUTSTANDING CONSTRUCTION HOLDBACK': a.construction, 'OUTSTANDING INTEREST RESERVE': a.reserve,
                'HAS OTHER HOLDBACKS': a.hasOtherHoldbacks,
                ...(a.hasOtherHoldbacks === 'Yes' ? { 'OTHER HOLDBACKS': JSON.stringify((a.otherHoldbacks || []).map(h => ({ NAME: h.name, AMOUNT: Number(h.amount || 0) }))) } : {}),
            } : {}),
            'TITLE COMPANY': ((ctx.titleCompanies || []).find(c => c.name === a.titleCompanyName) || {}).id || '',
        };
        saving = true;
        nextBtn.disabled = backBtn.disabled = true;
        nextBtn.classList.add('is-loading');
        try {
            await ctx.submit({
                pageType: 'Seller Net', clientId: ctx.client.id, purchasers: a.sellers || [], collaborators: a.collaborators || [],
                address: ad, propertyType: a.propertyType, purchasePrice: a.price, yearBuilt: a.yearBuilt, yearlyTaxes: a.taxes, fields,
            });
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = 'We couldn’t create the seller net sheet. Please try again.';
        } finally {
            saving = false;
            nextBtn.disabled = backBtn.disabled = false;
            nextBtn.classList.remove('is-loading');
        }
    }

    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
    dialog.addEventListener('close', () => { clearTimeout(expecting); expecting = null; dialog.classList.remove('is-keyboard'); dialog.style.removeProperty('--snw-kb'); });

    return {
        open(next) {
            ctx = next;
            STEPS.find(s => s.id === 'titleCompany').options = (ctx.titleCompanies || []).map(c => c.name);
            a = { sellers: [], collaborators: [], titleCompanyName: ((ctx.titleCompanies || [])[0] || {}).name || '' };
            touched = {};
            lookup = null;
            index = 0;
            fromReview = false;
            $('#snw-title').textContent = 'New Seller Net Sheet for ' + nameOf(ctx.client);
            draw(1);
            dialog.showModal();
            lockPageScroll(dialog);
            fitKeyboard();
        },
    };
}
