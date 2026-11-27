// Companion cylinders and camshaft timing panel of the Engine tab: all six cylinders on one crankshaft
// (side view) with the companion pairs coloured, the crank and cam gears turning 2:1 with their timing
// marks, a valve timing circle and the valve lift curves. Teaches how to find TDC compression and the
// two-position valve adjustment.
import { ENGINE_SPEC, cylinderAngle, strokeAt, valveLift, pistonFromTdcMm, type Stroke } from '../engine';
import { STROKE_COL } from './engine-cycle';

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}
function txt(parent: Element, x: number, y: number, s: string, attrs: Record<string, string | number> = {}) {
  const t = el(parent, 'text', { x, y, fill: '#8a8a93', 'font-size': 11, 'font-family': 'IBM Plex Mono, monospace', ...attrs });
  t.textContent = s;
  return t;
}
const set = (e: Element, a: Record<string, string | number>) => { for (const k in a) e.setAttribute(k, String(a[k])); };
const wrap = (x: number) => ((x % 720) + 720) % 720;
const FIRING = ENGINE_SPEC.firingOrder as readonly number[];
const VT = ENGINE_SPEC.valveTiming;
/** Companion = the cylinder 360° away in the cycle (same crank throw position). */
const companion = (n: number) => FIRING[(FIRING.indexOf(n) + 3) % 6];
const PAIR_COL: Record<number, string> = { 1: '#ff6b6b', 6: '#ff6b6b', 2: '#f5a623', 5: '#f5a623', 3: '#6fd3ff', 4: '#6fd3ff' };

