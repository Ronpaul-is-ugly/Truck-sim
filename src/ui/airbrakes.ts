// Air brakes tab. Same engine instance as every other tab (window.simEngine): the compressor turns with
// the engine, the dash gauges are the cluster's pressure sensors, and the codes go out on the J1939 bus.
// This file only draws and dispatches actions; the physics lives in src/engine/physics/airbrakes.ts.
import THREE from './three-global';
import { AIR_CHECKS, AIR_FAULTS, AIR_SPEC, AIR_TESTS, WHEEL_IDS, type SimEngine, type Wheel, type AirCheck, type AirFault } from '../engine';

declare global {
  interface Window {
    simEngine: SimEngine;
  }
}

const $ = (id: string) => document.getElementById(id)!;
const eng = () => window.simEngine;
const NS = 'http://www.w3.org/2000/svg';
const fmtT = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------------- UI state ----------------
const U = {
  fanUntil: -1,
  fanCount: 0,
  hold: false,
  parkWhenStopped: false,
  sw: { running: false, startMs: 0, accMs: 0 },
  marks: [] as string[],
  events: [] as string[],
  checks: [] as string[],
  instructor: new Map<string, string[]>(),
  mystery: null as null | { fault: AirFault; ids: string[]; answered: string | null },
  openTest: 'buildup' as string,
  last: { loaded: null as boolean | null, lowAir: false, park: false, purging: false },
};

// ---------------- markup ----------------
const sec = $('sec-air');
sec.innerHTML = `
<section class="panel" style="--c:#69db7c">
  <h2>Air brake system · same truck, same engine</h2>
  <div class="abGrid">
    <div><svg id="abSvg" viewBox="0 0 1000 560" role="img" aria-label="Air brake system schematic"></svg>
      <p class="note">Line brightness follows pressure. <span style="color:#6fd3ff">Blue</span> supply · <span style="color:#69db7c">green</span> primary (rear) · <span style="color:#ff6b6b">red</span> secondary (front) · <span style="color:#f5a623">amber</span> spring brake hold-off. The compressor is gear-driven: it only pumps with the engine running, and faster at higher rpm.</p></div>
    <div class="abDash">
      <div class="lab">Dash air gauge</div>
      <svg id="abGauge" viewBox="0 0 220 200"></svg>
      <div class="abLamps"><div class="lamp red" id="abLow">LOW AIR</div><div class="lamp red" id="abPark">PARK</div></div>
      <div class="lab">Key switch</div>
      <span class="seg" id="abKey"><button data-k="off">Off</button><button data-k="on">On</button><button data-k="run">Run</button></span>
      <div class="lab" style="margin-top:12px">Park control valve</div>
      <button id="abKnob" class="abKnob">◆ Pull · set</button>
      <div class="small muted" id="abKnobMsg"></div>
      <div class="lab" style="margin-top:12px">Brake pedal <b id="abPedalV">0%</b></div>
      <input type="range" id="abPedal" min="0" max="100" step="1" value="0">
      <div class="bar" style="margin-top:6px"><button id="abFan">Fan once</button><button id="abFan5">Fan ×5</button><button id="abHold">Hold full</button></div>
      <div class="bar" style="margin-top:8px"><button id="abParkHere" title="Slow to a stop and set the parking brake">Pull over &amp; park</button></div>
    </div>
  </div>
  <div class="status" id="abStatus"></div>
</section>
<section class="panel" style="--c:#6fd3ff">
  <h2>The air system on the truck · 3D</h2>
  <div class="v3wrap">
    <div><div class="v3box" id="ab3d"></div>
      <p class="note" style="margin:6px 0 0">The same truck chassis and MX-13 engine the multimeter uses, with the air system on it. Lines glow with pressure: <span style="color:#6fd3ff">supply</span>, <span style="color:#69db7c">primary</span>, <span style="color:#ff6b6b">secondary</span>, <span style="color:#f5a623">spring hold-off</span>. Pushrods move with the pedal; travel is drawn twice its real size.</p></div>
    <div>
      <div class="bar" style="flex-wrap:wrap"><button id="ab3Home">Reset view</button><button id="ab3Wheel">Look at a rear wheel end</button></div>
      <div class="v3chips" id="ab3Chips"></div>
      <div class="egCard" id="ab3Card"></div>
      <div class="egRead" id="ab3Read" style="grid-template-columns:repeat(2,1fr)"></div>
    </div>
  </div>
</section>
<div class="row r2">
  <section class="panel" style="--c:#f5a623">
    <h2>Air brake check · stopwatch and observations</h2>
    <div class="abSw"><div class="lcd"><span>STOPWATCH (sim time)</span><span id="abSwT" class="mono" style="font-size:28px;color:#b8ffcf">0:00.0</span></div>
      <div class="bar"><button id="abSwGo">Start</button><button id="abSwMark">Mark gauges</button><button id="abSwReset">Reset</button></div></div>
    <div id="abMarks" class="abLog"></div>
    <div id="abTests"></div>
    <h3 style="margin-top:12px">What you noticed (dash, ears, knob)</h3>
    <div id="abEvents" class="abLog"></div>
  </section>
  <section class="panel" style="--c:#6fd3ff">
    <h2>Hands-on checks</h2>
    <div class="bar" id="abChecks"></div>
    <div id="abCheckLog" class="abLog" style="margin-top:8px"></div>
    <h2 style="margin-top:18px">Mystery air fault</h2>
    <div id="abMystery"></div>
    <details style="margin-top:14px"><summary class="small muted">Instructor: put air faults on the truck</summary><div id="abInstr"></div></details>
  </section>
</div>`;

