// Loading screen animation (home page and pages): the text cycles through house-building phrases while
// the icon morphs from one drawing into the next. Every icon is a set of strokes; each stroke is sampled
// into the same number of points, and the points glide to the matching stroke of the next icon.
(function () {
    const STEPS = [
        { text: 'Nailing the boards...', icon: ['M2 17h20v4H2z', 'M17 12v5', 'M12 7.5 5 14.5', 'M10 3l5.5 5.5-2.5 2.5L7.5 5.5z'] },
        { text: 'Testing the wiring...', icon: ['M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z', 'M9 7v3', 'M15 7v3', 'M10.5 17.5v-1a1.5 1.5 0 0 1 3 0v1z'] },
        { text: 'Checking for leaks...', icon: ['M2 4h11a6 6 0 0 1 6 6v3', 'M2 9h10a2 2 0 0 1 2 2v2', 'M12 13h9', 'M16.5 16s-2 2.4-2 3.8a2 2 0 0 0 4 0c0-1.4-2-3.8-2-3.8z'] },
        { text: 'Approving the plans...', icon: ['M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z', 'M9 3v15', 'M15 6v15'] },
        { text: 'Installing the roof...', icon: ['M1.5 13 12 3.5 22.5 13', 'M5 14 12 7.5l7 6.5', 'M16.5 6.5V3h3v6.5'] },
        { text: 'Writing the loan...', icon: ['M2 6h20v12H2z', 'M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6z', 'M6 12h.01', 'M18 12h.01'] },
        { text: 'Sending the offer...', icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 12h8', 'M8 17.5c1-2 2-2 3 0s2 2 3 0'] },
        { text: 'Calling in a favor...', icon: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z', 'M15 2a7 7 0 0 1 7 7', 'M15 6a3 3 0 0 1 3 3'] },
        { text: 'Getting a discount...', icon: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z', 'M9 15l6-6', 'M9.5 9.5h.01', 'M14.5 14.5h.01'] },
        { text: 'Hoping for the best...', icon: ['M7 12.5h11a1 1 0 0 1 1 1V16a5 5 0 0 1-5 5h-2a6 6 0 0 1-6-6v-1.5a1 1 0 0 1 1-1z', 'M8.5 12.5 13.4 3.3a1.4 1.4 0 0 1 2.5 1.2L11.5 12.5', 'M15.5 12.5 10.6 3.3a1.4 1.4 0 0 0-2.5 1.2L12.5 12.5', 'M7 16h5'] },
    ];
    const POINTS = 80;
    const HOLD = 1300;   // ms each phrase stays up
    const MORPH = 650;   // ms for one icon to turn into the next

    const loader = document.querySelector('.page-loader');
    if (!loader) return;
    const svg = loader.querySelector('.loader-icon');
    const label = loader.querySelector('.page-loader-text');
    const badge = loader.querySelector('.loader-badge');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NS = 'http://www.w3.org/2000/svg';

    // Sample every stroke of every icon into POINTS points (measured in a hidden SVG)
    const probe = document.createElementNS(NS, 'svg');
    probe.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden');
    document.body.append(probe);
    const sample = d => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        probe.append(p);
        const len = p.getTotalLength();
        const pts = [];
        for (let i = 0; i < POINTS; i++) {
            const pt = p.getPointAtLength(len * i / (POINTS - 1));
            pts.push([pt.x, pt.y]);
        }
        p.remove();
        return pts;
    };
    const icons = STEPS.map(s => s.icon.map(sample));
    probe.remove();
    const MAX = Math.max(...icons.map(i => i.length));

    const paths = Array.from({ length: MAX }, () => {
        const p = document.createElementNS(NS, 'path');
        svg.append(p);
        return p;
    });

    const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const centroid = pts => pts.reduce((c, p) => [c[0] + p[0] / pts.length, c[1] + p[1] / pts.length], [0, 0]);
    const isClosed = pts => dist2(pts[0], pts[pts.length - 1]) < 0.25;
    const cost = (a, b) => a.reduce((sum, p, i) => sum + dist2(p, b[i]), 0);

    // Line the target stroke up with the source so points travel the shortest way
    // (closed shapes can start anywhere along their outline; any stroke can run backwards)
    function align(from, to) {
        const options = [to, to.slice().reverse()];
        if (isClosed(to)) {
            const ring = to.slice(0, -1);
            for (const dir of [ring, ring.slice().reverse()]) {
                for (let k = 0; k < ring.length; k += 2) {
                    const r = dir.slice(k).concat(dir.slice(0, k));
                    options.push(r.concat([r[0]]));
                }
            }
        }
        let best = options[0], bestCost = Infinity;
        options.forEach(o => { const c = cost(from, o); if (c < bestCost) { bestCost = c; best = o; } });
        return best;
    }
    const nearestPoint = (strokes, target) => {
        let best = strokes[0][0], bestD = Infinity;
        strokes.forEach(s => s.forEach(p => { const d = dist2(p, target); if (d < bestD) { bestD = d; best = p; } }));
        return best;
    };

    // Pair up the strokes of two icons; extra strokes grow out of (or shrink into) the nearest point of the other icon
    function plan(a, b) {
        const pairs = [];
        const left = b.map((s, i) => i);
        a.forEach(sa => {
            if (!left.length) {
                const point = nearestPoint(b, centroid(sa));
                pairs.push([sa, sa.map(() => point)]);
                return;
            }
            const ca = centroid(sa);
            left.sort((i, j) => dist2(ca, centroid(b[i])) - dist2(ca, centroid(b[j])));
            const sb = b[left.shift()];
            pairs.push([sa, align(sa, sb)]);
        });
        left.forEach(i => {
            const point = nearestPoint(a, centroid(b[i]));
            pairs.push([b[i].map(() => point), b[i]]);
        });
        return pairs;
    }

    const toD = pts => 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L');
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function draw(pairs, t) {
        paths.forEach((p, i) => {
            const pair = pairs[i];
            if (!pair) { p.setAttribute('d', ''); return; }
            p.setAttribute('d', toD(pair[0].map((q, j) => [q[0] + (pair[1][j][0] - q[0]) * t, q[1] + (pair[1][j][1] - q[1]) * t])));
        });
    }

    let index = 0;
    draw(icons[0].map(s => [s, s]), 1);
    label.textContent = STEPS[0].text;
    const running = () => document.body.classList.contains('is-checking');

    function next() {
        if (!running()) return;
        const from = icons[index];
        index = (index + 1) % STEPS.length;
        const to = icons[index];

        // Text slides out, then the new phrase slides in halfway through the morph
        label.classList.add('is-leaving');
        setTimeout(() => {
            label.textContent = STEPS[index].text;
            label.classList.remove('is-leaving');
            label.classList.remove('is-entering');
            void label.offsetWidth;
            label.classList.add('is-entering');
        }, reduceMotion ? 0 : MORPH * 0.45);

        if (reduceMotion) {
            draw(to.map(s => [s, s]), 1);
        } else {
            const pairs = plan(from, to);
            badge.classList.remove('is-morphing');
            void badge.offsetWidth; // restart the badge's pop animation
            badge.classList.add('is-morphing');
            const start = performance.now();
            (function frame(now) {
                const t = Math.min(1, (now - start) / MORPH);
                draw(pairs, ease(t));
                if (t < 1 && running()) requestAnimationFrame(frame);
            })(start);
        }
        setTimeout(next, HOLD);
    }
    // The first phrase has been on screen since the page appeared (its text is in the HTML), and each new
    // phrase only lands partway into its morph, so start the first change early enough to match the rest
    setTimeout(next, Math.max(0, HOLD - MORPH * 0.45 - performance.now()));
})();
