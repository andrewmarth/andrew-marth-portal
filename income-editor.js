// Income math and the "Your Income" edit pop-up, shared by settings.html and pages.html.
// Columns match the INCOME sheet: PRIMARY / SECONDARY / TERTIARY income levels plus monthly debt payments.

export const LEVELS = ['PRIMARY', 'SECONDARY', 'TERTIARY'];
const DEBT_COLUMNS = ['CAR LOAN PAYMENT', 'MORTGAGE PAYMENT', 'CREDIT CARD PAYMENT', 'OTHER PAYMENT'];
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
export const monthlyDebts = row => DEBT_COLUMNS.reduce((sum, c) => sum + num(getCol(row, c)), 0);

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
.income-dialog .type-fields[hidden] { display: none; }
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
// Tips, commission and bonus can be added to salary or hourly pay (ids get a prefix so salary/hourly don't clash)
const extras = (L, p) => '<p class="sub-label">Extra Pay</p>'
    + moneyField(L + ' WEEKLY TIPS', 'Weekly Tips', true, p + slug(L + ' WEEKLY TIPS'))
    + intervalField(L + ' COMMISSION INTERVAL', 'Commission Paid', p + slug(L + ' COMMISSION INTERVAL'))
    + moneyField(L + ' COMMISSION AMOUNT', 'Commission Amount', false, p + slug(L + ' COMMISSION AMOUNT'))
    + intervalField(L + ' BONUS INTERVAL', 'Bonus Paid', p + slug(L + ' BONUS INTERVAL'))
    + moneyField(L + ' BONUS AMOUNT', 'Bonus Amount', false, p + slug(L + ' BONUS AMOUNT'));
const levelSection = (L, title) => {
    const key = 'ie-' + L.toLowerCase();
    const radio = (value, label) => '<input type="radio" name="' + key + '-type" id="' + key + '-type-' + value + '" value="' + value + '"><label for="' + key + '-type-' + value + '">' + label + '</label>';
    return '<fieldset class="income-section" data-level="' + L + '">'
        + '<div class="section-head"><h3>' + title + '</h3><span class="section-total" data-total="' + L + '"></span></div>'
        + '<div class="type-picker" role="radiogroup" aria-label="' + title + ' type">' + radio('none', 'None') + radio('salary', 'Salary') + radio('hourly', 'Hourly') + radio('1099', '1099') + '</div>'
        + '<div class="type-fields" data-type="salary" hidden>' + textField(L + ' JOB TITLE', 'Job Title', true, key + '-salary-title')
            + moneyField(L + ' WEEKLY SALARY', 'Weekly Salary', true) + extras(L, 's-') + '</div>'
        + '<div class="type-fields" data-type="hourly" hidden>' + textField(L + ' JOB TITLE', 'Job Title', true, key + '-hourly-title')
            + moneyField(L + ' HOURLY RATE', 'Hourly Rate') + numberField(L + ' WEEKLY HOURS', 'Hours per Week') + extras(L, 'h-') + '</div>'
        + '<div class="type-fields" data-type="1099" hidden>' + moneyField(L + ' 1099 YEARLY INCOME', 'Yearly 1099 Income', true)
            + textField(L + ' 1099 INCOME DESCRIPTION', 'Description of Work', true) + '</div>'
        + '</fieldset>';
};
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="income-dialog-title">Your Income</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<p class="muted">Add each job or source of income, plus your monthly debt payments.</p>'
    + '<div class="dialog-scroll">' + levelSection('PRIMARY', 'Primary Income') + levelSection('SECONDARY', 'Secondary Income') + levelSection('TERTIARY', 'Tertiary Income')
        + '<fieldset class="income-section" data-level="DEBT"><div class="section-head"><h3>Monthly Debt Payments</h3></div><div class="type-fields">'
        + moneyField('CAR LOAN PAYMENT', 'Car Loan') + moneyField('MORTGAGE PAYMENT', 'Mortgage') + moneyField('CREDIT CARD PAYMENT', 'Credit Cards') + moneyField('OTHER PAYMENT', 'Other Payments')
        + '</div></fieldset></div>'
    + '<div class="dialog-foot"><div class="total-row"><span>Monthly Income</span><span class="total-value" data-grand-total>$0.00</span></div>'
        + '<p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
        + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span>Save Changes</button></div></div>'
    + '</form>';

/**
 * Builds the income pop-up (once) and returns { open(row) }.
 * save(income) gets { "COLUMN": value, ... } for every income column and must resolve to the saved row (or throw).
 * onSaved(row) runs after a successful save, once the pop-up has closed.
 */
export function createIncomeEditor({ save, onSaved }) {
    if (!document.getElementById('income-editor-css')) {
        const style = document.createElement('style');
        style.id = 'income-editor-css';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
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
        return c => { const el = group && group.querySelector('[data-col="' + L + ' ' + c + '"]'); return el ? el.value : ''; };
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
        });
        updateTotals();
    }

    // Checks the fields that are showing. Returns an error message, or '' when everything's fine.
    function validate() {
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        const bad = (el, msg) => { el.classList.add('is-invalid'); el.focus(); return msg; };
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
            const name = L.charAt(0) + L.slice(1).toLowerCase() + ' income';
            const need = (c, what) => num(input(c).value) > 0 ? '' : bad(input(c), name + ': please enter ' + what + '.');
            const missing = type === 'salary' ? need('WEEKLY SALARY', 'the weekly salary')
                : type === 'hourly' ? need('HOURLY RATE', 'the hourly rate') || need('WEEKLY HOURS', 'the hours per week')
                : type === '1099' ? need('1099 YEARLY INCOME', 'the yearly 1099 income') : '';
            if (missing) return missing;
            if (type === 'salary' || type === 'hourly') {
                for (const kind of ['COMMISSION', 'BONUS']) {
                    const amount = input(kind + ' AMOUNT');
                    const interval = input(kind + ' INTERVAL');
                    if (num(amount.value) > 0 && !interval.value) return bad(interval, name + ': please choose how often the ' + kind.toLowerCase() + ' is paid.');
                    if (interval.value && !(num(amount.value) > 0)) return bad(amount, name + ': please enter the ' + kind.toLowerCase() + ' amount.');
                }
            }
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
    }
    const close = () => { if (!saveBtn.disabled) dialog.close(); };
    form.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saveBtn.disabled) e.preventDefault(); });
    form.addEventListener('change', e => {
        if (e.target.type === 'radio') showType(e.target.name.replace(/^ie-/, '').split('-')[0].toUpperCase());
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
            form.querySelector('.dialog-scroll').scrollTop = 0;
        },
    };
}
