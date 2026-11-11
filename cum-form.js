// The CUM page's "+" pop-up, one question at a time (same look as the home page's New Task form):
//   Income / Expense   what it's for, how much, which day
//   Spending Budget    how much, the savings allocation set aside with it, and which Monday (always called "Spending Budget"; money set aside: it goes out like an
//                      expense, is highlighted on the list, and drops off the list on its Monday without a catch-up question)
//   Rent Split         what it's called, the day the rent is due, who it's split with, the line items, what percent of
//                      each they pay, whether any item is paid on its own day, and when they pay their share
//   Roadhouse Paycheck the day it comes in and the shifts it covers (hours, sales, tip %); the amount is worked out
//                      from the Roadhouse Paycheck Settings
// Editing a rent split or a paycheck opens the same questions (without the first one), filled in, with Delete.
// openSplitPayments: the Edit on money coming in from someone splitting with you: their share in payments on different days.
import { ensureStepFormStyles } from '/task-form.js';
import { lockPageScroll } from '/income-editor.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_ITEMS = 20;
const MAX_SHIFTS = 14;

const CSS = `
.cum-form-dialog .cf-money { position: relative; max-width: 260px; }
.cum-form-dialog .cf-money::before { content: '$'; position: absolute; left: 20px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.cum-form-dialog .tf-step .cf-money input[type="text"] { padding-left: 36px; }
.cum-form-dialog .cf-rows { display: flex; flex-direction: column; gap: 10px; }
.cum-form-dialog .cf-row { padding: 12px; border: 2px solid rgba(14, 42, 59, 0.2); border-radius: 16px; background: #f7f4f0; }
.cum-form-dialog .cf-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cum-form-dialog .cf-row-name { font-weight: bold; overflow-wrap: anywhere; }
.cum-form-dialog .cf-row-sub { font-size: 0.85rem; opacity: 0.7; }
.cum-form-dialog .cf-item { display: grid; grid-template-columns: 1fr 130px 40px; gap: 8px; align-items: center; }
.cum-form-dialog .tf-step .cf-row input[type="text"], .cum-form-dialog .tf-step .cf-row input[type="date"] {
    width: 100%; min-height: 46px; padding: 8px 14px; border: 2px solid var(--navy); border-radius: 999px; background: var(--white);
    font-family: inherit; font-size: 1rem; color: var(--brown);
}
.cum-form-dialog .tf-step .cf-row .cf-money input[type="text"] { padding-left: 28px; }
.cum-form-dialog .cf-row .cf-money::before { left: 14px; }
.cum-form-dialog .cf-row input:focus { outline: none; border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.cum-form-dialog .cf-remove { width: 40px; height: 40px; border-radius: 50%; border: 2px solid rgba(14, 42, 59, 0.3); background: var(--white); color: var(--rust); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.cum-form-dialog .cf-remove:disabled { opacity: 0.3; cursor: default; }
.cum-form-dialog .cf-remove svg { width: 16px; height: 16px; }
.cum-form-dialog .cf-add-item { margin-top: 12px; padding: 10px 18px; border: 2px dashed rgba(14, 42, 59, 0.4); border-radius: 999px; background: none; color: var(--olive); font-family: inherit; font-size: 0.95rem; font-weight: bold; cursor: pointer; }
.cum-form-dialog .cf-add-item[hidden] { display: none; }
.cum-form-dialog .cf-total { margin-top: 12px; font-size: 0.95rem; font-weight: bold; color: var(--olive); }
.cum-form-dialog .cf-pct { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.cum-form-dialog .tf-step .cf-pct input[type="text"] { width: 76px; text-align: right; }
.cum-form-dialog .cf-seg { display: inline-flex; gap: 6px; flex: 0 0 auto; }
.cum-form-dialog .cf-seg button { min-height: 38px; padding: 4px 12px; border: 2px solid rgba(14, 42, 59, 0.25); border-radius: 999px; background: var(--white); color: var(--brown); font-family: inherit; font-size: 0.85rem; font-weight: bold; cursor: pointer; white-space: nowrap; }
.cum-form-dialog .cf-seg button[aria-pressed="true"] { background: var(--olive); border-color: var(--olive); color: var(--cream); }
.cum-form-dialog .cf-sep-date { margin-top: 10px; }
.cum-form-dialog .cf-sep-date[hidden] { display: none; }
.cum-form-dialog .cf-sep-date label { display: block; font-size: 0.85rem; font-weight: bold; margin: 0 0 6px 6px; }
.cum-form-dialog .cf-delete { margin-right: auto; background: var(--white); color: #b3392f; border-color: #b3392f; }
.cum-form-dialog .cf-delete[hidden] { display: none; }
.cum-form-dialog [data-confirm-delete] { background: #b3392f; }
.cum-form-dialog .tf-cal-day.is-picked { background: var(--olive); }
.cum-form-dialog .cf-shift { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 0.8fr) 40px; gap: 8px; align-items: end; }
.cum-form-dialog .cf-shift label { display: block; font-size: 0.78rem; font-weight: bold; margin: 0 0 4px 8px; }
.cum-form-dialog .cf-suffix { position: relative; }
.cum-form-dialog .cf-suffix::after { content: attr(data-suffix); position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.cum-form-dialog .tf-step .cf-row .cf-suffix input[type="text"] { padding-right: 34px; }
.cum-form-dialog .cf-shift .cf-money { max-width: none; }
.cum-form-dialog .cf-pay-preview { margin-top: 12px; padding: 12px 14px; border-radius: 14px; background: #f7f4f0; font-size: 0.9rem; }
.cum-form-dialog .cf-pay-preview li { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; list-style: none; }
.cum-form-dialog .cf-pay-preview li.is-net { margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(14, 42, 59, 0.2); font-weight: bold; color: var(--olive); }
.cum-form-dialog .cf-pay-preview ul { margin: 0; padding: 0; }
.cum-form-dialog .cf-pay-preview.is-missing { color: #b3392f; font-weight: bold; }
@media (max-width: 600px) {
    .cum-form-dialog .cf-shift { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 40px; }
    .cum-form-dialog .cf-shift .cf-shift-sales { grid-column: 1 / 3; grid-row: 2; }
    .cum-form-dialog .cf-shift .cf-remove { grid-column: 3; grid-row: 1; }
    .cum-form-dialog .cf-item { grid-template-columns: 1fr 40px; }
    .cum-form-dialog .cf-item .cf-money { grid-column: 1; max-width: none; }
    .cum-form-dialog .cf-row-head { flex-wrap: wrap; }
    .cum-form-dialog .cf-delete { margin-right: 0; }
}
`;

