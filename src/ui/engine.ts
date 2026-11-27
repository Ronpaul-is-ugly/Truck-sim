// Engine tab: construction and fundamentals. Same engine instance as every other tab (window.simEngine):
// the four-stroke animation draws the truck's own cylinders (a weak cylinder shows a weak pressure trace),
// the systems panel reads the same rpm, boost, oil pressure and coolant temperature the ECM and the dash
// read, and the mystery faults set real J1939 codes. This file only draws and dispatches actions; the
// physics lives in src/engine/physics/enginemech.ts.
import './engine.css';
import {
  ENGINE_SPEC, ENGINE_CHECKS, ENGINE_COMPONENTS, ENGINE_QUIZ, ENGINE_FAULTS, displacementL, cylinderPressure, cycleForCylinder, cylinderAngle,
  strokeAt, valveLift, pistonFromTdcMm, airTempC, type SimEngine, type EngineFault, type EngineCheck, type Stroke,
} from '../engine';

declare global {
  interface Window {
    simEngine: SimEngine;
  }
}

const $ = (id: string) => document.getElementById(id)!;
const eng = () => window.simEngine;
const NS = 'http://www.w3.org/2000/svg';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fToC = (c: number) => Math.round(c * 1.8 + 32);
const STROKE_COL: Record<Stroke, string> = { intake: '#6fd3ff', compression: '#f5a623', power: '#ff3b30', exhaust: '#9a9aa3' };
const FIRING = ENGINE_SPEC.firingOrder as readonly number[];

// ---------------- UI state ----------------
const U = {
  phi: 0, // crank angle of cylinder 1
  speed: 45, // animation, crank degrees per second
  playing: true,
  cyl: 1,
  part: null as string | null,
  drill: null as null | { order: string[]; i: number; right: number; msg: string },
  quiz: { i: 0, picked: -1, right: 0, done: 0 },
  checks: [] as string[],
  instructor: new Map<string, string[]>(),
  mystery: null as null | { fault: EngineFault; ids: string[]; answered: string | null },
};

// ---------------- markup ----------------
const sec = $('sec-engine');
sec.innerHTML = `
<section class="panel" style="--c:#ff3b30">
  <h2>Four-stroke cycle · compression ignition · same truck, same engine</h2>
  <div class="egCycle">
    <svg id="egCyl" viewBox="0 0 360 600" role="img" aria-label="Animated cutaway of one cylinder"></svg>
    <div>
      <div class="egStroke" id="egStroke">Intake</div>
      <div id="egExplain" style="min-height:96px"></div>
      <div class="egRead">
        <div><span>Crank angle</span><b id="egAng">0°</b></div>
        <div><span>Piston from TDC</span><b id="egPos">0 mm</b></div>
        <div><span>Cylinder pressure</span><b id="egP">0 psi</b></div>
        <div><span>Air temperature</span><b id="egT">0 °C</b></div>
      </div>
      <div class="egCtl">
        <button id="egPlay" class="dark">Pause</button>
        <span class="seg" id="egSpeed"><button data-s="15">Slow</button><button data-s="45" class="on">Medium</button><button data-s="180">Fast</button></span>
        <button id="egBack">−10°</button><button id="egFwd">+10°</button>
        <span class="seg" id="egJump"><button data-j="90">Intake</button><button data-j="270">Compress</button><button data-j="352">Inject</button><button data-j="400">Power</button><button data-j="630">Exhaust</button></span>
      </div>
      <div class="note" id="egSpeedNote"></div>
      <svg id="egChart" viewBox="0 0 720 230" role="img" aria-label="Cylinder pressure against crank angle"></svg>
      <div class="note">Pressure in the selected cylinder over one full cycle (720°, two turns of the crank). Pick a cylinder below: they all run the same cycle, 120° apart, in firing order ${FIRING.join('-')}.</div>
      <div class="egSix" id="egSix"></div>
    </div>
  </div>
</section>
<div class="row r2">
  <section class="panel" style="--c:#f5a623">
    <h2>Engine construction · parts explorer</h2>
    <div class="egParts">
      <svg id="egPartsSvg" viewBox="0 0 560 600" role="img" aria-label="Cross-section of an inline six diesel engine, viewed from the front"></svg>
      <div class="bar"><button id="egDrill" class="dark">Identify the parts drill</button><span class="small muted" id="egDrillMsg">Click any part to see what it does, what it's made of, what gets measured and how it fails.</span></div>
      <div class="egCard" id="egPartCard"></div>
    </div>
  </section>
  <section class="panel" style="--c:#6fd3ff">
    <h2>Engine systems · live from the truck</h2>
    <div class="egSys" id="egSys"></div>
    <h2 style="margin-top:18px">Cause and effect</h2>
    <div class="egQuiz" id="egQuiz"></div>
  </section>
</div>
<div class="row r2">
  <section class="panel" style="--c:#69db7c">
    <h2>Engine shop · hands-on checks</h2>
    <div class="bar" style="flex-wrap:wrap;gap:10px;align-items:center">
      <span class="lab" style="margin:0">Key</span><span class="seg" id="egKey"><button data-k="off">Off</button><button data-k="on">On</button><button data-k="run">Run</button></span>
      <span class="seg" id="egMode"><button data-m="idle">Parked, idling</button><button data-m="hwy">Highway, loaded</button><button data-m="grade">Climbing a grade</button></span>
    </div>
    <div class="egStatus box" id="egStatus"></div>
    <div class="egChecks" id="egChecks"></div>
    <div class="egLog" id="egCheckLog" style="margin-top:8px"></div>
  </section>
  <section class="panel" style="--c:#e6e6e9">
    <h2>Mystery engine fault</h2>
    <div id="egMystery"></div>
    <details style="margin-top:14px"><summary class="small muted">Instructor: put engine faults on the truck</summary><div id="egInstr"></div></details>
    <h2 style="margin-top:18px">Specs and measurements</h2>
    <table class="egSpec" id="egSpec"></table>
    <h3 style="margin-top:12px">Displacement and compression ratio calculator</h3>
    <div class="egCalc">
      <label>Bore, mm<input id="cBore" type="number" value="${ENGINE_SPEC.boreMm}"></label>
      <label>Stroke, mm<input id="cStroke" type="number" value="${ENGINE_SPEC.strokeMm}"></label>
      <label>Cylinders<input id="cCyl" type="number" value="${ENGINE_SPEC.cylinders}"></label>
      <label>Compression ratio<input id="cCr" type="number" step="0.5" value="${ENGINE_SPEC.compressionRatio}"></label>
    </div>
    <div class="box small" id="cOut"></div>
  </section>
</div>`;