// ---------------- schematic ----------------
const svg = $('abSvg') as unknown as SVGSVGElement;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}
function text(x: number, y: number, s: string, attrs: Record<string, string | number> = {}, parent: Element = svg) {
  const t = el('text', { x, y, fill: '#c9c9cf', 'font-size': 13, 'font-family': 'IBM Plex Mono, monospace', ...attrs }, parent);
  t.textContent = s;
  return t;
}
const COL = { sup: '#6fd3ff', pri: '#69db7c', sec: '#ff6b6b', hold: '#f5a623' };
type LineKey = 'comp' | 'sup' | 'supPri' | 'supSec' | 'priFoot' | 'secFoot' | 'appFront' | 'appRear' | 'relayRear' | 'park' | 'hold';
const lines = {} as Record<LineKey, SVGPathElement>;
function line(k: LineKey, d: string, col: string, dash = '') {
  lines[k] = el('path', { d, stroke: col, 'stroke-width': 4, fill: 'none', 'stroke-dasharray': dash, 'stroke-linejoin': 'round' });
}
function tank(x: number, y: number, label: string, col: string) {
  el('rect', { x, y, width: 170, height: 52, rx: 26, fill: '#0e0e12', stroke: col, 'stroke-width': 2 });
  const fill = el('rect', { x: x + 4, y: y + 4, width: 0, height: 44, rx: 22, fill: col, opacity: 0.25 });
  text(x + 85, y - 8, label, { 'text-anchor': 'middle', 'font-size': 11, fill: col });
  const v = text(x + 85, y + 33, '-- psi', { 'text-anchor': 'middle', 'font-size': 17, fill: '#fff' });
  return { fill, v };
}
function check(x: number, y: number) {
  el('circle', { cx: x, cy: y, r: 9, fill: '#000', stroke: '#8a8a93', 'stroke-width': 2 });
  text(x, y + 4, '▸', { 'text-anchor': 'middle', 'font-size': 11, fill: '#8a8a93' });
}