const ICON = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const PERSON_ICON = ICON('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const KINDS = [
    { value: 'income', main: 'Income', sub: 'Money coming in', icon: ICON('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>') },
    { value: 'expense', main: 'Expense', sub: 'Money going out', icon: ICON('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>') },
    { value: 'savings', main: 'Spending Budget', sub: 'Money set aside for spending', icon: ICON('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>') },
    { value: 'rent', main: 'Rent Split', sub: 'Rent shared with someone else', icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M12 13v8"/>') },
    { value: 'roadhouse', main: 'Roadhouse Paycheck', sub: 'Worked out from your shifts', icon: ICON('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>') },
];
const WHENS = [
    { value: 'same', main: 'The same day as the rent', sub: 'Their share comes in when the rent is due', icon: ICON('<path d="M20 6 9 17l-5-5"/>') },
    { value: 'other', main: 'A different day', sub: 'Pick the day their share comes in', icon: ICON('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>') },
];

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) => a && b && dayStart(a).getTime() === dayStart(b).getTime();
const longDate = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const centsFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dollars = n => centsFormat.format(Math.round(n * 100) / 100);
// "11/5/2026" or "2026-11-05" as a local day
function dayOf(value) {
    const v = String(value || '').trim();
    let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(Number(m[3]), m[1] - 1, Number(m[2]));
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), m[2] - 1, Number(m[3])) : null;
}
// Money boxes: digits and one decimal point (line items also allow a leading minus, for a credit)
const cleanMoney = (v, negative) => v.replace(negative ? /[^0-9.-]/g : /[^0-9.]/g, '').replace(/(?!^)-/g, '').replace(/(\..*)\./g, '$1');

const choice = (value, main, sub, icon) => '<button type="button" class="tf-choice" data-value="' + escapeHtml(value) + '" aria-pressed="false">'
    + '<span class="tf-choice-icon">' + icon + '</span><span>' + escapeHtml(main) + '<small>' + escapeHtml(sub) + '</small></span></button>';
const step = (id, body) => '<section class="tf-step" data-step="' + id + '" hidden>'
    + '<h3 class="tf-question" id="cf-q-' + id + '"></h3><p class="tf-hint" data-hint></p>' + body + '</section>';
const calendar = id => '<div class="tf-cal" data-cal="' + id + '"><div class="tf-cal-head">'
    + '<button type="button" class="tf-cal-nav" data-cal-prev aria-label="Previous month">' + PREV + '</button>'
    + '<span class="tf-cal-title" data-cal-title></span>'
    + '<button type="button" class="tf-cal-nav" data-cal-next aria-label="Next month">' + NEXT + '</button></div>'
    + '<div class="tf-cal-grid" data-cal-grid></div></div><p class="tf-picked" data-cal-picked></p>';

const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="cf-title">Add Transaction</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<div class="tf-progress"><span class="tf-progress-text" data-progress></span><div class="tf-bar"><span data-bar></span></div></div>'
    + '<div class="dialog-scroll">'
    + step('kind', '<div class="tf-choices is-stacked" data-choices="kind">' + KINDS.map(k => choice(k.value, k.main, k.sub, k.icon)).join('') + '</div>')
    + step('description', '<input id="cf-description" type="text" maxlength="100" autocomplete="off" aria-labelledby="cf-q-description">')
    + step('amount', '<div class="cf-money"><input id="cf-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-labelledby="cf-q-amount"></div>')
    + step('allocation', '<div class="cf-money"><input id="cf-allocation" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-labelledby="cf-q-allocation"></div>')
    + step('date', calendar('date'))
    + step('splitWith', '<div class="tf-list" data-people role="group" aria-labelledby="cf-q-splitWith"></div>')
    + step('items', '<div class="cf-rows" data-items></div><button type="button" class="cf-add-item" data-add-item>+ Add a line item</button><p class="cf-total" data-items-total></p>')
    + step('percents', '<div class="cf-rows" data-percents></div><p class="cf-total" data-share-total></p>')
    + step('separate', '<div class="cf-rows" data-separate></div>')
    + step('splitWhen', '<div class="tf-choices is-stacked" data-choices="splitWhen">' + WHENS.map(w => choice(w.value, w.main, w.sub, w.icon)).join('') + '</div>')
    + step('splitDate', calendar('splitDate'))
    + step('shifts', '<div class="cf-rows" data-shifts></div><button type="button" class="cf-add-item" data-add-shift>+ Add a shift</button><div class="cf-pay-preview" data-pay-preview></div>')
    + '</div>'
    + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary cf-delete" data-delete hidden>Delete</button>'
        + '<button type="button" class="btn btn-secondary" data-back>Cancel</button>'
        + '<button type="submit" class="btn" data-next><span class="btn-spinner" aria-hidden="true"></span><span data-next-text>Next</span></button></div></div>'
    + '<div class="ie-confirm" hidden role="alertdialog" aria-labelledby="cf-confirm-title"><div class="ie-confirm-card"><h3 id="cf-confirm-title">Delete this rent split?</h3>'
        + '<p data-confirm-text>It will be removed from your cash flow, along with what the other person owes for it. This can’t be undone here.</p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-keep>Cancel</button>'
        + '<button type="button" class="btn" data-confirm-delete><span class="btn-spinner" aria-hidden="true"></span>Delete</button></div></div></div>'
    + '</form>';

let built = null;

/**
 * Opens the pop-up.
 *   add:  { splitPeople: [{ id, name }], save(payload), errorText(err) }
 *   edit: the same plus tx (a rent split's main entry: row, date, description, splitDate, items) and remove()
 * save(payload) gets the API request ({ action: 'addTransaction' | 'saveRentSplit', ... }) and must resolve once it's
 * saved (or throw an Error whose message is the API's error code); remove() likewise for Delete.
 */
export function openCumForm(next) {
    if (!built) built = build();
    built.open(next);
}

function ensureCumFormStyles() {
    ensureStepFormStyles();
    if (!document.getElementById('cum-form-css')) {
        const style = document.createElement('style');
        style.id = 'cum-form-css';
        style.textContent = CSS;
        document.head.append(style);
    }
}