// ---------------- SVG helpers ----------------
function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
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

// ---------------- one-cylinder cutaway ----------------
const cylSvg = $('egCyl') as unknown as SVGSVGElement;
const K = 150 / ENGINE_SPEC.strokeMm; // px per mm
const CX = 180, CY = 510, R = (ENGINE_SPEC.strokeMm / 2) * K, L = ENGINE_SPEC.rodMm * K, DECK = 150, PIN = 40, TOP_TDC = 158;
// block, water jacket, head
el(cylSvg, 'rect', { x: 70, y: DECK, width: 220, height: 245, fill: '#16161b' });
el(cylSvg, 'rect', { x: 84, y: DECK + 10, width: 14, height: 170, fill: '#123048' });
el(cylSvg, 'rect', { x: 262, y: DECK + 10, width: 14, height: 170, fill: '#123048' });
el(cylSvg, 'rect', { x: 101, y: DECK, width: 158, height: 245, fill: '#0b0b0e' }); // bore
el(cylSvg, 'rect', { x: 98, y: DECK, width: 3, height: 245, fill: '#3a3a44' });
el(cylSvg, 'rect', { x: 259, y: DECK, width: 3, height: 245, fill: '#3a3a44' });
el(cylSvg, 'path', { d: `M60 ${DECK} V60 H300 V${DECK} H262 V${DECK - 6} H98 V${DECK} Z`, fill: '#1b1b21', stroke: '#33333b' });
// ports
el(cylSvg, 'path', { d: 'M0 88 H100 Q122 92 122 130 L148 130 Q146 70 100 64 H0 Z', fill: '#0f2533' });
el(cylSvg, 'path', { d: 'M360 88 H262 Q238 92 238 130 L212 130 Q214 70 262 64 H360 Z', fill: '#262628' });
txt(cylSvg, 6, 58, 'AIR IN', { fill: '#6fd3ff', 'font-size': 10 });
txt(cylSvg, 300, 58, 'EXHAUST', { fill: '#b0b0b8', 'font-size': 10 });
const gas = el(cylSvg, 'rect', { x: 101, y: DECK, width: 158, height: 10, fill: '#6fd3ff', opacity: 0.18 });
const flame = el(cylSvg, 'ellipse', { cx: CX, cy: DECK + 14, rx: 70, ry: 16, fill: '#ff7a1a', opacity: 0 });
// valves
function valve(x: number) {
  const g = el(cylSvg, 'g', {});
  el(g, 'rect', { x: x - 3, y: 40, width: 6, height: 104, fill: '#9a9aa3' });
  el(g, 'path', { d: `M${x - 22} ${DECK} L${x - 4} ${DECK - 10} H${x + 4} L${x + 22} ${DECK} Z`, fill: '#c9c9cf' });
  el(g, 'rect', { x: x - 9, y: 26, width: 18, height: 14, fill: '#5a5a63' });
  return g;
}
const vIn = valve(135), vEx = valve(225);
txt(cylSvg, 112, 20, 'INTAKE', { 'font-size': 9 });
txt(cylSvg, 205, 20, 'EXHAUST', { 'font-size': 9 });
// injector and spray
el(cylSvg, 'rect', { x: CX - 7, y: 12, width: 14, height: 128, fill: '#4b4b55', stroke: '#6a6a74' });
el(cylSvg, 'path', { d: `M${CX - 5} 140 L${CX} ${DECK - 2} L${CX + 5} 140 Z`, fill: '#6a6a74' });
txt(cylSvg, CX + 10, 10, 'INJECTOR', { 'font-size': 9, 'text-anchor': 'middle' });
const spray = el(cylSvg, 'g', { opacity: 0 });
for (const a of [-55, -28, 0, 28, 55]) {
  const r = (a * Math.PI) / 180;
  el(spray, 'line', { x1: CX, y1: DECK - 1, x2: CX + Math.sin(r) * 60, y2: DECK + Math.cos(r) * 18, stroke: '#f5e663', 'stroke-width': 2.2, 'stroke-dasharray': '3 2' });
}
// crankcase and crank
el(cylSvg, 'path', { d: `M70 ${DECK + 245} H290 L320 590 H40 Z`, fill: '#121216' });
const crankG = el(cylSvg, 'g', {});
el(crankG, 'circle', { cx: CX, cy: CY, r: 62, fill: '#24242b', stroke: '#3a3a44' });
el(crankG, 'path', { d: `M${CX - 60} ${CY + 8} A60 60 0 0 0 ${CX + 60} ${CY + 8} Z`, fill: '#33333b' }); // counterweight (opposite the pin)
el(crankG, 'circle', { cx: CX, cy: CY, r: 10, fill: '#55555f' });
const rod = el(cylSvg, 'line', { x1: CX, y1: 0, x2: CX, y2: 0, stroke: '#a8a8b2', 'stroke-width': 16, 'stroke-linecap': 'round' });
const crankPin = el(cylSvg, 'circle', { cx: CX, cy: CY, r: 13, fill: '#c9c9cf' });
const piston = el(cylSvg, 'g', {});
el(piston, 'path', { d: 'M103 0 H257 V70 H103 Z M150 0 Q180 18 210 0 Z', fill: '#b5b5be', 'fill-rule': 'evenodd' });
for (const y of [8, 15, 24]) el(piston, 'rect', { x: 103, y, width: 154, height: 3, fill: '#55555f' });
el(piston, 'circle', { cx: CX, cy: PIN, r: 9, fill: '#55555f' });
txt(cylSvg, 300, 470, 'CRANK', { 'font-size': 9 });
txt(cylSvg, 6, 470, 'ROD', { 'font-size': 9 });
const tdcMark = txt(cylSvg, 300, TOP_TDC + 4, '◄ TDC', { 'font-size': 9 });
txt(cylSvg, 300, TOP_TDC + 154, '◄ BDC', { 'font-size': 9 });
void tdcMark;
const flowIn = el(cylSvg, 'path', { d: 'M20 108 H95 l-8 -6 m8 6 l-8 6', stroke: '#6fd3ff', 'stroke-width': 3, fill: 'none', opacity: 0 });
const flowEx = el(cylSvg, 'path', { d: 'M265 108 H340 l-8 -6 m8 6 l-8 6', stroke: '#b0b0b8', 'stroke-width': 3, fill: 'none', opacity: 0 });

