// Income math and the "Your Income" edit pop-up, shared by settings.html and pages.html.
// Columns match the INCOME sheet: PRIMARY / SECONDARY / TERTIARY / QUATERNARY / QUINARY income levels plus monthly debt payments.

export const LEVELS = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];
// Debt types: the Yes/No column (TRUE / FALSE), the monthly payment column, how many of each, and the text columns
// beside each payment. Entry 1 uses these names; entry n adds " n" ("CAR LOAN PAYMENT 2", "CAR LOAN MAKE 2"...).
const DEBT_TYPES = [
    { kind: 'car', title: 'Car Loans', one: 'car loan', flag: 'HAS CAR LOAN', amount: 'CAR LOAN PAYMENT', max: 5, question: 'Do you have a car loan payment?',
        texts: [{ col: 'CAR LOAN MAKE', label: 'Make', required: true }, { col: 'CAR LOAN MODEL', label: 'Model', required: true }] },
    { kind: 'mortgage', title: 'Mortgages', one: 'mortgage', flag: 'HAS MORTGAGE', amount: 'MORTGAGE PAYMENT', max: 5, question: 'Do you have a mortgage payment?', texts: [] },
    { kind: 'cards', title: 'Credit Cards', one: 'credit card', flag: 'HAS CREDIT CARDS', amount: 'CREDIT CARD PAYMENT', max: 5, question: 'Do you have credit card payments?',
        texts: [{ col: 'CREDIT CARD NAME', label: 'Card Name' }] },
    { kind: 'other', title: 'Other Debts', one: 'other debt', flag: 'HAS OTHER PAYMENTS', amount: 'OTHER PAYMENT', max: 10, question: 'Do you have any other debt payments?',
        texts: [{ col: 'OTHER PAYMENT NAME', label: 'Debt Name' }] },
];
const colN = (base, n) => (n === 1 ? base : base + ' ' + n);
const debtAmounts = t => Array.from({ length: t.max }, (_, i) => colN(t.amount, i + 1));
// Every debt column (answers, payments, names), for spotting edits
const DEBT_ALL_COLUMNS = DEBT_TYPES.flatMap(t => [t.flag].concat(Array.from({ length: t.max }, (_, i) => [colN(t.amount, i + 1)].concat(t.texts.map(x => colN(x.col, i + 1)))).flat()));
// How many times a year each interval pays out (Bi-Annually = twice a year)
const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, annually: 1, biannually: 2 };
const INTERVALS = ['Weekly', 'Monthly', 'Quarterly', 'Annually', 'Bi-Annually'];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; };
const letters = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
const perYear = interval => PER_YEAR[letters(interval)] || 0;
const getCol = (row, col) => { const k = Object.keys(row || {}).find(k => k.trim().toUpperCase() === col); return k ? row[k] : ''; };

// Which kind of income a level is (Salary, Hourly or 1099), based on which columns are filled in
export function detectType(row, L) {
    const v = c => getCol(row, L + ' ' + c);
    if (num(v('1099 YEARLY INCOME')) > 0 || String(v('1099 INCOME DESCRIPTION')).trim()) return '1099';
    if (num(v('HOURLY RATE')) > 0 || num(v('WEEKLY HOURS')) > 0) return 'hourly';
    if (num(v('WEEKLY SALARY')) > 0 || ['JOB TITLE', 'WEEKLY TIPS', 'COMMISSION AMOUNT', 'BONUS AMOUNT'].some(c => String(v(c)).trim())) return 'salary';
    return 'none';
}

// Yearly income for one level. Every amount is turned into a yearly figure first:
// weekly x 52, monthly x 12, quarterly x 4, annually x 1, bi-annually x 2
function levelYearly(get, type) {
    if (type === '1099') return num(get('1099 YEARLY INCOME'));
    if (type !== 'salary' && type !== 'hourly') return 0;
    const base = type === 'salary'
        ? num(get('WEEKLY SALARY')) * 52
        : num(get('HOURLY RATE')) * num(get('WEEKLY HOURS')) * 52;
    return base
        + num(get('WEEKLY TIPS')) * 52
        + num(get('COMMISSION AMOUNT')) * perYear(get('COMMISSION INTERVAL'))
        + num(get('BONUS AMOUNT')) * perYear(get('BONUS INTERVAL'));
}

// Monthly income = total yearly income / 12
export const monthlyIncome = row => LEVELS.reduce((sum, L) => sum + levelYearly(c => getCol(row, L + ' ' + c), detectType(row, L)), 0) / 12;
// Monthly debts = car loan + mortgage + credit cards + other (all monthly amounts)
export const monthlyDebts = row => DEBT_TYPES.reduce((sum, t) => sum + (String(getCol(row, t.flag)).toUpperCase() === 'FALSE' ? 0
    : debtAmounts(t).reduce((s2, c) => s2 + num(getCol(row, c)), 0)), 0);