function build() {
    ensureCumFormStyles();
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog task-dialog cum-form-dialog';
    dialog.setAttribute('aria-labelledby', 'cf-title');
    dialog.innerHTML = DIALOG_HTML;
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const nextBtn = $('[data-next]');
    const backBtn = $('[data-back]');
    const scroller = $('.dialog-scroll');
    const confirmBox = $('.ie-confirm');
    let ctx = null;
    let editing = false;
    let saving = false;
    let a = {};
    let current = 'kind';

    const RENT_STEPS = () => ['description', 'date', 'splitWith', 'items', 'percents', 'separate', 'splitWhen'].concat(a.splitWhen === 'other' ? ['splitDate'] : []);
    const kindSteps = () => (a.kind === 'rent' ? RENT_STEPS() : a.kind === 'roadhouse' ? ['date', 'shifts'] : a.kind === 'savings' ? ['amount', 'allocation', 'date'] : ['description', 'amount', 'date']);
    const savings = () => a.kind === 'savings';
    const steps = () => (editing ? kindSteps() : ['kind'].concat(kindSteps()));
    const rent = () => a.kind === 'rent';
    const roadhouse = () => a.kind === 'roadhouse';
    const personName = () => (ctx.splitPeople.find(p => p.id === a.splitWith) || {}).name || 'They';
    const firstName = () => personName().split(' ')[0];

    // The question and hint for each step (some depend on the answers so far)
    function words(id) {
        if (id === 'kind') return ['What are you adding?', ''];
        if (id === 'description') return rent() ? ['What should it be called?', 'Like “Rent” or “March Rent”.'] : ['What’s it for?', a.kind === 'income' ? 'Like “Paycheck”.' : a.kind === 'savings' ? 'Like “Emergency fund” or “Vacation”.' : 'Like “Car payment”.'];
        if (id === 'amount') return savings() ? ['How much is the spending budget?', ''] : ['How much?', ''];
        if (id === 'allocation') return ['How much goes to savings?', 'It goes out with the spending budget and is added to your Savings Allocation on that Monday. 0 if none.'];
        if (id === 'date') return rent() ? ['When is the rent due?', ''] : roadhouse() ? ['When is payday?', ''] : [a.kind === 'income' ? 'When does it come in?' : a.kind === 'savings' ? 'Which Monday is it for?' : 'When does it go out?', a.kind === 'savings' ? 'Mondays only. It comes off the list on that Monday.' : ''];
        if (id === 'shifts') return ['Which shifts does it cover?', 'Hours, sales and the tip percent for each shift.'];
        if (id === 'splitWith') return ['Who are you splitting it with?', ''];
        if (id === 'items') return ['What’s included?', 'Each charge on its own line. Use a minus for a credit, like -20.'];
        if (id === 'percents') return ['How much of each does ' + firstName() + ' pay?', 'A percent of each line. 0 means you pay all of it.'];
        if (id === 'separate') return ['Is anything paid on a different day?', 'Most lines are paid with the rent. Pick “Own day” for one that isn’t, like a utility bill.'];
        if (id === 'splitWhen') return ['When does ' + firstName() + ' pay you?', ''];
        if (id === 'splitDate') return ['Which day does ' + firstName() + ' pay you?', ''];
        return ['', ''];
    }

    // --- Big choices (Income / Expense / Rent Split; when they pay) ---
    dialog.querySelectorAll('[data-choices]').forEach(group => group.addEventListener('click', e => {
        const b = e.target.closest('.tf-choice');
        if (!b) return;
        a[group.dataset.choices] = b.dataset.value;
        if (group.dataset.choices === 'kind') {
            $('#cf-title').textContent = 'Add ' + KINDS.find(k => k.value === a.kind).main;
            // A rent split starts out called "Rent"
            if (a.kind === 'rent' && !$('#cf-description').value.trim()) $('#cf-description').value = 'Rent';
        }
        drawChoices();
        message.textContent = '';
        // "The same day as the rent" is the last question, so it waits for the save button
        if (!(group.dataset.choices === 'splitWhen' && b.dataset.value === 'same')) setTimeout(() => go(1), 180);
        else showFooter();
    }));
    const drawChoices = () => dialog.querySelectorAll('[data-choices]').forEach(group => group.querySelectorAll('.tf-choice')
        .forEach(b => b.setAttribute('aria-pressed', String(a[group.dataset.choices] === b.dataset.value))));

    // --- Money box (Income / Expense) ---
    $('#cf-amount').addEventListener('input', e => { const v = cleanMoney(e.target.value, false); if (v !== e.target.value) e.target.value = v; });
    $('#cf-allocation').addEventListener('input', e => { const v = cleanMoney(e.target.value, false); if (v !== e.target.value) e.target.value = v; });

    // --- Calendars (the rent's day, the day their share comes in): today on; a pick moves on unless it's the last question ---
    const cals = {};
    dialog.querySelectorAll('[data-cal]').forEach(box => {
        const name = box.dataset.cal;
        const cal = cals[name] = { shown: new Date() };
        const grid = box.querySelector('[data-cal-grid]');
        const picked = box.parentElement.querySelector('[data-cal-picked]');
        cal.draw = () => {
            const year = cal.shown.getFullYear(), month = cal.shown.getMonth();
            const today = dayStart(new Date());
            box.querySelector('[data-cal-title]').textContent = MONTHS[month] + ' ' + year;
            box.querySelector('[data-cal-prev]').disabled = year === today.getFullYear() && month === today.getMonth();
            const first = new Date(year, month, 1).getDay();
            const days = new Date(year, month + 1, 0).getDate();
            let html = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => '<span class="tf-cal-dow">' + d + '</span>').join('');
            for (let i = 0; i < first; i++) html += '<span></span>';
            for (let d = 1; d <= days; d++) {
                const day = new Date(year, month, d);
                const on = sameDay(day, a[name]);
                const closed = day < today || (savings() && name === 'date' && (day.getDay() !== 1 || day <= today));
                html += '<button type="button" class="tf-cal-day' + (sameDay(day, today) ? ' is-today' : '') + (on ? ' is-picked' : '') + '" data-day="' + d + '"'
                    + (closed ? ' disabled' : '') + (on ? ' aria-pressed="true"' : '') + ' aria-label="' + escapeHtml(longDate(day)) + '">' + d + '</button>';
            }
            grid.innerHTML = html;
            picked.textContent = a[name] ? longDate(a[name]) : '';
        };
        cal.open = () => { const d = a[name] || new Date(); cal.shown = new Date(d.getFullYear(), d.getMonth(), 1); cal.draw(); };
        box.querySelector('[data-cal-prev]').addEventListener('click', () => { cal.shown = new Date(cal.shown.getFullYear(), cal.shown.getMonth() - 1, 1); cal.draw(); });
        box.querySelector('[data-cal-next]').addEventListener('click', () => { cal.shown = new Date(cal.shown.getFullYear(), cal.shown.getMonth() + 1, 1); cal.draw(); });
        grid.addEventListener('click', e => {
            const b = e.target.closest('[data-day]');
            if (!b || b.disabled) return;
            a[name] = new Date(cal.shown.getFullYear(), cal.shown.getMonth(), Number(b.dataset.day));
            message.textContent = '';
            cal.draw();
            const list = steps();
            if (list.indexOf(current) < list.length - 1) setTimeout(() => go(1), 180);
            else showFooter();
        });
    });

    // --- Who it's split with ---
    function drawPeople() {
        const box = $('[data-people]');
        if (!ctx.splitPeople.length) { box.innerHTML = '<p class="tf-hint">There’s no one else with Cash Flow to split with yet.</p>'; return; }
        box.innerHTML = ctx.splitPeople.map(p => '<button type="button" class="tf-person" data-value="' + escapeHtml(p.id) + '" aria-pressed="' + (a.splitWith === p.id) + '">'
            + '<span class="tf-person-icon">' + PERSON_ICON + '</span><span class="tf-person-text"><span class="tf-person-name">' + escapeHtml(p.name) + '</span></span>'
            + '<span class="tf-check">' + CHECK + '</span></button>').join('');
    }
    $('[data-people]').addEventListener('click', e => {
        const b = e.target.closest('.tf-person');
        if (!b) return;
        a.splitWith = b.dataset.value;
        message.textContent = '';
        drawPeople();
        setTimeout(() => go(1), 180);
    });

    // --- Line items: description and amount, add / remove ---
    const itemAmount = i => Number(String(i.amount).replace(/[$,]/g, '')) || 0;
    function drawItems() {
        $('[data-items]').innerHTML = a.items.map((it, k) => '<div class="cf-row cf-item" data-k="' + k + '">'
            + '<input type="text" class="cf-item-desc" maxlength="100" autocomplete="off" placeholder="Description" aria-label="Line ' + (k + 1) + ' description" value="' + escapeHtml(it.description) + '">'
            + '<div class="cf-money"><input type="text" class="cf-item-amount" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Line ' + (k + 1) + ' amount" value="' + escapeHtml(it.amount) + '"></div>'
            + '<button type="button" class="cf-remove" data-remove aria-label="Remove line ' + (k + 1) + '"' + (a.items.length === 1 ? ' disabled' : '') + '>' + CLOSE_ICON + '</button></div>').join('');
        $('[data-add-item]').hidden = a.items.length >= MAX_ITEMS;
        drawItemsTotal();
    }
    const drawItemsTotal = () => { $('[data-items-total]').textContent = 'Total ' + dollars(a.items.reduce((s, i) => s + itemAmount(i), 0)); };
    $('[data-items]').addEventListener('input', e => {
        const row = e.target.closest('[data-k]');
        if (!row) return;
        const it = a.items[Number(row.dataset.k)];
        if (e.target.matches('.cf-item-desc')) it.description = e.target.value;
        if (e.target.matches('.cf-item-amount')) { const v = cleanMoney(e.target.value, true); if (v !== e.target.value) e.target.value = v; it.amount = v; drawItemsTotal(); }
    });
    $('[data-items]').addEventListener('click', e => {
        const b = e.target.closest('[data-remove]');
        if (!b || a.items.length === 1) return;
        a.items.splice(Number(b.closest('[data-k]').dataset.k), 1);
        drawItems();
    });
    $('[data-add-item]').addEventListener('click', () => {
        if (a.items.length >= MAX_ITEMS) return;
        a.items.push({ n: 0, description: '', amount: '', percent: '50', separate: false, separateDate: '' });
        drawItems();
        const rows = dialog.querySelectorAll('.cf-item-desc');
        rows[rows.length - 1].focus();
    });

    // --- Roadhouse Paycheck shifts: hours, sales, tip %; the paycheck worked out underneath ---
    const num = v => Number(String(v).replace(/[$,%\s]/g, '')) || 0;
    function drawShifts() {
        const box = (k, cls, label, value, extra) => '<div class="' + cls + '"><label for="cf-' + cls + '-' + k + '">' + label + '</label>' + extra[0]
            + '<input type="text" id="cf-' + cls + '-' + k + '" class="' + cls + '-input" inputmode="decimal" autocomplete="off" placeholder="0" value="' + escapeHtml(value) + '">' + extra[1] + '</div>';
        $('[data-shifts]').innerHTML = a.shifts.map((sh, k) => '<div class="cf-row cf-shift" data-k="' + k + '">'
            + box(k, 'cf-shift-hours', 'Hours', sh.hours, ['<div class="cf-suffix" data-suffix="hr">', '</div>'])
            + box(k, 'cf-shift-sales', 'Sales', sh.sales, ['<div class="cf-money">', '</div>'])
            + box(k, 'cf-shift-tip', 'Tip', sh.tip, ['<div class="cf-suffix" data-suffix="%">', '</div>'])
            + '<button type="button" class="cf-remove" data-remove aria-label="Remove shift ' + (k + 1) + '"' + (a.shifts.length === 1 ? ' disabled' : '') + '>' + CLOSE_ICON + '</button></div>').join('');
        $('[data-add-shift]').hidden = a.shifts.length >= MAX_SHIFTS;
        drawPay();
    }
    // The same math as the API: wages (no overtime) + tips - tip pool payout + tip pool received, less each tax
    function drawPay() {
        const s = ctx.roadhouse;
        const preview = $('[data-pay-preview]');
        preview.classList.toggle('is-missing', !s);
        if (!s) { preview.textContent = 'Fill in Roadhouse Paycheck Settings at the bottom of the page first.'; return; }
        const r = n => Math.round(n * 100) / 100;
        const hours = a.shifts.reduce((t, x) => t + num(x.hours), 0);
        const sales = a.shifts.reduce((t, x) => t + num(x.sales), 0);
        const wages = r(hours * s.rate);
        const tips = r(a.shifts.reduce((t, x) => t + num(x.sales) * num(x.tip) / 100, 0));
        const payout = r(sales * s.payout);
        const received = r(sales * s.payout * s.received);
        const earned = r(wages + tips - payout + received);
        const taxes = [['AZ Tax', s.az], ['FITW Tax', s.fitw], ['MED Tax', s.med], ['SS Tax', s.ss]].map(([label, p]) => [label, r(earned * p)]);
        const net = r(earned - taxes.reduce((t, x) => t + x[1], 0));
        const row = (label, n, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '><span>' + escapeHtml(label) + '</span><span>' + (n < 0 ? '−' : '') + dollars(Math.abs(n)) + '</span></li>';
        preview.innerHTML = '<ul>' + row('Wages (' + r(hours) + ' hours)', wages) + row('Tips', tips) + row('Tip Pool Payout', -payout) + row('Tip Pool Received', received)
            + row('Earned Income', earned, 'is-net') + taxes.map(([label, n]) => row(label, -n)).join('') + row('Paycheck', net, 'is-net') + '</ul>';
    }
    $('[data-shifts]').addEventListener('input', e => {
        const row = e.target.closest('[data-k]');
        if (!row) return;
        const v = cleanMoney(e.target.value, false);
        if (v !== e.target.value) e.target.value = v;
        const sh = a.shifts[Number(row.dataset.k)];
        if (e.target.matches('.cf-shift-hours-input')) sh.hours = v;
        if (e.target.matches('.cf-shift-sales-input')) sh.sales = v;
        if (e.target.matches('.cf-shift-tip-input')) sh.tip = v;
        drawPay();
    });
    $('[data-shifts]').addEventListener('click', e => {
        const b = e.target.closest('[data-remove]');
        if (!b || a.shifts.length === 1) return;
        a.shifts.splice(Number(b.closest('[data-k]').dataset.k), 1);
        drawShifts();
    });
    $('[data-add-shift]').addEventListener('click', () => {
        if (a.shifts.length >= MAX_SHIFTS) return;
        const last = a.shifts[a.shifts.length - 1];
        a.shifts.push({ hours: '', sales: '', tip: last ? last.tip : '' });
        drawShifts();
        const rows = dialog.querySelectorAll('.cf-shift-hours-input');
        rows[rows.length - 1].focus();
    });

    // --- What percent of each line they pay ---
    const share = i => itemAmount(i) * (Number(i.percent) || 0) / 100;
    function drawPercents() {
        $('[data-percents]').innerHTML = a.items.map((it, k) => '<div class="cf-row" data-k="' + k + '"><div class="cf-row-head">'
            + '<span><span class="cf-row-name">' + escapeHtml(it.description) + '</span><br><span class="cf-row-sub">' + dollars(itemAmount(it)) + ' · ' + escapeHtml(firstName()) + ' pays <span data-share>' + dollars(share(it)) + '</span></span></span>'
            + '<span class="cf-pct"><input type="text" class="cf-pct-input" inputmode="decimal" autocomplete="off" aria-label="Percent of ' + escapeHtml(it.description) + '" value="' + escapeHtml(it.percent) + '">%</span>'
            + '</div></div>').join('');
        drawShareTotal();
    }
    const drawShareTotal = () => { $('[data-share-total]').textContent = firstName() + ' pays ' + dollars(a.items.reduce((s, i) => s + share(i), 0)) + ' in all'; };
    $('[data-percents]').addEventListener('input', e => {
        const row = e.target.closest('[data-k]');
        if (!row) return;
        const v = cleanMoney(e.target.value, false);
        if (v !== e.target.value) e.target.value = v;
        const it = a.items[Number(row.dataset.k)];
        it.percent = v;
        row.querySelector('[data-share]').textContent = dollars(share(it));
        drawShareTotal();
    });

    // --- Paid with the rent, or on its own day ---
    function drawSeparate() {
        const today = isoDate(new Date());
        $('[data-separate]').innerHTML = a.items.map((it, k) => '<div class="cf-row" data-k="' + k + '"><div class="cf-row-head">'
            + '<span><span class="cf-row-name">' + escapeHtml(it.description) + '</span><br><span class="cf-row-sub">' + dollars(itemAmount(it)) + '</span></span>'
            + '<span class="cf-seg" role="group" aria-label="When ' + escapeHtml(it.description) + ' is paid">'
                + '<button type="button" data-sep="no" aria-pressed="' + !it.separate + '">With rent</button>'
                + '<button type="button" data-sep="yes" aria-pressed="' + it.separate + '">Own day</button></span></div>'
            + '<div class="cf-sep-date"' + (it.separate ? '' : ' hidden') + '><label for="cf-sep-' + k + '">Paid on' + (it.separatePaid ? ' (already paid)' : '') + '</label>'
            + '<input type="date" id="cf-sep-' + k + '" class="cf-sep-input" min="' + today + '" value="' + escapeHtml(it.separateDate) + '"></div></div>').join('');
    }
    $('[data-separate]').addEventListener('click', e => {
        const b = e.target.closest('[data-sep]');
        if (!b) return;
        const row = b.closest('[data-k]');
        const it = a.items[Number(row.dataset.k)];
        it.separate = b.dataset.sep === 'yes';
        message.textContent = '';
        row.querySelectorAll('[data-sep]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        row.querySelector('.cf-sep-date').hidden = !it.separate;
        if (it.separate && !it.separateDate) setTimeout(() => row.querySelector('.cf-sep-input').focus(), 50);
    });
    $('[data-separate]').addEventListener('input', e => {
        const row = e.target.closest('[data-k]');
        if (row && e.target.matches('.cf-sep-input')) a.items[Number(row.dataset.k)].separateDate = e.target.value;
    });

    // --- Moving between questions ---
    const problem = (el, text) => {
        if (el) { el.classList.add('is-invalid'); el.focus({ preventScroll: true }); }
        message.textContent = text;
        return false;
    };
    function check(id) {
        if (id === 'kind') return a.kind ? true : problem(null, 'Please choose what you’re adding.');
        if (id === 'description') { a.description = $('#cf-description').value.trim(); return a.description ? true : problem($('#cf-description'), 'Please enter a description.'); }
        if (id === 'amount') {
            a.amount = $('#cf-amount').value.trim();
            return Number(a.amount) > 0 ? true : problem($('#cf-amount'), 'Please enter an amount above $0.');
        }
        if (id === 'allocation') {
            a.allocation = $('#cf-allocation').value.trim() || '0';
            return isFinite(Number(a.allocation)) && Number(a.allocation) >= 0 ? true : problem($('#cf-allocation'), 'Please enter an amount (0 if none).');
        }
        if (id === 'date' || id === 'splitDate') return a[id] ? true : problem(null, 'Please pick a day.');
        if (id === 'splitWith') return a.splitWith ? true : problem(null, 'Please choose who you’re splitting it with.');
        if (id === 'items') {
            for (let k = 0; k < a.items.length; k++) {
                const row = dialog.querySelector('[data-items] [data-k="' + k + '"]');
                if (!a.items[k].description.trim()) return problem(row.querySelector('.cf-item-desc'), 'Please describe each line.');
                if (!itemAmount(a.items[k])) return problem(row.querySelector('.cf-item-amount'), 'Please enter an amount for each line.');
            }
            return true;
        }
        if (id === 'percents') {
            for (let k = 0; k < a.items.length; k++) {
                const p = a.items[k].percent === '' ? 0 : Number(a.items[k].percent);
                if (!(p >= 0 && p <= 100)) return problem(dialog.querySelector('[data-percents] [data-k="' + k + '"] input'), 'Please enter a percent from 0 to 100.');
            }
            return a.items.some(i => Number(i.percent) > 0) ? true : problem(dialog.querySelector('[data-percents] input'), firstName() + ' needs to pay part of at least one line.');
        }
        if (id === 'separate') {
            const today = isoDate(new Date());
            for (let k = 0; k < a.items.length; k++) {
                const it = a.items[k];
                // (One already paid on its own day keeps its date)
                if (it.separate && !(it.separatePaid && it.separateDate === it.paidDate) && (!it.separateDate || it.separateDate < today)) return problem(dialog.querySelector('#cf-sep-' + k), 'Please pick the day “' + it.description + '” is paid (today or later).');
            }
            return true;
        }
        if (id === 'splitWhen') return a.splitWhen ? true : problem(null, 'Please choose when they pay you.');
        if (id === 'shifts') {
            if (!ctx.roadhouse) return problem(null, 'Please fill in Roadhouse Paycheck Settings at the bottom of the page first.');
            const blank = v => String(v).trim() === '';
            for (let k = 0; k < a.shifts.length; k++) {
                const sh = a.shifts[k];
                const row = dialog.querySelector('[data-shifts] [data-k="' + k + '"]');
                if (blank(sh.hours) || !(num(sh.hours) > 0 && num(sh.hours) <= 24)) return problem(row.querySelector('.cf-shift-hours-input'), 'Please enter the hours for each shift.');
                if (blank(sh.sales)) return problem(row.querySelector('.cf-shift-sales-input'), 'Please enter the sales for each shift (0 if none).');
                if (blank(sh.tip) || num(sh.tip) > 100) return problem(row.querySelector('.cf-shift-tip-input'), 'Please enter a tip percent from 0 to 100 for each shift.');
            }
            return true;
        }
        return true;
    }
    function show(id, direction) {
        current = id;
        dialog.querySelectorAll('.tf-step').forEach(s => {
            s.hidden = s.dataset.step !== id;
            s.classList.toggle('is-entering', s.dataset.step === id && direction > 0);
        });
        const [question, hint] = words(id);
        const section = dialog.querySelector('[data-step="' + id + '"]');
        section.querySelector('.tf-question').textContent = question;
        section.querySelector('[data-hint]').textContent = hint;
        section.querySelector('[data-hint]').hidden = !hint;
        const list = steps();
        const n = list.indexOf(id) + 1;
        $('[data-progress]').textContent = 'Question ' + n + ' of ' + list.length;
        $('[data-bar]').style.width = Math.round((n / list.length) * 100) + '%';
        if (id === 'date' || id === 'splitDate') cals[id].open();
        if (id === 'splitWith') drawPeople();
        if (id === 'items') drawItems();
        if (id === 'percents') drawPercents();
        if (id === 'separate') drawSeparate();
        if (id === 'shifts') drawShifts();
        showFooter();
        scroller.scrollTop = 0;
        const field = { description: '#cf-description', amount: '#cf-amount', allocation: '#cf-allocation' }[id];
        if (field) setTimeout(() => $(field).focus(), 60);
    }
    function showFooter() {
        const list = steps();
        const i = list.indexOf(current);
        $('[data-next-text]').textContent = i === list.length - 1 ? (editing ? 'Save Changes' : 'Add') : 'Next';
        backBtn.textContent = i === 0 ? 'Cancel' : 'Back';
        $('[data-delete]').hidden = !(editing && i === 0);
    }
    function go(direction) {
        message.textContent = '';
        dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        const list = steps();
        const i = list.indexOf(current);
        if (direction > 0) {
            if (!check(current)) return;
            if (i === list.length - 1) { save(); return; }
            show(list[i + 1], 1);
        } else {
            if (i === 0) { close(); return; }
            show(list[i - 1], -1);
        }
    }
    backBtn.addEventListener('click', () => go(-1));
    form.addEventListener('submit', e => { e.preventDefault(); if (!saving) go(1); });
    form.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); if (!saving) go(1); }
    });
    form.addEventListener('input', e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; });

    const setBusy = (on, btn) => {
        saving = on;
        form.querySelectorAll('button, input').forEach(el => { el.disabled = on; });
        btn.classList.toggle('is-loading', on);
        // Redraws the question (buttons that should stay disabled, like a past day, get that back)
        if (!on) show(current, 0);
    };
    async function save() {
        let payload;
        if (roadhouse()) {
            payload = { action: 'saveRoadhousePaycheck', date: isoDate(a.date), shifts: a.shifts.map(sh => ({ hours: num(sh.hours), sales: num(sh.sales), tipPercent: num(sh.tip) })) };
            if (editing) { payload.row = ctx.tx.row; payload.original = { date: ctx.tx.date, description: ctx.tx.description }; }
        } else if (!rent()) {
            payload = { action: 'addTransaction', type: a.kind, date: isoDate(a.date), description: savings() ? 'Spending Budget' : a.description, amount: a.amount };
            if (savings()) payload.allocation = a.allocation || '0';
        } else {
            payload = {
                action: 'saveRentSplit', description: a.description, date: isoDate(a.date),
                splitDate: a.splitWhen === 'other' ? isoDate(a.splitDate) : '',
                items: a.items.map(i => {
                    const percent = Number(i.percent) || 0;
                    return { n: i.n || '', description: i.description.trim(), amount: itemAmount(i), splitId: percent > 0 ? a.splitWith : '', percent, separate: i.separate, separateDate: i.separate ? i.separateDate : '' };
                }),
            };
            if (editing) { payload.row = ctx.tx.row; payload.original = { date: ctx.tx.date, description: ctx.tx.description }; }
        }
        setBusy(true, nextBtn);
        try {
            await ctx.save(payload);
            setBusy(false, nextBtn);
            dialog.close();
        } catch (err) {
            console.error(err);
            setBusy(false, nextBtn);
            message.textContent = ctx.errorText(err);
        }
    }

    // --- Delete (editing a rent split) ---
    $('[data-delete]').addEventListener('click', () => { confirmBox.hidden = false; $('[data-keep]').focus(); });
    $('[data-keep]').addEventListener('click', () => { confirmBox.hidden = true; });
    $('[data-confirm-delete]').addEventListener('click', async () => {
        const btn = $('[data-confirm-delete]');
        setBusy(true, btn);
        try {
            await ctx.remove();
            setBusy(false, btn);
            confirmBox.hidden = true;
            dialog.close();
        } catch (err) {
            console.error(err);
            setBusy(false, btn);
            confirmBox.hidden = true;
            message.textContent = ctx.errorText(err);
        }
    });

    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        if (!confirmBox.hidden) { if (!saving) confirmBox.hidden = true; return; }
        close();
    });

    return {
        open(next) {
            ctx = next;
            editing = !!next.tx;
            form.reset();
            dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            message.textContent = '';
            confirmBox.hidden = true;
            $('#cf-confirm-title').textContent = editing && next.tx.roadhouse ? 'Delete this paycheck?' : 'Delete this rent split?';
            $('[data-confirm-text]').textContent = editing && next.tx.roadhouse
                ? 'It will be removed from your cash flow. This can’t be undone here.'
                : 'It will be removed from your cash flow, along with what the other person owes for it. This can’t be undone here.';
            if (editing && next.tx.roadhouse) {
                const tx = next.tx;
                a = {
                    kind: 'roadhouse', date: dayOf(tx.date),
                    shifts: (tx.shifts || []).map(sh => ({ hours: String(sh.hours), sales: String(sh.sales), tip: String(sh.tipPercent) })),
                    items: [],
                };
                if (!a.shifts.length) a.shifts = [{ hours: '', sales: '', tip: '' }];
                $('#cf-title').textContent = 'Edit Roadhouse Paycheck';
            } else if (editing) {
                const tx = next.tx;
                const items = tx.items || [];
                const splitWith = (items.find(i => i.splitId) || {}).splitId || '';
                // Someone no longer marked CUM still shows, so saving doesn't drop their split
                if (splitWith && !ctx.splitPeople.some(p => p.id === splitWith)) ctx = { ...ctx, splitPeople: ctx.splitPeople.concat({ id: splitWith, name: splitWith }) };
                a = {
                    kind: 'rent', description: tx.description || '', date: dayOf(tx.date), splitWith,
                    items: items.map(i => ({ n: i.n, description: i.description || '', amount: String(i.amount), percent: i.splitId ? String(i.percent) : '0', separate: !!i.separate, separateDate: i.separate && dayOf(i.separateDate) ? isoDate(dayOf(i.separateDate)) : '',
                        separatePaid: !!i.separatePaid, paidDate: i.separate && dayOf(i.separateDate) ? isoDate(dayOf(i.separateDate)) : '' })),
                    splitWhen: tx.splitDate ? 'other' : 'same', splitDate: tx.splitDate ? dayOf(tx.splitDate) : null,
                };
                $('#cf-title').textContent = 'Edit Rent Split';
            } else {
                a = { items: [{ n: 0, description: 'Base Rent', amount: '', percent: '50', separate: false, separateDate: '' }], shifts: [{ hours: '', sales: '', tip: '' }] };
                $('#cf-title').textContent = 'Add Transaction';
            }
            $('#cf-description').value = a.description || '';
            drawChoices();
            show(steps()[0], 0);
            dialog.showModal();
            lockPageScroll(dialog);
        },
    };
}