function drawCylinder(theta: number, p: number, cyc: ReturnType<typeof cycleForCylinder>) {
  const a = ((theta % 360) * Math.PI) / 180;
  const pinY = CY - (R * Math.cos(a) + Math.sqrt(L * L - (R * Math.sin(a)) ** 2));
  const top = pinY - PIN;
  piston.setAttribute('transform', `translate(0 ${top})`);
  const cpx = CX + R * Math.sin(a), cpy = CY - R * Math.cos(a);
  rod.setAttribute('x1', String(CX)); rod.setAttribute('y1', String(pinY));
  rod.setAttribute('x2', String(cpx)); rod.setAttribute('y2', String(cpy));
  crankPin.setAttribute('cx', String(cpx)); crankPin.setAttribute('cy', String(cpy));
  crankG.setAttribute('transform', `rotate(${theta % 360} ${CX} ${CY})`);
  const li = valveLift(theta, 'intake'), le = valveLift(theta, 'exhaust');
  vIn.setAttribute('transform', `translate(0 ${li * 18})`);
  vEx.setAttribute('transform', `translate(0 ${le * 18})`);
  flowIn.setAttribute('opacity', String(li > 0.05 ? 0.4 + 0.6 * li : 0));
  flowEx.setAttribute('opacity', String(le > 0.05 ? 0.4 + 0.6 * le : 0));
  gas.setAttribute('height', String(Math.max(2, top - DECK)));
  const st = strokeAt(theta);
  const hot = st === 'compression' ? Math.max(0, (theta - 180) / 180) : 0;
  const col = st === 'intake' ? '#6fd3ff' : st === 'compression' ? `rgb(${111 + 140 * hot},${211 - 90 * hot},${255 - 220 * hot})` : st === 'power' ? '#ff5a1a' : '#8a8a93';
  gas.setAttribute('fill', col);
  gas.setAttribute('opacity', String(st === 'power' ? 0.15 + Math.min(0.5, p / 4000) : 0.2 + 0.25 * hot));
  const inj = cyc.fuel > 0 && theta >= 360 - ENGINE_SPEC.injectionBtdc && theta < 374;
  spray.setAttribute('opacity', inj ? '1' : '0');
  const burn = cyc.fuel > 0 && theta >= 358 && theta < 440 ? Math.max(0, 1 - (theta - 366) / 74) : 0;
  flame.setAttribute('cy', String((DECK + top) / 2));
  flame.setAttribute('ry', String(Math.max(4, (top - DECK) / 2)));
  flame.setAttribute('opacity', String(Math.min(0.85, burn)));
}

// ---------------- pressure chart ----------------
const chart = $('egChart') as unknown as SVGSVGElement;
const CX0 = 44, CX1 = 712, CY0 = 205, CY1 = 14;
const xOf = (t: number) => CX0 + ((CX1 - CX0) * t) / 720;
for (const [i, s] of (['intake', 'compression', 'power', 'exhaust'] as Stroke[]).entries()) {
  el(chart, 'rect', { x: xOf(i * 180), y: CY1, width: xOf(180) - CX0, height: CY0 - CY1, fill: STROKE_COL[s], opacity: 0.05 });
  txt(chart, xOf(i * 180 + 90), 226, s.toUpperCase(), { 'text-anchor': 'middle', fill: STROKE_COL[s], 'font-size': 10 });
}
for (const t of [0, 180, 360, 540, 720]) {
  el(chart, 'line', { x1: xOf(t), y1: CY1, x2: xOf(t), y2: CY0, stroke: '#24242a' });
  txt(chart, xOf(t), CY0 + 11, t === 360 ? 'TDC 360°' : t === 0 || t === 720 ? 'TDC' : 'BDC', { 'text-anchor': 'middle', 'font-size': 9 });
}
el(chart, 'line', { x1: CX0, y1: CY0, x2: CX1, y2: CY0, stroke: '#33333b' });
const yLabels = [0, 1, 2, 3].map((i) => txt(chart, CX0 - 4, 0, '', { 'text-anchor': 'end', 'font-size': 9 }));
const yLines = [0, 1, 2, 3].map(() => el(chart, 'line', { x1: CX0, y1: 0, x2: CX1, y2: 0, stroke: '#1a1a20' }));
const trace = el(chart, 'path', { d: '', stroke: '#e6e6e9', 'stroke-width': 2, fill: 'none' });
const traceRef = el(chart, 'path', { d: '', stroke: '#69db7c', 'stroke-width': 1, fill: 'none', 'stroke-dasharray': '4 3', opacity: 0.6 });
const dot = el(chart, 'circle', { r: 5, fill: '#ff3b30' });
const chartNote = txt(chart, CX1 - 4, CY1 + 12, '', { 'text-anchor': 'end', 'font-size': 10, fill: '#c9c9cf' });
let chartKey = '';
let yMax = 1000;
const yOf = (p: number) => CY0 - ((CY0 - CY1) * p) / yMax;
function drawChart(cyc: ReturnType<typeof cycleForCylinder>, healthySeal: boolean) {
  const key = `${cyc.intakePsiA.toFixed(0)}|${cyc.sealing.toFixed(2)}|${cyc.fuel.toFixed(2)}`;
  if (key === chartKey) return;
  chartKey = key;
  const pts: number[] = [];
  for (let t = 0; t <= 720; t += 2) pts.push(cylinderPressure(t, cyc) - 14.7);
  const ref = healthySeal ? null : Array.from({ length: 361 }, (_, i) => cylinderPressure(i * 2, { ...cyc, sealing: 1 }) - 14.7);
  const peak = Math.max(...pts, ...(ref ?? []));
  yMax = Math.max(800, Math.ceil((peak * 1.1) / 500) * 500);
  const step = yMax / 4;
  yLabels.forEach((t, i) => { const v = step * (i + 1); t.setAttribute('y', String(yOf(v) + 3)); t.textContent = `${v}`; });
  yLines.forEach((l, i) => { const v = yOf(step * (i + 1)); l.setAttribute('y1', String(v)); l.setAttribute('y2', String(v)); });
  const path = (arr: number[]) => arr.map((p, i) => `${i ? 'L' : 'M'}${xOf(i * 2).toFixed(1)} ${yOf(Math.max(0, p)).toFixed(1)}`).join(' ');
  trace.setAttribute('d', path(pts));
  traceRef.setAttribute('d', ref ? path(ref) : '');
  chartNote.textContent = `psi gauge · peak ${Math.round(Math.max(...pts))} psi${ref ? ` · dashed: a healthy cylinder (${Math.round(Math.max(...ref))} psi)` : ''}`;
}

