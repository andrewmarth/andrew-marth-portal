// "New Task" pop-up for the home page's Current Tasks card (admins).
// Asks for the task's type, who it's for, its title and description, who to text (and the message) or who to call,
// and when it should show up; then hands the answers to submit(answers).
// Uses the same pop-up and dropdowns as the New Property form: a card on wide screens, a swipe-up sheet on phones.
import { lockPageScroll } from '/income-editor.js';
import { ensurePickerStyles, multiPicker, singlePicker } from '/new-property.js';

const TYPES = ['General', 'Send Text', 'Call', 'Errand'];
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CSS = `
.task-dialog .type-picker { margin-bottom: 0; }
.task-dialog .type-picker label { display: flex; align-items: center; justify-content: center; margin: 0; min-height: 44px; font-size: 0.92rem; text-align: center; line-height: 1.15; }
.task-dialog .type-picker.yes-no { grid-template-columns: 1fr 1fr; }
.task-dialog .field[hidden], .task-dialog .tf-other[hidden], .task-dialog [data-for][hidden] { display: none; }
.task-dialog .tf-other { margin-top: 10px; }
.task-dialog textarea {
    width: 100%; min-height: calc(9 * 1.5em + 28px); padding: 14px 20px; resize: vertical;
    border: 2px solid var(--navy); border-radius: 22px; background-color: #f7f4f0;
    font-family: inherit; font-size: 1.05rem; line-height: 1.5; color: var(--brown);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}
.task-dialog textarea:focus { outline: none; background-color: var(--white); border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.task-dialog textarea.is-invalid { border-color: var(--rust); background-color: #fdf2f2; }
/* When: a date button that opens a calendar, then hour / minute / AM-PM */
.task-dialog .tf-date { position: relative; }
.task-dialog .tf-cal {
    display: none; max-width: 340px; margin-top: 8px; padding: 12px; background: var(--white);
    border: 2px solid var(--navy); border-radius: 20px; box-shadow: 4px 4px 0 var(--navy);
}
.task-dialog .tf-date.is-open .tf-cal { display: block; }
.task-dialog .tf-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.task-dialog .tf-cal-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 1.05rem; }
.task-dialog .tf-cal-nav {
    width: 38px; height: 38px; border-radius: 50%; border: 2px solid var(--navy); background: #f7f4f0; color: var(--olive);
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.task-dialog .tf-cal-nav svg { width: 16px; height: 16px; }
.task-dialog .tf-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.task-dialog .tf-cal-dow { text-align: center; font-size: 0.75rem; font-weight: bold; opacity: 0.6; padding: 4px 0; }
.task-dialog .tf-cal-day {
    width: 38px; height: 38px; justify-self: center; border: none; border-radius: 50%; background: transparent; color: var(--brown);
    font-family: inherit; font-size: 0.95rem; cursor: pointer;
}
.task-dialog .tf-cal-day.is-today { box-shadow: inset 0 0 0 2px var(--tan); font-weight: bold; }
.task-dialog .tf-cal-day.is-picked { background: var(--olive); color: var(--cream); font-weight: bold; }
.task-dialog .tf-cal-day:focus-visible, .task-dialog .tf-cal-nav:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
@media (hover: hover) { .task-dialog .tf-cal-day:not(.is-picked):hover, .task-dialog .tf-cal-nav:hover { background: #f4efe8; } }
.task-dialog .tf-time { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; align-items: start; }
.task-dialog .tf-time .type-picker { min-height: 54px; align-items: center; }
@media (max-width: 600px) { .task-dialog .tf-time { grid-template-columns: 1fr 1fr; } .task-dialog .tf-time .type-picker { grid-column: 1 / -1; } }
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatPhone = id => (id.length === 10 ? '(' + id.slice(0, 3) + ') ' + id.slice(3, 6) + '-' + id.slice(6) : id);
const digitsOf = v => String(v || '').replace(/\D/g, '');
const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const yesNo = (name, a, b) => '<div class="type-picker yes-no">'
    + '<input type="radio" name="' + name + '" id="' + name + '-a" value="' + a + '"><label for="' + name + '-a">' + a + '</label>'
    + '<input type="radio" name="' + name + '" id="' + name + '-b" value="' + b + '"><label for="' + name + '-b">' + b + '</label></div>';
const phoneBox = (id, label) => '<div class="tf-other" hidden><label for="' + id + '" class="field-label">' + label + '</label>'
    + '<input id="' + id + '" type="text" inputmode="tel" autocomplete="off" maxlength="14" placeholder="(480) 555-0123"></div>';

const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="task-dialog-title">New Task</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<p class="muted">The task shows on their Current Tasks once its date and time arrive.</p>'
    + '<div class="dialog-scroll">'
    + '<fieldset class="income-section"><div class="section-head"><h3>Task</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label">Task Type</span><div class="type-picker" data-type>'
            + TYPES.map((t, i) => '<input type="radio" name="tf-type" id="tf-type-' + i + '" value="' + t + '"><label for="tf-type-' + i + '">' + t + '</label>').join('')
        + '</div></div>'
        + '<div class="field span-2"><span class="field-label" id="tf-assigned-label">Assigned To</span><div data-assigned></div></div>'
        + '<div class="field span-2"><label for="tf-title">Task Title</label><input id="tf-title" type="text" maxlength="100" autocomplete="off" placeholder="Call the lender"></div>'
        + '<div class="field span-2"><label for="tf-description">Task Description</label><input id="tf-description" type="text" maxlength="300" autocomplete="off" placeholder="A few words about it"></div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section" data-for="Send Text"><div class="section-head"><h3>Text</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label" id="tf-text-label">Who To Text</span><div data-text-to></div>'
            + phoneBox('tf-text-other', 'Other Phone Number') + '</div>'
        + '<div class="field span-2"><label for="tf-message">Message</label><textarea id="tf-message" rows="9" maxlength="2000" placeholder="Hi! Just checking in..."></textarea></div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section" data-for="Call"><div class="section-head"><h3>Call</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label" id="tf-call-label">Who To Call</span><div data-call-to></div>'
            + phoneBox('tf-call-other', 'Phone Number') + '</div>'
    + '</div></fieldset>'
    + '<fieldset class="income-section"><div class="section-head"><h3>When</h3></div><div class="type-fields">'
        + '<div class="field span-2"><span class="field-label" id="tf-date-label">Date</span>'
            + '<div class="tf-date mp"><button type="button" class="mp-btn sp-btn" data-date-btn aria-haspopup="dialog" aria-expanded="false" aria-labelledby="tf-date-label">'
            + '<span class="mp-text"><span class="mp-main" data-date-text></span></span></button>'
            + '<div class="tf-cal" role="dialog" aria-label="Pick a date"><div class="tf-cal-head">'
                + '<button type="button" class="tf-cal-nav" data-cal-prev aria-label="Previous month">' + PREV + '</button>'
                + '<span class="tf-cal-title" data-cal-title></span>'
                + '<button type="button" class="tf-cal-nav" data-cal-next aria-label="Next month">' + NEXT + '</button></div>'
                + '<div class="tf-cal-grid" data-cal-grid></div></div></div></div>'
        + '<div class="field span-2"><span class="field-label" id="tf-time-label">Time</span><div class="tf-time">'
            + '<div data-hour></div><div data-minute></div>' + yesNo('tf-ampm', 'AM', 'PM') + '</div></div>'
    + '</div></fieldset>'
    + '</div>'
    + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
        + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span>Add Task</button></div></div>'
    + '</form>';

let built = null;

/**
 * Opens the New Task pop-up. me: the signed-in admin's 10-digit ID; accounts: [{ id, name }] (everyone);
 * submit(answers) must resolve once the task is saved (or throw).
 */
export function openTaskForm({ me, accounts, submit }) {
    if (!built) built = build();
    built.open({ me, accounts, submit });
}

function build() {
    ensurePickerStyles();
    if (!document.getElementById('task-form-css')) {
        const style = document.createElement('style');
        style.id = 'task-form-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog property-dialog task-dialog';
    dialog.setAttribute('aria-labelledby', 'task-dialog-title');
    dialog.innerHTML = DIALOG_HTML;
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const saveBtn = $('[data-save]');
    let ctx = null;
    let saving = false;
    const others = () => (ctx ? ctx.accounts.filter(a => a.id !== ctx.me) : []);
    const everyone = () => (ctx ? ctx.accounts : []);

    // --- Type: shows the Text or Call questions ---
    const typeValue = () => (form.querySelector('input[name="tf-type"]:checked') || {}).value || '';
    const showType = () => dialog.querySelectorAll('[data-for]').forEach(s => { s.hidden = s.dataset.for !== typeValue(); });
    form.querySelectorAll('input[name="tf-type"]').forEach(r => r.addEventListener('change', showType));

    // --- People ---
    const assigned = singlePicker($('[data-assigned]'), { labelId: 'tf-assigned-label', placeholder: 'Choose...', icon: PERSON_ICON });
    const textOther = $('#tf-text-other');
    const textTo = multiPicker($('[data-text-to]'), {
        labelId: 'tf-text-label',
        placeholder: 'Choose who to text...',
        items: () => [{ id: 'other', name: 'Other', sub: 'Type in a phone number' }].concat(everyone()),
        canAdd: () => true,
        onChange: () => { textOther.closest('.tf-other').hidden = !textTo.value().includes('other'); },
    });
    const callOther = $('#tf-call-other');
    const callTo = singlePicker($('[data-call-to]'), {
        labelId: 'tf-call-label', placeholder: 'Choose who to call...', icon: PHONE_ICON,
        onChange: value => { callOther.closest('.tf-other').hidden = value !== 'other'; },
    });
    // Phone numbers: digits only, shown as (480) 555-0123
    [textOther, callOther].forEach(input => input.addEventListener('input', () => {
        const d = digitsOf(input.value).replace(/^1(?=\d{10})/, '').slice(0, 10);
        input.value = d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6)
            : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3) : d;
    }));

    // --- When: a calendar for the date, then hour, minute and AM/PM ---
    const dateWrap = $('.tf-date');
    const dateBtn = $('[data-date-btn]');
    let picked = new Date();
    let shown = new Date();
    const drawDateText = () => {
        $('[data-date-text]').textContent = picked.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    };
    function drawCalendar() {
        const year = shown.getFullYear(), month = shown.getMonth();
        $('[data-cal-title]').textContent = MONTHS[month] + ' ' + year;
        const first = new Date(year, month, 1).getDay();
        const days = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        let html = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => '<span class="tf-cal-dow">' + d + '</span>').join('');
        for (let i = 0; i < first; i++) html += '<span></span>';
        for (let d = 1; d <= days; d++) {
            const day = new Date(year, month, d);
            html += '<button type="button" class="tf-cal-day' + (sameDay(day, today) ? ' is-today' : '') + (sameDay(day, picked) ? ' is-picked' : '')
                + '" data-day="' + d + '" aria-label="' + escapeHtml(day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) + '"'
                + (sameDay(day, picked) ? ' aria-pressed="true"' : '') + '>' + d + '</button>';
        }
        $('[data-cal-grid]').innerHTML = html;
    }
    const openCal = () => { shown = new Date(picked.getFullYear(), picked.getMonth(), 1); drawCalendar(); dateWrap.classList.add('is-open'); dateBtn.setAttribute('aria-expanded', 'true'); };
    const closeCal = () => { dateWrap.classList.remove('is-open'); dateBtn.setAttribute('aria-expanded', 'false'); };
    dateBtn.addEventListener('click', () => (dateWrap.classList.contains('is-open') ? closeCal() : openCal()));
    $('[data-cal-prev]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); drawCalendar(); });
    $('[data-cal-next]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); drawCalendar(); });
    $('[data-cal-grid]').addEventListener('click', e => {
        const b = e.target.closest('[data-day]');
        if (!b) return;
        picked = new Date(shown.getFullYear(), shown.getMonth(), Number(b.dataset.day));
        drawDateText();
        closeCal();
        dateBtn.focus();
    });
    dateWrap.addEventListener('keydown', e => { if (e.key === 'Escape' && dateWrap.classList.contains('is-open')) { e.preventDefault(); e.stopPropagation(); closeCal(); dateBtn.focus(); } });
    document.addEventListener('pointerdown', e => { if (!dateWrap.contains(e.target)) closeCal(); });
    const hour = singlePicker($('[data-hour]'), { labelId: 'tf-time-label', placeholder: 'Hour', icon: CLOCK_ICON });
    const minute = singlePicker($('[data-minute]'), { labelId: 'tf-time-label', placeholder: 'Min', icon: CLOCK_ICON });
    hour.setItems(Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), main: String(i + 1) })));
    minute.setItems(MINUTES.map(m => ({ value: m, main: ':' + m })));
    // The next whole hour (from 11 PM on, the time stays 11 PM today)
    function setDefaultWhen() {
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(now.getHours() + 1, 23), 0);
        picked = new Date(next.getFullYear(), next.getMonth(), next.getDate());
        drawDateText();
        hour.setValue(String((next.getHours() % 12) || 12));
        minute.setValue('00');
        form.querySelectorAll('input[name="tf-ampm"]').forEach(r => { r.checked = r.value === (next.getHours() < 12 ? 'AM' : 'PM'); });
    }

    // --- Close / save ---
    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
    const clear = e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; };
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);
    const problem = (el, text) => {
        if (el) { el.classList.add('is-invalid'); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center' }); }
        message.textContent = text;
        return true;
    };

    function answers() {
        const type = typeValue();
        const h = Number(hour.value()) % 12 + ((form.querySelector('input[name="tf-ampm"]:checked') || {}).value === 'PM' ? 12 : 0);
        const out = {
            type,
            assignedTo: assigned.value(),
            title: $('#tf-title').value.trim(),
            description: $('#tf-description').value.trim(),
            date: isoDate(picked),
            time: pad(h) + ':' + minute.value(),
        };
        if (type === 'Send Text') {
            out.textTo = textTo.value().filter(id => id !== 'other').concat(textTo.value().includes('other') ? [digitsOf(textOther.value)] : []);
            out.message = $('#tf-message').value;
        }
        if (type === 'Call') out.callTo = callTo.value() === 'other' ? digitsOf(callOther.value) : callTo.value();
        return out;
    }
    function validate(a) {
        if (!a.type) return problem(form.querySelector('[data-type] label'), 'Please choose the task type.');
        if (!a.assignedTo) return problem(assigned.button, 'Please choose who the task is for.');
        if (!a.title) return problem($('#tf-title'), 'Please give the task a title.');
        if (a.type === 'Send Text') {
            if (!textTo.value().length) return problem($('[data-text-to] .mp-btn'), 'Please choose who to text.');
            if (textTo.value().includes('other') && digitsOf(textOther.value).length !== 10) return problem(textOther, 'Please enter a 10-digit phone number.');
            if (!a.message.trim()) return problem($('#tf-message'), 'Please write the message.');
        }
        if (a.type === 'Call') {
            if (!callTo.value()) return problem(callTo.button, 'Please choose who to call.');
            if (callTo.value() === 'other' && digitsOf(callOther.value).length !== 10) return problem(callOther, 'Please enter a 10-digit phone number.');
        }
        if (!hour.value() || !minute.value() || !form.querySelector('input[name="tf-ampm"]:checked')) return problem(hour.button, 'Please choose the time.');
        return false;
    }
    form.addEventListener('submit', async e => {
        e.preventDefault();
        message.textContent = '';
        const a = answers();
        if (validate(a)) return;
        saving = true;
        saveBtn.disabled = true;
        saveBtn.classList.add('is-loading');
        try {
            await ctx.submit(a);
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = 'We couldn’t add the task. Please try again.';
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
            form.querySelector('input[name="tf-type"][value="General"]').checked = true;
            showType();
            const me = ctx.accounts.find(a => a.id === ctx.me);
            assigned.setItems([{ value: ctx.me, main: 'Me', secondary: me ? me.name : formatPhone(ctx.me) }]
                .concat(others().map(a => ({ value: a.id, main: a.name || formatPhone(a.id), secondary: a.name ? formatPhone(a.id) : '' }))));
            assigned.setValue(ctx.me);
            textTo.reset();
            textOther.closest('.tf-other').hidden = true;
            callTo.setItems([{ value: 'other', main: 'Other', secondary: 'Type in a phone number' }]
                .concat(everyone().map(a => ({ value: a.id, main: a.name || formatPhone(a.id), secondary: a.name ? formatPhone(a.id) : '' }))));
            callOther.closest('.tf-other').hidden = true;
            closeCal();
            setDefaultWhen();
            dialog.showModal();
            lockPageScroll(dialog);
            $('.dialog-scroll').scrollTop = 0;
        },
    };
}
