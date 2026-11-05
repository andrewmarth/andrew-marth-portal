// On phones and tablets the portal only runs as the installed app: in a regular browser tab every page is covered
// by a screen that explains how to install it, with a button for the visitor's device (Android or iPhone/iPad).
// Computers use the portal in the browser as normal. The local preview server is left open too.
(function () {
    const PREVIEW_HOST = '127.0.0.1:5175';
    const installed = ['standalone', 'fullscreen', 'minimal-ui'].some(m => matchMedia('(display-mode: ' + m + ')').matches)
        || navigator.standalone === true;
    if (installed || location.host === PREVIEW_HOST) return;

    const ua = navigator.userAgent;
    const device = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios'
        : /Android/.test(ua) ? 'android' : 'desktop';
    if (device === 'desktop') return;

    // Hide the page right away so nothing flashes before the gate is drawn
    const style = document.createElement('style');
    style.textContent = `
        html, body { overflow: hidden !important; background: #4e513e !important; }
        body > *:not(#app-gate) { display: none !important; }
        #app-gate {
            position: fixed; inset: 0; z-index: 2147483647; overflow-y: auto;
            display: flex; align-items: center; justify-content: center;
            padding: calc(env(safe-area-inset-top, 0px) + 28px) 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
            background: radial-gradient(ellipse at center, #5b5e49 0%, #4e513e 70%, #4f2d2c 140%);
            font-family: 'Familjen Grotesk', sans-serif; line-height: 1.5; color: #4f2d2c;
            -webkit-tap-highlight-color: transparent;
        }
        :where(#app-gate *) { box-sizing: border-box; margin: 0; padding: 0; }
        .ag-card {
            width: calc(100% - 6px); max-width: 420px; background: #fff;
            border: 2px solid #0E2A3B; border-radius: 24px; box-shadow: 6px 6px 0 #0E2A3B;
            padding: 32px 28px 28px; text-align: center;
            animation: ag-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes ag-rise { from { opacity: 0; transform: translateY(20px); } }
        .ag-icon { display: block; width: 84px; height: 84px; border-radius: 20px; box-shadow: 0 6px 16px rgba(79, 45, 44, 0.25); margin: 0 auto 18px; }
        .ag-eyebrow {
            display: flex; justify-content: center; align-items: center; gap: 10px; margin-bottom: 8px;
            font-size: 0.78rem; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #9a5d40;
        }
        .ag-eyebrow::before, .ag-eyebrow::after { content: ''; width: 18px; height: 2px; background: currentColor; }
        .ag-card h1 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 1.95rem; line-height: 1.1; margin-bottom: 10px; }
        .ag-lead { font-size: 1.02rem; opacity: 0.85; }
        .ag-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            width: 100%; min-height: 52px; margin-top: 22px; padding: 12px 24px;
            border: 2px solid #0E2A3B; border-radius: 999px; background: #99724b; color: #e9e2d8;
            font: bold 1.05rem 'Familjen Grotesk', sans-serif; cursor: pointer;
            box-shadow: 0 4px 10px rgba(153, 114, 75, 0.2);
            transition: background-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
        }
        @media (hover: hover) { .ag-btn:hover { background: #9a5d40; transform: translateY(-3px); box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1); } }
        .ag-btn:active { transform: scale(0.98); }
        .ag-btn:focus-visible { outline: 3px solid #c09050; outline-offset: 3px; }
        .ag-btn svg { width: 20px; height: 20px; }
        .ag-steps { display: none; list-style: none; margin-top: 20px; text-align: left; counter-reset: ag; }
        .ag-steps.is-open { display: block; animation: ag-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .ag-steps li { position: relative; padding: 10px 0 10px 44px; counter-increment: ag; font-size: 0.98rem; }
        .ag-steps li + li { border-top: 1px solid rgba(79, 45, 44, 0.12); }
        .ag-steps li::before {
            content: counter(ag); position: absolute; left: 0; top: 8px;
            width: 30px; height: 30px; border-radius: 50%; background: #4e513e; color: #e9e2d8;
            display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.9rem;
        }
        .ag-steps svg { width: 18px; height: 18px; vertical-align: -3px; margin: 0 2px; color: #0E2A3B; }
        .ag-note { margin-top: 16px; font-size: 0.85rem; opacity: 0.7; }
        @media (prefers-reduced-motion: reduce) { .ag-card, .ag-steps.is-open { animation: none; } }
    `;
    document.head.appendChild(style);

    const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
    const DOTS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-label="menu"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    const DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';

    const COPY = {
        ios: {
            button: 'Add to Home Screen',
            steps: [
                'Tap the ' + SHARE + ' Share button. In Safari it can be inside the ••• menu next to the address bar.',
                'Scroll down and tap <b>Add to Home Screen</b>.',
                'Tap <b>Add</b>, then open <b>My Homes</b> from your home screen.'
            ],
            note: 'Opened this from Instagram, Facebook or a text preview? Open the link in Safari first.'
        },
        android: {
            button: 'Install the app',
            steps: [
                'Tap the ' + DOTS + ' menu in the top corner of Chrome.',
                'Tap <b>Install app</b> or <b>Add to Home screen</b>.',
                'Tap <b>Install</b>, then open <b>My Homes</b> from your home screen.'
            ],
            note: 'Already installed? Open My Homes from your home screen or app drawer.'
        }
    }[device];

    // Android Chrome hands over a native install prompt; keep it for the button
    let installPrompt = null;
    addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
    });
    addEventListener('appinstalled', () => showInstalled());

    let gate;
    function showInstalled() {
        if (!gate) return;
        gate.querySelector('h1').textContent = 'You\'re all set';
        gate.querySelector('.ag-lead').innerHTML = 'Open <b>My Homes</b> from your home screen to sign in.';
        gate.querySelector('.ag-btn').remove();
        gate.querySelector('.ag-steps').remove();
        gate.querySelector('.ag-note').remove();
    }

    function draw() {
        gate = document.createElement('div');
        gate.id = 'app-gate';
        gate.setAttribute('role', 'dialog');
        gate.setAttribute('aria-modal', 'true');
        gate.setAttribute('aria-labelledby', 'app-gate-title');
        gate.innerHTML = '<div class="ag-card">'
            + '<img class="ag-icon" src="/icons/apple-touch-icon.png" alt="">'
            + '<p class="ag-eyebrow">My Homes</p>'
            + '<h1 id="app-gate-title">Install the app</h1>'
            + '<p class="ag-lead">Your client portal works as an app on your phone. Add it to your home screen to sign in.</p>'
            + '<button type="button" class="ag-btn">' + DOWNLOAD + '<span>' + COPY.button + '</span></button>'
            + '<ol class="ag-steps">' + COPY.steps.map(s => '<li>' + s + '</li>').join('') + '</ol>'
            + '<p class="ag-note">' + COPY.note + '</p>'
            + '</div>';
        document.body.prepend(gate);

        gate.querySelector('.ag-btn').addEventListener('click', async () => {
            if (installPrompt) {
                installPrompt.prompt();
                const choice = await installPrompt.userChoice;
                installPrompt = null;
                if (choice.outcome === 'accepted') return showInstalled();
            }
            gate.querySelector('.ag-steps').classList.add('is-open');
        });
    }

    if (document.body) draw();
    else document.addEventListener('DOMContentLoaded', draw);
})();