// supply side
el('rect', { x: 20, y: 40, width: 120, height: 80, fill: '#111115', stroke: '#33333b' });
text(80, 66, 'ENGINE', { 'text-anchor': 'middle', 'font-size': 11, fill: '#8a8a93' });
const tRpm = text(80, 94, '0 rpm', { 'text-anchor': 'middle', 'font-size': 15, fill: '#fff' });
el('rect', { x: 170, y: 55, width: 100, height: 52, fill: '#111115', stroke: '#33333b' });
text(220, 50, 'COMPRESSOR', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' });
const tComp = text(220, 78, 'UNLOADED', { 'text-anchor': 'middle', 'font-size': 12 });
const tScfm = text(220, 97, '0.0 scfm', { 'text-anchor': 'middle', 'font-size': 12, fill: '#8a8a93' });
el('line', { x1: 140, y1: 80, x2: 170, y2: 80, stroke: '#555', 'stroke-width': 6, 'stroke-dasharray': '3 3' });
el('rect', { x: 175, y: 6, width: 90, height: 28, fill: '#0e0e12', stroke: '#33333b' });
const tGov = text(220, 25, 'GOV 125', { 'text-anchor': 'middle', 'font-size': 11, fill: '#8a8a93' });
el('rect', { x: 300, y: 48, width: 50, height: 66, rx: 8, fill: '#111115', stroke: '#33333b' });
text(325, 40, 'DRYER', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' });
const purge = el('g', { opacity: 0 });
for (let i = 0; i < 3; i++) el('circle', { cx: 316 + i * 9, cy: 128 + (i % 2) * 8, r: 5, fill: '#e6e6e9', opacity: 0.6 }, purge);
text(325, 152, 'PURGE', { 'text-anchor': 'middle', 'font-size': 10, fill: '#e6e6e9' }, purge);
line('comp', 'M270 80 H300', COL.sup);
line('sup', 'M350 80 H400', COL.sup);
const tSup = tank(400, 54, 'SUPPLY (WET) TANK', COL.sup);

// primary / secondary
line('supPri', 'M485 106 V200', COL.sup);
check(485, 150);
const tPri = tank(400, 200, 'PRIMARY · REAR CIRCUIT', COL.pri);
line('supSec', 'M570 80 H805 V200', COL.sup);
check(650, 80);
const tSec = tank(650, 200, 'SECONDARY · FRONT CIRCUIT', COL.sec);

// foot valve and park valve
el('rect', { x: 560, y: 300, width: 80, height: 56, fill: '#111115', stroke: '#33333b' });
text(600, 293, 'FOOT VALVE', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' });
const tFoot = text(600, 333, '0 / 0', { 'text-anchor': 'middle', 'font-size': 12 });
line('priFoot', 'M485 252 V320 H560', COL.pri);
line('secFoot', 'M700 252 V320 H640', COL.sec);
const knob = el('rect', { x: 828, y: 298, width: 40, height: 40, fill: '#f5c518', stroke: '#000', transform: 'rotate(45 848 318)' });
text(848, 280, 'PARK VALVE', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' });
const tKnob = text(848, 362, 'IN', { 'text-anchor': 'middle', 'font-size': 11, fill: '#f5c518' });
line('park', 'M770 252 V318 H818', COL.hold, '6 4');
text(780, 290, 'dbl check', { 'font-size': 9, fill: '#8a8a93' });

// chassis plan view
el('rect', { x: 60, y: 400, width: 900, height: 150, fill: 'none', stroke: '#24242a', 'stroke-dasharray': '4 6' });
text(70, 418, 'FRONT', { 'font-size': 10, fill: '#8a8a93' });
text(950, 418, 'REAR', { 'font-size': 10, fill: '#8a8a93', 'text-anchor': 'end' });
el('line', { x1: 150, y1: 410, x2: 150, y2: 540, stroke: '#33333b', 'stroke-width': 6 });
el('line', { x1: 860, y1: 410, x2: 860, y2: 540, stroke: '#33333b', 'stroke-width': 6 });
line('appFront', 'M560 340 H250 V430 M250 430 V520', COL.sec);
line('appRear', 'M640 340 H700 V475', COL.pri);
el('rect', { x: 680, y: 460, width: 44, height: 30, fill: '#111115', stroke: '#33333b' });
text(702, 505, 'RELAY', { 'text-anchor': 'middle', 'font-size': 9, fill: '#8a8a93' });
line('relayRear', 'M724 475 H760 V430 M760 475 V520', COL.pri);
line('hold', 'M868 318 H915 V440 M915 440 V505', COL.hold, '6 4');
const chamber: Record<Wheel, { rod: SVGLineElement; p: SVGTextElement; s: SVGTextElement; bar: SVGRectElement }> = {} as never;
const CH_POS: Record<Wheel, [number, number, boolean]> = { lf: [210, 430, false], rf: [210, 520, false], lr: [780, 430, true], rr: [780, 520, true] };
for (const w of WHEEL_IDS) {
  const [x, y, rear] = CH_POS[w];
  el('rect', { x: x, y: y - 14, width: rear ? 70 : 40, height: 28, rx: 6, fill: '#111115', stroke: rear ? COL.pri : COL.sec });
  if (rear) el('rect', { x: x + 40, y: y - 14, width: 30, height: 28, rx: 6, fill: '#1a1408', stroke: COL.hold });
  const rod = el('line', { x1: x, y1: y, x2: x - 20, y2: y, stroke: '#e6e6e9', 'stroke-width': 3 });
  const p = text(rear ? x + 35 : x + 20, y - 20, '0 psi', { 'text-anchor': 'middle', 'font-size': 11 });
  const s = text(rear ? x - 6 : x - 6, y + 28, '', { 'text-anchor': 'end', 'font-size': 10, fill: '#8a8a93' });
  el('rect', { x: rear ? x + 82 : x - 60, y: y - 4, width: 40, height: 8, fill: '#1c1c22' });
  const bar = el('rect', { x: rear ? x + 82 : x - 60, y: y - 4, width: 0, height: 8, fill: '#e6e6e9' });
  chamber[w] = { rod, p, s, bar };
  text(rear ? x + 102 : x - 40, y - 8, w.toUpperCase(), { 'text-anchor': 'middle', 'font-size': 9, fill: '#8a8a93' });
}
text(500, 545, 'Pushrod travel shown at each chamber · bar = braking force at that wheel', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' });

// dash gauge
const gauge = $('abGauge') as unknown as SVGSVGElement;
const ang = (psi: number) => -225 + (Math.max(0, Math.min(150, psi)) / 150) * 270;
for (let p = 0; p <= 150; p += 10) {
  const a = (ang(p) * Math.PI) / 180;
  const r1 = p % 30 === 0 ? 72 : 78;
  el('line', { x1: 110 + r1 * Math.cos(a), y1: 105 + r1 * Math.sin(a), x2: 110 + 86 * Math.cos(a), y2: 105 + 86 * Math.sin(a), stroke: p <= 60 ? '#ff3b30' : '#8a8a93', 'stroke-width': p % 30 === 0 ? 2 : 1 }, gauge);
  if (p % 30 === 0) text(110 + 58 * Math.cos(a), 109 + 58 * Math.sin(a), String(p), { 'text-anchor': 'middle', 'font-size': 11, fill: '#c9c9cf' }, gauge);
}
const needle = (col: string) => el('line', { x1: 110, y1: 105, x2: 110, y2: 30, stroke: col, 'stroke-width': 3, 'stroke-linecap': 'round' }, gauge);
const nSec = needle(COL.sec);
const nPri = needle(COL.pri);
el('circle', { cx: 110, cy: 105, r: 6, fill: '#e6e6e9' }, gauge);
const gTxt = text(110, 160, '', { 'text-anchor': 'middle', 'font-size': 12 }, gauge);
text(110, 182, 'PSI', { 'text-anchor': 'middle', 'font-size': 10, fill: '#8a8a93' }, gauge);

// ---------------- controls ----------------
function setPedal(pct: number) {
  const e = eng();
  if (Math.round(e.state.driver.brakePedalPct) !== Math.round(pct)) e.dispatch({ type: 'setBrakePedal', pct });
}
$('abKey').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-k]') as HTMLButtonElement | null;
  if (b) {
    const k = b.dataset.k as 'off' | 'on' | 'run';
    // the Vehicle control panel owns the key: click its button so both panels stay in step
    (document.querySelector(`#keySeg button[data-k="${k}"]`) as HTMLButtonElement | null)?.click();
  }
});
$('abKnob').addEventListener('click', () => {
  const e = eng();
  const r = e.dispatch({ type: 'setParkBrake', applied: !e.state.driver.parkBrake });
  $('abKnobMsg').textContent = r.text ?? '';
});
const pedal = $('abPedal') as HTMLInputElement;
pedal.addEventListener('input', () => {
  U.hold = false;
  setPedal(+pedal.value);
});
function fan(n: number) {
  U.fanCount += n;
  U.hold = false;
}
$('abFan').addEventListener('click', () => fan(1));
$('abFan5').addEventListener('click', () => fan(5));
$('abHold').addEventListener('click', () => {
  U.hold = !U.hold;
  U.fanCount = 0;
  setPedal(U.hold ? 100 : 0);
});
$('abParkHere').addEventListener('click', () => {
  const e = eng();
  if (e.state.speedMph > 0.5) {
    e.dispatch({ type: 'setTargetSpeed', mph: 0 });
    const sl = document.getElementById('mphSlider') as HTMLInputElement | null;
    if (sl) sl.value = '0';
    U.parkWhenStopped = true;
  } else if (!e.state.driver.parkBrake) e.dispatch({ type: 'setParkBrake', applied: true });
});
$('abSwGo').addEventListener('click', () => {
  const t = eng().timeMs;
  if (U.sw.running) U.sw.accMs += t - U.sw.startMs;
  else U.sw.startMs = t;
  U.sw.running = !U.sw.running;
  ($('abSwGo') as HTMLButtonElement).textContent = U.sw.running ? 'Stop' : 'Start';
});
$('abSwReset').addEventListener('click', () => {
  U.sw = { running: false, startMs: 0, accMs: 0 };
  U.marks = [];
  ($('abSwGo') as HTMLButtonElement).textContent = 'Start';
});
const swMs = () => U.sw.accMs + (U.sw.running ? eng().timeMs - U.sw.startMs : 0);
const dashAir = () => eng().module('clu').display()?.air ?? null;
const dashStr = () => {
  const a = dashAir();
  return a ? `primary ${a.primaryPsi} · secondary ${a.secondaryPsi} psi` : 'gauges dark (key off)';
};
$('abSwMark').addEventListener('click', () => {
  U.marks.unshift(`${fmtT(swMs())} · ${dashStr()}`);
  renderLogs();
});

// checks
$('abChecks').innerHTML = AIR_CHECKS.map((c) => `<button data-c="${c.id}">${esc(c.label)}</button>`).join('');
$('abChecks').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-c]') as HTMLButtonElement | null;
  if (!b) return;
  const id = b.dataset.c as AirCheck;
  const c = AIR_CHECKS.find((x) => x.id === id)!;
  const e = eng();
  e.dispatch({ type: 'labor', what: id, minutes: c.minutes });
  const r = e.dispatch({ type: 'airCheck', check: id });
  U.checks.unshift(`<b>${esc(c.label)}</b> (${c.minutes} min): ${r.text ?? ''}`);
  renderLogs();
});

