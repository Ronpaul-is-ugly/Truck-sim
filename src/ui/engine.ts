// Engine tab: construction and fundamentals. Same engine instance as every other tab (window.simEngine):
// the four-stroke animation draws the truck's own cylinders (a weak cylinder shows a weak pressure trace),
// the systems panel reads the same rpm, boost, oil pressure and coolant temperature the ECM and the dash
// read, and the mystery faults set real J1939 codes. This file only draws and dispatches actions; the
// physics lives in src/engine/physics/enginemech.ts.
import './engine.css';
import { mountCycle } from './engine-cycle';
import { mountTiming } from './engine-timing';
import { mountTeardown } from './engine-teardown';
import { mountPhysics } from './engine-physics';
import { mountSystems } from './engine-systems';
import { detailHTML } from './engine-detail';
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
<nav class="egJump" id="egJump"><span>On this page</span>
  <a href="#eg-teardown">Teardown</a><a href="#eg-physics">Basic physics</a><a href="#eg-systems">Engine systems</a><a href="#egCyclePanel">Four-stroke cycle</a><a href="#egTimingPanel">Timing</a><a href="#eg-parts">Parts &amp; systems</a><a href="#eg-shop">Engine shop</a>
</nav>
<section class="panel" style="--c:#e6e6e9" id="eg-teardown"></section>
<section class="panel" style="--c:#69db7c" id="eg-physics"></section>
<section class="panel" style="--c:#6fd3ff" id="eg-systems"></section>
<section class="panel" style="--c:#ff3b30" id="egCyclePanel"></section>
<section class="panel" style="--c:#b07aff" id="egTimingPanel"></section>
<div class="row r2" id="eg-parts">
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
<div class="row r2" id="eg-shop">
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

// ---------------- four-stroke cycle and companion / cam timing ----------------
$('egJump').addEventListener('click', (ev) => {
  const a = (ev.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
  if (!a) return;
  ev.preventDefault();
  document.getElementById(a.getAttribute('href')!.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
mountTeardown($('eg-teardown'));
mountPhysics($('eg-physics'));
mountSystems($('eg-systems'));
mountCycle($('egCyclePanel'));
mountTiming($('egTimingPanel'));

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

function partHTML(id: string | null, hint: string) {
  const c = id ? ENGINE_COMPONENTS.find((x) => x.id === id) : null;
  return c
    ? `<h4>${esc(c.name)} <span class="muted small" style="letter-spacing:.08em">· ${c.group}</span></h4><div class="egDetail">${detailHTML(c.id, esc) || `<p>${esc(c.does)}</p>`}</div><p><span class="k">Made of</span>${esc(c.madeOf)}</p><p><span class="k">Measure</span>${esc(c.measure)}</p><p><span class="k">How it fails</span>${esc(c.fails)}</p>`
    : `<p class="muted">${hint}</p>`;
}
function showPart(id: string | null) {
  U.part = id;
  for (const [k, g] of Object.entries(groups)) {
    g.classList.toggle('sel', k === id);
  }
  $('egPartCard').innerHTML = partHTML(id, `${ENGINE_COMPONENTS.length} major components. Hover to see a name, click for the details.`);
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
  const order = ENGINE_COMPONENTS.map((c) => c.id).filter((id) => groups[id]).sort(() => Math.random() - 0.5).slice(0, 10);
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
