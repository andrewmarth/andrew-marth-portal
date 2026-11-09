// "New Property" for the home page's My Sellers card (admins): a new Seller Net sheet, one question at a time.
// Asks everything the net sheet needs except the seller's own questions (Client Input: their loan balance and rate,
// the HOA, ...), which they answer on the page. Once the address is chosen, beds, baths, sqft, yearly taxes (and the
// property type / year built, when known) are looked up from the property APIs and filled in, to check or change.
// Uses the income editor's pop-up styles: a card on wide screens, a swipe-up sheet on phones.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';
import { ensurePickerStyles, multiPicker, loadPlaces } from '/new-property.js';

const MAX_OTHERS = 5; // six people on a page: the seller plus five more
const PROPERTY_TYPES = ['Single Family', 'Townhome', 'Condo', 'Manufactured'];
// The page's loan types (pages.html LOAN_TYPES). No Loan skips the loan amount and every payoff fee.
const LOAN_TYPES = ['Conventional', 'FHA', 'VA', 'DSCR', 'Hard Money', 'Jumbo', 'Other', 'No Loan'];

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
.snw-dialog .snw-term-other { max-width: 220px; }
.snw-dialog .snw-term-other[hidden] { display: none; }
.snw-dialog .snw-body { margin-top: 18px; display: grid; gap: 14px; }
.snw-dialog .snw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
.snw-dialog .field input[type="date"] { font-family: inherit; font-size: 1rem; color: var(--brown); }
.snw-dialog .suffix-wrap { position: relative; }
.snw-dialog .suffix-wrap input { padding-right: 64px; }
.snw-dialog .suffix-wrap span { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.snw-dialog .type-picker.snw-choice { grid-template-columns: repeat(var(--n, 2), 1fr); margin: 0; border-radius: 22px; }
.snw-dialog .type-picker.snw-choice label { display: flex; align-items: center; justify-content: center; min-height: 48px; margin: 0; border-radius: 18px; text-align: center; font-size: 0.95rem; }
/* The property APIs' answer */
.snw-dialog .snw-found { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 14px; font-size: 0.88rem; font-weight: bold; background: #eef3e6; color: var(--olive); }
.snw-dialog .snw-found.is-pending { background: #f4efe8; color: var(--brown); font-weight: normal; }
.snw-dialog .snw-found.is-missing { background: #fdf6e9; color: var(--brown); font-weight: normal; border: 1px dashed rgba(192, 144, 80, 0.7); }
.snw-dialog .snw-found svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.snw-dialog .snw-spin { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; border-radius: 50%; border: 3px solid rgba(78, 81, 62, 0.2); border-top-color: var(--olive); animation: spin 0.8s linear infinite; }
/* Review */
.snw-dialog .snw-review { list-style: none; display: grid; gap: 0; margin: 0; padding: 0; }
.snw-dialog .snw-review li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 4px; border-bottom: 1px solid rgba(78, 81, 62, 0.12); }
.snw-dialog .snw-review .k { flex: 0 0 auto; font-weight: bold; font-size: 0.92rem; }
.snw-dialog .snw-review .v { flex: 1; min-width: 0; text-align: right; overflow-wrap: anywhere; font-size: 0.92rem; }
.snw-dialog .snw-review button { flex: 0 0 auto; padding: 4px 2px; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: bold; color: var(--rust); text-decoration: underline; text-underline-offset: 3px; }
.snw-dialog .snw-review .snw-review-head { min-height: 0; padding: 16px 4px 4px 4px; border: none; font-size: 0.72rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.snw-dialog .snw-review .snw-review-head:first-child { padding-top: 0; }
.snw-dialog .dialog-foot .form-actions { justify-content: space-between; }
.snw-dialog .dialog-foot .form-actions .btn[hidden] { display: none; }
.snw-dialog .snw-spacer { flex: 1; }
@media (max-width: 600px) {
    .snw-dialog .snw-row { grid-template-columns: 1fr; }
    .snw-dialog .snw-question { font-size: 1.25rem; }
    .snw-dialog .type-picker.snw-choice { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) { .snw-dialog .snw-step { animation: none; } }
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const INFO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

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

/**
 * Opens the form for one seller. client: { id, name }; sellers: the other SELLER accounts; accounts: everyone (for
 * collaborators); lookup(address) resolves to { facts, sources } (the propertyFacts API); submit(answers) resolves once
 * the page is saved (or throws).
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
    let current = null;  // the shown step's { read() -> error text or '' }
    let saving = false;

    // No Loan: nothing to pay off
    const hasLoan = () => a.loanType !== 'No Loan';

    // --- The questions, in order. show(): asked only when it returns true. ---
    const STEPS = [
        { id: 'sellers', group: 'People', title: 'Who else is selling?', help: 'Anyone else on the title. Leave it empty if it’s just the seller.', kind: 'people', which: 'sellers' },
        { id: 'collaborators', group: 'People', title: 'Anyone else who should see this sheet?', help: 'Collaborators can view the page but aren’t selling. Up to six people in all.', kind: 'people', which: 'collaborators' },
        { id: 'address', group: 'Property', title: 'What’s the property address?', help: 'Add the unit number for a condo, townhome or apartment.', kind: 'address' },
        { id: 'type', group: 'Property', title: 'What kind of property is it?', kind: 'choice', key: 'propertyType', options: PROPERTY_TYPES, fact: 'propertyType' },
        { id: 'beds', group: 'Property', title: 'How many bedrooms?', kind: 'number', key: 'beds', format: 'int', fact: 'beds', placeholder: '3' },
        { id: 'baths', group: 'Property', title: 'How many bathrooms?', help: 'Half baths count as .5 (2.5 for two full and one half).', kind: 'number', key: 'baths', format: 'decimal', fact: 'baths', placeholder: '2' },
        { id: 'sqft', group: 'Property', title: 'How many square feet?', kind: 'number', key: 'sqft', format: 'int', commas: true, fact: 'sqft', placeholder: '1,800' },
        { id: 'year', group: 'Property', title: 'What year was it built?', kind: 'number', key: 'yearBuilt', format: 'year', fact: 'yearBuilt', placeholder: '1995' },
        { id: 'taxes', group: 'Property', title: 'What are the yearly property taxes?', kind: 'number', key: 'taxes', format: 'money', fact: 'taxes', placeholder: '2,400' },
        { id: 'price', group: 'Sale', title: 'What’s the expected sale price?', kind: 'number', key: 'price', format: 'money', placeholder: '450,000' },
        { id: 'credit', group: 'Sale', title: 'Any seller credit to the buyer?', help: 'A percent of the sale price. Enter 0 for none.', kind: 'number', key: 'credit', format: 'percent' },
        { id: 'acceptance', group: 'Sale', title: 'When will the offer be accepted?', help: 'An estimate is fine.', kind: 'date', key: 'acceptance' },
        { id: 'escrow', group: 'Sale', title: 'How long is escrow?', kind: 'number', key: 'escrowDays', format: 'int', suffix: 'days', placeholder: '30' },
        { id: 'loanType', group: 'Loan Payoff', title: 'What kind of loan does the seller have?', help: 'Choose No Loan if the home is paid off.', kind: 'choice', key: 'loanType', options: LOAN_TYPES },
        { id: 'loanAmount', group: 'Loan Payoff', title: 'What was the original loan amount?', help: 'The seller’s mortgage when it was taken out.', kind: 'number', key: 'loanAmount', format: 'money', placeholder: '360,000', show: hasLoan },
        { id: 'loanDate', group: 'Loan Payoff', title: 'When was the loan taken out?', kind: 'date', key: 'loanDate', show: () => hasLoan() && Number(a.loanAmount) > 0 },
        { id: 'loanTerm', group: 'Loan Payoff', title: 'What was the original loan term?', kind: 'term', key: 'loanTermYears', show: () => hasLoan() && Number(a.loanAmount) > 0 },
        { id: 'recording', group: 'Loan Payoff', title: 'Recording fee?', help: 'To record the loan’s release. Enter 0 for none.', kind: 'fee', key: 'recording', show: hasLoan },
        { id: 'payoffStatement', group: 'Loan Payoff', title: 'Payoff statement fee?', help: 'The lender’s fee for the payoff statement. Enter 0 for none.', kind: 'fee', key: 'payoffStatement', show: hasLoan },
        { id: 'otherPayoff', group: 'Loan Payoff', title: 'Any other loan payoff fees?', help: 'A percent of the loan balance and a flat amount. Enter 0 for none.', kind: 'split', key: 'otherPayoff', status: true, show: hasLoan },
        { id: 'escrowFee', group: 'Costs', title: 'Escrow fee?', help: 'A percent of the sale price.', kind: 'number', key: 'escrowFee', format: 'percent' },
        { id: 'ownersTitle', group: 'Costs', title: 'Owner’s title insurance?', help: 'A percent of the sale price.', kind: 'number', key: 'ownersTitle', format: 'percent' },
        { id: 'buyersAgent', group: 'Costs', title: 'Buyer’s agent commission?', help: 'Paid by the seller. A percent of the price and a flat amount. Enter 0 for none.', kind: 'split', key: 'buyersAgent' },
        { id: 'listingAgent', group: 'Costs', title: 'Listing agent commission?', help: 'A percent of the price and a flat amount. Enter 0 for none.', kind: 'split', key: 'listingAgent' },
        { id: 'review', group: 'Review', title: 'Look it over', help: 'Everything else (the seller’s loan balance and rate, the HOA) the seller fills in on the page.', kind: 'review' },
    ];
    const shown = () => STEPS.filter(s => !s.show || s.show());

    // --- Pieces ---
    // "Apt 4B", "#4b", "Unit 4B" -> "4B"
    const cleanUnit = v => String(v || '').trim().replace(/^(#|(unit|apt|apartment|ste|suite|no\.?|number)\b)\s*#?\s*/i, '').replace(/\s+/g, '').toUpperCase();
    const UNIT_AT_END = /^(.*?\S)\s*,?\s*((?:#|\b(?:unit|apt|apartment|ste|suite)\b\.?)\s*#?\s*(?:[\w-]*\d[\w-]*|[a-z]))$/i;
    const field = (label, inner, id) => '<div class="field">' + (label ? '<label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' : '') + inner + '</div>';
    const input = (id, { format, placeholder = '', value = '', suffix } = {}) => {
        const mode = format === 'decimal' || format === 'percent' ? 'decimal' : 'numeric';
        const box = '<input id="' + id + '" type="text" inputmode="' + mode + '" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '"' + (format === 'money' ? ' class="money"' : '') + '>';
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
    const choice = (name, options, value) => '<div class="type-picker snw-choice" style="--n:' + Math.min(options.length, 4) + '" role="radiogroup">'
        + options.map((o, i) => '<input type="radio" name="' + name + '" id="' + name + '-' + i + '" value="' + esc(o) + '"' + (o === value ? ' checked' : '') + '><label for="' + name + '-' + i + '">' + esc(o) + '</label>').join('') + '</div>';
    const picked = name => { const r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };
    const statusChoice = (name, value) => field('Estimated or final?', choice(name, ['Estimated', 'Final'], value));

    // What the property APIs said about this fact
    function foundNote(step) {
        if (!step.fact) return '';
        if (!lookup || lookup.state === 'pending') return '<div class="snw-found is-pending"><span class="snw-spin" aria-hidden="true"></span><span>Looking this home up in the property APIs…</span></div>';
        const v = lookup.facts && lookup.facts[step.fact];
        if (lookup.state === 'done' && v !== '' && v !== undefined && !touched[step.key]) {
            return '<div class="snw-found">' + CHECK_ICON + '<span>Found ' + esc((lookup.sources || []).length ? 'on ' + lookup.sources.map(s => s.replace(/\s*\(RapidAPI\)$/, '')).join(' and ') : 'automatically') + '. Change it if it’s wrong.</span></div>';
        }
        if (touched[step.key]) return '';
        return '<div class="snw-found is-missing">' + INFO_ICON + '<span>' + (lookup.state === 'failed' ? 'The property lookup didn’t work this time' : 'The property APIs didn’t have this') + '. Please enter it.</span></div>';
    }

    // Fills in what the lookup found, unless it was typed in by hand
    function applyLookup() {
        if (!lookup || lookup.state !== 'done') return;
        const f = lookup.facts || {};
        [['propertyType', 'propertyType'], ['beds', 'beds'], ['baths', 'baths'], ['sqft', 'sqft'], ['yearBuilt', 'yearBuilt'], ['taxes', 'taxes']].forEach(([key, fact]) => {
            if (!touched[key] && f[fact] !== '' && f[fact] !== undefined && f[fact] !== null) a[key] = key === 'propertyType' ? f[fact] : String(Math.round(Number(f[fact]) * (key === 'baths' ? 100 : 1)) / (key === 'baths' ? 100 : 1));
        });
    }
    function startLookup() {
        const addr = a.address;
        const key = addr ? [addr.street, addr.city, addr.state, addr.zip].join('|').toLowerCase() : '';
        if (!key || (lookup && lookup.key === key)) return;
        // A new address: what the last one found no longer applies
        if (lookup && lookup.state === 'done') {
            const f = lookup.facts || {};
            ['propertyType', 'beds', 'baths', 'sqft', 'yearBuilt', 'taxes'].forEach(k => { if (!touched[k] && f[k] !== '' && f[k] !== undefined) a[k] = ''; });
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
            // Redraw the shown question if it's one the lookup answers (and nothing's been typed into it)
            const step = STEPS[index];
            if (lookup === mine && dialog.open && step && step.fact && !touched[step.key]) draw(0);
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
                    + '<div class="field span-2" style="grid-column: 1 / -1"><label for="snw-street">Street Address</label><input id="snw-street" type="text" autocomplete="off" placeholder="123 Main St"></div>'
                    + field('City', '<input id="snw-city" type="text" autocomplete="off" placeholder="Phoenix">', 'snw-city')
                    + field('State', '<input id="snw-state" type="text" autocomplete="off" maxlength="20" placeholder="AZ">', 'snw-state')
                    + field('Zip', '<input id="snw-zip" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="85251">', 'snw-zip')
                + '</div>'
                + '<div class="snw-unit">' + field('Unit (optional)', '<input id="snw-unit" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="e.g. 204" value="' + esc(ad.unit || '') + '">', 'snw-unit') + '</div>'
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
        choice(step, body) {
            body.innerHTML = foundNote(step) + choice('snw-' + step.id, step.options, a[step.key]);
            body.querySelectorAll('input[type="radio"]').forEach(r => r.addEventListener('change', () => { touched[step.key] = true; }));
            return { read() { const v = picked('snw-' + step.id); if (!v) return 'Please choose one.'; a[step.key] = v; return ''; } };
        },
        number(step, body) {
            const shownValue = step.format === 'percent' ? pctOf(a[step.key]) : (step.format === 'money' || step.commas) ? commas(a[step.key]) : (a[step.key] ?? '');
            body.innerHTML = foundNote(step) + field('', input('snw-in', { format: step.format, placeholder: step.placeholder || (step.format === 'percent' ? '0' : ''), value: shownValue, suffix: step.suffix }));
            const el = body.querySelector('#snw-in');
            el.setAttribute('aria-label', step.title);
            liveFormat(el, step.format, step.commas);
            el.addEventListener('input', () => { touched[step.key] = true; });
            return {
                read() {
                    const raw = el.value.trim();
                    const bad = text => { el.classList.add('is-invalid'); return text; };
                    if (raw === '' && step.key === 'price') return bad('Please enter the sale price.');
                    if (raw === '') return bad('Please enter a number' + (step.format === 'percent' || step.format === 'money' ? ' (0 counts).' : '.'));
                    let v;
                    if (step.format === 'percent') { v = rateOf(raw); if (v === '' || v > 1) return bad('Please enter a percent between 0 and 100.'); }
                    else if (step.format === 'decimal') { v = Number(raw); if (!isFinite(v) || v < 0 || v > 50) return bad('Please enter a number like 2 or 2.5.'); v = Math.round(v * 100) / 100; }
                    else {
                        v = Number(digits(raw));
                        if (step.format === 'year') { const last = new Date().getFullYear() + 1; if (v < 1850 || v > last) return bad('Please enter a year between 1850 and ' + last + '.'); }
                        if (step.key === 'price' && !(v > 0)) return bad('Please enter the sale price.');
                        if (step.key === 'escrowDays' && !(v > 0)) return bad('Please enter the number of days.');
                    }
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
        term(step, body) {
            const years = a[step.key];
            const preset = years === '30' || years === '15' ? years : years ? 'other' : '';
            body.innerHTML = field('', '<select id="snw-term" aria-label="Original loan term"><option value="">Choose…</option>'
                    + '<option value="30"' + (preset === '30' ? ' selected' : '') + '>30 years</option>'
                    + '<option value="15"' + (preset === '15' ? ' selected' : '') + '>15 years</option>'
                    + '<option value="other"' + (preset === 'other' ? ' selected' : '') + '>Other</option></select>')
                + '<div class="snw-term-other"' + (preset === 'other' ? '' : ' hidden') + '>'
                + field('Loan term', input('snw-term-years', { format: 'int', placeholder: '20', value: preset === 'other' ? years : '', suffix: 'years' }), 'snw-term-years') + '</div>';
            const select = body.querySelector('#snw-term');
            const other = body.querySelector('.snw-term-other');
            const box = body.querySelector('#snw-term-years');
            liveFormat(box, 'int');
            select.addEventListener('change', () => {
                select.classList.remove('is-invalid');
                other.hidden = select.value !== 'other';
                if (!other.hidden) box.focus();
            });
            return {
                read() {
                    if (!select.value) { select.classList.add('is-invalid'); return 'Please choose the loan term.'; }
                    if (select.value !== 'other') { a[step.key] = select.value; return ''; }
                    const v = Number(digits(box.value));
                    if (!(v >= 1 && v <= 50)) { box.classList.add('is-invalid'); return 'Please enter the loan term in years (1 to 50).'; }
                    a[step.key] = String(v);
                    return '';
                },
            };
        },
        fee(step, body) {
            const v = a[step.key] || {};
            body.innerHTML = field('Amount', input('snw-in', { format: 'money', placeholder: '0', value: commas(v.amount) }), 'snw-in') + statusChoice('snw-' + step.id + '-status', v.status);
            const el = body.querySelector('#snw-in');
            liveFormat(el, 'money');
            return {
                read() {
                    if (el.value.trim() === '') { el.classList.add('is-invalid'); return 'Please enter the amount (0 counts).'; }
                    const status = picked('snw-' + step.id + '-status');
                    if (!status) return 'Please choose Estimated or Final.';
                    a[step.key] = { amount: digits(el.value), status };
                    return '';
                },
            };
        },
        split(step, body) {
            const v = a[step.key] || {};
            body.innerHTML = '<div class="snw-row">' + field('Percent', input('snw-pct', { format: 'percent', placeholder: '0', value: pctOf(v.rate) }), 'snw-pct')
                + field('Flat Amount', input('snw-amt', { format: 'money', placeholder: '0', value: commas(v.amount) }), 'snw-amt') + '</div>'
                + (step.status ? statusChoice('snw-' + step.id + '-status', v.status) : '');
            const pct = body.querySelector('#snw-pct');
            const amt = body.querySelector('#snw-amt');
            liveFormat(pct, 'percent');
            liveFormat(amt, 'money');
            return {
                read() {
                    if (pct.value.trim() === '') { pct.classList.add('is-invalid'); return 'Please enter the percent (0 counts).'; }
                    const rate = rateOf(pct.value);
                    if (rate === '' || rate > 1) { pct.classList.add('is-invalid'); return 'Please enter a percent between 0 and 100.'; }
                    if (amt.value.trim() === '') { amt.classList.add('is-invalid'); return 'Please enter the flat amount (0 counts).'; }
                    const status = step.status ? picked('snw-' + step.id + '-status') : '';
                    if (step.status && !status) return 'Please choose Estimated or Final.';
                    a[step.key] = { rate, amount: digits(amt.value), status };
                    return '';
                },
            };
        },
        review(step, body) {
            const ppl = ids => (ids || []).map(id => { const p = ctx.accounts.find(x => x.id === id) || ctx.sellers.find(x => x.id === id); return p ? nameOf(p) : formatPhone(id); }).join(', ');
            const pct = r => (r === '' || r === undefined ? '' : pctOf(r) + '%');
            const ad = a.address || {};
            const split = v => v ? [pct(v.rate), money(v.amount)].join(' + ') + (v.status ? ' (' + v.status + ')' : '') : '';
            const fee = v => v ? money(v.amount) + ' (' + v.status + ')' : '';
            const rows = [
                ['People'],
                ['Sellers', [nameOf(ctx.client), ppl(a.sellers)].filter(Boolean).join(', '), 'sellers'],
                ['Collaborators', ppl(a.collaborators) || 'None', 'collaborators'],
                ['Property'],
                ['Address', [ad.street, ad.city, ((ad.state || '') + ' ' + (ad.zip || '')).trim()].filter(Boolean).join(', '), 'address'],
                ['Property Type', a.propertyType, 'type'],
                ['Beds / Baths', a.beds + ' / ' + a.baths, 'beds'],
                ['Square Feet', commas(a.sqft), 'sqft'],
                ['Year Built', a.yearBuilt, 'year'],
                ['Yearly Taxes', money(a.taxes), 'taxes'],
                ['Sale'],
                ['Sale Price', money(a.price), 'price'],
                ['Seller Credit', pct(a.credit), 'credit'],
                ['Offer Accepted', niceDate(a.acceptance), 'acceptance'],
                ['Escrow', a.escrowDays + ' days', 'escrow'],
                ['Loan Payoff'],
                ['Loan Type', a.loanType, 'loanType'],
                ...(hasLoan() ? [
                    ['Original Loan', Number(a.loanAmount) > 0 ? money(a.loanAmount) + ', ' + niceDate(a.loanDate) : money(0), 'loanAmount'],
                    ...(Number(a.loanAmount) > 0 ? [['Loan Term', a.loanTermYears ? a.loanTermYears + ' years' : '', 'loanTerm']] : []),
                    ['Recording Fee', fee(a.recording), 'recording'],
                    ['Payoff Statement Fee', fee(a.payoffStatement), 'payoffStatement'],
                    ['Other Payoff Fees', split(a.otherPayoff), 'otherPayoff'],
                ] : []),
                ['Costs'],
                ['Escrow Fee', pct(a.escrowFee), 'escrowFee'],
                ['Owner’s Title', pct(a.ownersTitle), 'ownersTitle'],
                ['Buyer’s Agent', split(a.buyersAgent), 'buyersAgent'],
                ['Listing Agent', split(a.listingAgent), 'listingAgent'],
            ];
            body.innerHTML = '<ul class="snw-review">' + rows.map(r => r.length === 1 ? '<li class="snw-review-head">' + esc(r[0]) + '</li>'
                : '<li><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span><button type="button" data-go="' + r[2] + '" aria-label="Change ' + esc(r[0]) + '">Change</button></li>').join('') + '</ul>';
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
        const first = scroll.querySelector('input:not([type="radio"]), .mp-btn');
        if (first && direction !== 0) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }
    const move = by => {
        const list = shown();
        const at = list.indexOf(STEPS[index]);
        const next = list[Math.max(0, Math.min(list.length - 1, at + by))];
        index = STEPS.indexOf(next);
        draw(by);
    };

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
            // Back to the review after a change (unless it opened a question that still needs an answer, like the loan date)
            if (fromReview) {
                const list = shown();
                const ANSWER = { loanAmount: 'loanAmount', loanDate: 'loanDate', loanTerm: 'loanTermYears', recording: 'recording', payoffStatement: 'payoffStatement', otherPayoff: 'otherPayoff' };
                const unanswered = list.find(s => ANSWER[s.id] && (a[ANSWER[s.id]] === undefined || a[ANSWER[s.id]] === ''));
                index = unanswered ? STEPS.indexOf(unanswered) : STEPS.findIndex(s => s.kind === 'review');
                draw(1);
            } else move(1);
            return;
        }
        await save();
    });

    async function save() {
        const ad = a.address;
        const noLoanDate = !(Number(a.loanAmount) > 0);
        const fields = {
            'BEDS': a.beds, 'BATHS': a.baths, 'SQFT': a.sqft, 'YEAR BUILT': a.yearBuilt, 'YEARLY TAXES': a.taxes,
            'SELLER CREDIT': a.credit,
            'OFFER ACCEPTANCE DATE': mdy(a.acceptance), 'ESCROW DURATION': a.escrowDays,
            'LOAN TYPE': a.loanType,
            // No Loan: none of the loan payoff answers
            ...(hasLoan() ? {
                // A $0 loan: the date and term don't matter, but the sheet wants them
                'ORIGINAL LOAN AMOUNT': a.loanAmount, 'ORIGINAL LOAN DATE': mdy(noLoanDate ? isoDay(new Date()) : a.loanDate),
                'LOAN TERM MONTHS': noLoanDate ? 360 : Number(a.loanTermYears) * 12,
                'RECORDING FEE': a.recording.amount, 'RECORDING FEE STATUS': a.recording.status,
                'PAYOFF STATEMENT FEE': a.payoffStatement.amount, 'PAYOFF STATEMENT FEE STATUS': a.payoffStatement.status,
                'OTHER LOAN PAYOFF FEES %': a.otherPayoff.rate, 'OTHER LOAN PAYOFF FEES $': a.otherPayoff.amount, 'OTHER LOAN PAYOFF FEES STATUS': a.otherPayoff.status,
            } : {}),
            'ESCROW FEE RATE': a.escrowFee, 'OWNERS TITLE RATE': a.ownersTitle,
            'SELLER PAID BUYER COMMISSION %': a.buyersAgent.rate, 'SELLER PAID BUYER COMMISSION $': a.buyersAgent.amount,
            'LISTING AGENT COMMISSION %': a.listingAgent.rate, 'LISTING AGENT COMMISSION $': a.listingAgent.amount,
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

    return {
        open(next) {
            ctx = next;
            // Standard starting answers (each is still asked)
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            a = {
                sellers: [], collaborators: [], credit: '0', acceptance: isoDay(tomorrow), escrowDays: '30',
                escrowFee: '0.002', ownersTitle: '0.0045',
                buyersAgent: { rate: 0.025, amount: '0' }, listingAgent: { rate: 0.025, amount: '0' },
            };
            touched = {};
            lookup = null;
            index = 0;
            fromReview = false;
            $('#snw-title').textContent = 'New Seller Net Sheet for ' + nameOf(ctx.client);
            draw(1);
            dialog.showModal();
            lockPageScroll(dialog);
        },
    };
}