// ---------------- six cylinders ----------------
$('egSix').innerHTML = [1, 2, 3, 4, 5, 6].map((n) => `<button data-c="${n}"><i><em></em></i>#${n}<small></small></button>`).join('');
$('egSix').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-c]') as HTMLElement | null;
  if (!b) return;
  U.cyl = +b.dataset.c!;
  chartKey = '';
  frame(0);
});

const EXPLAIN: Record<Stroke, (theta: number, tC: number) => string> = {
  intake: () => `The piston moves <b>down</b> with the intake valve open, drawing in air (pushed in by the turbo when the engine is loaded). A diesel takes in <b>only air</b>: no throttle plate limits it, and there is no fuel yet. The exhaust valve closed just after TDC; for a moment both valves were open (<b>overlap</b>) to sweep the chamber clean.`,
  compression: (t, tC) => `Both valves are shut and the piston moves <b>up</b>, squeezing the air to about 1/${ENGINE_SPEC.compressionRatio} of its volume. Squeezing it heats it: <b>${Math.round(tC)} °C</b> now${t > 330 ? `, far above diesel fuel's self-ignition temperature (about 210–250 °C)` : ''}. ${t >= 360 - ENGINE_SPEC.injectionBtdc ? '<b>Injection starts</b> a few degrees before TDC: fuel at up to 2,000 bar sprays into the hot air and lights on its own. That is <b>compression ignition</b>: no spark plug.' : 'This is why a diesel needs high compression and good rings and valves: lose the squeeze and the air never gets hot enough.'}`,
  power: (t) => t < 380
    ? 'The fuel burns as it is injected and the pressure jumps. Peak pressure comes just <b>after</b> TDC, so it pushes the piston down instead of fighting it. The rod turns the push into crankshaft torque.'
    : 'Expanding gas drives the piston <b>down</b>: the only stroke that makes power. The other three are paid for by the flywheel and the other cylinders. Near the bottom the exhaust valve starts to open and the pressure blows down into the exhaust manifold.',
  exhaust: () => 'The exhaust valve is open and the piston moves <b>up</b>, pushing the burned gas out to the turbo\'s turbine, which uses that energy to drive the compressor. Near TDC the intake valve starts to open again for the next cycle.',
};

// ---------------- animation loop ----------------
let lastNow = 0;
function frame(now: number) {
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
  lastNow = now;
  if (U.playing) U.phi = (U.phi + U.speed * dt) % 720;
  const e = eng();
  if (!e || !sec.classList.contains('on')) return;
  const s = e.state;
  const theta = cylinderAngle(U.phi, U.cyl);
  const cyc = cycleForCylinder(s, U.cyl);
  const p = cylinderPressure(theta, cyc) - 14.7;
  drawCylinder(theta, p, cyc);
  drawChart(cyc, cyc.sealing > 0.97);
  dot.setAttribute('cx', String(xOf(theta)));
  dot.setAttribute('cy', String(yOf(Math.max(0, p))));
  const st = strokeAt(theta);
  const tC = airTempC(theta, s.running ? s.intakeTempC : s.ambientC, cyc.sealing);
  $('egStroke').innerHTML = `<span style="color:${STROKE_COL[st]}">${st}</span><small>cylinder ${U.cyl} · ${Math.round(theta)}° of 720°</small>`;
  $('egExplain').innerHTML = EXPLAIN[st](theta, tC);
  $('egAng').textContent = `${Math.round(theta)}°`;
  $('egPos').textContent = `${pistonFromTdcMm(theta).toFixed(0)} mm`;
  $('egP').textContent = `${Math.max(0, Math.round(p))} psi`;
  $('egT').textContent = st === 'power' && cyc.fuel > 0 && theta < 450 ? 'burning' : `${Math.round(tC)} °C`;
  document.querySelectorAll<HTMLElement>('#egSix button').forEach((b) => {
    const n = +b.dataset.c!;
    const t = cylinderAngle(U.phi, n);
    const sk = strokeAt(t);
    b.classList.toggle('on', n === U.cyl);
    const em = b.querySelector('em') as HTMLElement;
    em.style.top = `${2 + (pistonFromTdcMm(t) / ENGINE_SPEC.strokeMm) * 20}px`;
    em.style.background = STROKE_COL[sk];
    (b.querySelector('small') as HTMLElement).textContent = sk === 'power' && t < 400 ? 'FIRING' : sk;
    (b.querySelector('small') as HTMLElement).style.color = STROKE_COL[sk];
  });
  const rpm = s.rpm;
  $('egSpeedNote').innerHTML = s.running
    ? `The truck's engine is running at <b>${Math.round(rpm)} rpm</b>: a full cycle takes ${(120000 / rpm).toFixed(0)} ms and each cylinder fires ${(rpm / 120).toFixed(1)} times a second. This animation is about ${Math.round((rpm * 6) / U.speed)} times slower. Boost, fuel and the cylinder's condition come from the live truck.`
    : 'Engine stopped: the cylinder is shown being turned over without fuel (cranking), so there is compression but no combustion. Start the engine in the Engine shop below to see it fire.';
}
function loop(now: number) {
  requestAnimationFrame(loop);
  frame(now);
}
requestAnimationFrame(loop);
$('egPlay').addEventListener('click', () => {
  U.playing = !U.playing;
  $('egPlay').textContent = U.playing ? 'Pause' : 'Play';
});
$('egSpeed').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-s]') as HTMLElement | null;
  if (!b) return;
  U.speed = +b.dataset.s!;
  document.querySelectorAll('#egSpeed button').forEach((x) => x.classList.toggle('on', x === b));
});
const nudge = (d: number) => {
  U.phi = (U.phi + d + 720) % 720;
  frame(performance.now());
};
$('egBack').addEventListener('click', () => nudge(-10));
$('egFwd').addEventListener('click', () => nudge(10));
$('egJump').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-j]') as HTMLElement | null;
  if (!b) return;
  // put the selected cylinder at that angle
  const k = FIRING.indexOf(U.cyl);
  U.phi = (+b.dataset.j! + 120 * k) % 720;
  U.playing = false;
  $('egPlay').textContent = 'Play';
  frame(performance.now());
});