// --- Edit pop-up ---
const CSS = `
.income-dialog {
    margin: auto; width: calc(100% - 40px); max-width: 640px; padding: 0;
    border: 2px solid var(--navy); border-radius: 24px; box-shadow: 6px 6px 0px var(--navy);
    background: var(--white); color: var(--brown); overflow: visible;
}
.income-dialog::backdrop { background: rgba(14, 42, 59, 0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.income-dialog[open] { animation: incomeDialogIn 0.4s var(--ease); }
.income-dialog[open]::backdrop { animation: incomeFadeIn 0.3s ease; }
@keyframes incomeDialogIn { from { opacity: 0; transform: translateY(24px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes incomeFadeIn { from { opacity: 0; } to { opacity: 1; } }
.income-dialog .income-form { display: flex; flex-direction: column; max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); }
.income-dialog .dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 6px; padding: 26px 28px 0 28px; }
.income-dialog .dialog-head h2 { font-size: 1.6rem; line-height: 1.15; }
.income-dialog .close-btn {
    flex: 0 0 auto; width: 40px; height: 40px; margin: -4px -6px 0 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 50%; background: #f2ede6; color: var(--brown); cursor: pointer;
}
.income-dialog .close-btn svg { width: 18px; height: 18px; }
.income-dialog .muted { opacity: 0.75; font-size: 0.95rem; padding: 0 28px; margin-bottom: 12px; }
.income-dialog .dialog-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 28px 8px 28px; border-top: 1px solid rgba(78, 81, 62, 0.15); }
.income-dialog .dialog-foot { padding: 14px 28px 22px 28px; border-top: 1px solid rgba(78, 81, 62, 0.15); background: #fbf9f6; border-radius: 0 0 22px 22px; }
.income-dialog .total-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-weight: bold; }
.income-dialog .total-row .total-value { font-family: 'Bricolage Grotesque', sans-serif; font-size: 1.35rem; color: var(--olive); }
.income-dialog .form-message { min-height: 1.4em; margin: 12px 4px 0 4px; font-size: 0.92rem; font-weight: bold; color: var(--rust); }
.income-dialog .form-message:empty { min-height: 0; margin: 0; }
.income-dialog .form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.income-dialog .btn { font-family: inherit; font-size: 1rem; cursor: pointer; gap: 8px; }
.income-dialog .btn:disabled { opacity: 0.65; cursor: wait; transform: none; }
.income-dialog .btn-secondary { background: var(--white); color: var(--brown); }
@media (hover: hover) { .income-dialog .btn-secondary:hover { background: #f2ede6; } }
.income-dialog .btn-spinner { display: none; width: 16px; height: 16px; border-radius: 50%; border: 3px solid rgba(233, 226, 216, 0.35); border-top-color: var(--cream); animation: spin 0.8s linear infinite; }
.income-dialog .btn.is-loading .btn-spinner { display: inline-block; }

.income-dialog .income-section { border: none; padding: 20px 0 22px 0; border-bottom: 1px solid rgba(78, 81, 62, 0.15); }
.income-dialog .income-section:last-child { border-bottom: none; }
.income-dialog .section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.income-dialog .section-head h3 { font-size: 1.2rem; }
.income-dialog .section-total { font-size: 0.9rem; font-weight: bold; color: var(--olive); white-space: nowrap; }

/* Salary / Hourly / 1099 picker */
.income-dialog .type-picker { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 5px; border-radius: 999px; background: #f2ede6; margin-bottom: 16px; }
.income-dialog .type-picker input { position: absolute; opacity: 0; pointer-events: none; }
.income-dialog .type-picker label {
    display: flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 999px;
    font-weight: bold; font-size: 0.92rem; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease;
}
.income-dialog .type-picker input:checked + label { background: var(--olive); color: var(--cream); }
.income-dialog .type-picker input:focus-visible + label { outline: 3px solid var(--gold); outline-offset: 2px; }

.income-dialog .type-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
/* Each section is "view" (a summary with an edit button), "empty" (a + button) or "edit" (the full form, one at a time) */
.income-dialog .ie-summary, .income-dialog .ie-add, .income-dialog .ie-locked, .income-dialog .ie-edited, .income-dialog .ie-done-row { display: none; }
.income-dialog .income-section[data-mode="view"] .ie-summary { display: block; }
.income-dialog .income-section[data-mode="empty"] .ie-add { display: flex; }
.income-dialog .income-section[data-mode="edit"] .ie-done-row { display: flex; justify-content: flex-end; margin-top: 18px; }
.income-dialog .income-section:not([data-mode="edit"]) > .type-picker,
.income-dialog .income-section:not([data-mode="edit"]) > .type-fields,
.income-dialog .income-section:not([data-mode="edit"]) .section-total { display: none; }
.income-dialog .income-section.is-locked .ie-locked { display: flex; }
.income-dialog .income-section.is-edited .ie-edited { display: flex; }
.income-dialog .ie-card { display: flex; align-items: center; gap: 12px; padding: 14px 14px 14px 18px; border-radius: 16px; background: #f7f4f0; border: 1px solid rgba(78, 81, 62, 0.15); }
.income-dialog .ie-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.income-dialog .ie-card-title { font-family: 'Bricolage Grotesque', sans-serif; font-size: 1.1rem; font-weight: 700; overflow-wrap: anywhere; }
.income-dialog .ie-card-sub { font-size: 0.85rem; opacity: 0.7; }
.income-dialog .ie-card-amount { flex: 0 0 auto; font-weight: bold; color: var(--olive); white-space: nowrap; }
.income-dialog .ie-add {
    align-items: center; gap: 12px; width: 100%; min-height: 54px; padding: 10px 16px;
    border: 2px dashed rgba(78, 81, 62, 0.45); border-radius: 16px; background: #fbf9f6;
    font-family: inherit; font-size: 1rem; font-weight: bold; color: var(--rust); text-align: left; cursor: pointer;
}
.income-dialog .ie-add span.ie-plus { width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; background: var(--olive); color: var(--cream); display: flex; align-items: center; justify-content: center; }
.income-dialog .ie-add svg { width: 18px; height: 18px; }
@media (hover: hover) { .income-dialog .ie-add:not(:disabled):hover { border-color: var(--navy); } }
.income-dialog .ie-edit {
    flex: 0 0 auto; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
    border: 2px solid var(--navy); border-radius: 50%; background: var(--white); color: var(--olive); cursor: pointer;
}
.income-dialog .ie-edit svg { width: 17px; height: 17px; }
@media (hover: hover) { .income-dialog .ie-edit:not(:disabled):hover { background: var(--olive); color: var(--cream); } }
.income-dialog .ie-edit:disabled, .income-dialog .ie-add:disabled { opacity: 0.45; cursor: not-allowed; }
.income-dialog .ie-locked { align-items: center; gap: 8px; margin: 10px 0 0 4px; font-size: 0.85rem; font-style: italic; opacity: 0.75; }
.income-dialog .ie-locked svg, .income-dialog .ie-edited svg { width: 16px; height: 16px; flex-shrink: 0; }
.income-dialog .ie-edited { align-items: flex-start; gap: 8px; margin-top: 10px; padding: 10px 14px; border-radius: 14px; background: #fdf6e9; border: 1px dashed rgba(192, 144, 80, 0.7); font-size: 0.88rem; font-weight: bold; }
.income-dialog .ie-edited svg { color: var(--gold); margin-top: 2px; }
.income-dialog .ie-done { min-height: 44px; padding: 8px 26px; }
.income-dialog .section-head { align-items: center; }
/* "Are you sure?" when closing with unsaved changes */
.income-dialog .ie-confirm { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 20px; border-radius: inherit; background: rgba(14, 42, 59, 0.45); }
.income-dialog .ie-confirm[hidden] { display: none; }
.income-dialog .ie-confirm-card { width: 100%; max-width: 380px; padding: 22px 22px 18px 22px; border-radius: 20px; background: var(--white); border: 2px solid var(--navy); box-shadow: 4px 4px 0 var(--navy); }
.income-dialog .ie-confirm-card h3 { font-size: 1.35rem; margin-bottom: 6px; }
.income-dialog .ie-confirm-card p { font-size: 0.95rem; opacity: 0.8; margin-bottom: 14px; }
.income-dialog .ie-confirm-card .form-actions { flex-wrap: wrap; }
.income-dialog .type-fields[hidden] { display: none; }
/* Extra pay: a Yes/No question, then (on Yes) its inputs */
.income-dialog .ie-yn { grid-column: 1 / -1; }
.income-dialog .ie-q { font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
.income-dialog .type-picker.yes-no { grid-template-columns: 1fr 1fr; margin-bottom: 0; }
.income-dialog .ie-extra { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
.income-dialog .ie-extra[hidden] { display: none; }
/* Debts: each type in its own block, each entry in its own box */
.income-dialog .ie-debt-group { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr; gap: 14px; padding: 16px; border-radius: 18px; background: #fbf9f6; border: 1px solid rgba(78, 81, 62, 0.18); }
.income-dialog .ie-debt-title { font-size: 1.05rem; color: var(--olive); }
.income-dialog .ie-debt-group .ie-extra { grid-template-columns: 1fr 1fr; }
.income-dialog .ie-debt-entry { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; padding: 14px; border-radius: 14px; background: var(--white); border: 1px solid rgba(78, 81, 62, 0.15); }
.income-dialog .ie-debt-entry[hidden] { display: none; }
.income-dialog .ie-entry-head { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 0.78rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.income-dialog .ie-remove { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: none; border-radius: 999px; background: none; cursor: pointer; font-family: inherit; font-size: 0.8rem; font-weight: bold; letter-spacing: 0; text-transform: none; color: var(--rust); }
.income-dialog .ie-remove svg { width: 15px; height: 15px; }
@media (hover: hover) { .income-dialog .ie-remove:hover { background: rgba(154, 93, 64, 0.1); } }
.income-dialog .ie-add-entry { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; border: 2px dashed rgba(78, 81, 62, 0.4); border-radius: 14px; background: none; cursor: pointer; font-family: inherit; font-size: 0.95rem; font-weight: bold; color: var(--rust); }
.income-dialog .ie-add-entry svg { width: 17px; height: 17px; }
.income-dialog .ie-add-entry[hidden] { display: none; }
@media (hover: hover) { .income-dialog .ie-add-entry:hover { border-color: var(--navy); } }
.income-dialog .ie-optional { font-weight: normal; opacity: 0.6; }
.income-dialog .field-help { margin: -6px 0 0 8px; font-size: 0.82rem; opacity: 0.7; }
.income-dialog .span-2 { grid-column: 1 / -1; }
.income-dialog .sub-label { grid-column: 1 / -1; margin: 6px 0 -4px 6px; font-size: 0.78rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.income-dialog .field label { display: block; font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
.income-dialog .field input, .income-dialog .field select {
    width: 100%; min-height: 54px; padding: 12px 20px;
    border: 2px solid var(--navy); border-radius: 999px; background-color: #f7f4f0;
    font-family: inherit; font-size: 1.05rem; color: var(--brown);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}
.income-dialog .field select {
    padding-right: 44px; appearance: none; -webkit-appearance: none;
    background: #f7f4f0 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234e513e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 18px center / 16px;
}
.income-dialog .field input:focus, .income-dialog .field select:focus { outline: none; background-color: var(--white); border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.income-dialog .field input.money { padding-left: 34px; }
.income-dialog .money-wrap { position: relative; }
.income-dialog .money-wrap::before { content: '$'; position: absolute; left: 18px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.income-dialog .is-invalid { border-color: var(--rust) !important; background-color: #fdf2f2 !important; }

/* Phones: slides up from the bottom */
@media (max-width: 600px) {
    .income-dialog { width: 100%; max-width: none; margin: auto 0 0 0; border-radius: 24px 24px 0 0; border-bottom: none; box-shadow: none; }
    .income-dialog[open] { animation: incomeSheetIn 0.42s var(--ease); }
    @keyframes incomeSheetIn { from { transform: translateY(100%); } to { transform: none; } }
    .income-dialog .income-form { max-height: 92vh; max-height: 92dvh; }
    .income-dialog .dialog-head { padding: 22px 20px 0 20px; }
    .income-dialog .muted { padding: 0 20px; }
    .income-dialog .dialog-scroll { padding: 4px 20px 8px 20px; }
    .income-dialog .dialog-foot { padding: 12px 20px calc(env(safe-area-inset-bottom, 0px) + 16px) 20px; border-radius: 0; }
    .income-dialog .type-fields { grid-template-columns: 1fr; }
    .income-dialog .ie-extra, .income-dialog .ie-debt-group .ie-extra, .income-dialog .ie-debt-entry { grid-template-columns: 1fr; }
    .income-dialog .ie-debt-group { padding: 14px 12px; }
    .income-dialog .type-picker label { font-size: 0.85rem; }
    .income-dialog .form-actions { flex-direction: column-reverse; }
    .income-dialog .form-actions .btn { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
    .income-dialog[open], .income-dialog[open]::backdrop { animation: none; }
}
`;

