// Phones: keeps a pop-up that slides up from the bottom of the screen (a "sheet") above the on-screen keyboard.
// The keyboard only shrinks the visible part of the page (the browser's autofill bar on top of it is counted too), so
// a sheet pinned to the bottom ends up under it. While it's up, the sheet moves up to sit on top of it and is sized to
// what's left of the screen, gliding with the keyboard's own easing; the box being typed in is scrolled into view.
// A tap on a box starts the sheet moving right away (by the keyboard's last height, or a typical one the first time),
// so it rises with the keyboard instead of after it and the browser has no need to scroll the page; the keyboard's real
// size corrects it, and if no keyboard comes (a hardware keyboard) it settles back.
//
// fitSheetToKeyboard(dialog, { sheet, scroller }) sets a <dialog> up (once; safe to call again on every open):
//   sheet: the element whose height is capped (default: the dialog's .income-form, else the dialog itself)
//   scroller: the element that scrolls its content (default: the dialog's .dialog-scroll, else the sheet)
// keepInSheet(dialog, el, smooth) scrolls a set-up dialog so el is in view.

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const CSS = `
@media (max-width: 600px) {
    dialog.kb-fit { translate: 0 calc(-1 * var(--kb-lift, 0px)); transition: translate 0.3s ${EASE}; }
    dialog.kb-fit .kb-fit-sheet { transition: max-height 0.3s ${EASE}; }
    dialog.kb-fit.kb-fit-sheet { transition: translate 0.3s ${EASE}, max-height 0.3s ${EASE}; }
    dialog.kb-fit.is-keyboard .kb-fit-sheet, dialog.kb-fit.is-keyboard.kb-fit-sheet { max-height: calc(var(--kb-visible, 100dvh) - 10px); }
    /* (a sheet that's the dialog itself scrolls once it's capped) */
    dialog.kb-fit.is-keyboard.kb-fit-sheet { overflow-y: auto; }
}
@media (prefers-reduced-motion: reduce) { dialog.kb-fit, dialog.kb-fit .kb-fit-sheet { transition: none; } }
`;

// How a sheet fits an on-screen keyboard. layoutHeight: the page's full height (window.innerHeight, which the keyboard
// doesn't change); visibleHeight and offsetTop: the part of it showing (window.visualViewport) and how far down that part
// is, once the browser has scrolled the page to show the box being typed in (as Chrome does when a box is tapped again
// while the sheet is down at the bottom). → { up: a keyboard is showing (the visible part is over 80px shorter, more than
// any browser toolbar; however far it's scrolled), lift: how far the sheet moves up to sit on it (what the keyboard covers
// of the page's bottom, less what the scroll already brought into view) }
export function keyboardFit(layoutHeight, visibleHeight, offsetTop) {
    const up = layoutHeight - visibleHeight > 80;
    return { up, lift: up ? Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop)) : 0 };
}

const vv = typeof window !== 'undefined' ? window.visualViewport : null;
const phone = typeof window !== 'undefined' ? window.matchMedia('(max-width: 600px)') : null;
const touch = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
// Boxes that bring up the keyboard (not choices, dates, pickers or buttons)
const TYPING = 'input:not([type="radio"]):not([type="checkbox"]):not([type="date"]):not([type="file"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]), textarea';
const sheets = new Map();   // dialog -> { sheet, scroller, expecting }
let lastKeyboard = 0;       // the keyboard's height the last time it was up (0: not yet seen)

function ensureStyles() {
    if (document.getElementById('keyboard-fit-css')) return;
    const style = document.createElement('style');
    style.id = 'keyboard-fit-css';
    style.textContent = CSS;
    document.head.append(style);
}

// Scrolls the dialog's content so el is in view (a little room around it); smooth: a gentle scroll instead of a jump
export function keepInSheet(dialog, el, smooth) {
    const s = sheets.get(dialog);
    const area = s ? s.scroller : dialog;
    if (!el || !area || !area.contains(el)) return;
    const box = el.getBoundingClientRect();
    const view = area.getBoundingClientRect();
    const room = 16;
    const by = box.bottom > view.bottom - room ? Math.min(box.bottom - view.bottom + room, box.top - view.top - room)
        : box.top < view.top + room ? -(view.top + room - box.top) : 0;
    if (by) area.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
}

function setFit(dialog, up, lift, visible) {
    dialog.style.setProperty('--kb-lift', lift + 'px');
    dialog.style.setProperty('--kb-visible', Math.round(visible) + 'px');
    dialog.classList.toggle('is-keyboard', up);
}
function reset(dialog) {
    const s = sheets.get(dialog);
    if (s) { clearTimeout(s.expecting); s.expecting = null; }
    dialog.classList.remove('is-keyboard');
    dialog.style.removeProperty('--kb-lift');
    dialog.style.removeProperty('--kb-visible');
}
// Fits one open dialog to the keyboard as it is now
function fit(dialog) {
    const s = sheets.get(dialog);
    if (!s || !dialog.open || !vv) return;
    const { up, lift } = phone.matches ? keyboardFit(window.innerHeight, vv.height, vv.offsetTop) : { up: false, lift: 0 };
    // (the sheet moved up ahead of the keyboard: a resize before the keyboard arrives doesn't drop it back down)
    if (!up && s.expecting) return;
    if (up) { lastKeyboard = Math.round(window.innerHeight - vv.height); clearTimeout(s.expecting); s.expecting = null; }
    setFit(dialog, up, lift, vv.height);
    // (once the sheet has settled)
    if (up) setTimeout(() => keepInSheet(dialog, document.activeElement, true), 320);
}
const fitAll = () => sheets.forEach((s, dialog) => fit(dialog));
if (vv) { vv.addEventListener('resize', fitAll); vv.addEventListener('scroll', fitAll); }

export function fitSheetToKeyboard(dialog, opts = {}) {
    if (!dialog || !vv) return;
    if (!sheets.has(dialog)) {
        ensureStyles();
        const sheet = opts.sheet || dialog.querySelector('.income-form') || dialog;
        const scroller = opts.scroller || dialog.querySelector('.dialog-scroll') || sheet;
        sheets.set(dialog, { sheet, scroller, expecting: null });
        dialog.classList.add('kb-fit');
        sheet.classList.add('kb-fit-sheet');
        // Opening: fits the keyboard as it is; closing: back to the bottom of the screen
        new MutationObserver(() => { if (dialog.open) fit(dialog); else reset(dialog); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
        // A tap on a box: the keyboard is coming, so the sheet starts moving up now
        dialog.addEventListener('click', e => {
            const s = sheets.get(dialog);
            if (!dialog.open || !phone.matches || !touch.matches || dialog.classList.contains('is-keyboard')) return;
            if (!(e.target instanceof Element) || !e.target.matches(TYPING)) return;
            const kb = lastKeyboard || Math.round(window.innerHeight * 0.4);
            setFit(dialog, true, kb, window.innerHeight - kb);
            clearTimeout(s.expecting);
            s.expecting = setTimeout(() => { s.expecting = null; fit(dialog); }, 900);
        });
        // A box tapped while the keyboard is already up comes into view
        dialog.addEventListener('focusin', e => {
            if (!(e.target instanceof Element) || !e.target.matches(TYPING)) return;
            setTimeout(() => { if (document.activeElement === e.target && dialog.classList.contains('is-keyboard')) keepInSheet(dialog, e.target, true); }, 320);
        });
    }
    fit(dialog);
}