// ---------------- parts explorer ----------------
const ps = $('egPartsSvg') as unknown as SVGSVGElement;
const groups: Record<string, SVGGElement> = {};
function part(id: string, draw: (g: SVGGElement) => void) {
  const g = el(ps, 'g', { 'data-part': id });
  const c = ENGINE_COMPONENTS.find((x) => x.id === id)!;
  el(g, 'title', {}).textContent = c.name;
  draw(g);
  groups[id] = g;
}
const IRON = '#3a3a44', STEEL = '#9a9aa3', BRIGHT = '#c9c9cf';
part('oilPan', (g) => el(g, 'path', { d: 'M120 470 H440 L420 585 H140 Z', fill: '#2a2418', stroke: '#5a4a2a' }));
part('block', (g) => el(g, 'path', { d: 'M140 200 H420 V330 L445 470 H405 L385 330 V215 H175 V330 L155 470 H115 L140 330 Z', fill: IRON, stroke: '#4a4a55' }));
part('waterJacket', (g) => { el(g, 'rect', { x: 150, y: 212, width: 18, height: 112, fill: '#16507a' }); el(g, 'rect', { x: 392, y: 212, width: 18, height: 112, fill: '#16507a' }); el(g, 'rect', { x: 215, y: 150, width: 18, height: 22, fill: '#16507a' }); el(g, 'rect', { x: 327, y: 150, width: 18, height: 22, fill: '#16507a' }); });
part('liner', (g) => { el(g, 'rect', { x: 170, y: 200, width: 10, height: 140, fill: '#6a6a74' }); el(g, 'rect', { x: 380, y: 200, width: 10, height: 140, fill: '#6a6a74' }); });
part('rod', (g) => el(g, 'path', { d: 'M270 262 L292 262 L312 420 L284 424 Z', fill: STEEL, stroke: '#6a6a74' }));
part('piston', (g) => el(g, 'path', { d: 'M182 222 H378 V290 H182 Z M245 222 Q280 244 315 222 Z', fill: BRIGHT, 'fill-rule': 'evenodd', stroke: '#8a8a93' }));
part('rings', (g) => { for (const y of [229, 238, 249]) { el(g, 'rect', { x: 180, y, width: 16, height: 5, fill: '#e0b000' }); el(g, 'rect', { x: 364, y, width: 16, height: 5, fill: '#e0b000' }); } });
part('crankshaft', (g) => { el(g, 'circle', { cx: 280, cy: 445, r: 46, fill: '#4b4b55', stroke: '#6a6a74' }); el(g, 'path', { d: 'M236 455 A46 46 0 0 0 324 455 L300 470 H260 Z', fill: '#5a5a63' }); el(g, 'circle', { cx: 298, cy: 422, r: 15, fill: BRIGHT }); });
part('mainBearings', (g) => { el(g, 'path', { d: 'M248 445 A32 32 0 0 0 312 445', fill: 'none', stroke: '#d08a3a', 'stroke-width': 6 }); el(g, 'rect', { x: 236, y: 476, width: 88, height: 18, fill: '#55555f' }); });
part('oilPump', (g) => { el(g, 'rect', { x: 355, y: 495, width: 44, height: 26, fill: '#6a5a3a', stroke: '#8a7a4a' }); el(g, 'path', { d: 'M377 521 V568 H340', stroke: '#8a7a4a', 'stroke-width': 5, fill: 'none' }); el(g, 'rect', { x: 322, y: 562, width: 22, height: 10, fill: '#8a7a4a' }); });
part('headGasket', (g) => el(g, 'rect', { x: 140, y: 193, width: 280, height: 7, fill: '#d08a3a' }));
part('head', (g) => el(g, 'path', { d: 'M140 80 H420 V193 H140 Z', fill: '#2c2c34', stroke: '#4a4a55' }));
part('intakeManifold', (g) => { el(g, 'path', { d: 'M40 110 H140 V170 H40 Z', fill: '#1f3a4a', stroke: '#2f5a70' }); el(g, 'path', { d: 'M140 120 H200 Q235 125 238 185 H218 Q215 150 190 160 H140 Z', fill: '#16303d' }); });
part('exhaustManifold', (g) => { el(g, 'path', { d: 'M420 125 H480 V175 H420 Z', fill: '#4a3a34', stroke: '#6a4a3a' }); el(g, 'path', { d: 'M420 128 H370 Q328 132 324 185 H344 Q348 155 370 160 H420 Z', fill: '#3a2c28' }); });
part('valves', (g) => { for (const x of [228, 332]) { el(g, 'rect', { x: x - 3, y: 105, width: 6, height: 78, fill: STEEL }); el(g, 'path', { d: `M${x - 16} 192 L${x - 3} 182 H${x + 3} L${x + 16} 192 Z`, fill: BRIGHT }); } });
part('injector', (g) => { el(g, 'rect', { x: 273, y: 60, width: 14, height: 120, fill: '#5a5a66', stroke: '#7a7a86' }); el(g, 'path', { d: 'M275 180 L280 194 L285 180 Z', fill: '#7a7a86' }); });
part('commonRail', (g) => { el(g, 'rect', { x: 150, y: 52, width: 60, height: 16, rx: 8, fill: '#7a6a2a', stroke: '#b09a3a' }); el(g, 'path', { d: 'M210 60 H273', stroke: '#b09a3a', 'stroke-width': 3, fill: 'none' }); });
part('rocker', (g) => { el(g, 'path', { d: 'M222 100 L300 88 L306 98 L226 110 Z', fill: STEEL }); el(g, 'path', { d: 'M338 100 L374 92 L378 102 L340 110 Z', fill: STEEL }); });
part('camshaft', (g) => { el(g, 'circle', { cx: 380, cy: 70, r: 15, fill: '#6a6a74' }); el(g, 'ellipse', { cx: 384, cy: 82, rx: 13, ry: 19, fill: '#8a8a93', transform: 'rotate(-20 384 82)' }); });
part('valveCover', (g) => el(g, 'path', { d: 'M150 80 V40 Q150 24 168 24 H392 Q410 24 410 40 V80 Z', fill: '#2a2a2f', stroke: '#4a4a55', 'fill-opacity': 0.55 }));
part('turbo', (g) => { el(g, 'circle', { cx: 505, cy: 175, r: 32, fill: '#5a4038', stroke: '#8a5a48' }); el(g, 'circle', { cx: 505, cy: 95, r: 28, fill: '#4a5a66', stroke: '#6a8a96' }); el(g, 'rect', { x: 501, y: 120, width: 8, height: 30, fill: STEEL }); el(g, 'path', { d: 'M480 150 H470', stroke: '#8a5a48', 'stroke-width': 10 }); el(g, 'path', { d: 'M505 67 V14 H60 V108', stroke: '#2f5a70', 'stroke-width': 8, fill: 'none', 'stroke-dasharray': '2 0' }); });
txt(ps, 300, 10, 'compressed air → charge air cooler → intake', { 'text-anchor': 'middle', 'font-size': 9, fill: '#6fd3ff' });
txt(ps, 8, 596, 'Inline six, viewed from the front. Cut through one cylinder.', { 'font-size': 9 });