// Form markup: one section per income level, plus debt. Each input's data-col is the exact INCOME sheet column.
const slug = s => 'ie-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const field = (id, label, input, span) => '<div class="field' + (span ? ' span-2' : '') + '"><label for="' + id + '">' + label + '</label>' + input + '</div>';
const moneyField = (col, label, span, id = slug(col)) => field(id, label, '<div class="money-wrap"><input class="money" id="' + id + '" data-col="' + col + '" type="text" inputmode="decimal" autocomplete="off" placeholder="0"></div>', span);
const numberField = (col, label, id = slug(col)) => field(id, label, '<input id="' + id + '" data-col="' + col + '" type="text" inputmode="decimal" autocomplete="off" placeholder="0">');
const textField = (col, label, span, id = slug(col)) => field(id, label, '<input id="' + id + '" data-col="' + col + '" type="text" maxlength="100" autocomplete="off">', span);
const intervalField = (col, label, id = slug(col)) => field(id, label, '<select id="' + id + '" data-col="' + col + '"><option value="">Select...</option>'
    + INTERVALS.map(i => '<option value="' + i + '">' + (i === 'Bi-Annually' ? 'Bi-Annually (twice a year)' : i) + '</option>').join('') + '</select>');
// Tips, commission and bonus can be added to salary or hourly pay (ids get a prefix so salary/hourly don't clash).
// Each one asks Yes/No first; its inputs show only after Yes (and are left out, so saved blank, on No).
const yesNo = (L, p, kind, question) => {
    const name = 'ie-' + L.toLowerCase() + '-' + p + kind;
    return '<div class="ie-yn"><p class="ie-q">' + question + '</p><div class="type-picker yes-no" role="radiogroup" aria-label="' + question + '">'
        + '<input type="radio" name="' + name + '" id="' + name + '-yes" value="yes" data-extra-toggle="' + kind + '"><label for="' + name + '-yes">Yes</label>'
        + '<input type="radio" name="' + name + '" id="' + name + '-no" value="no" data-extra-toggle="' + kind + '" checked><label for="' + name + '-no">No</label></div></div>';
};
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
// One debt type, in its own block: the Yes/No (Yes by default; a hidden input holds TRUE / FALSE for the sheet),
// then on Yes its entries (all written out; the unused ones stay hidden, so they're saved blank) and "+ Add another"
const debtGroup = t => {
    const name = 'ie-debt-' + t.kind;
    const entry = n => '<div class="ie-debt-entry" data-entry="' + n + '"' + (n > 1 ? ' hidden' : '') + '>'
        + (t.max > 1 ? '<div class="ie-entry-head"><span>' + t.title.replace(/s$/, '') + ' ' + n + '</span>'
            + (n > 1 ? '<button type="button" class="ie-remove" data-remove-entry="' + n + '" aria-label="Remove ' + t.one + ' ' + n + '">' + TRASH_ICON + 'Remove</button>' : '') + '</div>' : '')
        + t.texts.map(x => textField(colN(x.col, n), x.label + (x.required ? '' : ' <span class="ie-optional">(optional)</span>'), t.texts.length === 1)).join('')
        + moneyField(colN(t.amount, n), 'Monthly Payment', true)
        + '</div>';
    return '<div class="ie-debt-group" data-debt="' + t.kind + '"><h4 class="ie-debt-title">' + t.title + '</h4>'
        + '<div class="ie-yn"><p class="ie-q">' + t.question + '</p><div class="type-picker yes-no" role="radiogroup" aria-label="' + t.question + '">'
        + '<input type="radio" name="' + name + '" id="' + name + '-yes" value="yes" data-extra-toggle="' + t.kind + '" data-flag="' + t.flag + '" checked><label for="' + name + '-yes">Yes</label>'
        + '<input type="radio" name="' + name + '" id="' + name + '-no" value="no" data-extra-toggle="' + t.kind + '" data-flag="' + t.flag + '"><label for="' + name + '-no">No</label></div>'
        + '<input type="hidden" data-col="' + t.flag + '" value="TRUE"></div>'
        + '<div class="ie-extra" data-extra="' + t.kind + '">'
        + Array.from({ length: t.max }, (_, i) => entry(i + 1)).join('')
        + '<button type="button" class="ie-add-entry" data-add-entry="' + t.kind + '">' + PLUS_ICON + 'Add another ' + t.one + '</button>'
        + '</div></div>';
};
const extras = (L, p) => '<p class="sub-label">Extra Pay</p>'
    + yesNo(L, p, 'tips', 'Do you earn tips?')
    + '<div class="ie-extra" data-extra="tips" hidden>' + moneyField(L + ' WEEKLY TIPS', 'Weekly Tips', true, p + slug(L + ' WEEKLY TIPS')) + '</div>'
    + yesNo(L, p, 'commission', 'Do you earn commission?')
    + '<div class="ie-extra" data-extra="commission" hidden>' + intervalField(L + ' COMMISSION INTERVAL', 'Commission Paid', p + slug(L + ' COMMISSION INTERVAL'))
        + moneyField(L + ' COMMISSION AMOUNT', 'Commission Amount', false, p + slug(L + ' COMMISSION AMOUNT')) + '</div>'
    + yesNo(L, p, 'bonus', 'Do you earn bonuses?')
    + '<div class="ie-extra" data-extra="bonus" hidden>' + intervalField(L + ' BONUS INTERVAL', 'Bonus Paid', p + slug(L + ' BONUS INTERVAL'))
        + moneyField(L + ' BONUS AMOUNT', 'Bonus Amount', false, p + slug(L + ' BONUS AMOUNT')) + '</div>';