// --- Payments from someone splitting with you ---
// Their share split into payments, each on its own day (and checked off on its own). The set amounts come first;
// the last payment is always "the rest", so the payments add up to their share. Payments already checked off are shown
// but can't be changed.
const PAY_CSS = `
.pay-dialog .tf-step { padding-top: 8px; }
.pay-dialog .cf-pay { display: grid; grid-template-columns: 1fr 140px 40px; gap: 8px; align-items: center; }
.pay-dialog .cf-pay .cf-rest { font-weight: bold; color: var(--olive); padding-left: 6px; }
.pay-dialog .cf-pay-label { grid-column: 1 / -1; font-size: 0.8rem; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; color: var(--olive); }
.pay-dialog .cf-row.is-locked { opacity: 0.7; }
@media (max-width: 600px) { .pay-dialog .cf-pay { grid-template-columns: 1fr 40px; } .pay-dialog .cf-pay > .cf-money, .pay-dialog .cf-pay > .cf-rest { grid-column: 1; } }
`;
let payBuilt = null;

/**
 * Opens the payments editor. entry: the money-coming-in entry ({ row, person, personName, total, payments:
 * [{ n, date, amount, locked }] with the rest last }); save(payload) sends { action: 'saveSplitPayments', ... } and must
 * resolve once saved (or throw an Error whose message is the API's error code); errorText(err) words an error.
 */