function showPart(id: string | null) {
  U.part = id;
  for (const [k, g] of Object.entries(groups)) {
    g.classList.toggle('sel', k === id);
  }
  const c = id ? ENGINE_COMPONENTS.find((x) => x.id === id) : null;
  $('egPartCard').innerHTML = c
    ? `<h4>${esc(c.name)} <span class="muted small" style="letter-spacing:.08em">· ${c.group}</span></h4><p>${esc(c.does)}</p><p><span class="k">Made of</span>${esc(c.madeOf)}</p><p><span class="k">Measure</span>${esc(c.measure)}</p><p><span class="k">How it fails</span>${esc(c.fails)}</p>`
    : `<p class="muted">${ENGINE_COMPONENTS.length} major components. Hover to see a name, click for the details.</p>`;
}
showPart(null);
ps.addEventListener('click', (ev) => {
  const g = (ev.target as Element).closest('[data-part]') as SVGGElement | null;
  if (!g) return;
  const id = g.dataset.part!;
  const d = U.drill;
  if (d && d.i < d.order.length) {
    const want = d.order[d.i];
    const ok = id === want;
    if (ok) d.right++;
    d.msg = ok ? `<span class="ok">Right:</span> that's the ${ENGINE_COMPONENTS.find((x) => x.id === want)!.name.toLowerCase()}.` : `<span class="bad">That's the ${ENGINE_COMPONENTS.find((x) => x.id === id)!.name.toLowerCase()}.</span> The ${ENGINE_COMPONENTS.find((x) => x.id === want)!.name.toLowerCase()} is highlighted.`;
    showPart(want);
    d.i++;
    renderDrill();
    return;
  }
  showPart(id === U.part ? null : id);
});
function renderDrill() {
  const d = U.drill;
  if (!d) {
    $('egDrillMsg').innerHTML = 'Click any part to see what it does, what it\'s made of, what gets measured and how it fails.';
    $('egDrill').textContent = 'Identify the parts drill';
    return;
  }
  if (d.i >= d.order.length) {
    $('egDrillMsg').innerHTML = `${d.msg} <b>Score: ${d.right} / ${d.order.length}.</b>`;
    $('egDrill').textContent = 'Try again';
    U.drill = null;
    return;
  }
  const want = ENGINE_COMPONENTS.find((x) => x.id === d.order[d.i])!;
  $('egDrillMsg').innerHTML = `${d.msg ? d.msg + '<br>' : ''}<b>${d.i + 1}/${d.order.length}: click the ${esc(want.name.toLowerCase())}.</b>`;
  $('egDrill').textContent = 'Stop drill';
}
$('egDrill').addEventListener('click', () => {
  if (U.drill) {
    U.drill = null;
    renderDrill();
    return;
  }
  const order = ENGINE_COMPONENTS.map((c) => c.id).sort(() => Math.random() - 0.5).slice(0, 10);
  U.drill = { order, i: 0, right: 0, msg: '' };
  showPart(null);
  renderDrill();
});

// ---------------- systems (live) ----------------
function renderSystems() {
  const s = eng().state;
  const m = s.engineMech;
  const v = (k: string, val: string) => `<div class="v"><span>${k}</span><b>${val}</b></div>`;
  const run = s.running;
  $('egSys').innerHTML = `
  <div style="--c:#6fd3ff"><h4>Air: intake, turbo, charge air</h4>
    ${v('Intake restriction', run ? `${m.intakeRestrictionInH2O.toFixed(1)} inH₂O` : '—')}
    ${v('Boost', `${(Math.max(0, s.boostKpa) * 0.145).toFixed(1)} psi`)}
    ${v('Intake manifold temp', `${fToC(s.intakeTempC)} °F`)}
    ${v('Exhaust temp', `${fToC(m.exhaustTempC)} °F`)}
    <p>Air filter → turbo compressor → charge air cooler → intake manifold → cylinders → exhaust manifold → turbine → aftertreatment.</p></div>
  <div style="--c:#f5a623"><h4>Fuel: common rail injection</h4>
    ${v('Rail pressure', `${(s.railMpa * 145).toFixed(0)} psi`)}
    ${v('Fuel rate', `${(s.fuelRateLph * 0.264).toFixed(1)} gal/h`)}
    ${v('Smoke', m.smoke)}
    <div class="small muted">Cylinder contribution 1–6</div><div class="egBars">${s.cylinderContribution.map((x, i) => `<i title="#${i + 1}: ${Math.round(x * 100)}%" style="height:${Math.max(4, x * 100)}%;background:${x < 0.5 ? '#ff6b6b' : x < 0.9 ? '#f5a623' : '#69db7c'}"></i>`).join('')}</div>
    <p>Tank → lift pump → filters → high-pressure pump → rail → injectors. The ECM sets rail pressure and injection timing.</p></div>
  <div style="--c:#d08a3a"><h4>Lubrication</h4>
    ${v('Oil pressure', `${(s.oilKpa * 0.145).toFixed(0)} psi`)}
    ${v('Blow-by', run ? `${m.blowbyCfm.toFixed(1)} cfm` : '—')}
    ${v('Engine speed', `${Math.round(s.rpm)} rpm`)}
    <p>Pan → pickup → pump → cooler → filter → main gallery → crank, rod and cam bearings, piston cooling jets, valvetrain, turbo → back to the pan.</p></div>
  <div style="--c:#3b8fd9"><h4>Cooling</h4>
    ${v('Coolant temp', `${fToC(s.coolantC)} °F`)}
    ${v('Coolant level', `${Math.round(m.coolantLevelPct)}%`)}
    ${v('Thermostat opens', `${fToC(ENGINE_SPEC.thermostatOpensC)} °F`)}
    <p>Water pump → oil cooler → block (around the liners) → head → thermostat → radiator (or bypass when cold) → pump.</p></div>`;
}