// Each extra's columns, for answering its Yes/No from saved data
const EXTRA_COLUMNS = { tips: ['WEEKLY TIPS'], commission: ['COMMISSION AMOUNT', 'COMMISSION INTERVAL'], bonus: ['BONUS AMOUNT', 'BONUS INTERVAL'] };
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const CAUTION_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
// Above the questions: the + button (empty), the summary (filled), and the notes; below them: Done
const sectionExtras = title => '<button type="button" class="ie-add" data-add><span class="ie-plus">' + PLUS_ICON + '</span>Add ' + title + '</button>'
    + '<div class="ie-summary"></div>'
    + '<p class="ie-edited">' + CAUTION_ICON + '<span>Edited, but not saved yet. Press Save Changes to keep it.</span></p>'
    + '<p class="ie-locked">' + LOCK_ICON + '<span></span></p>';
const doneRow = '<div class="ie-done-row"><button type="button" class="btn ie-done" data-done>Done</button></div>';
const levelSection = (L, title) => {
    const key = 'ie-' + L.toLowerCase();
    const radio = (value, label) => '<input type="radio" name="' + key + '-type" id="' + key + '-type-' + value + '" value="' + value + '"><label for="' + key + '-type-' + value + '">' + label + '</label>';
    return '<fieldset class="income-section" data-level="' + L + '">'
        + '<div class="section-head"><h3>' + title + '</h3><span class="section-total" data-total="' + L + '"></span></div>'
        + sectionExtras(title)
        + '<div class="type-picker" role="radiogroup" aria-label="' + title + ' type">' + radio('none', 'None') + radio('salary', 'Salary') + radio('hourly', 'Hourly') + radio('1099', '1099') + '</div>'
        + '<div class="type-fields" data-type="salary" hidden>' + textField(L + ' JOB TITLE', 'Job Title', true, key + '-salary-title')
            + moneyField(L + ' WEEKLY SALARY', 'Weekly Salary', true) + extras(L, 's-') + '</div>'
        + '<div class="type-fields" data-type="hourly" hidden>' + textField(L + ' JOB TITLE', 'Job Title', true, key + '-hourly-title')
            + moneyField(L + ' HOURLY RATE', 'Hourly Rate') + numberField(L + ' WEEKLY HOURS', 'Hours per Week') + extras(L, 'h-') + '</div>'
        + '<div class="type-fields" data-type="1099" hidden>' + moneyField(L + ' 1099 YEARLY INCOME', 'Yearly 1099 Income', true)
            + textField(L + ' 1099 INCOME DESCRIPTION', 'Description of Work', true) + '</div>'
        + doneRow
        + '</fieldset>';
};
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="income-dialog-title">Your Income</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<p class="muted">Add each job or source of income, plus your monthly debt payments.</p>'
    + '<div class="dialog-scroll">' + levelSection('PRIMARY', 'Primary Income') + levelSection('SECONDARY', 'Secondary Income') + levelSection('TERTIARY', 'Tertiary Income') + levelSection('QUATERNARY', 'Fourth Income') + levelSection('QUINARY', 'Fifth Income')
        + '<fieldset class="income-section" data-level="DEBT"><div class="section-head"><h3>Monthly Debt Payments</h3></div>' + sectionExtras('Monthly Debt Payments') + '<div class="type-fields">'
        + DEBT_TYPES.map(debtGroup).join('')
        + '</div>' + doneRow + '</fieldset>'
        + '<fieldset class="income-section" data-level="CREDIT"><div class="section-head"><h3>Credit Score</h3></div>' + sectionExtras('Credit Score') + '<div class="type-fields">'
        + field('ie-credit-score', 'Credit Score', '<input id="ie-credit-score" data-col="CREDIT SCORE" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="720">', true)
        + '<p class="field-help span-2">Your best estimate is fine (between 300 and 850).</p>'
        + '</div>' + doneRow + '</fieldset></div>'
    + '<div class="dialog-foot"><div class="total-row"><span>Monthly Income</span><span class="total-value" data-grand-total>$0.00</span></div>'
        + '<p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
        + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span>Save Changes</button></div></div>'
    + '<div class="ie-confirm" hidden role="alertdialog" aria-labelledby="ie-confirm-title"><div class="ie-confirm-card"><h3 id="ie-confirm-title">Are you sure?</h3>'
        + '<p>Your changes haven’t been saved. If you close now, they’ll be lost.</p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-keep>Keep Editing</button>'
        + '<button type="button" class="btn" data-discard>Discard Changes</button></div></div></div>'
    + '</form>';