export function openSplitPayments(next) {
    if (!payBuilt) payBuilt = buildPayments();
    payBuilt.open(next);
}

function buildPayments() {
    ensureCumFormStyles();
    if (!document.getElementById('cum-pay-css')) {
        const style = document.createElement('style');
        style.id = 'cum-pay-css';
        style.textContent = PAY_CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog task-dialog cum-form-dialog pay-dialog';
    dialog.setAttribute('aria-labelledby', 'pay-title');
    dialog.innerHTML = '<form class="income-form" novalidate>'
        + '<div class="dialog-head"><h2 id="pay-title">Payments</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
        + '<div class="dialog-scroll"><section class="tf-step">'
        + '<p class="tf-hint" data-pay-hint></p><div class="cf-rows" data-pays></div>'
        + '<button type="button" class="cf-add-item" data-add-pay>+ Add a payment</button><p class="cf-total" data-pay-total></p>'
        + '</section></div>'
        + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
        + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span>Save Changes</button></div></div>'
        + '</form>';
    document.body.append(dialog);
    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    let ctx = null;
    // Payments already checked off: [{ date, amount }]
    let locked = [];
    // The payments that can change: [{ date (YYYY-MM-DD), amount (text) }], then the rest: { date }
    let pays = [];
    let rest = { date: '' };
    let saving = false;

    const amountOf = v => Number(String(v).replace(/[$,]/g, '')) || 0;
    const restAmount = () => Math.round((ctx.entry.total - locked.reduce((s, p) => s + p.amount, 0) - pays.reduce((s, p) => s + amountOf(p.amount), 0)) * 100) / 100;
    const shortDay = v => { const d = dayOf(v); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
    function draw() {
        const today = isoDate(new Date());
        const count = locked.length + pays.length + 1;
        let k = 0;
        const label = extra => '<span class="cf-pay-label">Payment ' + (++k) + ' of ' + count + (extra || '') + '</span>';
        $('[data-pays]').innerHTML = locked.map(p => '<div class="cf-row is-locked"><div class="cf-row-head"><span><span class="cf-row-name">' + escapeHtml(shortDay(p.date)) + '</span><br>'
                + '<span class="cf-row-sub">Already checked off</span></span><span class="cf-row-name">' + dollars(p.amount) + '</span></div></div>').join('')
            + pays.map((p, i) => '<div class="cf-row cf-pay" data-i="' + i + '">' + label()
                + '<input type="date" class="cf-pay-date" min="' + today + '" aria-label="Payment ' + k + ' day" value="' + escapeHtml(p.date) + '">'
                + '<div class="cf-money"><input type="text" class="cf-pay-amount" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Payment ' + k + ' amount" value="' + escapeHtml(p.amount) + '"></div>'
                + '<button type="button" class="cf-remove" data-remove aria-label="Remove payment ' + k + '">' + CLOSE_ICON + '</button></div>').join('')
            + '<div class="cf-row cf-pay" data-rest>' + label(count > 1 ? ' · the rest' : '')
                + '<input type="date" class="cf-pay-date" min="' + today + '" aria-label="Day the rest comes in" value="' + escapeHtml(rest.date) + '">'
                + '<span class="cf-rest" data-rest-amount></span></div>';
        $('[data-add-pay]').hidden = pays.length + locked.length >= 10;
        drawTotals();
    }
    function drawTotals() {
        const r = restAmount();
        $('[data-rest-amount]').textContent = dollars(r);
        $('[data-pay-total]').textContent = r > 0 ? 'Adds up to ' + dollars(ctx.entry.total) : 'The payments come to more than ' + dollars(ctx.entry.total) + '.';
    }
    $('[data-pays]').addEventListener('input', e => {
        message.textContent = '';
        e.target.classList.remove('is-invalid');
        const row = e.target.closest('.cf-pay');
        if (!row) return;
        const target = row.hasAttribute('data-rest') ? rest : pays[Number(row.dataset.i)];
        if (e.target.matches('.cf-pay-date')) target.date = e.target.value;
        if (e.target.matches('.cf-pay-amount')) {
            const v = cleanMoney(e.target.value, false);
            if (v !== e.target.value) e.target.value = v;
            target.amount = v;
            drawTotals();
        }
    });
    $('[data-pays]').addEventListener('click', e => {
        const b = e.target.closest('[data-remove]');
        if (!b) return;
        pays.splice(Number(b.closest('.cf-pay').dataset.i), 1);
        message.textContent = '';
        draw();
    });
    // A new payment goes before the rest, starting on the rest's day
    $('[data-add-pay]').addEventListener('click', () => {
        pays.push({ date: rest.date, amount: '' });
        message.textContent = '';
        draw();
        const boxes = dialog.querySelectorAll('.cf-pay-amount');
        boxes[boxes.length - 1].focus();
    });

    const problem = (el, text) => { if (el) { el.classList.add('is-invalid'); el.focus(); } message.textContent = text; };
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (saving) return;
        const today = isoDate(new Date());
        const rows = dialog.querySelectorAll('.cf-pay[data-i]');
        for (let i = 0; i < pays.length; i++) {
            if (!pays[i].date || pays[i].date < today) return problem(rows[i].querySelector('.cf-pay-date'), 'Please pick a day for each payment (today or later).');
            if (!(amountOf(pays[i].amount) > 0)) return problem(rows[i].querySelector('.cf-pay-amount'), 'Please enter an amount for each payment.');
        }
        if (!rest.date || rest.date < today) return problem($('[data-rest] .cf-pay-date'), 'Please pick the day the rest comes in (today or later).');
        if (!(restAmount() > 0)) {
            return problem(rows.length ? rows[rows.length - 1].querySelector('.cf-pay-amount') : null,
                'The payments come to more than ' + dollars(ctx.entry.total) + '. Lower one so there’s some left for the last payment.');
        }
        const btn = $('[data-save]');
        saving = true;
        form.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
        btn.classList.add('is-loading');
        try {
            await ctx.save({
                action: 'saveSplitPayments', row: ctx.entry.row, person: ctx.entry.person, original: JSON.stringify(ctx.entry.payments),
                payments: pays.map(p => ({ date: p.date, amount: amountOf(p.amount) })), restDate: rest.date,
            });
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = ctx.errorText(err);
        } finally {
            saving = false;
            form.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
            btn.classList.remove('is-loading');
        }
    });
    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });

    return {
        open(next) {
            ctx = next;
            const list = next.entry.payments || [];
            const iso = v => { const d = dayOf(v); return d ? isoDate(d) : ''; };
            locked = list.slice(0, -1).filter(p => p.locked).map(p => ({ date: p.date, amount: p.amount }));
            pays = list.slice(0, -1).filter(p => !p.locked).map(p => ({ date: iso(p.date), amount: String(p.amount) }));
            rest = { date: iso((list[list.length - 1] || {}).date) };
            const name = next.entry.personName || 'They';
            $('#pay-title').textContent = 'Payments from ' + name.split(' ')[0];
            $('[data-pay-hint]').textContent = name + '’s share is ' + dollars(next.entry.total)
                + '. Split it into payments on different days; each one is checked off on its own. The last payment is whatever is left.';
            message.textContent = '';
            draw();
            dialog.showModal();
            lockPageScroll(dialog);
        },
    };
}
