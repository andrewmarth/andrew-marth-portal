// "New Property" pop-up for the home page's My Buyers card (admins).
// Asks for the other people on the page and the property details, then hands them to submit(answers).
// Uses the same pop-up styles as the income editor: a card on wide screens, a swipe-up sheet on phones.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';

// Same browser key as the main site's form (Google Places address suggestions)
const GOOGLE_MAPS_API_KEY = 'AIzaSyB_huoPCD9Jls7QigYuoJdW7ut9rOuQgwM';
const PROPERTY_TYPES = ['Single Family', 'Townhome', 'Condo', 'Manufactured'];
const CENSUS = ['Low', 'Moderate', 'Middle', 'Upper'];
const MAX_OTHERS = 5; // six people on a page: the buyer plus five more

const CSS = `
.property-dialog .income-section .type-fields { margin-top: 2px; }
.property-dialog .field-label { display: block; font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
.property-dialog .field-help { margin: 6px 0 0 8px; font-size: 0.82rem; opacity: 0.7; }
.property-dialog .type-picker.yes-no { grid-template-columns: 1fr 1fr; margin-bottom: 0; min-height: 54px; align-items: center; }
/* (the general ".field label" style would otherwise pull these to the top-left) */
.property-dialog .type-picker label { display: flex; align-items: center; justify-content: center; margin: 0; min-height: 44px; font-size: 0.95rem; }
.property-dialog [data-hoa-fields][hidden] { display: none; }
/* Single-choice dropdowns: same look as the portal's other dropdowns */
.property-dialog .sp-btn .mp-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.property-dialog .sp-option > svg:first-child { width: 20px; height: 20px; flex-shrink: 0; color: var(--gold); }
.property-dialog .sp-check { width: 18px; height: 18px; flex-shrink: 0; margin-left: auto; color: var(--olive); visibility: hidden; }
.property-dialog .sp-option[aria-selected="true"] .sp-check { visibility: visible; }
.property-dialog .mp-btn.is-invalid { border-color: var(--rust); background-color: #fdf2f2; }
/* Multi-select people dropdowns */
.property-dialog .mp-btn {
    width: 100%; min-height: 54px; display: flex; align-items: center; padding: 10px 44px 10px 20px;
    border: 2px solid var(--navy); border-radius: 999px; cursor: pointer; text-align: left;
    background: #f7f4f0 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234e513e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 18px center / 16px;
    font-family: inherit; font-size: 1.05rem; color: var(--brown);
}
.property-dialog .mp-btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.property-dialog .mp-btn .is-placeholder { opacity: 0.55; }
.property-dialog .mp.is-open .mp-btn, .property-dialog .mp-btn:focus-visible { outline: none; background-color: var(--white); border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.property-dialog .mp-list, .property-dialog .addr-suggestions {
    display: none; margin-top: 8px; max-height: 260px; overflow-y: auto; padding: 6px;
    background: var(--white); border: 2px solid var(--navy); border-radius: 20px; box-shadow: 4px 4px 0 var(--navy);
}
.property-dialog .mp.is-open .mp-list, .property-dialog .addr-suggestions.is-open { display: block; }
.property-dialog .mp-option, .property-dialog .addr-option {
    display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border-radius: 14px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.property-dialog .mp-option.is-disabled { opacity: 0.45; cursor: not-allowed; }
.property-dialog .mp-box {
    width: 22px; height: 22px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
    border: 2px solid var(--navy); border-radius: 7px; background: var(--white); color: var(--cream);
}
.property-dialog .mp-box svg { width: 14px; height: 14px; opacity: 0; }
.property-dialog .mp-option.is-on .mp-box { background: var(--olive); border-color: var(--olive); }
.property-dialog .mp-option.is-on .mp-box svg { opacity: 1; }
.property-dialog .mp-text, .property-dialog .addr-option-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.property-dialog .mp-main, .property-dialog .addr-main { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.property-dialog .mp-sub, .property-dialog .addr-secondary { font-size: 0.85rem; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.property-dialog .mp-empty { padding: 12px; font-size: 0.92rem; opacity: 0.7; }
.property-dialog .addr-option svg { width: 20px; height: 20px; flex-shrink: 0; color: var(--gold); }
.property-dialog .mp-option:active, .property-dialog .addr-option.is-active, .property-dialog .addr-option:active { background: #f4efe8; }
@media (hover: hover) { .property-dialog .mp-option:not(.is-disabled):hover, .property-dialog .addr-option:hover { background: #f4efe8; } }
.property-dialog .addr-credit { padding: 4px 12px 2px 12px; font-size: 0.7rem; opacity: 0.55; text-align: right; }
.property-dialog .addr-selected { display: flex; align-items: center; gap: 8px; margin: 10px 0 0 8px; font-weight: bold; color: var(--olive); }
.property-dialog .addr-selected svg { width: 18px; height: 18px; flex-shrink: 0; color: var(--tan); }
.property-dialog .addr-manual { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; margin-top: 4px; }
.property-dialog .addr-manual[hidden] { display: none; }
.property-dialog .addr-toggle {
    margin: 10px 0 0 6px; padding: 4px 0; border: none; background: none; cursor: pointer;
    font-family: inherit; font-size: 0.9rem; font-weight: bold; color: var(--rust); text-decoration: underline; text-underline-offset: 3px;
}
@media (max-width: 600px) {
    .property-dialog .addr-manual { grid-template-columns: 1fr; }
}
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const HOME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';
const MAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>';
const BANK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-6 9 6"/><path d="M5 10v9"/><path d="M19 10v9"/><path d="M9 10v9"/><path d="M15 10v9"/><path d="M3 21h18"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatPhone = id => (id.length === 10 ? '(' + id.slice(0, 3) + ') ' + id.slice(3, 6) + '-' + id.slice(6) : id);
const nameOf = a => a.name || formatPhone(a.id);
const digitsOf = v => String(v || '').replace(/\D/g, '');

const field = (id, label, input, span) => '<div class="field' + (span ? ' span-2' : '') + '"><label for="' + id + '">' + label + '</label>' + input + '</div>';
// Whole numbers shown with commas ("2,310"); money gets a $ in front
const wholeField = (id, label, { money, commas = true, max = 12, placeholder = '0' } = {}) => field(id, label,
    (money ? '<div class="money-wrap">' : '') + '<input id="' + id + '" class="' + (money ? 'money ' : '') + (commas ? 'commas' : 'digits') + '" type="text" inputmode="numeric" autocomplete="off" maxlength="' + max + '" placeholder="' + placeholder + '">' + (money ? '</div>' : ''));

let placesPromise = null;
function loadPlaces() {
    if (placesPromise) return placesPromise;
    placesPromise = new Promise((resolve, reject) => {
        if (window.google && google.maps && google.maps.importLibrary) { google.maps.importLibrary('places').then(resolve, reject); return; }
        window.__portalPlacesReady = () => google.maps.importLibrary('places').then(resolve, reject);
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_API_KEY) + '&loading=async&v=weekly&callback=__portalPlacesReady';
        script.async = true;
        script.onerror = reject;
        document.head.append(script);
    }).catch(err => { placesPromise = null; throw err; });
    return placesPromise;
}

// A dropdown of checkboxes. items() is re-read each time it opens (choices can depend on another dropdown).
function multiPicker(mount, { labelId, placeholder, items, canAdd, onChange }) {
    mount.innerHTML = '<div class="mp"><button type="button" class="mp-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + labelId + '"><span></span></button>'
        + '<div class="mp-list" role="listbox" aria-multiselectable="true"></div></div>';
    const root = mount.firstElementChild;
    const button = root.querySelector('.mp-btn');
    const list = root.querySelector('.mp-list');
    let chosen = [];
    const label = () => {
        const all = items(true);
        const names = chosen.map(id => all.find(a => a.id === id)).filter(Boolean).map(nameOf);
        const span = button.firstElementChild;
        span.textContent = names.length ? names.join(', ') : placeholder;
        span.classList.toggle('is-placeholder', !names.length);
    };
    const draw = () => {
        const opts = items();
        list.innerHTML = opts.length ? opts.map(a => {
            const on = chosen.includes(a.id);
            const off = !on && !canAdd();
            return '<div class="mp-option' + (on ? ' is-on' : '') + (off ? ' is-disabled' : '') + '" role="option" aria-selected="' + on + '" data-id="' + escapeHtml(a.id) + '">'
                + '<span class="mp-box">' + CHECK_ICON + '</span><span class="mp-text"><span class="mp-main">' + escapeHtml(nameOf(a)) + '</span>'
                + (a.name ? '<span class="mp-sub">' + escapeHtml(formatPhone(a.id)) + '</span>' : '') + '</span></div>';
        }).join('') : '<p class="mp-empty">No one else to add.</p>';
        list.querySelectorAll('.mp-option').forEach(o => {
            o.addEventListener('pointerdown', e => e.preventDefault());
            o.addEventListener('click', () => {
                const id = o.dataset.id;
                if (chosen.includes(id)) chosen = chosen.filter(x => x !== id);
                else if (canAdd()) chosen = chosen.concat([id]);
                else return;
                draw();
                label();
                onChange();
            });
        });
    };
    const close = () => { root.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', () => {
        if (root.classList.contains('is-open')) { close(); return; }
        draw();
        root.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); });
    label();
    return {
        value: () => chosen.slice(),
        // Drop anything no longer allowed (e.g. a collaborator who was just made a purchaser)
        prune() { const ok = items(true).map(a => a.id); chosen = chosen.filter(id => ok.includes(id)); label(); if (root.classList.contains('is-open')) draw(); },
        reset() { chosen = []; close(); label(); },
    };
}

// One choice from a list, drawn like the portal's other dropdowns (icon, name, small text, check on the choice)
function singlePicker(mount, { labelId, placeholder, icon }) {
    mount.innerHTML = '<div class="mp"><button type="button" class="mp-btn sp-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + labelId + '"><span class="mp-text"><span class="mp-main"></span><span class="mp-sub"></span></span></button>'
        + '<div class="mp-list" role="listbox"></div></div>';
    const root = mount.firstElementChild;
    const button = root.querySelector('.mp-btn');
    const list = root.querySelector('.mp-list');
    let items = [];
    let chosen = '';
    const label = () => {
        const it = items.find(i => i.value === chosen);
        const main = button.querySelector('.mp-main');
        const sub = button.querySelector('.mp-sub');
        main.textContent = it ? it.main : placeholder;
        main.classList.toggle('is-placeholder', !it);
        main.style.fontWeight = it ? 'bold' : 'normal';
        sub.textContent = it && it.secondary ? it.secondary : '';
        sub.hidden = !sub.textContent;
    };
    const draw = () => {
        list.innerHTML = items.map(it => '<div class="mp-option sp-option" role="option" aria-selected="' + (it.value === chosen) + '" data-value="' + escapeHtml(it.value) + '">' + icon
            + '<span class="mp-text"><span class="mp-main">' + escapeHtml(it.main) + '</span>' + (it.secondary ? '<span class="mp-sub">' + escapeHtml(it.secondary) + '</span>' : '') + '</span>'
            + CHECK_ICON.replace('<svg ', '<svg class="sp-check" ') + '</div>').join('');
        list.querySelectorAll('.sp-option').forEach(o => {
            o.addEventListener('pointerdown', e => e.preventDefault());
            o.addEventListener('click', () => { chosen = o.dataset.value; close(); label(); button.classList.remove('is-invalid'); button.focus(); });
        });
    };
    const close = () => { root.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', () => {
        if (root.classList.contains('is-open')) { close(); return; }
        draw();
        root.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); });
    return {
        button,
        value: () => chosen,
        setItems(next) { items = next; chosen = ''; close(); label(); },
        reset() { chosen = ''; close(); label(); },
    };
}

const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="property-dialog-title">New Property</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<p class="muted" data-intro></p>'
    + '<div class="dialog-scroll">'
    + '<fieldset class="income-section"><div class="section-head"><h3>People</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label" id="np-purchasers-label">Who Else Is A Purchaser</span><div data-purchasers></div></div>'
        + '<div class="field span-2"><span class="field-label" id="np-collaborators-label">Who Is A Collaborator</span><div data-collaborators></div>'
        + '<p class="field-help">Up to six people in all, including the buyer.</p></div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section"><div class="section-head"><h3>Property</h3></div><div class="type-fields">'
        + '<div class="field span-2"><label for="np-address">Property Address</label>'
            + '<div data-address-search><input id="np-address" type="text" placeholder="Start typing the address" autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="np-address-list">'
            + '<div class="addr-suggestions" id="np-address-list" role="listbox"></div>'
            + '<p class="addr-selected" hidden>' + CHECK_ICON + '<span></span></p></div>'
            + '<div class="addr-manual" hidden>'
                + field('np-street', 'Street Address', '<input id="np-street" type="text" autocomplete="off" placeholder="123 Main St">', true)
                + field('np-city', 'City', '<input id="np-city" type="text" autocomplete="off" placeholder="City">')
                + field('np-state', 'State', '<input id="np-state" type="text" autocomplete="off" maxlength="20" placeholder="AZ">')
                + field('np-zip', 'Zip', '<input id="np-zip" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="85251">')
            + '</div>'
            + '<button type="button" class="addr-toggle" data-addr-toggle>Can’t find it? Enter the address manually</button></div>'
        + '<div class="field"><span class="field-label" id="np-type-label">Property Type</span><div data-type></div></div>'
        + '<div class="field"><span class="field-label" id="np-census-label">Census Designation</span><div data-census></div></div>'
        + wholeField('np-sqft', 'Square Feet')
        + wholeField('np-year', 'Year Built', { commas: false, max: 4, placeholder: '1995' })
        + wholeField('np-taxes', 'Yearly Taxes', { money: true })
        + '<div class="field"><span class="field-label">Has Pool</span><div class="type-picker yes-no">'
            + '<input type="radio" name="np-pool" id="np-pool-yes" value="TRUE"><label for="np-pool-yes">Yes</label>'
            + '<input type="radio" name="np-pool" id="np-pool-no" value="FALSE" checked><label for="np-pool-no">No</label></div></div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section"><div class="section-head"><h3>Purchase</h3></div><div class="type-fields">'
        + wholeField('np-price', 'Purchase Price', { money: true })
        + '<div class="field"><span class="field-label" id="np-loan-label">Loan Product</span><div data-loan></div></div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section"><div class="section-head"><h3>HOA</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label">Has HOA</span><div class="type-picker yes-no">'
            + '<input type="radio" name="np-hoa" id="np-hoa-yes" value="TRUE"><label for="np-hoa-yes">Yes</label>'
            + '<input type="radio" name="np-hoa" id="np-hoa-no" value="FALSE" checked><label for="np-hoa-no">No</label></div></div>'
    + '</div><div class="type-fields" data-hoa-fields hidden>'
        + wholeField('np-hoa-transfer', 'Transfer Fee', { money: true })
        + wholeField('np-hoa-cap', 'Cap Fee', { money: true })
        + wholeField('np-hoa-disclosure', 'Disclosure Fee', { money: true })
        + wholeField('np-hoa-other', 'Other Fee', { money: true })
        + wholeField('np-hoa-primary', 'Primary Monthly Dues', { money: true })
        + wholeField('np-hoa-master', 'Master Monthly Dues', { money: true })
    + '</div></fieldset>'
    + '</div>'
    + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
        + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span>Create Property</button></div></div>'
    + '</form>';

let built = null;

/**
 * Opens the New Property pop-up for one buyer.
 * client: { id, name }; buyers / accounts: [{ id, name }]; loanProducts: [{ index, name, lender }]
 * submit(answers) must resolve once the property is saved (or throw).
 */
export function openNewPropertyForm({ client, buyers, accounts, loanProducts, submit }) {
    if (!built) built = build();
    built.open({ client, buyers, accounts, loanProducts, submit });
}

function build() {
    ensureDialogStyles();
    if (!document.getElementById('new-property-css')) {
        const style = document.createElement('style');
        style.id = 'new-property-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog property-dialog';
    dialog.setAttribute('aria-labelledby', 'property-dialog-title');
    dialog.innerHTML = DIALOG_HTML;
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const saveBtn = $('[data-save]');
    let ctx = null;
    let saving = false;

    // --- People ---
    const others = () => purchasers.value().length + collaborators.value().length;
    const purchasers = multiPicker($('[data-purchasers]'), {
        labelId: 'np-purchasers-label',
        placeholder: 'Just the buyer',
        items: () => (ctx ? ctx.buyers.filter(b => b.id !== ctx.client.id) : []),
        canAdd: () => others() < MAX_OTHERS,
        onChange: () => collaborators.prune(),
    });
    const collaborators = multiPicker($('[data-collaborators]'), {
        labelId: 'np-collaborators-label',
        placeholder: 'No collaborators',
        items: () => (ctx ? ctx.accounts.filter(a => a.id !== ctx.client.id && !purchasers.value().includes(a.id)) : []),
        canAdd: () => others() < MAX_OTHERS,
        onChange: () => {},
    });

    // --- Dropdowns ---
    const typePicker = singlePicker($('[data-type]'), { labelId: 'np-type-label', placeholder: 'Choose...', icon: HOME_ICON });
    const censusPicker = singlePicker($('[data-census]'), { labelId: 'np-census-label', placeholder: 'Choose...', icon: MAP_ICON });
    const loanPicker = singlePicker($('[data-loan]'), { labelId: 'np-loan-label', placeholder: 'Choose...', icon: BANK_ICON });
    typePicker.setItems(PROPERTY_TYPES.map(t => ({ value: t, main: t })));
    censusPicker.setItems(CENSUS.map(t => ({ value: t, main: t })));

    // --- HOA: the fee questions only show when there is one ---
    const hoaFields = $('[data-hoa-fields]');
    const hasHoa = () => form.querySelector('input[name="np-hoa"]:checked').value === 'TRUE';
    form.querySelectorAll('input[name="np-hoa"]').forEach(r => r.addEventListener('change', () => { hoaFields.hidden = !hasHoa(); }));

    // --- Numbers: commas while typing, digits only for year built ---
    dialog.querySelectorAll('input.commas').forEach(input => input.addEventListener('input', () => {
        const d = digitsOf(input.value).replace(/^0+(?=\d)/, '');
        input.value = d ? Number(d).toLocaleString('en-US') : '';
    }));
    dialog.querySelectorAll('input.digits').forEach(input => input.addEventListener('input', () => { input.value = digitsOf(input.value); }));

    // --- Address: Google suggestions, or the four fields typed in by hand ---
    const search = $('#np-address');
    const suggestions = $('.addr-suggestions');
    const selectedLine = $('.addr-selected');
    const manual = $('.addr-manual');
    const searchWrap = $('[data-address-search]');
    const toggle = $('[data-addr-toggle]');
    const parts = { street: $('#np-street'), city: $('#np-city'), state: $('#np-state'), zip: $('#np-zip') };
    let picked = null;
    let places = null;
    let session = null;
    let results = [];
    let highlighted = -1;
    let timer = null;
    let requestId = 0;
    const showManual = on => {
        manual.hidden = !on;
        searchWrap.hidden = on;
        toggle.textContent = on ? 'Search for the address instead' : 'Can’t find it? Enter the address manually';
        // Carry a chosen address over so it can be tweaked by hand
        if (on && picked) Object.keys(parts).forEach(k => { parts[k].value = picked[k]; });
    };
    toggle.addEventListener('click', () => showManual(manual.hidden));
    const closeSuggestions = () => { suggestions.classList.remove('is-open'); search.setAttribute('aria-expanded', 'false'); highlighted = -1; };
    const drawSuggestions = () => {
        if (!results.length) { closeSuggestions(); return; }
        suggestions.innerHTML = results.map((s, i) => {
            const p = s.placePrediction;
            return '<div class="addr-option' + (i === highlighted ? ' is-active' : '') + '" role="option" data-i="' + i + '">' + PIN_ICON
                + '<span class="addr-option-text"><span class="addr-main">' + escapeHtml(p.mainText ? p.mainText.text : p.text.text) + '</span>'
                + '<span class="addr-secondary">' + escapeHtml(p.secondaryText ? p.secondaryText.text : '') + '</span></span></div>';
        }).join('') + '<div class="addr-credit">Google Maps</div>';
        suggestions.querySelectorAll('.addr-option').forEach(o => {
            o.addEventListener('pointerdown', e => e.preventDefault());
            o.addEventListener('click', () => choose(Number(o.dataset.i)));
        });
        suggestions.classList.add('is-open');
        search.setAttribute('aria-expanded', 'true');
    };
    const fetchSuggestions = async text => {
        const id = ++requestId;
        try {
            places = places || await loadPlaces();
            session = session || new places.AutocompleteSessionToken();
            const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: text,
                sessionToken: session,
                includedRegionCodes: ['us'],
                includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
                locationBias: { center: { lat: 33.4484, lng: -112.074 }, radius: 50000 },
            });
            if (id !== requestId) return;
            results = (found || []).filter(s => s.placePrediction).slice(0, 4);
            highlighted = -1;
            drawSuggestions();
        } catch (err) {
            console.error('Google address suggestions unavailable:', err);
            closeSuggestions();
            // Google couldn't load or refused (e.g. this site isn't allowed on the key): type it in instead
            showManual(true);
            parts.street.value = parts.street.value || search.value.trim();
        }
    };
    const choose = async i => {
        const s = results[i];
        if (!s) return;
        closeSuggestions();
        const p = s.placePrediction;
        search.value = p.mainText ? p.mainText.text : p.text.text;
        try {
            const place = p.toPlace();
            await place.fetchFields({ fields: ['addressComponents'] });
            const get = (type, short) => {
                const c = (place.addressComponents || []).find(c => c.types.includes(type));
                return c ? (short ? c.shortText : c.longText) : '';
            };
            const line1 = [get('street_number'), get('route', true)].filter(Boolean).join(' ');
            const unit = get('subpremise');
            picked = {
                street: line1 ? (unit ? line1 + ' #' + unit : line1) : search.value,
                city: get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3'),
                state: get('administrative_area_level_1', true),
                zip: get('postal_code'),
            };
            search.value = picked.street;
            selectedLine.querySelector('span').textContent = [picked.city, (picked.state + ' ' + picked.zip).trim()].filter(Boolean).join(', ');
            selectedLine.hidden = false;
            search.classList.remove('is-invalid');
        } catch (err) {
            console.error('Could not load address details:', err);
            picked = null;
        }
        session = null; // a choice ends Google's billing session
    };
    search.addEventListener('input', () => {
        clearTimeout(timer);
        if (picked) { picked = null; selectedLine.hidden = true; }
        search.classList.remove('is-invalid');
        const text = search.value.trim();
        if (text.length < 3) { results = []; closeSuggestions(); return; }
        timer = setTimeout(() => fetchSuggestions(text), 220);
    });
    search.addEventListener('keydown', e => {
        if (!suggestions.classList.contains('is-open')) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
            drawSuggestions();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(highlighted >= 0 ? highlighted : 0);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            closeSuggestions();
        }
    });
    search.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

    // --- Close / save ---
    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
    form.addEventListener('input', e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; });
    form.addEventListener('change', e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; });

    const value = id => $('#' + id).value.trim();
    const problem = (el, text) => { if (el) { el.classList.add('is-invalid'); el.focus({ preventScroll: false }); } message.textContent = text; return true; };
    function address() {
        if (!manual.hidden) return { street: parts.street.value.trim(), city: parts.city.value.trim(), state: parts.state.value.trim(), zip: parts.zip.value.trim() };
        return picked;
    }
    function validate() {
        const a = address();
        if (!a) return problem(search, 'Please choose the address from the suggestions, or enter it manually.');
        const missingPart = ['street', 'city', 'state', 'zip'].find(k => !a[k]);
        if (missingPart) return problem(manual.hidden ? search : parts[missingPart], 'Please fill in the full address (street, city, state and zip).');
        if (!typePicker.value()) return problem(typePicker.button, 'Please choose the property type.');
        const year = value('np-year');
        const latest = new Date().getFullYear() + 1;
        if (year && (year.length !== 4 || Number(year) < 1850 || Number(year) > latest)) return problem($('#np-year'), 'Year built must be between 1850 and ' + latest + '.');
        if (!(Number(digitsOf(value('np-price'))) > 0)) return problem($('#np-price'), 'Please enter the purchase price.');
        if (loanPicker.value() === '') return problem(loanPicker.button, 'Please choose a loan product.');
        return false;
    }
    form.addEventListener('submit', async e => {
        e.preventDefault();
        message.textContent = '';
        if (validate()) return;
        const answers = {
            clientId: ctx.client.id,
            purchasers: purchasers.value(),
            collaborators: collaborators.value(),
            address: address(),
            propertyType: typePicker.value(),
            sqft: digitsOf(value('np-sqft')),
            yearBuilt: digitsOf(value('np-year')),
            yearlyTaxes: digitsOf(value('np-taxes')),
            hasPool: form.querySelector('input[name="np-pool"]:checked').value === 'TRUE',
            purchasePrice: digitsOf(value('np-price')),
            loanProduct: Number(loanPicker.value()),
            // No HOA: every HOA fee and due is 0
            hoa: hasHoa() ? {
                transfer: digitsOf(value('np-hoa-transfer')), cap: digitsOf(value('np-hoa-cap')),
                disclosure: digitsOf(value('np-hoa-disclosure')), other: digitsOf(value('np-hoa-other')),
                primary: digitsOf(value('np-hoa-primary')), master: digitsOf(value('np-hoa-master')),
            } : { transfer: '0', cap: '0', disclosure: '0', other: '0', primary: '0', master: '0' },
            census: censusPicker.value(),
        };
        saving = true;
        saveBtn.disabled = true;
        saveBtn.classList.add('is-loading');
        try {
            await ctx.submit(answers);
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = 'We couldn’t create the property. Please try again.';
        } finally {
            saving = false;
            saveBtn.disabled = false;
            saveBtn.classList.remove('is-loading');
        }
    });

    return {
        open(next) {
            ctx = next;
            form.reset();
            dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            message.textContent = '';
            purchasers.reset();
            collaborators.reset();
            picked = null;
            results = [];
            selectedLine.hidden = true;
            closeSuggestions();
            showManual(false);
            $('[data-intro]').textContent = 'For ' + nameOf(ctx.client) + '. Everything else starts with standard placeholder values you can change in Settings.';
            typePicker.reset();
            censusPicker.reset();
            loanPicker.setItems((ctx.loanProducts || []).map(p => ({ value: String(p.index), main: p.name || 'Loan product ' + (p.index + 1), secondary: p.lender })));
            hoaFields.hidden = true;
            dialog.showModal();
            lockPageScroll(dialog);
            $('.dialog-scroll').scrollTop = 0;
        },
    };
}