// The pop-up's styles (a centered card on wide screens, a swipe-up sheet on phones). Other pop-ups that use the
// same classes (.income-dialog, .dialog-head, .dialog-foot...) call this too.
export function ensureDialogStyles() {
    if (document.getElementById('income-editor-css')) return;
    const style = document.createElement('style');
    style.id = 'income-editor-css';
    style.textContent = CSS;
    document.head.appendChild(style);
}

// While a pop-up is open, phones would still scroll the page behind it (overflow: hidden isn't enough on iOS),
// so the page is pinned where it is until the pop-up closes, then put back at the same spot
export function lockPageScroll(dialog) {
    const y = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const saved = { overflow: html.style.overflow, position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right };
    html.style.overflow = 'hidden';
    Object.assign(body.style, { position: 'fixed', top: -y + 'px', left: '0', right: '0' });
    dialog.addEventListener('close', () => {
        html.style.overflow = saved.overflow;
        Object.assign(body.style, { position: saved.position, top: saved.top, left: saved.left, right: saved.right });
        window.scrollTo({ top: y, behavior: 'instant' });
    }, { once: true });
}

/**
 * Builds the income pop-up (once) and returns { open(row) }.
 * save(income) gets { "COLUMN": value, ... } for every income column and must resolve to the saved row (or throw).
 * onSaved(row) runs after a successful save, once the pop-up has closed.
 */