export function mountTiming(root: HTMLElement): void {
  root.innerHTML = `
  <h2>Companion cylinders and camshaft timing</h2>
  <div class="egTimeGrid">
    <svg id="egTime" viewBox="0 0 1000 540" role="img" aria-label="Inline six side view with crank and cam gears and a valve timing diagram"></svg>
  </div>
  <div class="egCtl">
    <button id="tPlay" class="dark">Pause</button>
    <span class="seg" id="tSpeed"><button data-s="20">Slow</button><button data-s="60" class="on">Medium</button><button data-s="240">Fast</button></span>
    <button id="tBack">◀ 5°</button><button id="tFwd">5° ▶</button>
    <span class="seg" id="tBar"><button data-b="360">Bar to #1 TDC compression</button><button data-b="0">Bar to #6 TDC compression</button><button data-b="next">+120° (next in firing order)</button></span>
  </div>
  <div class="row r2" style="margin-top:6px">
    <div class="egExplain" id="tExplain"></div>
    <div><table class="egSpec" id="tTable"></table></div>
  </div>`;

  const U = { phi: 0, speed: 60, playing: true, focus: 1 };
  const svg = root.querySelector('#egTime') as SVGSVGElement;
  const defs = el(svg, 'defs');
  const lg = el(defs, 'linearGradient', { id: 'tMetal', x1: 0, y1: 0, x2: 1, y2: 0 });
  for (const [o, c] of [[0, '#6a6b72'], [0.45, '#e8e8ec'], [1, '#5a5b62']] as const) el(lg, 'stop', { offset: o, 'stop-color': c });

  // ---------- side view of the six ----------
  const SX0 = 50, DX = 82, BW = 58, DECK = 96, R = 48, L = 120, TOP_TDC = 104, PIN = 20;
  const CY = TOP_TDC + PIN + R + L;
  txt(svg, 10, 18, 'FRONT', { 'font-size': 9 });
  txt(svg, SX0 + 5 * DX + BW + 10, 18, 'REAR · FLYWHEEL', { 'font-size': 9, 'text-anchor': 'end' });
  el(svg, 'rect', { x: SX0 - 22, y: DECK - 46, width: 5 * DX + BW + 44, height: 46, fill: '#1e1e24', stroke: '#33333b' });
  el(svg, 'rect', { x: SX0 - 22, y: DECK, width: 5 * DX + BW + 44, height: CY + R + 30 - DECK, fill: '#18181d', stroke: '#2a2a30' });
  el(svg, 'line', { x1: SX0 - 40, y1: CY, x2: SX0 + 5 * DX + BW + 40, y2: CY, stroke: '#8a8a93', 'stroke-width': 12 });
  el(svg, 'rect', { x: SX0 + 5 * DX + BW + 34, y: CY - 70, width: 16, height: 140, fill: '#3a3a44' });
  txt(svg, SX0 - 30, CY - 12, 'CRANKSHAFT', { 'font-size': 8 });
  const cyl = [1, 2, 3, 4, 5, 6].map((n, i) => {
    const x = SX0 + i * DX;
    el(svg, 'rect', { x, y: DECK, width: BW, height: 156, fill: '#0a0a0d', stroke: '#44444d' });
    const gas = el(svg, 'rect', { x: x + 1, y: DECK, width: BW - 2, height: 10, opacity: 0.25 });
    const throwG = el(svg, 'g', {});
    const web = el(throwG, 'rect', { x: x + 6, width: BW - 12, rx: 6, fill: PAIR_COL[n], opacity: 0.55 });
    const rod = el(svg, 'line', { stroke: '#a8a8b2', 'stroke-width': 9, 'stroke-linecap': 'round' });
    const piston = el(svg, 'rect', { x: x + 2, width: BW - 4, height: 36, rx: 2, fill: 'url(#tMetal)' });
    const pin = el(svg, 'circle', { r: 7, fill: PAIR_COL[n] });
    const vi = el(svg, 'rect', { x: x + 9, y: DECK - 40, width: 14, height: 36, fill: '#6fd3ff' });
    const ve = el(svg, 'rect', { x: x + BW - 23, y: DECK - 40, width: 14, height: 36, fill: '#b0b0b8' });
    txt(svg, x + 16, DECK - 44 - 2, 'I', { 'font-size': 8, 'text-anchor': 'middle', fill: '#6fd3ff' });
    txt(svg, x + BW - 16, DECK - 44 - 2, 'E', { 'font-size': 8, 'text-anchor': 'middle', fill: '#b0b0b8' });
    const num = txt(svg, x + BW / 2, CY + R + 56, `#${n}`, { 'font-size': 15, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Michroma, sans-serif' });
    const label = txt(svg, x + BW / 2, CY + R + 74, '', { 'font-size': 10, 'text-anchor': 'middle' });
    const pair = txt(svg, x + BW / 2, CY + R + 90, `pairs with #${companion(n)}`, { 'font-size': 8, 'text-anchor': 'middle', fill: PAIR_COL[n] });
    const hit = el(svg, 'rect', { x, y: DECK - 50, width: BW, height: CY + R + 100 - DECK, fill: 'transparent', style: 'cursor:pointer' });
    hit.addEventListener('click', () => { U.focus = n; lastText = ''; });
    return { n, x, gas, web, rod, piston, pin, vi, ve, label, num, pair };
  });
  const focusBox = el(svg, 'rect', { y: DECK - 52, width: BW + 12, height: CY + R + 104 - DECK, fill: 'none', stroke: '#fff', 'stroke-dasharray': '4 3', opacity: 0.5 });

  // ---------- gear train ----------
  const GX = 655, MR = 58, CR = 29, MGY = 200, CGY = MGY + MR + CR;
  const gear = (cx: number, cy: number, r: number, teeth: number, fill: string) => {
    const g = el(svg, 'g', {});
    let d = '';
    for (let i = 0; i < teeth * 2; i++) {
      const a = (Math.PI * i) / teeth, rr = i % 2 ? r - 5 : r + 3;
      const a2 = (Math.PI * (i + 1)) / teeth;
      d += `${i ? 'L' : 'M'}${(rr * Math.sin(a)).toFixed(1)} ${(-rr * Math.cos(a)).toFixed(1)} L${(rr * Math.sin(a2)).toFixed(1)} ${(-rr * Math.cos(a2)).toFixed(1)} `;
    }
    el(g, 'path', { d: d + 'Z', fill, stroke: '#55555f' });
    el(g, 'circle', { r: r * 0.35, fill: '#2a2a30', stroke: '#55555f' });
    el(g, 'circle', { cy: -(r - 12), r: 5, fill: '#fff' });
    el(g, 'path', { d: `M0 ${-(r - 22)} L-5 ${-(r - 32)} H5 Z`, fill: '#fff' });
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    return g;
  };
  const crankGear = gear(GX, CGY, CR, 18, '#5a5a63');
  const camGear = gear(GX, MGY, MR, 36, '#4a4a55');
  txt(svg, GX, CGY + CR + 18, 'CRANK GEAR', { 'font-size': 9, 'text-anchor': 'middle' });
  txt(svg, GX, MGY - MR - 18, 'CAM GEAR · 2× THE TEETH', { 'font-size': 9, 'text-anchor': 'middle' });
  txt(svg, GX, MGY - MR - 6, 'turns once per cycle', { 'font-size': 8, 'text-anchor': 'middle' });
  const markMsg = txt(svg, GX, CGY + CR + 34, '', { 'font-size': 9, 'text-anchor': 'middle' });

  // ---------- valve timing circle (for the focused cylinder) ----------
  const VX = 850, VY = 150, VR = 76;
  const pol = (deg: number, r: number) => [VX + r * Math.sin((deg * Math.PI) / 180), VY - r * Math.cos((deg * Math.PI) / 180)];
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = pol(from, r), [x2, y2] = pol(to, r);
    const span = ((to - from) % 360 + 360) % 360;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  el(svg, 'circle', { cx: VX, cy: VY, r: VR + 10, fill: '#0b0b0e', stroke: '#24242a' });
  el(svg, 'path', { d: arc(VT.intakeOpens, VT.intakeCloses, VR), stroke: '#6fd3ff', 'stroke-width': 9, fill: 'none', opacity: 0.85 });
  el(svg, 'path', { d: arc(VT.exhaustOpens - 360, VT.exhaustCloses - 360, VR - 14), stroke: '#b0b0b8', 'stroke-width': 9, fill: 'none', opacity: 0.85 });
  el(svg, 'path', { d: arc(VT.intakeOpens, VT.exhaustCloses - 720, VR + 9), stroke: '#ff6b6b', 'stroke-width': 4, fill: 'none' });
  const injA = 360 - ENGINE_SPEC.injectionBtdc;
  { const [x, y] = pol(injA, VR - 28); el(svg, 'circle', { cx: x, cy: y, r: 4, fill: '#f5e663' }); }
  txt(svg, VX, VY - VR - 16, 'TDC', { 'font-size': 9, 'text-anchor': 'middle', fill: '#69db7c' });
  txt(svg, VX, VY + VR + 22, 'BDC', { 'font-size': 9, 'text-anchor': 'middle', fill: '#69db7c' });
  for (const [deg, s, r, col] of [[VT.intakeOpens, 'IVO 15° BTDC', VR + 24, '#6fd3ff'], [VT.intakeCloses, 'IVC 35° ABDC', VR + 24, '#6fd3ff'], [VT.exhaustOpens - 360, 'EVO 40° BBDC', VR + 24, '#b0b0b8'], [VT.exhaustCloses - 720, 'EVC 15° ATDC', VR + 24, '#b0b0b8']] as const) {
    const [x, y] = pol(deg, r);
    txt(svg, x, y + 3, s, { 'font-size': 8, 'text-anchor': x < VX ? 'end' : 'start', fill: col });
  }
  txt(svg, VX + VR + 12, VY - VR + 2, 'overlap', { 'font-size': 8, fill: '#ff6b6b' });
  const needle = el(svg, 'line', { x1: VX, y1: VY, stroke: '#fff', 'stroke-width': 2.5 });
  el(svg, 'circle', { cx: VX, cy: VY, r: 5, fill: '#fff' });
  const circTitle = txt(svg, VX, VY + 30, '', { 'font-size': 9, 'text-anchor': 'middle', fill: '#c9c9cf' });
  const circTurn = txt(svg, VX, VY + 44, '', { 'font-size': 8, 'text-anchor': 'middle' });

  // ---------- lift curves (focused cylinder and its companion) ----------
  const LX0 = 740, LX1 = 990, LY0 = 520, LY1 = 370;
  const lx = (t: number) => LX0 + ((LX1 - LX0) * t) / 720;
  el(svg, 'rect', { x: LX0, y: LY1, width: LX1 - LX0, height: LY0 - LY1, fill: '#0b0b0e', stroke: '#24242a' });
  for (const t of [0, 180, 360, 540, 720]) el(svg, 'line', { x1: lx(t), x2: lx(t), y1: LY1, y2: LY0, stroke: '#1d1d23' });
  const liftLines = el(svg, 'g', {});
  const liftCursor = el(svg, 'line', { y1: LY1, y2: LY0, stroke: '#ff3b30' });
  const liftTitle = txt(svg, LX0, LY1 - 6, '', { 'font-size': 9 });
  txt(svg, lx(360), LY0 + 12, '360°', { 'font-size': 8, 'text-anchor': 'middle' });
  let liftKey = -1;
  function drawLift(n: number) {
    if (liftKey === n) return;
    liftKey = n;
    liftLines.innerHTML = '';
    const c = companion(n);
    for (const [cy, col, dash] of [[n, '#fff', ''], [c, PAIR_COL[c], '4 3']] as const) {
      const off = 120 * FIRING.indexOf(cy as number);
      for (const v of ['intake', 'exhaust'] as const) {
        let d = '';
        for (let t = 0; t <= 720; t += 4) d += `${t ? 'L' : 'M'}${lx(t).toFixed(1)} ${(LY0 - 8 - 58 * valveLift(wrap(t - off), v) - (v === 'intake' ? 70 : 0)).toFixed(1)} `;
        el(liftLines, 'path', { d, stroke: v === 'intake' ? (dash ? col : '#6fd3ff') : (dash ? col : '#b0b0b8'), 'stroke-dasharray': dash, fill: 'none', 'stroke-width': dash ? 1.2 : 2 });
      }
    }
    txt(liftLines, LX0 + 4, LY1 + 12, 'intake lift', { 'font-size': 8, fill: '#6fd3ff' });
    txt(liftLines, LX0 + 4, LY1 + 82, 'exhaust lift', { 'font-size': 8, fill: '#b0b0b8' });
    liftTitle.textContent = `Valve lift: #${n} solid, companion #${c} dashed`;
  }

  // ---------- frame ----------
  let lastText = '';
  function draw() {
    const phi = U.phi;
    const a1 = ((phi % 360) * Math.PI) / 180;
    for (const c of cyl) {
      const th = cylinderAngle(phi, c.n);
      const a = ((th % 360) * Math.PI) / 180;
      const pinY = CY - (R * Math.cos(a) + Math.sqrt(L * L - (R * Math.sin(a)) ** 2));
      const top = pinY - PIN;
      set(c.piston, { y: top });
      set(c.pin, { cx: c.x + BW / 2, cy: pinY });
      const cpy = CY - R * Math.cos(a);
      set(c.rod, { x1: c.x + BW / 2, y1: pinY, x2: c.x + BW / 2 + 0.001, y2: cpy });
      set(c.web, { y: Math.min(cpy, CY) - 8, height: Math.abs(cpy - CY) + 16 });
      const st = strokeAt(th);
      set(c.gas, { height: Math.max(2, top - DECK), fill: STROKE_COL[st] });
      const li = valveLift(th, 'intake'), le = valveLift(th, 'exhaust');
      set(c.vi, { y: DECK - 40 + 26 * li, opacity: li > 0.01 ? 1 : 0.45 });
      set(c.ve, { y: DECK - 40 + 26 * le, opacity: le > 0.01 ? 1 : 0.45 });
      const rocking = li > 0.005 && le > 0.005;
      c.label.textContent = rocking ? 'OVERLAP' : st === 'power' && th < 380 ? 'FIRING' : st.toUpperCase();
      c.label.setAttribute('fill', rocking ? '#ff6b6b' : STROKE_COL[st]);
      if (c.n === U.focus) set(focusBox, { x: c.x - 6 });
    }
    void a1;
    // gears: crank turns with phi, cam at half speed the other way; marks meet at #1 TDC compression (phi = 360)
    crankGear.setAttribute('transform', `translate(${GX} ${CGY}) rotate(${phi - 360})`);
    camGear.setAttribute('transform', `translate(${GX} ${MGY}) rotate(${180 - (phi - 360) / 2})`);
    const aligned = Math.abs(wrap(phi) - 360) < 4;
    markMsg.textContent = aligned ? 'Marks aligned: #1 TDC compression' : wrap(phi) < 4 || wrap(phi) > 716 ? 'Crank mark up, cam mark away: #6 on compression' : '';
    markMsg.setAttribute('fill', aligned ? '#69db7c' : '#f5a623');
    // circle and lift for the focused cylinder
    const th = cylinderAngle(phi, U.focus);
    const [nx, ny] = pol(th % 360, VR - 6);
    set(needle, { x2: nx, y2: ny });
    circTitle.textContent = `#${U.focus} at ${Math.round(th)}°`;
    circTurn.textContent = th < 360 ? '1st turn: intake, compression' : '2nd turn: power, exhaust';
    drawLift(U.focus);
    set(liftCursor, { x1: lx(phi), x2: lx(phi) });
    renderText();
  }

  function renderText() {
    const tdc = cyl.map((c) => ({ c, th: cylinderAngle(U.phi, c.n) }));
    const comp = tdc.find((x) => Math.abs(x.th - 360) < 6);
    const k = `${U.focus}|${comp?.c.n ?? ''}|${Math.round(U.phi / 20)}`;
    if (k === lastText) return;
    lastText = k;
    const f = U.focus, c = companion(f);
    (root.querySelector('#tExplain') as HTMLElement).innerHTML = `
      <p><b>Companion cylinders</b> share a crank throw position, so their pistons always move up and down together. In the firing order ${FIRING.join('-')}, they are the cylinders three places apart: <b style="color:${PAIR_COL[1]}">1 &amp; 6</b>, <b style="color:${PAIR_COL[2]}">2 &amp; 5</b>, <b style="color:${PAIR_COL[3]}">3 &amp; 4</b>. They are <b>360° apart in the cycle</b>: when #${f} is at TDC compression (both valves closed, about to fire), #${c} is at TDC overlap (exhaust closing, intake opening, the rockers "rocking").</p>
      <p><b>Camshaft timing:</b> the cam turns once for every two crank turns (the cam gear has twice the teeth), so each valve opens once per cycle. The timing marks line up only at #1 TDC compression. The crank mark alone comes up every revolution, which is why the mark at the damper can't tell you whether #1 or #6 is on compression.</p>
      <p><b>Finding TDC compression on #1:</b> bar the engine to the TDC mark. If #1's rockers are both loose (valves closed) it is on compression. If #1's rockers are rocking, #6 is on compression: turn the crank one more full revolution. On a typical inline six you then set half the valves, turn 360° and set the rest (the two-position method).</p>
      <p class="note">Click a cylinder in the drawing to follow it on the timing circle.</p>`;
    (root.querySelector('#tTable') as HTMLElement).innerHTML = '<tr><td>Cylinder</td><td>Stroke now · valves</td></tr>' + tdc.map(({ c, th }) => {
      const li = valveLift(th, 'intake'), le = valveLift(th, 'exhaust');
      const v = li > 0.005 && le > 0.005 ? 'both open (rocking)' : li > 0.005 ? 'intake open' : le > 0.005 ? 'exhaust open' : 'both closed';
      return `<tr><td><b style="color:${PAIR_COL[c.n]}">#${c.n}</b> <span class="muted small">(with #${companion(c.n)})</span></td><td>${strokeAt(th) as Stroke} · ${v} · ${pistonFromTdcMm(th).toFixed(0)} mm from TDC</td></tr>`;
    }).join('');
  }

  let lastNow = 0;
  function step(now: number) {
    requestAnimationFrame(step);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (!root.offsetParent) return;
    if (U.playing) U.phi = wrap(U.phi + U.speed * dt);
    draw();
  }
  requestAnimationFrame(step);

  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const setPlaying = (p: boolean) => { U.playing = p; q('#tPlay').textContent = p ? 'Pause' : 'Play'; };
  q('#tPlay').addEventListener('click', () => setPlaying(!U.playing));
  q('#tSpeed').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-s]') as HTMLElement | null;
    if (!b) return;
    U.speed = +b.dataset.s!;
    root.querySelectorAll('#tSpeed button').forEach((x) => x.classList.toggle('on', x === b));
  });
  q('#tBack').addEventListener('click', () => { setPlaying(false); U.phi = wrap(U.phi - 5); draw(); });
  q('#tFwd').addEventListener('click', () => { setPlaying(false); U.phi = wrap(U.phi + 5); draw(); });
  q('#tBar').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-b]') as HTMLElement | null;
    if (!b) return;
    setPlaying(false);
    U.phi = b.dataset.b === 'next' ? wrap(Math.round(U.phi / 120) * 120 + 120) : +b.dataset.b!;
    if (b.dataset.b === '360') U.focus = 1;
    if (b.dataset.b === '0') U.focus = 6;
    lastText = '';
    draw();
  });
}