// test cards
function setupFor(id: string) {
  const e = eng();
  const key = (k: 'off' | 'on' | 'run') => {
    if (e.state.key !== k) (document.querySelector(`#keySeg button[data-k="${k}"]`) as HTMLButtonElement | null)?.click();
  };
  U.hold = false;
  U.fanCount = 0;
  setPedal(0);
  if (e.state.speedMph > 0.5) $('abParkHere').click();
  if (id === 'buildup' || id === 'governor') {
    key('run');
    if (!e.state.driver.parkBrake && e.state.speedMph <= 0.5) e.dispatch({ type: 'setParkBrake', applied: true });
  } else {
    key('on');
    const r = e.dispatch({ type: 'setParkBrake', applied: false });
    $('abKnobMsg').textContent = r.text ?? '';
    if (id === 'applied' || id === 'stroke') {
      U.hold = true;
      setPedal(100);
    }
  }
}
function renderTests() {
  $('abTests').innerHTML = AIR_TESTS.map(
    (t) => `<details class="abTest" data-t="${t.id}" ${U.openTest === t.id ? 'open' : ''}><summary>${esc(t.title)}</summary>
    <div class="small"><b>Setup:</b> ${esc(t.setup)} <button data-setup="${t.id}" style="padding:2px 8px;font-size:10px">Set up the truck</button></div>
    <ol class="small">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="small box" style="margin:4px 0"><b>Spec:</b> ${esc(t.spec)}</div></details>`,
  ).join('');
}
renderTests();
$('abTests').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-setup]') as HTMLButtonElement | null;
  if (b) setupFor(b.dataset.setup!);
});
$('abTests').addEventListener('toggle', (ev) => {
  const d = ev.target as HTMLDetailsElement;
  if (d.open) U.openTest = d.dataset.t!;
}, true);