// ---------------- quiz ----------------
function renderQuiz() {
  const z = U.quiz;
  const q = ENGINE_QUIZ[z.i % ENGINE_QUIZ.length];
  $('egQuiz').innerHTML = `<div class="small muted">Question ${(z.i % ENGINE_QUIZ.length) + 1} of ${ENGINE_QUIZ.length} · ${z.right}/${z.done} right</div>
    <div style="margin-top:4px"><b>${esc(q.q)}</b></div>
    <div class="opts">${q.options.map((o, i) => `<button data-o="${i}" class="${z.picked < 0 ? '' : i === q.a ? 'right' : i === z.picked ? 'wrong' : ''}" ${z.picked >= 0 ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    ${z.picked >= 0 ? `<div class="box small">${z.picked === q.a ? '<span class="ok">Right.</span> ' : '<span class="bad">Not quite.</span> '}${esc(q.why)}</div><button id="egNextQ">Next question</button>` : ''}`;
}
$('egQuiz').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  const z = U.quiz;
  if (b.id === 'egNextQ') {
    z.i++;
    z.picked = -1;
  } else if (b.dataset.o !== undefined && z.picked < 0) {
    z.picked = +b.dataset.o;
    z.done++;
    if (z.picked === ENGINE_QUIZ[z.i % ENGINE_QUIZ.length].a) z.right++;
  }
  renderQuiz();
});
renderQuiz();

// ---------------- specs and calculator ----------------
const SP = ENGINE_SPEC;
$('egSpec').innerHTML = [
  ['Layout', SP.layout],
  ['Bore × stroke', `${SP.boreMm} × ${SP.strokeMm} mm (${(SP.boreMm / 25.4).toFixed(2)} × ${(SP.strokeMm / 25.4).toFixed(2)} in)`],
  ['Displacement', `${displacementL().toFixed(1)} L (${Math.round(displacementL() * 61.024)} in³)`],
  ['Compression ratio', `${SP.compressionRatio} : 1`],
  ['Firing order', SP.firingOrder.join('-')],
  ['Low idle / rated / governed', `${SP.lowIdleRpm} / ${SP.ratedRpm} / ${SP.governedRpm} rpm`],
  ['Valve lash (cold)', `intake ${SP.valveLashMm.intake.toFixed(2)} mm (${(SP.valveLashMm.intake / 25.4).toFixed(3)} in), exhaust ${SP.valveLashMm.exhaust.toFixed(2)} mm (${(SP.valveLashMm.exhaust / 25.4).toFixed(3)} in)`],
  ['Cranking compression', `${SP.compression.minPsi} psi minimum, within ${SP.compression.maxSpreadPct}% of the highest`],
  ['Cylinder leak-down', `under ${SP.leakdown.goodPct}% good, over ${SP.leakdown.limitPct}% find the leak`],
  ['Oil pressure (hot)', `${SP.oilPsi.idleMin} psi min at idle, ${SP.oilPsi.ratedMin} psi min at rated speed`],
  ['Intake restriction', `${SP.intakeRestriction.maxInH2O} inH₂O max at full airflow`],
  ['Thermostat', `starts to open at ${SP.thermostatOpensC} °C (${fToC(SP.thermostatOpensC)} °F)`],
].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') + '<tr><td colspan="2" class="note">Training values for this simulated engine. On a real truck, always use the OEM service information.</td></tr>';
function calc() {
  const b = +($('cBore') as HTMLInputElement).value, st = +($('cStroke') as HTMLInputElement).value;
  const n = +($('cCyl') as HTMLInputElement).value, cr = +($('cCr') as HTMLInputElement).value;
  const vd = (Math.PI / 4) * (b / 10) ** 2 * (st / 10);
  const vc = cr > 1 ? vd / (cr - 1) : NaN;
  $('cOut').innerHTML = b > 0 && st > 0 && n > 0
    ? `Swept volume per cylinder = π/4 × bore² × stroke = π/4 × ${(b / 10).toFixed(1)}² × ${(st / 10).toFixed(1)} = <b>${vd.toFixed(0)} cm³</b>.<br>
       Displacement = ${vd.toFixed(0)} × ${n} = <b>${(vd * n / 1000).toFixed(2)} L</b> (${(vd * n * 0.061024).toFixed(0)} in³).<br>
       Clearance volume = swept ÷ (CR − 1) = <b>${vc.toFixed(0)} cm³</b>: all the room the air has left at TDC.`
    : 'Enter positive numbers.';
}
document.querySelectorAll('.egCalc input').forEach((i) => i.addEventListener('input', calc));
calc();

// ---------------- engine shop ----------------
const SPN_NAME: Record<number, string> = { 100: 'oil pressure', 102: 'boost pressure', 110: 'coolant temperature', 651: 'injector cyl 1', 652: 'injector cyl 2', 653: 'injector cyl 3', 654: 'injector cyl 4', 655: 'injector cyl 5', 656: 'injector cyl 6' };
$('egChecks').innerHTML = ENGINE_CHECKS.map((c) => `<button data-c="${c.id}" title="${esc(c.how)}">${esc(c.label)}</button>`).join('') + '<button data-c="cutout" title="Scan tool: the ECM cuts each injector in turn and reports how far the engine speed drops.">Cylinder cutout (scan tool)</button>';
function logCheck(label: string, t: string) {
  U.checks.unshift(`<b>${esc(label)}</b> <span class="muted">· ${Math.round(eng().state.rpm)} rpm</span><br>${t}`);
  if (U.checks.length > 30) U.checks.pop();
  $('egCheckLog').innerHTML = U.checks.map((x) => `<div>${x}</div>`).join('');
}
$('egChecks').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-c]') as HTMLElement | null;
  if (!b) return;
  const id = b.dataset.c!;
  const e = eng();
  if (id === 'cutout') {
    const drops = e.scan.cylinderCutout();
    logCheck('Cylinder cutout', drops ? `Engine speed drop when each cylinder is cut out: ${drops.map((d, i) => `#${i + 1} ${Math.round(d)} rpm${d < 15 ? ' <b>(no change: dead)</b>' : ''}`).join(' · ')}. A healthy cylinder drops the idle about 40–50 rpm.` : 'The ECM refused: the engine has to be running.');
    return;
  }
  const c = ENGINE_CHECKS.find((x) => x.id === id)!;
  const r = e.dispatch({ type: 'engineCheck', check: id as EngineCheck });
  if (r.text && !/^(Shut|Start)/.test(r.text)) e.dispatch({ type: 'labor', what: c.label, minutes: c.minutes });
  logCheck(c.label, r.text ?? '');
});
$('egKey').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-k]') as HTMLElement | null;
  if (b) eng().dispatch({ type: 'setKey', key: b.dataset.k as 'off' | 'on' | 'run' });
});
$('egMode').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-m]') as HTMLElement | null;
  if (!b) return;
  const e = eng();
  const m = b.dataset.m!;
  if (m === 'idle') {
    e.dispatch({ type: 'setTargetSpeed', mph: 0 });
    if (e.state.speedMph < 1) e.dispatch({ type: 'setParkBrake', applied: true });
    return;
  }
  if (e.state.key !== 'run') e.dispatch({ type: 'setKey', key: 'run' });
  const r = e.dispatch({ type: 'setParkBrake', applied: false });
  if (r.text) logCheck('Park brake', r.text);
  e.dispatch({ type: 'setLoad', load: m === 'grade' ? 'grade' : 'loaded' });
  e.dispatch({ type: 'setTargetSpeed', mph: m === 'grade' ? 50 : 62 });
});
let parkWhenStopped = false;
function renderStatus() {
  const e = eng();
  const s = e.state;
  const m = s.engineMech;
  if (s.driver.setMph === 0 && s.speedMph < 0.3 && !s.driver.parkBrake && parkWhenStopped) {
    parkWhenStopped = false;
    e.dispatch({ type: 'setParkBrake', applied: true });
  }
  if (s.driver.setMph === 0 && s.speedMph > 0.3) parkWhenStopped = true;
  document.querySelectorAll<HTMLElement>('#egKey button').forEach((b) => b.classList.toggle('on', b.dataset.k === s.key));
  const mode = s.driver.setMph === 0 ? 'idle' : s.driver.load === 'grade' ? 'grade' : 'hwy';
  document.querySelectorAll<HTMLElement>('#egMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  const codes = e.module('ecm').dtcs('active');
  const oil = s.oilKpa * 0.145;
  $('egStatus').innerHTML = [
    s.running ? `ENGINE RUNNING · ${Math.round(s.rpm)} rpm · ${s.speedMph.toFixed(0)} mph · load ${Math.round(s.load * 100)}%` : s.key === 'on' ? 'KEY ON · ENGINE OFF' : s.key === 'off' ? 'KEY OFF' : 'NO START',
    `oil ${oil.toFixed(0)} psi${s.running && oil < 15 ? ' <span class="r">LOW</span>' : ''} · coolant ${fToC(s.coolantC)} °F${s.coolantC >= 102 ? ' <span class="r">HOT</span>' : ''} · level ${Math.round(m.coolantLevelPct)}% · smoke <span class="${m.smoke === 'clear' ? '' : 'w'}">${m.smoke}</span>`,
    `<span class="egCodes">ECM active codes: ${codes.length ? codes.map((d) => `<span title="${SPN_NAME[d.spn] ?? ''}">SPN ${d.spn} FMI ${d.fmi}${SPN_NAME[d.spn] ? ' · ' + SPN_NAME[d.spn] : ''}</span>`).join('') : '<span style="border-color:#33333b;color:#8a8a93">none</span>'}</span>`,
  ].join('<br>');
}

// mystery + instructor
function clearMystery() {
  if (U.mystery) for (const id of U.mystery.ids) eng().dispatch({ type: 'removeFault', id });
  U.mystery = null;
}
function newMystery() {
  clearMystery();
  const f = ENGINE_FAULTS[Math.floor(Math.random() * ENGINE_FAULTS.length)];
  const ids = f.faults.map((spec) => eng().dispatch({ type: 'injectFault', fault: spec }).faultId!);
  U.mystery = { fault: f, ids, answered: null };
  U.checks = [];
  $('egCheckLog').innerHTML = '';
  renderMystery();
}
function renderMystery() {
  const m = U.mystery;
  if (!m) {
    $('egMystery').innerHTML = `<p class="small muted">The truck gets one hidden engine problem and a driver complaint. Use the Engine shop checks, the scan tool and the gauges, then pick the cause. Every check costs shop time, so think before you pull the valve cover.</p><button id="egNew" class="dark">New mystery fault</button>`;
  } else if (!m.answered) {
    const opts = [...ENGINE_FAULTS].sort((a, b) => a.label.localeCompare(b.label));
    $('egMystery').innerHTML = `<div class="box"><b>Driver complaint:</b> ${esc(m.fault.complaint)}</div>
      <div class="bar"><select id="egAns" style="flex:1;min-width:0"><option value="">Pick the cause…</option>${opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select><button id="egSubmit">Submit</button><button id="egGiveUp">Give up</button></div>`;
  } else {
    const ok = m.answered === m.fault.id;
    const mins = eng().log.laborMinutes();
    $('egMystery').innerHTML = `<div class="box"><span class="${ok ? 'ok' : 'bad'}">${ok ? 'Correct.' : 'Not quite.'}</span> It was: <b>${esc(m.fault.label)}</b>.<br>${esc(m.fault.found)}<div class="small muted" style="margin-top:4px">Shop time logged this session: ${mins} min.</div></div><div class="bar"><button id="egNew" class="dark">Next mystery fault</button><button id="egFix">Repair the engine</button></div>`;
  }
}
$('egMystery').addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('button');
  if (!t) return;
  if (t.id === 'egNew') newMystery();
  if (t.id === 'egFix') {
    clearMystery();
    renderMystery();
  }
  if ((t.id === 'egSubmit' || t.id === 'egGiveUp') && U.mystery) {
    const v = t.id === 'egGiveUp' ? 'gave up' : ($('egAns') as HTMLSelectElement).value;
    if (!v) return;
    eng().dispatch({ type: 'submitDiagnosis', circuit: 'engine', location: v, kind: 'engine', cause: v });
    U.mystery.answered = v;
    renderMystery();
  }
});
function renderInstr() {
  $('egInstr').innerHTML = `<p class="small muted">Tick a fault to put it on the truck. It stays until you untick it or press Reset.</p>` +
    ENGINE_FAULTS.map((f) => `<label class="small" style="display:block"><input type="checkbox" data-f="${f.id}" ${U.instructor.has(f.id) ? 'checked' : ''}> ${esc(f.label)}</label>`).join('');
}
renderInstr();
$('egInstr').addEventListener('change', (ev) => {
  const cb = ev.target as HTMLInputElement;
  const id = cb.dataset.f;
  if (!id) return;
  const e = eng();
  if (cb.checked) {
    const f = ENGINE_FAULTS.find((x) => x.id === id)!;
    U.instructor.set(id, f.faults.map((spec) => e.dispatch({ type: 'injectFault', fault: spec }).faultId!));
  } else {
    for (const fid of U.instructor.get(id) ?? []) e.dispatch({ type: 'removeFault', id: fid });
    U.instructor.delete(id);
  }
});
document.getElementById('btnReset')?.addEventListener('click', () => {
  U.instructor.clear();
  U.mystery = null;
  renderInstr();
  renderMystery();
});
renderMystery();

// slower panels: 4 times a second while the tab is open
setInterval(() => {
  if (!eng() || !sec.classList.contains('on')) return;
  renderSystems();
  renderStatus();
}, 250);
