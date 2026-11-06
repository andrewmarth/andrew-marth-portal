// "New Task" pop-up for the home page's Current Tasks card (admins). One question at a time, with Back / Next:
// the task's type, who it's for, its title and description, who to text and the message (Send Text) or who to call
// (Call), and when it should show up: immediately, a day and time in the future, or once another task (still open) is
// completed ("Contingent"). The answers go to submit(answers).
// Uses the same pop-up as the other forms: a card on wide screens, a swipe-up sheet on phones.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CSS = `
.task-dialog .tf-progress { padding: 0 28px; margin-bottom: 14px; }
.task-dialog .tf-progress-text { font-size: 0.82rem; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; color: var(--olive); }
.task-dialog .tf-bar { height: 6px; margin-top: 8px; border-radius: 999px; background: #ece5db; overflow: hidden; }
.task-dialog .tf-bar span { display: block; height: 100%; border-radius: inherit; background: var(--olive); transition: width 0.3s ease; }
.task-dialog .tf-step { padding: 18px 0 10px 0; }
.task-dialog .tf-step[hidden] { display: none; }
.task-dialog .tf-step.is-entering { animation: tf-in 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes tf-in { from { opacity: 0; transform: translateX(14px); } }
@media (prefers-reduced-motion: reduce) { .task-dialog .tf-step.is-entering { animation: none; } }
.task-dialog .tf-question { font-family: 'Bricolage Grotesque', sans-serif; font-size: 1.35rem; line-height: 1.2; margin-bottom: 6px; }
.task-dialog .tf-hint { font-size: 0.9rem; opacity: 0.7; margin-bottom: 14px; }
.task-dialog .tf-step input[type="text"], .task-dialog textarea {
    width: 100%; min-height: 54px; padding: 12px 20px; border: 2px solid var(--navy); border-radius: 999px; background-color: #f7f4f0;
    font-family: inherit; font-size: 1.05rem; color: var(--brown); transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}
.task-dialog textarea { min-height: calc(9 * 1.5em + 28px); padding: 14px 20px; border-radius: 22px; line-height: 1.5; resize: vertical; }
.task-dialog .tf-step input[type="text"]:focus, .task-dialog textarea:focus { outline: none; background-color: var(--white); border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.task-dialog .is-invalid { border-color: var(--rust) !important; background-color: #fdf2f2 !important; }
.task-dialog .tf-other { margin-top: 12px; }
.task-dialog .tf-other[hidden] { display: none; }
.task-dialog .tf-other label { display: block; font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
/* Big choices (task type, immediately / future) */
.task-dialog .tf-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.task-dialog .tf-choice {
    display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 16px 10px 10px; text-align: left;
    border: 2px solid rgba(14, 42, 59, 0.35); border-radius: 18px; background: #f7f4f0; color: var(--brown);
    font-family: inherit; font-size: 1rem; font-weight: bold; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.task-dialog .tf-choice small { display: block; font-size: 0.82rem; font-weight: normal; opacity: 0.75; }
.task-dialog .tf-choice-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: #ece5db; color: var(--tan); }
.task-dialog .tf-choice-icon svg { width: 20px; height: 20px; }
.task-dialog .tf-choice[aria-pressed="true"] { background: var(--olive); border-color: var(--olive); color: var(--cream); }
.task-dialog .tf-choice[aria-pressed="true"] .tf-choice-icon { background: var(--cream); color: var(--olive); }
.task-dialog .tf-choice:focus-visible, .task-dialog .tf-person:focus-visible, .task-dialog .tf-time:focus-visible, .task-dialog .tf-cal-day:focus-visible, .task-dialog .tf-cal-nav:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
/* People lists */
.task-dialog .tf-list { display: flex; flex-direction: column; gap: 8px; }
.task-dialog .tf-person {
    display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 8px 14px 8px 8px; text-align: left; width: 100%;
    border: 2px solid rgba(14, 42, 59, 0.2); border-radius: 16px; background: #f7f4f0; color: var(--brown); font-family: inherit; cursor: pointer;
}
.task-dialog .tf-person-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #ece5db; color: var(--tan); }
.task-dialog .tf-person-icon svg { width: 19px; height: 19px; }
.task-dialog .tf-person-text { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.3; }
.task-dialog .tf-person-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-dialog .tf-person-sub { font-size: 0.85rem; opacity: 0.7; }
.task-dialog .tf-check { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(14, 42, 59, 0.35); display: inline-flex; align-items: center; justify-content: center; color: var(--cream); }
.task-dialog .tf-list.is-multi .tf-check { border-radius: 8px; }
.task-dialog .tf-check svg { width: 15px; height: 15px; opacity: 0; }
.task-dialog .tf-person[aria-pressed="true"] { border-color: var(--olive); background: #eef0e6; }
.task-dialog .tf-person[aria-pressed="true"] .tf-check { background: var(--olive); border-color: var(--olive); }
.task-dialog .tf-person[aria-pressed="true"] .tf-check svg { opacity: 1; }
@media (hover: hover) { .task-dialog .tf-person:hover, .task-dialog .tf-choice[aria-pressed="false"]:hover { border-color: var(--navy); } }
.task-dialog .tf-choices.is-stacked { grid-template-columns: 1fr; }
.task-dialog .tf-person-name.is-wrapping { white-space: normal; }
.task-dialog .tf-empty { padding: 14px 4px; font-size: 0.95rem; opacity: 0.75; }
/* Day: a calendar */
.task-dialog .tf-cal { max-width: 360px; padding: 12px; background: var(--white); border: 2px solid var(--navy); border-radius: 20px; box-shadow: 4px 4px 0 var(--navy); }
.task-dialog .tf-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.task-dialog .tf-cal-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 1.05rem; }
.task-dialog .tf-cal-nav { width: 38px; height: 38px; border-radius: 50%; border: 2px solid var(--navy); background: #f7f4f0; color: var(--olive); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.task-dialog .tf-cal-nav:disabled { opacity: 0.35; cursor: default; }
.task-dialog .tf-cal-nav svg { width: 16px; height: 16px; }
.task-dialog .tf-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.task-dialog .tf-cal-dow { text-align: center; font-size: 0.75rem; font-weight: bold; opacity: 0.6; padding: 4px 0; }
.task-dialog .tf-cal-day { width: 40px; height: 40px; justify-self: center; border: none; border-radius: 50%; background: transparent; color: var(--brown); font-family: inherit; font-size: 0.95rem; cursor: pointer; }
.task-dialog .tf-cal-day:disabled { opacity: 0.3; cursor: default; }
.task-dialog .tf-cal-day.is-today { box-shadow: inset 0 0 0 2px var(--tan); font-weight: bold; }
.task-dialog .tf-cal-day.is-picked { background: var(--olive); color: var(--cream); font-weight: bold; }
@media (hover: hover) { .task-dialog .tf-cal-day:not(.is-picked):not(:disabled):hover, .task-dialog .tf-cal-nav:not(:disabled):hover { background: #f4efe8; } }
/* Time: every 15 minutes, one tap */
.task-dialog .tf-times { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; max-height: 300px; overflow-y: auto; padding: 4px 6px 4px 2px; scroll-padding: 8px; }
.task-dialog .tf-time {
    min-height: 44px; padding: 6px 4px; border: 2px solid rgba(14, 42, 59, 0.25); border-radius: 999px; background: #f7f4f0; color: var(--brown);
    font-family: inherit; font-size: 0.92rem; font-weight: bold; cursor: pointer; white-space: nowrap;
}
.task-dialog .tf-time.is-hour { border-color: rgba(14, 42, 59, 0.5); }
.task-dialog .tf-time:disabled { opacity: 0.3; cursor: default; }
.task-dialog .tf-time[aria-pressed="true"] { background: var(--olive); border-color: var(--olive); color: var(--cream); }
@media (hover: hover) { .task-dialog .tf-time:not(:disabled):not([aria-pressed="true"]):hover { border-color: var(--navy); } }
.task-dialog .tf-picked { margin-top: 12px; font-size: 0.92rem; font-weight: bold; color: var(--olive); }
@media (max-width: 600px) {
    .task-dialog .tf-progress { padding: 0 20px; }
    .task-dialog .tf-choices { grid-template-columns: 1fr; }
    .task-dialog .tf-times { grid-template-columns: repeat(3, 1fr); max-height: 260px; }
    .task-dialog .tf-cal { max-width: none; }
}
`;

const ICON = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const PERSON_ICON = ICON('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
const OTHER_ICON = ICON('<path d="M12 5v14"/><path d="M5 12h14"/>');
const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const TYPES = [
    { value: 'General', sub: 'Something to do', icon: ICON('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>') },
    { value: 'Send Text', sub: 'A text with the message ready', icon: ICON('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') },
    { value: 'Call', sub: 'Call someone', icon: ICON('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>') },
    { value: 'Errand', sub: 'Somewhere to go', icon: ICON('<path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/><path d="M9 9V6h6v3"/>') },
];
const WHENS = [
    { value: 'now', main: 'Immediately', sub: 'Shows up right away', icon: ICON('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>') },
    { value: 'future', main: 'In the future', sub: 'Pick a day and time', icon: ICON('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>') },
    { value: 'contingent', main: 'Contingent', sub: 'Once another task is completed', icon: ICON('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>') },
];
const TASK_ICON = ICON('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>');

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatPhone = id => (id.length === 10 ? '(' + id.slice(0, 3) + ') ' + id.slice(3, 6) + '-' + id.slice(6) : id);
const digitsOf = v => String(v || '').replace(/\D/g, '');
const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) => a && b && dayStart(a).getTime() === dayStart(b).getTime();
const timeLabel = mins => ((Math.floor(mins / 60) % 12) || 12) + ':' + pad(mins % 60) + ' ' + (mins < 720 ? 'AM' : 'PM');

const choice = (value, main, sub, icon) => '<button type="button" class="tf-choice" data-value="' + escapeHtml(value) + '" aria-pressed="false">'
    + '<span class="tf-choice-icon">' + icon + '</span><span>' + escapeHtml(main) + '<small>' + escapeHtml(sub) + '</small></span></button>';
const step = (id, question, hint, body) => '<section class="tf-step" data-step="' + id + '" hidden>'
    + '<h3 class="tf-question" id="tf-q-' + id + '">' + question + '</h3>' + (hint ? '<p class="tf-hint">' + hint + '</p>' : '') + body + '</section>';
const phoneBox = (id, label) => '<div class="tf-other" hidden><label for="' + id + '">' + label + '</label>'
    + '<input id="' + id + '" type="text" inputmode="tel" autocomplete="off" maxlength="14" placeholder="(480) 555-0123"></div>';

const DIALOG_HTML = '<form class="income-form" novalidate>'
    + '<div class="dialog-head"><h2 id="task-dialog-title">New Task</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
    + '<div class="tf-progress"><span class="tf-progress-text" data-progress></span><div class="tf-bar"><span data-bar></span></div></div>'
    + '<div class="dialog-scroll">'
    + step('type', 'What kind of task is it?', '', '<div class="tf-choices" data-choices="type">' + TYPES.map(t => choice(t.value, t.value, t.sub, t.icon)).join('') + '</div>')
    + step('assigned', 'Who is it for?', '', '<div class="tf-list" data-list="assigned" role="group" aria-labelledby="tf-q-assigned"></div>')
    + step('title', 'What’s the task?', 'A short title, like “Call the lender”.', '<input id="tf-title" type="text" maxlength="100" autocomplete="off" aria-labelledby="tf-q-title">')
    + step('description', 'Any details?', 'Optional: a few words about it.', '<input id="tf-description" type="text" maxlength="300" autocomplete="off" aria-labelledby="tf-q-description">')
    + step('textTo', 'Who should get the text?', 'Pick everyone it goes to. More than one makes a group text.',
        '<div class="tf-list is-multi" data-list="textTo" role="group" aria-labelledby="tf-q-textTo"></div>' + phoneBox('tf-text-other', 'Other phone number'))
    + step('message', 'What should the text say?', 'Line breaks and blank lines are kept.', '<textarea id="tf-message" rows="9" maxlength="2000" aria-labelledby="tf-q-message"></textarea>')
    + step('callTo', 'Who should be called?', '', '<div class="tf-list" data-list="callTo" role="group" aria-labelledby="tf-q-callTo"></div>' + phoneBox('tf-call-other', 'Phone number'))
    + step('when', 'When should it show up?', '', '<div class="tf-choices is-stacked" data-choices="when">' + WHENS.map(w => choice(w.value, w.main, w.sub, w.icon)).join('') + '</div>')
    + step('contingent', 'Which task has to be completed first?', 'It shows up once that task is completed.',
        '<div class="tf-list" data-tasks role="group" aria-labelledby="tf-q-contingent"></div>')
    + step('date', 'Which day?', '', '<div class="tf-cal"><div class="tf-cal-head">'
        + '<button type="button" class="tf-cal-nav" data-cal-prev aria-label="Previous month">' + PREV + '</button>'
        + '<span class="tf-cal-title" data-cal-title></span>'
        + '<button type="button" class="tf-cal-nav" data-cal-next aria-label="Next month">' + NEXT + '</button></div>'
        + '<div class="tf-cal-grid" data-cal-grid></div></div>')
    + step('time', 'What time?', '', '<div class="tf-times" data-times role="group" aria-labelledby="tf-q-time"></div><p class="tf-picked" data-picked></p>')
    + '</div>'
    + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
        + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-back>Cancel</button>'
        + '<button type="submit" class="btn" data-next><span class="btn-spinner" aria-hidden="true"></span><span data-next-text>Next</span></button></div></div>'
    + '</form>';

let built = null;

/**
 * Opens the New Task pop-up. me: the signed-in admin's 10-digit ID; accounts: [{ id, name }] (everyone);
 * openTasks(): resolves to the tasks not completed yet ([{ taskId, title, assignedTo, assignedName, when, waitingOn }]),
 * for the "Contingent" question; submit(answers) must resolve once the task is saved (or throw).
 */
export function openTaskForm({ me, accounts, openTasks, submit }) {
    if (!built) built = build();
    built.open({ me, accounts, openTasks, submit });
}

function build() {
    ensureDialogStyles();
    if (!document.getElementById('task-form-css')) {
        const style = document.createElement('style');
        style.id = 'task-form-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog task-dialog';
    dialog.setAttribute('aria-labelledby', 'task-dialog-title');
    dialog.innerHTML = DIALOG_HTML;
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const nextBtn = $('[data-next]');
    const backBtn = $('[data-back]');
    const scroller = $('.dialog-scroll');
    let ctx = null;
    let saving = false;
    // The answers so far
    let a = {};
    let current = 'type';

    // Which questions are asked, in order (the Text / Call / day and time questions only when they apply)
    const steps = () => ['type', 'assigned', 'title', 'description']
        .concat(a.type === 'Send Text' ? ['textTo', 'message'] : [], a.type === 'Call' ? ['callTo'] : [], ['when'],
            a.when === 'future' ? ['date', 'time'] : [], a.when === 'contingent' ? ['contingent'] : []);

    // --- Big choices: tap to pick; a pick moves on to the next question ---
    dialog.querySelectorAll('[data-choices]').forEach(group => group.addEventListener('click', e => {
        const b = e.target.closest('.tf-choice');
        if (!b) return;
        a[group.dataset.choices] = b.dataset.value;
        drawChoices();
        message.textContent = '';
        // "Immediately" is the last question, so it waits for Add Task
        if (!(group.dataset.choices === 'when' && b.dataset.value === 'now')) setTimeout(() => go(1), 180);
        else showFooter();
    }));
    const drawChoices = () => dialog.querySelectorAll('[data-choices]').forEach(group => group.querySelectorAll('.tf-choice')
        .forEach(b => b.setAttribute('aria-pressed', String(a[group.dataset.choices] === b.dataset.value))));

    // --- People lists: one person (Assigned To, Who To Call) or several (Who To Text); "Other" asks for a number ---
    const person = (value, name, sub, icon) => '<button type="button" class="tf-person" data-value="' + escapeHtml(value) + '" aria-pressed="false">'
        + '<span class="tf-person-icon">' + icon + '</span><span class="tf-person-text"><span class="tf-person-name">' + escapeHtml(name) + '</span>'
        + (sub ? '<span class="tf-person-sub">' + escapeHtml(sub) + '</span>' : '') + '</span><span class="tf-check">' + CHECK + '</span></button>';
    function drawLists() {
        const me = ctx.accounts.find(x => x.id === ctx.me);
        const others = ctx.accounts.filter(x => x.id !== ctx.me);
        const row = x => person(x.id, x.name || formatPhone(x.id), x.name ? formatPhone(x.id) : '', PERSON_ICON);
        $('[data-list="assigned"]').innerHTML = person(ctx.me, 'Me', me ? me.name : formatPhone(ctx.me), PERSON_ICON) + others.map(row).join('');
        const other = person('other', 'Other', 'Type in a phone number', OTHER_ICON);
        $('[data-list="textTo"]').innerHTML = other + ctx.accounts.map(row).join('');
        $('[data-list="callTo"]').innerHTML = other + ctx.accounts.map(row).join('');
    }
    const picked = list => (list === 'textTo' ? a.textTo || [] : a[list] ? [a[list]] : []);
    const drawPicks = () => dialog.querySelectorAll('[data-list]').forEach(list => {
        list.querySelectorAll('.tf-person').forEach(b => b.setAttribute('aria-pressed', String(picked(list.dataset.list).includes(b.dataset.value))));
        const box = list.parentElement.querySelector('.tf-other');
        if (box) box.hidden = !picked(list.dataset.list).includes('other');
    });
    dialog.querySelectorAll('[data-list]').forEach(list => list.addEventListener('click', e => {
        const b = e.target.closest('.tf-person');
        if (!b) return;
        const v = b.dataset.value;
        message.textContent = '';
        if (list.dataset.list === 'textTo') {
            const now = a.textTo || [];
            a.textTo = now.includes(v) ? now.filter(x => x !== v) : now.concat([v]);
            drawPicks();
            if (v === 'other' && a.textTo.includes('other')) setTimeout(() => $('#tf-text-other').focus(), 50);
            return;
        }
        a[list.dataset.list] = v;
        drawPicks();
        if (v === 'other') setTimeout(() => $('#tf-call-other').focus(), 50);
        else setTimeout(() => go(1), 180);
    }));
    // Phone numbers: digits only, shown as (480) 555-0123
    ['#tf-text-other', '#tf-call-other'].forEach(sel => $(sel).addEventListener('input', e => {
        const input = e.target;
        const d = digitsOf(input.value).replace(/^1(?=\d{10})/, '').slice(0, 10);
        input.value = d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3) : d;
    }));

    // --- Contingent: which open task this one waits for (it can be one that's waiting on another task itself) ---
    let openTasks = null;
    const shortWhen = iso => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + timeLabel(d.getHours() * 60 + d.getMinutes());
    };
    function drawTasks() {
        const box = $('[data-tasks]');
        if (openTasks === null) { box.innerHTML = '<p class="tf-empty">Loading tasks…</p>'; return; }
        if (openTasks === false) { box.innerHTML = '<p class="tf-empty">We couldn’t load the tasks. Go back and try again.</p>'; return; }
        if (!openTasks.length) { box.innerHTML = '<p class="tf-empty">There are no open tasks to wait on.</p>'; return; }
        box.innerHTML = openTasks.map(t => {
            const who = t.assignedTo === ctx.me ? 'Me' : t.assignedName || formatPhone(t.assignedTo || '');
            const status = t.waitingOn ? 'Waiting on “' + t.waitingOn.title + '”'
                : t.when && new Date(t.when) > new Date() ? 'Shows ' + shortWhen(t.when) : 'Current';
            return person(t.taskId, t.title, who + ' · ' + status, TASK_ICON).replace('class="tf-person-name"', 'class="tf-person-name is-wrapping"');
        }).join('');
        box.querySelectorAll('.tf-person').forEach(b => b.setAttribute('aria-pressed', String(a.contingentOn === b.dataset.value)));
    }
    function loadOpenTasks() {
        openTasks = null;
        Promise.resolve(ctx.openTasks ? ctx.openTasks() : [])
            .then(list => { openTasks = list || []; }, err => { console.error(err); openTasks = false; })
            .then(() => { if (current === 'contingent') drawTasks(); });
    }
    $('[data-tasks]').addEventListener('click', e => {
        const b = e.target.closest('.tf-person');
        if (!b) return;
        a.contingentOn = b.dataset.value;
        message.textContent = '';
        drawTasks();
    });

    // --- Day: a calendar (today on); picking a day moves on to the time ---
    let shown = new Date();
    function drawCalendar() {
        const year = shown.getFullYear(), month = shown.getMonth();
        const today = dayStart(new Date());
        $('[data-cal-title]').textContent = MONTHS[month] + ' ' + year;
        $('[data-cal-prev]').disabled = year === today.getFullYear() && month === today.getMonth();
        const first = new Date(year, month, 1).getDay();
        const days = new Date(year, month + 1, 0).getDate();
        let html = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => '<span class="tf-cal-dow">' + d + '</span>').join('');
        for (let i = 0; i < first; i++) html += '<span></span>';
        for (let d = 1; d <= days; d++) {
            const day = new Date(year, month, d);
            const on = sameDay(day, a.date);
            html += '<button type="button" class="tf-cal-day' + (sameDay(day, today) ? ' is-today' : '') + (on ? ' is-picked' : '') + '" data-day="' + d + '"'
                + (day < today ? ' disabled' : '') + (on ? ' aria-pressed="true"' : '')
                + ' aria-label="' + escapeHtml(day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) + '">' + d + '</button>';
        }
        $('[data-cal-grid]').innerHTML = html;
    }
    $('[data-cal-prev]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); drawCalendar(); });
    $('[data-cal-next]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); drawCalendar(); });
    $('[data-cal-grid]').addEventListener('click', e => {
        const b = e.target.closest('[data-day]');
        if (!b || b.disabled) return;
        a.date = new Date(shown.getFullYear(), shown.getMonth(), Number(b.dataset.day));
        // A time already gone by on that day is dropped
        if (a.time !== undefined && isPast(a.time)) a.time = undefined;
        message.textContent = '';
        drawCalendar();
        setTimeout(() => go(1), 180);
    });

    // --- Time: every 15 minutes, one tap (times already past are greyed out for today) ---
    const isPast = mins => sameDay(a.date, new Date()) && new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate(), 0, mins) <= new Date();
    function drawTimes() {
        let html = '';
        for (let m = 0; m < 1440; m += 15) {
            html += '<button type="button" class="tf-time' + (m % 60 ? '' : ' is-hour') + '" data-mins="' + m + '" aria-pressed="' + (a.time === m) + '"'
                + (isPast(m) ? ' disabled' : '') + '>' + timeLabel(m) + '</button>';
        }
        $('[data-times]').innerHTML = html;
        drawPickedTime();
    }
    const drawPickedTime = () => {
        $('[data-picked]').textContent = a.date && a.time !== undefined
            ? 'Shows up ' + a.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' at ' + timeLabel(a.time) : '';
    };
    $('[data-times]').addEventListener('click', e => {
        const b = e.target.closest('.tf-time');
        if (!b || b.disabled) return;
        a.time = Number(b.dataset.mins);
        message.textContent = '';
        $('[data-times]').querySelectorAll('.tf-time').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        drawPickedTime();
    });
    // Opens scrolled to the picked time, or else 9:00 AM (or the next hour, if that's later today)
    function scrollTimes() {
        const grid = $('[data-times]');
        let target = a.time;
        if (target === undefined) {
            target = 540;
            if (sameDay(a.date, new Date())) target = Math.max(target, Math.min(1425, (new Date().getHours() + 1) * 60));
        }
        const b = grid.querySelector('[data-mins="' + target + '"]');
        if (b) grid.scrollTop = b.offsetTop - grid.offsetTop - 8;
    }

    // --- Moving between questions ---
    const problem = (el, text) => {
        if (el) { el.classList.add('is-invalid'); el.focus({ preventScroll: true }); }
        message.textContent = text;
        return false;
    };
    // Whether the current question is answered well enough to move on (saving what was typed)
    function check(id) {
        if (id === 'type') return a.type ? true : problem(null, 'Please choose the type of task.');
        if (id === 'assigned') return a.assigned ? true : problem(null, 'Please choose who the task is for.');
        if (id === 'title') { a.title = $('#tf-title').value.trim(); return a.title ? true : problem($('#tf-title'), 'Please give the task a title.'); }
        if (id === 'description') { a.description = $('#tf-description').value.trim(); return true; }
        if (id === 'textTo') {
            if (!(a.textTo || []).length) return problem(null, 'Please choose who to text.');
            if (a.textTo.includes('other') && digitsOf($('#tf-text-other').value).length !== 10) return problem($('#tf-text-other'), 'Please enter a 10-digit phone number.');
            return true;
        }
        if (id === 'message') { a.message = $('#tf-message').value; return a.message.trim() ? true : problem($('#tf-message'), 'Please write the message.'); }
        if (id === 'callTo') {
            if (!a.callTo) return problem(null, 'Please choose who to call.');
            if (a.callTo === 'other' && digitsOf($('#tf-call-other').value).length !== 10) return problem($('#tf-call-other'), 'Please enter a 10-digit phone number.');
            return true;
        }
        if (id === 'when') return a.when ? true : problem(null, 'Please choose when it should show up.');
        if (id === 'date') return a.date ? true : problem(null, 'Please pick a day.');
        if (id === 'time') return a.time !== undefined ? true : problem(null, 'Please pick a time.');
        if (id === 'contingent') return a.contingentOn ? true : problem(null, 'Please choose the task that has to be completed first.');
        return true;
    }
    function show(id, direction) {
        current = id;
        dialog.querySelectorAll('.tf-step').forEach(s => {
            s.hidden = s.dataset.step !== id;
            s.classList.toggle('is-entering', s.dataset.step === id && direction > 0);
        });
        const list = steps();
        const n = list.indexOf(id) + 1;
        $('[data-progress]').textContent = 'Question ' + n + ' of ' + list.length;
        $('[data-bar]').style.width = Math.round((n / list.length) * 100) + '%';
        if (id === 'date') { shown = new Date((a.date || new Date()).getFullYear(), (a.date || new Date()).getMonth(), 1); drawCalendar(); }
        if (id === 'time') drawTimes();
        if (id === 'contingent') { if (openTasks === false) loadOpenTasks(); drawTasks(); }
        showFooter();
        scroller.scrollTop = 0;
        if (id === 'time') scrollTimes();
        const field = { title: '#tf-title', description: '#tf-description', message: '#tf-message' }[id];
        if (field) setTimeout(() => $(field).focus(), 60);
    }
    function showFooter() {
        const list = steps();
        const last = list.indexOf(current) === list.length - 1;
        $('[data-next-text]').textContent = last ? 'Add Task' : 'Next';
        backBtn.textContent = list.indexOf(current) === 0 ? 'Cancel' : 'Back';
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
    // Enter in a one-line box moves on (the message box keeps Enter for new lines)
    form.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); if (!saving) go(1); }
    });
    form.addEventListener('input', e => { if (e.target.classList) e.target.classList.remove('is-invalid'); message.textContent = ''; });

    async function save() {
        // Immediately or Contingent: now (it shows on their Current Tasks right away, or once the other task is completed)
        const when = a.when === 'future' ? new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate(), 0, a.time) : new Date();
        const answers = {
            type: a.type, assignedTo: a.assigned, title: a.title, description: a.description || '',
            date: isoDate(when), time: pad(when.getHours()) + ':' + pad(when.getMinutes()),
        };
        if (a.type === 'Send Text') {
            answers.textTo = a.textTo.filter(x => x !== 'other').concat(a.textTo.includes('other') ? [digitsOf($('#tf-text-other').value)] : []);
            answers.message = a.message;
        }
        if (a.type === 'Call') answers.callTo = a.callTo === 'other' ? digitsOf($('#tf-call-other').value) : a.callTo;
        if (a.when === 'contingent') answers.contingentOn = a.contingentOn;
        saving = true;
        nextBtn.disabled = true;
        nextBtn.classList.add('is-loading');
        try {
            await ctx.submit(answers);
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = 'We couldn’t add the task. Please try again.';
        } finally {
            saving = false;
            nextBtn.disabled = false;
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
            form.reset();
            dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            message.textContent = '';
            // Starts on the type, for "Me", showing up immediately
            a = { assigned: ctx.me, when: 'now' };
            loadOpenTasks();
            drawLists();
            drawChoices();
            drawPicks();
            show('type', 0);
            dialog.showModal();
            lockPageScroll(dialog);
        },
    };
}