// mystery + instructor
function clearMystery() {
  if (U.mystery) for (const id of U.mystery.ids) eng().dispatch({ type: 'removeFault', id });
  U.mystery = null;
}
function newMystery() {
  clearMystery();
  const f = AIR_FAULTS[Math.floor(Math.random() * AIR_FAULTS.length)];
  const ids = f.faults.map((spec) => eng().dispatch({ type: 'injectFault', fault: spec }).faultId!);
  U.mystery = { fault: f, ids, answered: null };
  U.checks = [];
  U.events = [];
  renderMystery();
  renderLogs();
}
function renderMystery() {
  const m = U.mystery;
  if (!m) {
    $('abMystery').innerHTML = `<p class="small muted">The truck gets one hidden air brake fault and a driver complaint. Run the air brake check and the hands-on checks, then pick the cause.</p><button id="abNew" class="dark">New mystery fault</button>`;
  } else if (!m.answered) {
    const opts = [...AIR_FAULTS].sort((a, b) => a.label.localeCompare(b.label));
    $('abMystery').innerHTML = `<div class="box"><b>Driver complaint:</b> ${esc(m.fault.complaint)}</div>
      <div class="bar"><select id="abAns" style="flex:1"><option value="">Pick the cause…</option>${opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select><button id="abSubmit">Submit</button><button id="abGiveUp">Give up</button></div>`;
  } else {
    const ok = m.answered === m.fault.id;
    $('abMystery').innerHTML = `<div class="box"><span class="${ok ? 'ok' : 'bad'}">${ok ? 'Correct.' : 'Not quite.'}</span> It was: <b>${esc(m.fault.label)}</b>.<br>${esc(m.fault.found)}</div><div class="bar"><button id="abNew" class="dark">Next mystery fault</button><button id="abFix">Repair the truck</button></div>`;
  }
}
$('abMystery').addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('button');
  if (!t) return;
  if (t.id === 'abNew') newMystery();
  if (t.id === 'abFix') {
    clearMystery();
    renderMystery();
  }
  if ((t.id === 'abSubmit' || t.id === 'abGiveUp') && U.mystery) {
    const v = t.id === 'abGiveUp' ? 'gave up' : ($('abAns') as HTMLSelectElement).value;
    if (!v) return;
    eng().dispatch({ type: 'submitDiagnosis', circuit: 'air', location: v, kind: 'air', cause: v });
    U.mystery.answered = v;
    renderMystery();
  }
});
function renderInstr() {
  $('abInstr').innerHTML = `<p class="small muted">Tick a fault to put it on the truck. These stay until you untick them or press Reset.</p>` +
    AIR_FAULTS.map((f) => `<label class="small" style="display:block"><input type="checkbox" data-f="${f.id}" ${U.instructor.has(f.id) ? 'checked' : ''}> ${esc(f.label)}</label>`).join('');
}
renderInstr();
$('abInstr').addEventListener('change', (ev) => {
  const cb = ev.target as HTMLInputElement;
  const id = cb.dataset.f;
  if (!id) return;
  const e = eng();
  if (cb.checked) {
    const f = AIR_FAULTS.find((x) => x.id === id)!;
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

// ---------------- rendering ----------------
function renderLogs() {
  $('abMarks').innerHTML = U.marks.slice(0, 8).map((m) => `<div>${m}</div>`).join('');
  $('abEvents').innerHTML = U.events.length ? U.events.slice(0, 14).map((m) => `<div>${m}</div>`).join('') : '<div class="muted">Nothing yet.</div>';
  $('abCheckLog').innerHTML = U.checks.slice(0, 8).map((m) => `<div>${m}</div>`).join('');
}
renderLogs();
function note(s: string) {
  U.events.unshift(`<span class="muted">${U.sw.running || U.sw.accMs ? fmtT(swMs()) : 'sim ' + fmtT(eng().timeMs)}</span> ${s}`);
  if (U.events.length > 40) U.events.pop();
}

const shade = (psi: number) => String(0.18 + 0.82 * Math.min(1, Math.max(0, psi) / 125));
function render() {
  const e = eng();
  const s = e.state;
  const a = s.air;
  tRpm.textContent = `${Math.round(s.rpm)} rpm`;
  tComp.textContent = !s.running ? 'STOPPED' : a.compressorLoaded ? 'PUMPING' : 'UNLOADED';
  tComp.setAttribute('fill', s.running && a.compressorLoaded ? '#69db7c' : '#8a8a93');
  tScfm.textContent = `${a.compressorScfm.toFixed(1)} scfm`;
  purge.setAttribute('opacity', a.purging ? '1' : '0');
  const setTank = (t: { fill: SVGRectElement; v: SVGTextElement }, psi: number) => {
    t.fill.setAttribute('width', String(Math.max(0, Math.min(1, psi / 150)) * 162));
    t.v.textContent = `${psi.toFixed(0)} psi`;
  };
  setTank(tSup, a.supplyPsi);
  setTank(tPri, s.airPrimaryPsi);
  setTank(tSec, s.airSecondaryPsi);
  const op: Record<LineKey, number> = {
    comp: a.compressorScfm > 0 ? a.supplyPsi : 0, sup: a.supplyPsi, supPri: a.supplyPsi, supSec: a.supplyPsi,
    priFoot: s.airPrimaryPsi, secFoot: s.airSecondaryPsi, appFront: a.appSecondaryPsi, appRear: a.appPrimaryPsi,
    relayRear: Math.max(a.chamberPsi.lr, a.chamberPsi.rr), park: Math.max(s.airPrimaryPsi, s.airSecondaryPsi), hold: a.holdoffPsi,
  };
  for (const k of Object.keys(lines) as LineKey[]) lines[k].setAttribute('opacity', shade(op[k]));
  tFoot.textContent = `${Math.round(a.appPrimaryPsi)} / ${Math.round(a.appSecondaryPsi)}`;
  knob.setAttribute('transform', `rotate(45 848 318) translate(${s.driver.parkBrake ? -10 : 0} ${s.driver.parkBrake ? 10 : 0})`);
  tKnob.textContent = s.driver.parkBrake ? (a.parkPopped ? 'POPPED OUT' : 'OUT · SET') : 'IN · RELEASED';
  for (const w of WHEEL_IDS) {
    const [x, y] = CH_POS[w];
    const c = chamber[w];
    const st = a.strokeIn[w];
    c.rod.setAttribute('x2', String(x - 20 - st * 22));
    c.rod.setAttribute('y2', String(y));
    c.rod.setAttribute('stroke', st > AIR_SPEC.chambers[w].limit + 0.01 ? '#ff6b6b' : '#e6e6e9');
    c.p.textContent = `${Math.round(a.chamberPsi[w])} psi`;
    c.s.textContent = st > 0 ? `${st.toFixed(2)}"` : '';
    c.bar.setAttribute('width', String(40 * a.wheelForce[w]));
  }
  // dash: the cluster's own sensors, exactly what the driver sees
  const D = e.module('clu').display();
  const rot = (n: SVGLineElement, v: number | 'ERR' | undefined) => {
    const p = typeof v === 'number' ? v : 0;
    n.setAttribute('transform', `rotate(${ang(p) + 90} 110 105)`);
    n.setAttribute('opacity', typeof v === 'number' ? '1' : '0.15');
  };
  rot(nPri, D?.air.primaryPsi);
  rot(nSec, D?.air.secondaryPsi);
  gTxt.textContent = D ? `${D.air.primaryPsi} / ${D.air.secondaryPsi}` : 'key off';
  gTxt.setAttribute('fill', '#e6e6e9');
  $('abLow').classList.toggle('on', !!D?.lamps.lowAir);
  $('abLow').classList.toggle('blink', !!D?.lamps.lowAir);
  $('abPark').classList.toggle('on', !!D?.lamps.park);
  document.querySelectorAll('#abKey button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === s.key));
  $('abKnob').textContent = s.driver.parkBrake ? '◆ Push in · release' : '◆ Pull out · set';
  $('abKnob').classList.toggle('set', s.driver.parkBrake);
  const ped = s.driver.brake ? 100 : s.driver.brakePedalPct;
  if (document.activeElement !== pedal) pedal.value = String(ped);
  $('abPedalV').textContent = `${Math.round(ped)}%`;
  $('abHold').classList.toggle('on', U.hold);
  $('abSwT').textContent = fmtT(swMs());
  const lo = Math.min(s.airPrimaryPsi, s.airSecondaryPsi);
  $('abStatus').innerHTML = [
    s.running ? `ENGINE RUNNING · ${Math.round(s.rpm)} rpm · ${s.speedMph.toFixed(0)} mph` : s.key === 'on' ? 'KEY ON · ENGINE OFF · compressor stopped' : 'KEY OFF · gauges dark',
    s.driver.parkBrake ? '<span class="w">SPRING BRAKES APPLIED</span>' : a.springApply > 0.05 ? '<span class="r">SPRING BRAKES DRAGGING</span>' : 'spring brakes released',
    a.brakeEffort > 0.02 ? `service brakes ${Math.round(a.brakeEffort * 100)}%` : '',
    lo < 60 ? '<span class="r">AIR BELOW 60 PSI: DO NOT DRIVE</span>' : '',
  ].filter(Boolean).join(' · ');

  // observations a person at the truck would notice
  const L = U.last;
  if (s.running && L.loaded !== null && L.loaded !== a.compressorLoaded) note(a.compressorLoaded ? `Compressor starts pumping again (cut-in) · dash ${dashStr()}` : `Compressor stops; the dryer purges (cut-out) · dash ${dashStr()}`);
  L.loaded = s.running ? a.compressorLoaded : null;
  const low = !!D?.lamps.lowAir;
  if (low !== L.lowAir) note(low ? `<span class="bad">Low-air lamp and buzzer ON</span> · dash ${dashStr()}` : `Low-air warning off · dash ${dashStr()}`);
  L.lowAir = low;
  if (s.driver.parkBrake && !L.park && a.parkPopped) note(`<span class="bad">Park knob POPPED OUT</span> · dash ${dashStr()}`);
  L.park = s.driver.parkBrake;
  if (a.purging && !L.purging && a.compressorLoaded) note('Air blowing from the dryer purge valve while the compressor pumps');
  L.purging = a.purging && a.compressorLoaded;
}

// ---------------- loop ----------------
let lastUi = 0;
let fanPhase: { until: number; down: boolean } | null = null;
function loop(now: number) {
  requestAnimationFrame(loop);
  const e = eng();
  if (!e) return;
  // fanning: 0.6 s on, 0.6 s off, in simulation time
  if (U.fanCount > 0 || fanPhase) {
    if (!fanPhase) {
      fanPhase = { until: e.timeMs + 600, down: true };
      setPedal(100);
    } else if (e.timeMs >= fanPhase.until) {
      if (fanPhase.down) {
        setPedal(0);
        fanPhase = { until: e.timeMs + 600, down: false };
      } else {
        fanPhase = null;
        U.fanCount = Math.max(0, U.fanCount - 1);
      }
    }
  }
  if (U.parkWhenStopped && e.state.speedMph < 0.3) {
    U.parkWhenStopped = false;
    if (!e.state.driver.parkBrake) e.dispatch({ type: 'setParkBrake', applied: true });
  }
  if (now - lastUi < 100 || !sec.classList.contains('on')) {
    // keep the observation log honest even while another tab is open
    if (now - lastUi >= 100) {
      lastUi = now;
      const s = e.state;
      U.last.loaded = s.running ? s.air.compressorLoaded : null;
    }
    return;
  }
  lastUi = now;
  render();
  renderLogs();
}
requestAnimationFrame(loop);

// ---------------- 3D: the air system on the shared truck chassis ----------------
// World frame of h3EnvChassis: +x forward, +y up, +z = left (driver) side. Front axle x 2.2, drive axles x -4.0 and -5.3.
type V3 = [number, number, number];
const AIR3D: { id: string; label: string; pos: V3; dist?: number; view?: V3; what: string; check: string }[] = [
  { id: 'compressor', label: 'Compressor', pos: [1.1, 1.42, 0.5], what: 'Gear-driven off the engine, so it turns whenever the engine runs. It only pumps when the governor loads it; unloaded, it spins without building air.', check: 'Build-up time: 85 to 100 psi in 45 seconds or less at fast idle.' },
  { id: 'governor', label: 'Governor', pos: [1.0, 1.58, 0.62], what: 'Senses supply pressure and unloads the compressor at cut-out (about 125 psi), then loads it again at cut-in (about 20 psi lower).', check: 'Cut-out 120 to 135 psi; cut-in no more than 25 psi below cut-out.' },
  { id: 'dryer', label: 'Air dryer', pos: [1.25, 0.98, 0.64], what: 'Desiccant cartridge that strips water and oil from the compressor air. Each time the governor cuts out it purges with a short blast.', check: 'One purge at every cut-out; a purge valve that blows constantly is stuck open. Water in the tanks means a saturated cartridge.' },
  { id: 'supply', label: 'Supply (wet) tank', pos: [-1.95, 0.95, 0.1], what: 'First tank after the dryer. It catches what water gets through and feeds the primary and secondary tanks through one-way check valves.', check: 'Drain daily. The check valves must hold each circuit if the other one leaks.' },
  { id: 'primary', label: 'Primary tank', pos: [-2.55, 1.03, 0.8], what: 'Feeds the primary (rear) circuit: the foot valve\'s primary side and the rear relay valve.', check: 'Green needle on the dash gauge.' },
  { id: 'secondary', label: 'Secondary tank', pos: [-2.55, 0.4, 0.86], what: 'Feeds the secondary (front) circuit through the foot valve to the steer axle chambers.', check: 'Red needle on the dash gauge.' },
  { id: 'foot', label: 'Foot valve', pos: [0.72, 1.48, 0.45], dist: 2.4, what: 'Dual treadle valve. Pedal travel meters air from both tanks: primary delivery signals the rear relay valve, secondary delivery goes to the front chambers.', check: 'Applied leakage: no more than 4 psi in one minute with a full brake application (tractor only).' },
  { id: 'park', label: 'Park control valve', pos: [0.72, 1.88, 0.15], dist: 2.4, what: 'Yellow diamond knob. Pushed in, it sends air to hold off the spring brakes; pulled out, it exhausts that air and the springs apply.', check: 'Pops out on its own between 20 and 45 psi as air is fanned down.' },
  { id: 'relay', label: 'Relay valve', pos: [-4.65, 1.08, 0.0], what: 'Mounted near the drive axles. A small control signal from the foot valve opens it, and it fills the rear chambers straight from the primary tank: faster application and release.', check: 'Rear chambers should apply and release as fast as the fronts.' },
  { id: 'qr', label: 'Quick release valve', pos: [2.05, 1.08, 0.0], what: 'Sits between the front chambers and dumps their air right there when the pedal is released, instead of sending it all the way back to the foot valve.', check: 'Front brakes release promptly; air exhausts at the valve.' },
  { id: 'frontCh', label: 'Front service chamber', pos: [2.45, 0.72, 0.72], view: [3.2, 0.4, -0.1], what: 'Type 20 service chamber. Air on the diaphragm pushes the pushrod out against the slack adjuster.', check: 'Pushrod stroke at 90 to 100 psi: readjust above 1-3/4 in.' },
  { id: 'springCh', label: 'Spring brake chamber', pos: [-3.66, 0.62, 0.68], view: [-3.0, 0.14, 0.05], what: 'Type 30/30: a service chamber plus a powerful spring held back by hold-off air. Lose that air and the spring applies the brake.', check: 'Pushrod stroke at 90 to 100 psi: readjust above 2 in. Never take a spring chamber apart.' },
  { id: 'slack', label: 'Slack adjuster', pos: [-3.86, 0.42, 0.68], view: [-3.05, 0.12, 0.1], what: 'Lever between the pushrod and the S-cam. It turns the pushrod\'s push into cam rotation and takes up lining wear automatically.', check: 'Measure applied stroke; an automatic slack that keeps going out of adjustment means a foundation brake problem.' },
];
const ab3Mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.55 });
const glow = (c: number) => new THREE.MeshStandardMaterial({ color: 0x15151a, emissive: c, emissiveIntensity: 0.2, metalness: 0.2, roughness: 0.6 });
interface AirParts {
  lines: Record<string, THREE.MeshStandardMaterial>;
  rods: { w: Wheel; mesh: THREE.Mesh; arm: THREE.Object3D; base: number; y: number }[];
  purge: THREE.Mesh;
  comp: THREE.MeshStandardMaterial;
  tanks: Record<string, THREE.MeshStandardMaterial>;
  knob: THREE.Object3D;
}
let airParts: AirParts | null = null;
function ab3Build(g: THREE.Group): AirParts {
  const add = (m: THREE.Object3D, p: V3, spot: string) => { m.position.set(p[0], p[1], p[2]); m.userData.spot = spot; g.add(m); return m; };
  const cyl = (r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', seg = 24) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  const box = (s: V3, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), mat);
  const lines: AirParts['lines'] = {};
  const tube = (key: string, col: number, pts: V3[], r = 0.011) => {
    const mat = lines[key] || (lines[key] = glow(col));
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(24, pts.length * 14), r, 8, false), mat);
    g.add(m);
  };
  const alu = ab3Mat(0xb7bdc5), dark = ab3Mat(0x2b2e33), blk = ab3Mat(0x18191c);
  // compressor and governor on the engine (left side, rear gear train)
  const comp = glow(0x69db7c);
  const cg = new THREE.Group();
  cg.add(cyl(0.075, 0.22, alu, 'x'));
  const head = box([0.12, 0.08, 0.12], comp); head.position.set(0, 0.09, 0); cg.add(head);
  add(cg, [1.1, 1.32, 0.52], 'compressor');
  add(box([0.06, 0.07, 0.05], blk), [1.0, 1.48, 0.6], 'governor');
  // air dryer on the left rail, ahead of the battery box
  const dg = new THREE.Group();
  dg.add(cyl(0.1, 0.3, ab3Mat(0x1d3d6b), 'y'));
  const cap = cyl(0.105, 0.05, alu, 'y'); cap.position.y = -0.17; dg.add(cap);
  add(dg, [1.25, 0.78, 0.64], 'dryer');
  const purge = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe6e6e9, transparent: true, opacity: 0, depthWrite: false }));
  purge.position.set(1.25, 0.5, 0.64); g.add(purge);
  // supply tank across the frame; colored shells over the chassis model's primary/secondary tanks
  const tanks: AirParts['tanks'] = { supply: glow(0x6fd3ff), primary: glow(0x69db7c), secondary: glow(0xff6b6b) };
  add(cyl(0.12, 0.78, tanks.supply, 'z'), [-1.95, 0.78, 0], 'supply');
  const shell = (mat: THREE.MeshStandardMaterial, y: number, id: string) => {
    const sh = cyl(0.146, 0.87, mat.clone(), 'x', 32);
    (sh.material as THREE.MeshStandardMaterial).transparent = true;
    (sh.material as THREE.MeshStandardMaterial).opacity = 0.55;
    tanks[id] = sh.material as THREE.MeshStandardMaterial;
    add(sh, [-2.55, y, 0.72], id);
  };
  shell(tanks.primary, 0.86, 'primary');
  shell(tanks.secondary, 0.56, 'secondary');
  // foot valve and pedal on the cab floor, park knob on the dash
  const fg = new THREE.Group();
  fg.add(box([0.09, 0.1, 0.09], dark));
  const ped = box([0.16, 0.012, 0.08], blk); ped.position.set(0.1, 0.08, 0); ped.rotation.z = -0.5; fg.add(ped);
  add(fg, [0.72, 1.33, 0.45], 'foot');
  const knob = box([0.05, 0.05, 0.02], new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.4 }));
  knob.rotation.z = Math.PI / 4;
  const kg = new THREE.Group(); kg.add(knob); add(kg, [0.75, 1.85, 0.15], 'park');
  // relay valve and quick release valve on crossmembers
  add(box([0.13, 0.1, 0.13], dark), [-4.65, 0.98, 0], 'relay');
  add(cyl(0.05, 0.06, dark, 'y'), [2.05, 0.98, 0], 'qr');
  // chambers, pushrods, slack adjusters
  const rods: AirParts['rods'] = [];
  const chamber = (w: Wheel, x: number, z: number, spring: boolean) => {
    const cgp = new THREE.Group();
    const svc = cyl(0.085, 0.09, ab3Mat(0x202226), 'x'); cgp.add(svc);
    if (spring) { const sp = cyl(0.09, 0.14, ab3Mat(0x2a2620), 'x'); sp.position.x = 0.115; cgp.add(sp); }
    const y = spring ? 0.5 : 0.66;
    add(cgp, [x, y, z], spring ? 'springCh' : 'frontCh');
    const rod = cyl(0.009, 1, ab3Mat(0xd8dde3), 'x', 8);
    g.add(rod);
    const arm = new THREE.Group();
    const lever = box([0.03, 0.2, 0.03], ab3Mat(0x8a8f96)); lever.position.y = 0.08; arm.add(lever);
    arm.position.set(x - 0.12, y - 0.08, z); arm.userData.spot = 'slack';
    g.add(arm);
    rods.push({ w, mesh: rod, arm, base: x - 0.045, y });
  };
  for (const s of [1, -1]) {
    chamber(s > 0 ? 'lf' : 'rf', 2.45, s * 0.72, false);
    for (const x of [-4.0, -5.3]) chamber(s > 0 ? 'lr' : 'rr', x + 0.3, s * 0.68, true);
  }
  // plumbing
  tube('comp', 0x6fd3ff, [[1.1, 1.32, 0.6], [1.2, 1.15, 0.66], [1.25, 0.95, 0.66]]);
  tube('sup', 0x6fd3ff, [[1.25, 0.62, 0.6], [1.0, 1.0, 0.4], [-1.6, 1.0, 0.4], [-1.95, 0.9, 0.3]]);
  tube('supPri', 0x6fd3ff, [[-1.95, 0.84, 0.35], [-2.15, 0.88, 0.55], [-2.2, 0.86, 0.6]]);
  tube('supSec', 0x6fd3ff, [[-1.95, 0.72, 0.35], [-2.15, 0.6, 0.55], [-2.2, 0.56, 0.6]]);
  tube('priFoot', 0x69db7c, [[-2.4, 0.86, 0.58], [-2.2, 1.0, 0.36], [0.4, 1.0, 0.36], [0.7, 1.3, 0.42]]);
  tube('secFoot', 0xff6b6b, [[-2.4, 0.56, 0.58], [-2.25, 0.96, 0.32], [0.4, 0.96, 0.32], [0.74, 1.3, 0.47]]);
  tube('appFront', 0xff6b6b, [[0.76, 1.3, 0.48], [0.9, 1.02, 0.25], [1.9, 0.98, 0.05], [2.05, 0.98, 0]]);
  for (const s of [1, -1]) tube('appFront', 0xff6b6b, [[2.05, 0.96, 0], [2.3, 0.85, s * 0.4], [2.45, 0.72, s * 0.68]]);
  tube('appRear', 0x69db7c, [[0.68, 1.3, 0.44], [0.55, 1.04, 0.2], [-4.4, 1.04, 0.08], [-4.6, 1.0, 0.02]]);
  for (const s of [1, -1]) for (const x of [-4.0, -5.3]) tube('relayRear', 0x69db7c, [[-4.65, 0.98, 0], [x + 0.2, 0.9, s * 0.35], [x + 0.3, 0.56, s * 0.62]]);
  tube('park', 0xf5a623, [[0.75, 1.85, 0.15], [0.62, 1.4, 0.12], [0.55, 1.07, 0.05]]);
  tube('hold', 0xf5a623, [[0.55, 1.07, 0.05], [-4.3, 1.07, -0.05], [-4.6, 1.06, -0.1]]);
  for (const s of [1, -1]) for (const x of [-4.0, -5.3]) tube('hold', 0xf5a623, [[-4.6, 1.06, -0.1], [x + 0.35, 0.95, s * 0.35], [x + 0.42, 0.56, s * 0.64]], 0.008);
  return { lines, rods, purge, comp, tanks, knob: kg };
}
const lit = (m: THREE.MeshStandardMaterial | undefined, psi: number) => { if (m) m.emissiveIntensity = 0.08 + 1.1 * Math.max(0, Math.min(1, psi / 125)); };
function ab3Frame() {
  const P = airParts;
  if (!P) return;
  const s = eng().state, a = s.air;
  const L: Record<string, number> = {
    comp: s.running && a.compressorLoaded ? a.supplyPsi : 0, sup: a.supplyPsi, supPri: a.supplyPsi, supSec: a.supplyPsi,
    priFoot: s.airPrimaryPsi, secFoot: s.airSecondaryPsi, appFront: a.appSecondaryPsi, appRear: a.appPrimaryPsi,
    relayRear: Math.max(a.chamberPsi.lr, a.chamberPsi.rr), park: Math.max(s.airPrimaryPsi, s.airSecondaryPsi) * (s.driver.parkBrake ? 0 : 1), hold: a.holdoffPsi,
  };
  for (const k in P.lines) lit(P.lines[k], L[k] ?? 0);
  lit(P.tanks.supply, a.supplyPsi);
  lit(P.tanks.primary, s.airPrimaryPsi);
  lit(P.tanks.secondary, s.airSecondaryPsi);
  P.comp.emissiveIntensity = s.running && a.compressorLoaded ? 0.6 + 0.3 * Math.sin(performance.now() / 60) : 0.05;
  (P.purge.material as THREE.MeshBasicMaterial).opacity = a.purging ? 0.35 + 0.2 * Math.sin(performance.now() / 40) : 0;
  P.purge.scale.setScalar(a.purging ? 1 + ((performance.now() / 300) % 1) : 1);
  P.knob.position.z = 0.15 + (s.driver.parkBrake ? 0.05 : 0);
  for (const r of P.rods) {
    const travel = 0.06 + a.strokeIn[r.w] * 0.0254 * 2; // drawn at twice real travel
    r.mesh.scale.set(1, travel, 1);
    r.mesh.position.set(r.base - travel / 2, r.y, r.arm.position.z);
    r.arm.position.x = r.base - travel;
    r.arm.rotation.z = -0.25 + a.strokeIn[r.w] * 0.18;
    (r.mesh.material as THREE.MeshStandardMaterial).color.set(a.strokeIn[r.w] > AIR_SPEC.chambers[r.w].limit + 0.01 ? 0xff6b6b : 0xd8dde3);
  }
  if (++ab3Tick % 15 === 0) {
    const cell = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
    $('ab3Read').innerHTML = cell('Supply', `${a.supplyPsi.toFixed(0)} psi`) + cell('Primary / secondary', `${s.airPrimaryPsi.toFixed(0)} / ${s.airSecondaryPsi.toFixed(0)}`) +
      cell('Compressor', !s.running ? 'stopped' : a.compressorLoaded ? 'pumping' : 'unloaded') + cell('Spring brakes', a.springApply > 0.5 ? 'applied' : 'released') +
      cell('Front stroke', `${a.strokeIn.lf.toFixed(2)}" / ${a.strokeIn.rf.toFixed(2)}"`) + cell('Rear stroke', `${a.strokeIn.lr.toFixed(2)}" / ${a.strokeIn.rr.toFixed(2)}"`);
  }
}
let ab3Tick = 0;
const ab3 = (window as unknown as { v3Viewer: (box: HTMLElement, o: unknown) => { select(id: string): void; home(now?: boolean): void; fly(p: unknown, t: unknown): void } }).v3Viewer($('ab3d'), {
  env: 'truck',
  envLabels: false,
  spots: AIR3D,
  cams: { truck: [[3.4, 4.2, 6.6], [-1.4, 0.9, 0]] },
  extra: (g: THREE.Group) => { airParts = ab3Build(g); return airParts; },
  onFrame: ab3Frame,
  onPick: (id: string) => ab3Show(id),
});
function ab3Show(id: string | null) {
  const c = AIR3D.find((x) => x.id === id);
  $('ab3Card').innerHTML = c
    ? `<h4>${esc(c.label)}</h4><p>${esc(c.what)}</p><p><span class="k">Check</span>${esc(c.check)}</p>`
    : '<p class="muted">Click a label or a part to see what it does and how it is checked. Work the pedal, the park knob and the key in the panel above and watch the lines and pushrods.</p>';
  document.querySelectorAll('#ab3Chips button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.s === id));
}
$('ab3Chips').innerHTML = AIR3D.map((c) => `<button data-s="${c.id}">${esc(c.label)}</button>`).join('');
$('ab3Chips').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button[data-s]') as HTMLElement | null;
  if (!b) return;
  ab3.select(b.dataset.s!);
  ab3Show(b.dataset.s!);
});
$('ab3Home').addEventListener('click', () => ab3.home());
$('ab3Wheel').addEventListener('click', () => { ab3.select('springCh'); ab3Show('springCh'); });
ab3Show(null);