export function createIncomeEditor({ save, onSaved }) {
    ensureDialogStyles();
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog';
    dialog.setAttribute('aria-labelledby', 'income-dialog-title');
    dialog.innerHTML = DIALOG_HTML;
    document.body.appendChild(dialog);

    const form = dialog.querySelector('form');
    const grandTotal = dialog.querySelector('[data-grand-total]');
    const message = dialog.querySelector('.form-message');
    const saveBtn = dialog.querySelector('[data-save]');
    let current = {};

    const sectionFor = L => form.querySelector('.income-section[data-level="' + L + '"]');
    const selectedType = L => (form.querySelector('input[name="ie-' + L.toLowerCase() + '-type"]:checked') || {}).value || 'none';
    const visibleGroup = L => sectionFor(L).querySelector('.type-fields[data-type="' + selectedType(L) + '"]');
    const isDecimal = el => el.getAttribute('inputmode') === 'decimal';
    function formGetter(L) {
        const group = visibleGroup(L);
        // Inputs tucked away (an extra answered No) don't count
        return c => { const el = group && group.querySelector('[data-col="' + L + ' ' + c + '"]'); return el && !el.closest('[hidden]') ? el.value : ''; };
    }
    function showType(L) {
        const type = selectedType(L);
        sectionFor(L).querySelectorAll('.type-fields[data-type]').forEach(g => { g.hidden = g.dataset.type !== type; });
    }
    function updateTotals() {
        let yearly = 0;
        LEVELS.forEach(L => {
            const y = levelYearly(formGetter(L), selectedType(L));
            yearly += y;
            form.querySelector('[data-total="' + L + '"]').textContent = y > 0 ? money.format(y / 12) + ' / mo' : '';
        });
        grandTotal.textContent = money.format(yearly / 12);
    }
    // --- View / empty / edit sections ---
    const TYPE_NAMES = { none: 'None', salary: 'Salary', hourly: 'Hourly', '1099': '1099' };
    const TITLES = { PRIMARY: 'Primary Income', SECONDARY: 'Secondary Income', TERTIARY: 'Tertiary Income', QUATERNARY: 'Fourth Income', QUINARY: 'Fifth Income', DEBT: 'Monthly Debt Payments', CREDIT: 'Credit Score' };
    const creditInput = form.querySelector('#ie-credit-score');
    // Credit score: a whole number from 300 to 850
    const creditOk = v => /^\d{3}$/.test(String(v || '').trim()) && Number(v) >= 300 && Number(v) <= 850;
    creditInput.addEventListener('input', () => { creditInput.value = creditInput.value.replace(/\D/g, '').slice(0, 3); });
    // --- Debt entries: show the ones in use, add another, remove one (later ones move up) ---
    const groupOf = kind => form.querySelector('.ie-debt-group[data-debt="' + kind + '"]');
    const entryInputs = (kind, n) => [...groupOf(kind).querySelectorAll('.ie-debt-entry[data-entry="' + n + '"] [data-col]')];
    const shownEntries = kind => [...groupOf(kind).querySelectorAll('.ie-debt-entry')].filter(e => !e.hidden).length;
    function showEntries(kind, count) {
        const t = DEBT_TYPES.find(x => x.kind === kind);
        groupOf(kind).querySelectorAll('.ie-debt-entry').forEach(e => { e.hidden = Number(e.dataset.entry) > count; });
        groupOf(kind).querySelector('[data-add-entry]').hidden = count >= t.max;
    }
    form.addEventListener('click', e => {
        const add = e.target.closest('[data-add-entry]');
        const remove = e.target.closest('[data-remove-entry]');
        if (add) {
            const kind = add.dataset.addEntry;
            const next = shownEntries(kind) + 1;
            showEntries(kind, next);
            const first = entryInputs(kind, next)[0];
            if (first) first.focus();
            updateTotals();
        } else if (remove) {
            const kind = remove.closest('.ie-debt-group').dataset.debt;
            const count = shownEntries(kind);
            // Move every later entry up one, then drop the last
            for (let n = Number(remove.dataset.removeEntry); n < count; n++) {
                const from = entryInputs(kind, n + 1);
                entryInputs(kind, n).forEach((el, i) => { el.value = from[i].value; el.classList.remove('is-invalid'); });
            }
            entryInputs(kind, count).forEach(el => { el.value = ''; });
            showEntries(kind, count - 1);
            message.textContent = '';
            updateTotals();
        }
    });
    const sections = () => [...form.querySelectorAll('.income-section')];
    let editing = null;  // the one section open for editing (or null)
    let snapshot = {};   // each section's answers when the pop-up opened
    // A section's answers, as they'd be saved
    const answersOf = (section, all = collect()) => {
        const L = section.dataset.level;
        // (Credit Score is just its one column: the credit card debt columns also start with "CREDIT ")
        const mine = k => (L === 'DEBT' ? DEBT_ALL_COLUMNS.includes(k) : L === 'CREDIT' ? k === 'CREDIT SCORE' : k.startsWith(L + ' '));
        return JSON.stringify(Object.keys(all).filter(mine).sort().map(k => [k, all[k]]));
    };
    // Every debt answered: No, or Yes with an amount over $0
    const debtsAnswered = all => DEBT_TYPES.every(t => all[t.flag] === 'FALSE' || num(all[t.amount]) > 0);
    const isFilled = (section, all = collect()) => {
        const L = section.dataset.level;
        if (L === 'CREDIT') return num(all['CREDIT SCORE']) > 0;
        return L === 'DEBT' ? debtsAnswered(all) : detectType(all, L) !== 'none';
    };
    const dirty = () => { const all = collect(); return sections().some(sec => answersOf(sec, all) !== snapshot[sec.dataset.level]); };

    // The summary: job title (or description) and type on the left, the monthly amount, and an edit button
    function summarize(section) {
        const L = section.dataset.level;
        const all = collect();
        let title, sub, amount;
        if (L === 'CREDIT') {
            const score = Number(all['CREDIT SCORE']);
            title = String(score);
            sub = score >= 740 ? 'Excellent' : score >= 670 ? 'Good' : score >= 580 ? 'Fair' : 'Needs work';
        } else if (L === 'DEBT') {
            // "2 Car Loans, Credit Cards": each type with payments (with a count when there's more than one)
            const parts = [];
            amount = 0;
            DEBT_TYPES.forEach(t => {
                const paid = debtAmounts(t).filter(c => num(all[c]) > 0);
                if (!paid.length || all[t.flag] === 'FALSE') return;
                amount += paid.reduce((sum, c) => sum + num(all[c]), 0);
                parts.push(paid.length > 1 ? paid.length + ' ' + t.title : t.title.replace(/s$/, ''));
            });
            title = 'Monthly Debts';
            sub = parts.length ? parts.join(', ') : 'No monthly debt payments';
        } else {
            const type = selectedType(L);
            title = (type === '1099' ? all[L + ' 1099 INCOME DESCRIPTION'] : all[L + ' JOB TITLE']) || TITLES[L];
            sub = TYPE_NAMES[type] + (type === '1099' ? ' income' : '');
            amount = levelYearly(formGetter(L), type) / 12;
        }
        const box = section.querySelector('.ie-summary');
        box.innerHTML = '<div class="ie-card"><span class="ie-card-text"><span class="ie-card-title"></span><span class="ie-card-sub"></span></span>'
            + '<span class="ie-card-amount"></span><button type="button" class="ie-edit" data-edit aria-label="Edit ' + TITLES[L] + '">' + PENCIL_ICON + '</button></div>';
        box.querySelector('.ie-card-title').textContent = title;
        box.querySelector('.ie-card-sub').textContent = sub;
        box.querySelector('.ie-card-amount').textContent = amount === undefined ? '' : money.format(amount) + ' / mo';
    }
    // Redraw every section: which mode it's in, whether it's locked (another one is being edited), and edited-not-saved
    function render() {
        const all = collect();
        // Income levels are added in order: every level with something in it shows, plus only the first empty one
        // (from what's in the form right now, saved or not)
        const firstEmpty = LEVELS.find(L => !isFilled(sectionFor(L), all));
        sections().forEach(section => {
            const L = section.dataset.level;
            section.hidden = LEVELS.includes(L) && section !== editing && !isFilled(section, all) && L !== firstEmpty;
            const mode = section === editing ? 'edit' : isFilled(section, all) ? 'view' : 'empty';
            section.dataset.mode = mode;
            if (mode === 'view') summarize(section);
            const locked = !!editing && section !== editing;
            section.classList.toggle('is-locked', locked);
            section.querySelectorAll('[data-edit], [data-add]').forEach(b => { b.disabled = locked; });
            if (locked) section.querySelector('.ie-locked span').textContent = 'Press Done on ' + TITLES[editing.dataset.level] + ' before editing this section.';
            section.classList.toggle('is-edited', section !== editing && answersOf(section, all) !== snapshot[L]);
        });
    }
    function startEditing(section, adding) {
        if (editing && editing !== section) return;
        const L = section.dataset.level;
        // A new income starts as Salary so its questions show right away
        if (adding && LEVELS.includes(L) && selectedType(L) === 'none') {
            form.querySelector('#ie-' + L.toLowerCase() + '-type-salary').checked = true;
            showType(L);
            updateTotals();
        }
        editing = section;
        render();
        const first = [...section.querySelectorAll('.type-fields input, .type-fields select')].find(el => !el.closest('[hidden]'));
        if (first) first.focus();
    }
    form.addEventListener('click', e => {
        const section = e.target.closest('.income-section');
        if (!section) return;
        if (e.target.closest('[data-add]')) startEditing(section, true);
        else if (e.target.closest('[data-edit]')) startEditing(section, false);
        else if (e.target.closest('[data-done]')) {
            const problem = validate(section);
            if (problem) { message.textContent = problem; return; }
            message.textContent = '';
            editing = null;
            render();
            section.scrollIntoView({ block: 'nearest' });
        }
    });

    // "Are you sure?" before throwing away unsaved changes
    const confirmBox = form.querySelector('.ie-confirm');
    function requestClose() {
        if (saveBtn.disabled) return;
        if (dirty()) { confirmBox.hidden = false; confirmBox.querySelector('[data-keep]').focus(); return; }
        dialog.close();
    }
    confirmBox.querySelector('[data-keep]').addEventListener('click', () => { confirmBox.hidden = true; });
    confirmBox.querySelector('[data-discard]').addEventListener('click', () => { confirmBox.hidden = true; dialog.close(); });

    function fill() {
        form.querySelectorAll('[data-col]').forEach(el => {
            const v = getCol(current, el.dataset.col);
            if (el.tagName === 'SELECT') {
                const match = [...el.options].find(o => o.value && letters(o.value) === letters(v));
                el.value = match ? match.value : '';
            } else if (isDecimal(el)) {
                el.value = num(v) ? String(num(v)) : '';
            } else {
                el.value = String(v || '');
            }
            el.classList.remove('is-invalid');
        });
        LEVELS.forEach(L => {
            form.querySelector('#ie-' + L.toLowerCase() + '-type-' + detectType(current, L)).checked = true;
            showType(L);
            sectionFor(L).querySelectorAll('.type-fields').forEach(group => {
                Object.keys(EXTRA_COLUMNS).forEach(kind => {
                    const has = EXTRA_COLUMNS[kind].some(c => String(getCol(current, L + ' ' + c) || '').trim() && (c.endsWith('INTERVAL') || num(getCol(current, L + ' ' + c)) > 0));
                    const yes = group.querySelector('input[data-extra-toggle="' + kind + '"][value="yes"]');
                    if (!yes) return;
                    yes.checked = has;
                    group.querySelector('input[data-extra-toggle="' + kind + '"][value="no"]').checked = !has;
                    showExtra(yes);
                });
            });
        });
        DEBT_TYPES.forEach(t => {
            // Yes when a payment is saved or the saved answer isn't FALSE (so Yes by default)
            const yes = debtAmounts(t).some(c => num(getCol(current, c)) > 0) || String(getCol(current, t.flag)).toUpperCase() !== 'FALSE';
            const radio = form.querySelector('#ie-debt-' + t.kind + '-' + (yes ? 'yes' : 'no'));
            radio.checked = true;
            form.querySelector('[data-col="' + t.flag + '"]').value = yes ? 'TRUE' : 'FALSE';
            showExtra(radio);
            // Show every entry up to the last one with something saved in it (at least one)
            let count = 1;
            for (let n = 1; n <= t.max; n++) {
                if ([t.amount].concat(t.texts.map(x => x.col)).some(c => String(getCol(current, colN(c, n)) || '').trim())) count = n;
            }
            showEntries(t.kind, count);
        });
        updateTotals();
        // A score saved as "742.00" shows as 742
        const savedScore = num(getCol(current, 'CREDIT SCORE'));
        creditInput.value = savedScore ? String(Math.round(savedScore)) : '';
        // Remember the answers as loaded (to spot edits), and start with nothing open
        const all = collect();
        snapshot = {};
        sections().forEach(section => { snapshot[section.dataset.level] = answersOf(section, all); });
        editing = null;
        confirmBox.hidden = true;
        render();
    }

    // Checks the fields that are showing. Returns an error message, or '' when everything's fine.
    function validate(only) {
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        const bad = (el, msg) => {
            // Open the section with the problem (only one section is open at a time)
            const section = el.closest('.income-section');
            if (section && editing !== section) { editing = section; render(); }
            el.classList.add('is-invalid');
            el.focus();
            return msg;
        };
        for (const el of form.querySelectorAll('input[inputmode="decimal"]')) {
            if (el.closest('[hidden]') || !el.value.trim()) continue;
            const n = Number(el.value.trim().replace(/[$,]/g, ''));
            if (!isFinite(n) || n < 0) return bad(el, 'Please enter numbers only.');
        }
        for (const L of LEVELS) {
            const type = selectedType(L);
            const group = visibleGroup(L);
            if (!group) continue;
            const input = c => group.querySelector('[data-col="' + L + ' ' + c + '"]');
            const name = TITLES[L];
            const need = (c, what) => num(input(c).value) > 0 ? '' : bad(input(c), name + ': please enter ' + what + '.');
            const missing = type === 'salary' ? need('WEEKLY SALARY', 'the weekly salary')
                : type === 'hourly' ? need('HOURLY RATE', 'the hourly rate') || need('WEEKLY HOURS', 'the hours per week')
                : type === '1099' ? need('1099 YEARLY INCOME', 'the yearly 1099 income') : '';
            if (missing) return missing;
            if (type === 'salary' || type === 'hourly') {
                const said = kind => group.querySelector('input[data-extra-toggle="' + kind + '"][value="yes"]').checked;
                if (said('tips') && !(num(input('WEEKLY TIPS').value) > 0)) return bad(input('WEEKLY TIPS'), name + ': please enter the weekly tips, or answer No.');
                if (said('commission') && !(num(input('COMMISSION AMOUNT').value) > 0) && !input('COMMISSION INTERVAL').value) return bad(input('COMMISSION INTERVAL'), name + ': please enter the commission, or answer No.');
                if (said('bonus') && !(num(input('BONUS AMOUNT').value) > 0) && !input('BONUS INTERVAL').value) return bad(input('BONUS INTERVAL'), name + ': please enter the bonus, or answer No.');
                for (const kind of ['COMMISSION', 'BONUS']) {
                    if (!said(kind.toLowerCase())) continue;
                    const amount = input(kind + ' AMOUNT');
                    const interval = input(kind + ' INTERVAL');
                    if (num(amount.value) > 0 && !interval.value) return bad(interval, name + ': please choose how often the ' + kind.toLowerCase() + ' is paid.');
                    if (interval.value && !(num(amount.value) > 0)) return bad(amount, name + ': please enter the ' + kind.toLowerCase() + ' amount.');
                }
            }
        }
        // Debts: required before saving (and when pressing Done on them); 0 means No
        if (!only || only.dataset.level === 'DEBT') {
            for (const t of DEBT_TYPES) {
                if (form.querySelector('#ie-debt-' + t.kind + '-no').checked) continue;
                const count = shownEntries(t.kind);
                for (let n = 1; n <= count; n++) {
                    const which = 'the ' + t.one + (count > 1 ? ' ' + n : '');
                    // Car loans need a make and model
                    for (const x of t.texts.filter(x => x.required)) {
                        const el = form.querySelector('[data-col="' + colN(x.col, n) + '"]');
                        if (!el.value.trim()) return bad(el, 'Please enter the ' + x.label.toLowerCase() + ' for ' + which + '.');
                    }
                    const amount = form.querySelector('[data-col="' + colN(t.amount, n) + '"]');
                    const raw = amount.value.trim();
                    if (!raw) return bad(amount, 'Please enter the monthly payment for ' + which + (n === 1 ? ', or answer No.' : ', or remove it.'));
                    if (!(num(raw) > 0)) return bad(amount, 'A $0 payment for ' + which + (n === 1 ? ' counts as No. Please enter the amount, or answer No.' : ' isn’t needed. Please enter the amount, or remove it.'));
                }
            }
        }
        // Required before saving (and when pressing Done on it)
        if ((!only || only.dataset.level === 'CREDIT') && !creditOk(creditInput.value)) {
            return bad(creditInput, creditInput.value.trim() ? 'Credit score must be a whole number from 300 to 850.' : 'Please enter your credit score before saving.');
        }
        return '';
    }

    // Every income column gets a value: what's entered for the chosen type, and blanks for the rest
    function collect() {
        const out = {};
        form.querySelectorAll('[data-col]').forEach(el => { out[el.dataset.col] = out[el.dataset.col] || ''; });
        form.querySelectorAll('[data-col]').forEach(el => {
            if (el.closest('[hidden]')) return;
            const v = el.value.trim();
            out[el.dataset.col] = isDecimal(el) ? v.replace(/[$,]/g, '') : v;
        });
        return out;
    }

    function setSaving(saving) {
        form.querySelectorAll('input, select, button').forEach(el => { el.disabled = saving; });
        saveBtn.classList.toggle('is-loading', saving);
        if (!saving) render(); // put the locked sections' buttons back the way they were
    }
    form.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', requestClose));
    dialog.addEventListener('click', e => { if (e.target === dialog) requestClose(); });
    // Escape: same as Cancel (asks first when there are unsaved changes)
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        if (!confirmBox.hidden) { confirmBox.hidden = true; return; }
        requestClose();
    });
    // Show an extra's inputs only while its question is answered Yes
    function showExtra(toggle) {
        const group = toggle.closest('.type-fields');
        const box = group.querySelector('.ie-extra[data-extra="' + toggle.dataset.extraToggle + '"]');
        const yes = group.querySelector('input[data-extra-toggle="' + toggle.dataset.extraToggle + '"][value="yes"]').checked;
        box.hidden = !yes;
    }
    form.addEventListener('change', e => {
        if (e.target.dataset && e.target.dataset.extraToggle) {
            showExtra(e.target);
            if (e.target.dataset.flag) form.querySelector('[data-col="' + e.target.dataset.flag + '"]').value = e.target.value === 'yes' ? 'TRUE' : 'FALSE';
            const first = !e.target.closest('.type-fields').querySelector('.ie-extra[data-extra="' + e.target.dataset.extraToggle + '"]').hidden
                && e.target.closest('.type-fields').querySelector('.ie-extra[data-extra="' + e.target.dataset.extraToggle + '"] input, .ie-extra[data-extra="' + e.target.dataset.extraToggle + '"] select');
            if (first) first.focus();
        } else if (e.target.type === 'radio') showType(e.target.name.replace(/^ie-/, '').split('-')[0].toUpperCase());
        updateTotals();
    });
    form.addEventListener('input', e => {
        e.target.classList.remove('is-invalid');
        message.textContent = '';
        updateTotals();
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const problem = validate();
        if (problem) { message.textContent = problem; return; }
        setSaving(true);
        try {
            const row = await save(collect());
            setSaving(false);
            dialog.close();
            if (onSaved) onSaved(row);
        } catch (err) {
            console.error(err);
            message.textContent = 'We couldn\'t save your changes. Please try again.';
            setSaving(false);
        }
    });

    return {
        open(row) {
            current = row || {};
            fill();
            message.textContent = '';
            dialog.showModal();
            lockPageScroll(dialog);
            form.querySelector('.dialog-scroll').scrollTop = 0;
        },
    };
}
