// Four-stroke cycle panel of the Engine tab: a detailed cutaway of one cylinder (cams over the valves,
// buckets, springs, ports with moving air and exhaust, the injector spray, the flame, an I-beam rod and a
// counterweighted crank), selectable stroke cards that drive the animation, and the live pressure chart.
// The cylinder's condition, boost and fuelling come from the shared truck (window.simEngine).
import {
  ENGINE_SPEC, cylinderPressure, cycleForCylinder, strokeAt, valveLift, pistonFromTdcMm, airTempC, type SimEngine, type Stroke,
} from '../engine';

const NS = 'http://www.w3.org/2000/svg';
const eng = () => (window as unknown as { simEngine: SimEngine }).simEngine;
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
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const wrap = (x: number) => ((x % 720) + 720) % 720;

export const STROKE_COL: Record<Stroke, string> = { intake: '#6fd3ff', compression: '#f5a623', power: '#ff3b30', exhaust: '#9a9aa3' };
const VT = ENGINE_SPEC.valveTiming;

interface StrokeInfo {
  id: Stroke;
  title: string;
  range: [number, number];
  piston: string;
  valves: string;
  summary: string;
  detail: string;
  events: [number, string][];
}
const STROKES: StrokeInfo[] = [
  {
    id: 'intake', title: 'Intake', range: [0, 180], piston: 'Down ↓', valves: 'Intake open · exhaust closing',
    summary: 'The piston goes down and pulls (and the turbo pushes) a full charge of air in.',
    detail: 'The piston moves from TDC to BDC with the intake valve open. A diesel takes in <b>only air</b>: there is no throttle restricting it and no fuel yet, so every cylinder fills completely at every load. Under load the turbo pushes the air in at boost pressure, so more air (more oxygen) is packed in than the piston alone could draw. The shape of the port makes the air <b>swirl</b> as it enters, which later mixes it with the fuel spray.',
    events: [[-15 + 720, 'Intake valve opens (IVO), 15° before TDC: both valves open, overlap'], [15, 'Exhaust valve closes (EVC), 15° after TDC'], [90, 'Piston at mid-stroke, fastest air flow'], [180, 'BDC: cylinder full, piston changes direction']],
  },
  {
    id: 'compression', title: 'Compression', range: [180, 360], piston: 'Up ↑', valves: 'Both closed (after IVC)',
    summary: 'Both valves shut and the piston squeezes the air to 1/18.5 of its volume. It gets hot enough to light diesel.',
    detail: `The intake valve stays open a little past BDC (the moving air keeps ramming in), then closes at ${VT.intakeCloses}°. From there the piston squeezes the trapped air to about <b>1/${ENGINE_SPEC.compressionRatio}</b> of its volume. Squeezing it heats it to well over <b>500 °C</b>, far above diesel fuel's self-ignition temperature (about 210–250 °C). Just before TDC the injector sprays fuel at up to 2,000 bar into the hot air. That is <b>compression ignition</b>: no spark plug. A cylinder with worn rings or a leaking valve loses some of the squeeze, so the air doesn't get as hot and the cylinder makes less power.`,
    events: [[215, 'Intake valve closes (IVC), 35° after BDC: real compression starts'], [300, 'Air temperature passes about 300 °C'], [352, 'Start of injection, 8° before TDC'], [360, 'TDC: smallest volume, highest compression pressure']],
  },
  {
    id: 'power', title: 'Power', range: [360, 540], piston: 'Down ↓', valves: 'Both closed until EVO',
    summary: 'The fuel burns, pressure jumps to well over 2,000 psi and drives the piston down. The only stroke that makes power.',
    detail: 'Fuel lights a few degrees after it starts spraying (the <b>ignition delay</b>) and burns as it is injected. Peak pressure comes 10–15° <b>after</b> TDC, when the rod has some leverage on the crank, so the push turns the crank instead of fighting it. The expanding gas drives the piston down: the only one of the four strokes that makes power; the flywheel and the other five cylinders carry this one through its other three strokes. Near BDC the exhaust valve opens early to let the pressure <b>blow down</b> into the exhaust manifold.',
    events: [[356, 'Ignition: the spray lights after a short delay'], [372, 'Peak cylinder pressure, about 12° after TDC'], [430, 'Expansion: pressure and temperature fall as the piston moves down'], [500, 'Exhaust valve opens (EVO), 40° before BDC: blow-down']],
  },
  {
    id: 'exhaust', title: 'Exhaust', range: [540, 720], piston: 'Up ↑', valves: 'Exhaust open · intake opening',
    summary: 'The piston pushes the burned gas out through the exhaust valve to the turbo.',
    detail: 'With the exhaust valve open the piston moves up and pushes the burned gas out. The gas still carries a lot of energy: it spins the turbo\'s turbine, which drives the compressor that boosts the next intake charge. Near TDC the intake valve starts to open before the exhaust valve closes. This <b>overlap</b> lets the outgoing gas help pull fresh air in and sweep the chamber clean. Here the cylinder is "rocking": both rockers are moving at once, which is how a technician tells TDC overlap from TDC compression.',
    events: [[560, 'Piston rising, pushing exhaust out'], [640, 'Exhaust valve at full lift'], [705, 'Intake valve opens: overlap begins'], [719, 'TDC overlap: both valves slightly open (rocking)']],
  },
];

// geometry of the cutaway (px)
const K = 150 / ENGINE_SPEC.strokeMm;
const CX = 230, DECK = 250, TOP_TDC = 258, PIN = 46, R = (ENGINE_SPEC.strokeMm / 2) * K, L = ENGINE_SPEC.rodMm * K;
const CY = TOP_TDC + PIN + R + L;
const BORE_L = 147, BORE_R = 313;
const VALVE_X = { intake: 180, exhaust: 280 };
const LIFT_PX = 18, CAM_Y = 66, CAM_R = 18, BUCKET_TOP = CAM_Y + CAM_R;

export function mountCycle(root: HTMLElement): void {
  root.innerHTML = `
  <h2>Four-stroke cycle · compression ignition · same truck, same engine</h2>
  <div class="egCards" id="egCards">
    <button data-st="all" class="on"><b>Full cycle</b><span>All four strokes, 720°: two turns of the crank, one turn of the cam.</span></button>
    ${STROKES.map((s, i) => `<button data-st="${s.id}" style="--sc:${STROKE_COL[s.id]}"><b>${i + 1} · ${s.title}</b><span>${s.summary}</span><em>Piston ${s.piston} · ${s.valves}</em></button>`).join('')}
  </div>
  <div class="egCycle">
    <div><svg id="egCyl" viewBox="0 0 460 720" role="img" aria-label="Animated cutaway of one diesel cylinder"></svg>
      <div class="egCtl">
        <button id="egPlay" class="dark">Pause</button>
        <span class="seg" id="egSpeed"><button data-s="20">Slow</button><button data-s="60" class="on">Medium</button><button data-s="240">Fast</button></span>
        <button id="egBack" title="Back 5°">◀ 5°</button><button id="egFwd" title="Forward 5°">5° ▶</button>
      </div>
    </div>
    <div>
      <div class="egStroke" id="egStroke"></div>
      <div id="egExplain" class="egExplain"></div>
      <div class="egEvents" id="egEvents"></div>
      <div class="egRead">
        <div><span>Crank angle</span><b id="egAng">0°</b></div>
        <div><span>Piston from TDC</span><b id="egPos">0 mm</b></div>
        <div><span>Cylinder pressure</span><b id="egP">0 psi</b></div>
        <div><span>Gas temperature</span><b id="egT">0 °C</b></div>
      </div>
      <div class="note" id="egSpeedNote"></div>
      <svg id="egChart" viewBox="0 0 720 230" role="img" aria-label="Cylinder pressure against crank angle"></svg>
      <div class="egCtl"><span class="note" style="margin:0">Cylinder shown:</span><span class="seg" id="egCylSel">${[1, 2, 3, 4, 5, 6].map((n) => `<button data-c="${n}" class="${n === 1 ? 'on' : ''}">#${n}</button>`).join('')}</span><span class="note" style="margin:0">Faulted cylinders show a weaker trace (dashed line = healthy).</span></div>
    </div>
  </div>`;

  const U = { theta: 0, speed: 60, playing: true, sel: 'all' as 'all' | Stroke, cyl: 1, hold: null as number | null };

  // ---------------- drawing ----------------
  const svg = root.querySelector('#egCyl') as SVGSVGElement;
  const defs = el(svg, 'defs');
  const grad = (id: string, stops: [number, string, number?][], x2 = 1, y2 = 0, radial = false) => {
    const g = el(defs, radial ? 'radialGradient' : 'linearGradient', radial ? { id } : { id, x1: 0, y1: 0, x2, y2 });
    for (const [o, c, op] of stops) el(g, 'stop', { offset: o, 'stop-color': c, 'stop-opacity': op ?? 1 });
    return g;
  };
  grad('gMetal', [[0, '#5f6068'], [0.18, '#c8c9cf'], [0.45, '#f2f2f5'], [0.7, '#a6a7ae'], [1, '#55565d']]);
  grad('gMetalV', [[0, '#d8d8de'], [1, '#77787f']], 0, 1);
  grad('gIron', [[0, '#26262c'], [0.5, '#34343c'], [1, '#202026']]);
  grad('gHead', [[0, '#2e2e36'], [1, '#1f1f25']], 0, 1);
  grad('gLiner', [[0, '#55555e'], [0.5, '#8a8a93'], [1, '#4a4a52']]);
  grad('gCool', [[0, '#0d3550'], [0.5, '#1a5f8a'], [1, '#0d3550']]);
  grad('gSteel', [[0, '#6b6c74'], [0.5, '#b9bac1'], [1, '#5c5d65']]);
  grad('gFlame', [[0, '#fff6c2', 1], [0.35, '#ffb21a', 0.95], [0.75, '#ff4b12', 0.65], [1, '#c01a00', 0]], 1, 0, true);
  grad('gSpray', [[0, '#fff7a8', 0.95], [1, '#f5d74a', 0]], 1, 0);
  grad('gOil', [[0, '#e0a83a', 0.9], [1, '#e0a83a', 0]], 0, 1);
  const clip = el(defs, 'clipPath', { id: 'cBore' });
  const clipRect = el(clip, 'rect', { x: BORE_L, y: DECK - 2, width: BORE_R - BORE_L, height: 100 });

  // block, coolant jacket, liner
  el(svg, 'rect', { x: 92, y: DECK, width: 276, height: 290, fill: 'url(#gIron)' });
  el(svg, 'rect', { x: 110, y: DECK + 14, width: 22, height: 200, rx: 4, fill: 'url(#gCool)' });
  el(svg, 'rect', { x: 328, y: DECK + 14, width: 22, height: 200, rx: 4, fill: 'url(#gCool)' });
  txt(svg, 121, DECK + 236, 'COOLANT', { 'font-size': 8, fill: '#3b8fd9', 'text-anchor': 'middle', transform: `rotate(-90 121 ${DECK + 236})` });
  el(svg, 'rect', { x: BORE_L - 9, y: DECK, width: 9, height: 270, fill: 'url(#gLiner)' });
  el(svg, 'rect', { x: BORE_R, y: DECK, width: 9, height: 270, fill: 'url(#gLiner)' });
  el(svg, 'rect', { x: BORE_L, y: DECK, width: BORE_R - BORE_L, height: 270, fill: '#0a0a0d' });
  // crosshatch on the liner wall
  const hatch = el(svg, 'g', { opacity: 0.12 });
  for (let y = DECK + 6; y < DECK + 262; y += 9) {
    el(hatch, 'line', { x1: BORE_L, y1: y, x2: BORE_L + 6, y2: y + 6, stroke: '#fff' });
    el(hatch, 'line', { x1: BORE_R, y1: y, x2: BORE_R - 6, y2: y + 6, stroke: '#fff' });
  }

  // gas in the cylinder, particles, flame, spray (clipped to the bore above the piston)
  const gasG = el(svg, 'g', { 'clip-path': 'url(#cBore)' });
  const gas = el(gasG, 'rect', { x: BORE_L, y: DECK - 2, width: BORE_R - BORE_L, height: 300, fill: '#6fd3ff', opacity: 0.12 });
  const parts = el(gasG, 'g', {});
  const P = Array.from({ length: 70 }, (_, i) => {
    const u = ((i * 37) % 70) / 70, v = ((i * 53) % 70) / 70;
    return { u, v, c: el(parts, 'circle', { r: 1.8, fill: '#8fe3ff' }) };
  });
  const flameG = el(gasG, 'g', { opacity: 0 });
  const flames = [-62, -38, -14, 14, 38, 62].map((a) => ({ a, e: el(flameG, 'ellipse', { fill: 'url(#gFlame)' }) }));
  const sprayG = el(gasG, 'g', { opacity: 0 });
  const sprays = [-62, -38, -14, 14, 38, 62].map((a) => el(sprayG, 'path', { fill: 'url(#gSpray)' }) as SVGPathElement & { a?: number });
  sprays.forEach((s, i) => (s.a = [-62, -38, -14, 14, 38, 62][i]));

  // head
  el(svg, 'path', {
    d: `M60 ${DECK} V150 H400 V${DECK} H${BORE_R + 9} V${DECK - 4} H${BORE_L - 9} V${DECK} Z`, fill: 'url(#gHead)', stroke: '#3a3a44',
  });
  el(svg, 'rect', { x: 120, y: 170, width: 26, height: 30, rx: 4, fill: 'url(#gCool)' });
  el(svg, 'rect', { x: 314, y: 170, width: 26, height: 30, rx: 4, fill: 'url(#gCool)' });
  // ports: intake from the left, exhaust to the right
  const inPortD = `M0 182 H90 C140 182 150 196 ${VALVE_X.intake - 24} ${DECK - 6} H${VALVE_X.intake + 24} C${VALVE_X.intake + 18} 210 150 160 90 160 H0 Z`;
  const exPortD = `M460 182 H370 C320 182 310 196 ${VALVE_X.exhaust + 24} ${DECK - 6} H${VALVE_X.exhaust - 24} C${VALVE_X.exhaust - 18} 210 310 160 370 160 H460 Z`;
  el(svg, 'path', { d: inPortD, fill: '#0f2a3a', stroke: '#1d4a63' });
  el(svg, 'path', { d: exPortD, fill: '#2a2321', stroke: '#4a3a34' });
  const inFlow = el(svg, 'path', { d: `M0 171 H90 C135 171 ${VALVE_X.intake - 6} 196 ${VALVE_X.intake} ${DECK - 4}`, fill: 'none', stroke: 'none' }) as SVGPathElement;
  const exFlow = el(svg, 'path', { d: `M${VALVE_X.exhaust} ${DECK - 4} C${VALVE_X.exhaust + 6} 196 325 171 370 171 H460`, fill: 'none', stroke: 'none' }) as SVGPathElement;
  const inDots = Array.from({ length: 16 }, (_, i) => ({ s: i / 16, c: el(svg, 'circle', { r: 2.2, fill: '#8fe3ff', opacity: 0.85 }) }));
  const exDots = Array.from({ length: 16 }, (_, i) => ({ s: i / 16, c: el(svg, 'circle', { r: 2.6, fill: '#8a8a93', opacity: 0.85 }) }));
  txt(svg, 8, 154, 'AIR FROM THE CHARGE AIR COOLER', { fill: '#6fd3ff', 'font-size': 8 });
  txt(svg, 452, 154, 'EXHAUST TO TURBO', { fill: '#b0b0b8', 'font-size': 8, 'text-anchor': 'end' });

  // cam box, cams, buckets, springs, valves
  el(svg, 'path', { d: 'M100 150 V40 Q100 22 120 22 H340 Q360 22 360 40 V150 Z', fill: '#17171c', stroke: '#33333b' });
  const valve = (v: 'intake' | 'exhaust') => {
    const x = VALVE_X[v];
    el(svg, 'rect', { x: x - 7, y: 160, width: 14, height: 62, fill: '#3e3e46' }); // guide
    const g = el(svg, 'g', {});
    el(g, 'rect', { x: x - 3.5, y: BUCKET_TOP + 16, width: 7, height: DECK - BUCKET_TOP - 24, fill: 'url(#gSteel)' }); // stem
    el(g, 'path', { d: `M${x - 25} ${DECK - 1} L${x - 21} ${DECK - 7} Q${x - 6} ${DECK - 12} ${x - 4} ${DECK - 26} H${x + 4} Q${x + 6} ${DECK - 12} ${x + 21} ${DECK - 7} L${x + 25} ${DECK - 1} Z`, fill: 'url(#gMetalV)', stroke: '#55555f' });
    el(g, 'rect', { x: x - 19, y: BUCKET_TOP, width: 38, height: 18, rx: 3, fill: 'url(#gMetal)', stroke: '#4a4a52' }); // bucket
    const spring = el(svg, 'polyline', { fill: 'none', stroke: v === 'intake' ? '#7fb8d8' : '#c99a7a', 'stroke-width': 2.4 });
    el(svg, 'rect', { x: x - 16, y: 148, width: 32, height: 4, fill: '#55555f' }); // spring seat
    const cam = el(svg, 'g', {});
    el(cam, 'path', { d: `M${-CAM_R} 0 A${CAM_R} ${CAM_R} 0 1 1 ${CAM_R} 0 L${CAM_R * 0.55} ${CAM_R + LIFT_PX * 0.85} Q0 ${CAM_R + LIFT_PX + 3} ${-CAM_R * 0.55} ${CAM_R + LIFT_PX * 0.85} Z`, fill: 'url(#gMetal)', stroke: '#4a4a52' });
    el(cam, 'circle', { r: 6, fill: '#2a2a30' });
    txt(svg, x, 16, v === 'intake' ? 'INTAKE CAM' : 'EXHAUST CAM', { 'font-size': 8, 'text-anchor': 'middle', fill: v === 'intake' ? '#6fd3ff' : '#b0b0b8' });
    return { g, spring, cam, x };
  };
  const vIn = valve('intake'), vEx = valve('exhaust');
  const drawSpring = (s: SVGPolylineElement, x: number, top: number, bot: number) => {
    const n = 8, pts: string[] = [];
    for (let i = 0; i <= n * 2; i++) pts.push(`${x + (i === 0 || i === n * 2 ? 0 : i % 2 ? -13 : 13)},${top + ((bot - top) * i) / (n * 2)}`);
    s.setAttribute('points', pts.join(' '));
  };

  // injector
  el(svg, 'rect', { x: CX - 9, y: 26, width: 18, height: 160, rx: 3, fill: 'url(#gSteel)', stroke: '#4a4a52' });
  el(svg, 'rect', { x: CX - 12, y: 34, width: 24, height: 26, rx: 3, fill: '#3a3a44' });
  el(svg, 'path', { d: `M${CX - 6} 186 V${DECK - 10} L${CX} ${DECK - 2} L${CX + 6} ${DECK - 10} V186 Z`, fill: '#8a8a93' });
  el(svg, 'path', { d: `M${CX + 12} 46 H300 V30`, stroke: '#b09a3a', 'stroke-width': 3, fill: 'none' });
  txt(svg, 302, 30, 'RAIL', { 'font-size': 8, fill: '#b09a3a' });
  txt(svg, CX, 12, 'INJECTOR', { 'font-size': 8, 'text-anchor': 'middle' });

  // crankcase, oil jet, crank, rod, piston
  el(svg, 'path', { d: `M92 ${DECK + 290} H368 L410 712 H50 Z`, fill: '#111115' });
  el(svg, 'path', { d: `M${BORE_R - 6} ${DECK + 284} L${BORE_R - 22} ${DECK + 250}`, stroke: '#8a7a4a', 'stroke-width': 4 });
  const oilJet = el(svg, 'path', { fill: 'url(#gOil)', opacity: 0.7 });
  const crank = el(svg, 'g', {});
  el(crank, 'path', { d: `M${-R - 8} 0 A${R + 8} ${R + 8} 0 0 0 ${R + 8} 0 L${R * 0.5} ${-10} H${-R * 0.5} Z`, fill: '#3e3e47', stroke: '#55555f' });
  el(crank, 'path', { d: `M-26 -${R + 22} H26 L34 8 H-34 Z`, fill: '#4a4a53', stroke: '#5a5a63' });
  el(crank, 'path', { d: `M${-R - 6} 6 A${R + 6} ${R + 6} 0 0 0 ${R + 6} 6 L30 0 H-30 Z`, fill: 'url(#gMetalV)', opacity: 0.55 });
  el(crank, 'circle', { r: 20, fill: 'url(#gMetal)', stroke: '#55555f' });
  txt(svg, 412, CY + 4, 'CRANK', { 'font-size': 8, 'text-anchor': 'end' });
  const rod = el(svg, 'g', {});
  el(rod, 'path', { d: `M-13 0 L-9 ${L} H9 L13 0 Z`, fill: 'url(#gSteel)', stroke: '#55555f' });
  el(rod, 'path', { d: `M-4 18 L-3 ${L - 30} H3 L4 18 Z`, fill: '#4a4a52' });
  el(rod, 'circle', { r: 17, fill: '#9a9aa3', stroke: '#55555f' });
  el(rod, 'circle', { r: 9, fill: '#6a6a72' });
  el(rod, 'circle', { cy: L, r: 30, fill: 'url(#gSteel)', stroke: '#55555f' });
  el(rod, 'circle', { cy: L, r: 21, fill: '#d08a3a' });
  el(rod, 'circle', { cy: L, r: 18, fill: 'url(#gMetal)' });
  for (const sx of [-24, 24]) el(rod, 'rect', { x: sx - 3, y: L + 4, width: 6, height: 26, fill: '#77787f' });
  const piston = el(svg, 'g', {});
  const pw = BORE_R - BORE_L - 2;
  el(piston, 'path', {
    d: `M${BORE_L + 1} 0 H${BORE_R - 1} V96 H${BORE_R - 9} V60 Q${CX + 34} 56 ${CX + 26} 78 H${CX - 26} Q${CX - 34} 56 ${BORE_L + 9} 60 V96 H${BORE_L + 1} Z
        M${CX - 42} 0 Q${CX - 46} 16 ${CX - 30} 20 Q${CX} 26 ${CX + 30} 20 Q${CX + 46} 16 ${CX + 42} 0 Z`,
    fill: 'url(#gMetal)', 'fill-rule': 'evenodd', stroke: '#55555f',
  });
  for (const [y, h, c] of [[9, 4, '#3a3a44'], [19, 4, '#3a3a44'], [30, 5, '#2e2e36']] as const) {
    el(piston, 'rect', { x: BORE_L + 1, y, width: 8, height: h, fill: c });
    el(piston, 'rect', { x: BORE_R - 9, y, width: 8, height: h, fill: c });
  }
  el(piston, 'circle', { cx: CX, cy: PIN, r: 12, fill: 'url(#gSteel)', stroke: '#55555f' });
  void pw;
  txt(svg, 452, TOP_TDC + 4, 'TDC', { 'font-size': 8, 'text-anchor': 'end', fill: '#69db7c' });
  txt(svg, 452, TOP_TDC + 154, 'BDC', { 'font-size': 8, 'text-anchor': 'end', fill: '#69db7c' });
  el(svg, 'line', { x1: 372, y1: TOP_TDC, x2: 428, y2: TOP_TDC, stroke: '#69db7c', 'stroke-dasharray': '3 3', opacity: 0.5 });
  el(svg, 'line', { x1: 372, y1: TOP_TDC + 150, x2: 428, y2: TOP_TDC + 150, stroke: '#69db7c', 'stroke-dasharray': '3 3', opacity: 0.5 });
  const strokeTag = txt(svg, CX, 708, '', { 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'Michroma, sans-serif', 'letter-spacing': 2 });

  // ---------------- pressure chart ----------------
  const chart = root.querySelector('#egChart') as SVGSVGElement;
  const X0 = 44, X1 = 712, Y0 = 205, Y1 = 14;
  const xOf = (t: number) => X0 + ((X1 - X0) * t) / 720;
  STROKES.forEach((s, i) => {
    el(chart, 'rect', { x: xOf(i * 180), y: Y1, width: xOf(180) - X0, height: Y0 - Y1, fill: STROKE_COL[s.id], opacity: 0.05 });
    txt(chart, xOf(i * 180 + 90), 226, s.title.toUpperCase(), { 'text-anchor': 'middle', fill: STROKE_COL[s.id], 'font-size': 10 });
  });
  const selBand = el(chart, 'rect', { y: Y1, height: Y0 - Y1, fill: '#fff', opacity: 0 });
  for (const t of [0, 180, 360, 540, 720]) {
    el(chart, 'line', { x1: xOf(t), y1: Y1, x2: xOf(t), y2: Y0, stroke: '#24242a' });
    txt(chart, xOf(t), Y0 + 11, t === 360 ? 'TDC 360°' : t === 0 || t === 720 ? 'TDC' : 'BDC', { 'text-anchor': 'middle', 'font-size': 9 });
  }
  const lifts = el(chart, 'g', {});
  el(chart, 'line', { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: '#33333b' });
  const yLab = [0, 1, 2, 3].map(() => txt(chart, X0 - 4, 0, '', { 'text-anchor': 'end', 'font-size': 9 }));
  const yLin = [0, 1, 2, 3].map(() => el(chart, 'line', { x1: X0, x2: X1, stroke: '#1a1a20' }));
  const trace = el(chart, 'path', { stroke: '#e6e6e9', 'stroke-width': 2, fill: 'none' });
  const traceRef = el(chart, 'path', { stroke: '#69db7c', 'stroke-width': 1, fill: 'none', 'stroke-dasharray': '4 3', opacity: 0.6 });
  const cursor = el(chart, 'line', { y1: Y1, y2: Y0, stroke: '#ff3b30', opacity: 0.4 });
  const dot = el(chart, 'circle', { r: 5, fill: '#ff3b30' });
  const note = txt(chart, X1 - 4, Y1 + 12, '', { 'text-anchor': 'end', 'font-size': 10, fill: '#c9c9cf' });
  // valve lift strips under the trace
  const liftPath = (v: 'intake' | 'exhaust') => {
    let d = '';
    for (let t = 0; t <= 720; t += 3) d += `${t ? 'L' : 'M'}${xOf(t).toFixed(1)} ${(Y0 - 26 * valveLift(t, v)).toFixed(1)} `;
    return d;
  };
  el(lifts, 'path', { d: liftPath('intake'), stroke: '#6fd3ff', fill: 'none', opacity: 0.45 });
  el(lifts, 'path', { d: liftPath('exhaust'), stroke: '#b0b0b8', fill: 'none', opacity: 0.45 });
  txt(lifts, xOf(90), Y0 - 30, 'intake lift', { 'font-size': 8, fill: '#6fd3ff', 'text-anchor': 'middle' });
  txt(lifts, xOf(618), Y0 - 30, 'exhaust lift', { 'font-size': 8, fill: '#b0b0b8', 'text-anchor': 'middle' });
  let key = '', yMax = 1000;
  const yOf = (p: number) => Y0 - ((Y0 - Y1) * p) / yMax;
  function drawChart(c: ReturnType<typeof cycleForCylinder>) {
    const k = `${c.intakePsiA.toFixed(0)}|${c.sealing.toFixed(2)}|${c.fuel.toFixed(2)}`;
    if (k === key) return;
    key = k;
    const pts: number[] = [];
    for (let t = 0; t <= 720; t += 2) pts.push(cylinderPressure(t, c) - 14.7);
    const ref = c.sealing > 0.97 ? null : pts.map((_, i) => cylinderPressure(i * 2, { ...c, sealing: 1 }) - 14.7);
    const peak = Math.max(...pts, ...(ref ?? []));
    yMax = Math.max(800, Math.ceil((peak * 1.1) / 500) * 500);
    yLab.forEach((t, i) => { const v = (yMax / 4) * (i + 1); set(t, { y: yOf(v) + 3 }); t.textContent = `${v}`; });
    yLin.forEach((l, i) => { const y = yOf((yMax / 4) * (i + 1)); set(l, { y1: y, y2: y }); });
    const path = (a: number[]) => a.map((p, i) => `${i ? 'L' : 'M'}${xOf(i * 2).toFixed(1)} ${yOf(Math.max(0, p)).toFixed(1)}`).join(' ');
    trace.setAttribute('d', path(pts));
    traceRef.setAttribute('d', ref ? path(ref) : '');
    note.textContent = `psi gauge · peak ${Math.round(Math.max(...pts))} psi${ref ? ` · dashed: healthy ${Math.round(Math.max(...ref))} psi` : ''}`;
  }

  // ---------------- per-frame ----------------
  let lastNow = 0;
  function draw(dt: number) {
    const e = eng();
    if (!e) return;
    const s = e.state;
    const th = U.theta;
    const cyc = cycleForCylinder(s, U.cyl);
    const p = cylinderPressure(th, cyc) - 14.7;
    const st = strokeAt(th);
    // piston, rod, crank
    const a = ((th % 360) * Math.PI) / 180;
    const pinY = CY - (R * Math.cos(a) + Math.sqrt(L * L - (R * Math.sin(a)) ** 2));
    const top = pinY - PIN;
    piston.setAttribute('transform', `translate(0 ${top})`);
    const cpx = CX + R * Math.sin(a), cpy = CY - R * Math.cos(a);
    const rodAng = (Math.atan2(cpx - CX, cpy - pinY) * 180) / Math.PI;
    rod.setAttribute('transform', `translate(${CX} ${pinY}) rotate(${-rodAng})`);
    crank.setAttribute('transform', `translate(${CX} ${CY}) rotate(${th % 360})`);
    // valvetrain: cam at half crank speed, nose toward the bucket at full lift
    for (const [v, o, mid] of [['intake', vIn, (VT.intakeOpens + VT.intakeCloses) / 2], ['exhaust', vEx, (VT.exhaustOpens + VT.exhaustCloses) / 2]] as const) {
      const lift = valveLift(th, v) * LIFT_PX;
      o.g.setAttribute('transform', `translate(0 ${lift})`);
      o.cam.setAttribute('transform', `translate(${o.x} ${CAM_Y}) rotate(${-(wrap(th - mid + 360) - 360) / 2})`);
      drawSpring(o.spring, o.x, BUCKET_TOP + 18 + lift, 148);
    }
    // gas
    clipRect.setAttribute('height', String(Math.max(2, top - DECK + 26))); // includes the piston bowl
    const comp = st === 'compression' ? clamp((th - VT.intakeCloses + 35) / 180, 0, 1) : 0;
    const burnT = cyc.fuel > 0 ? th - 356 : -1;
    let col = '#6fd3ff', op = 0.12;
    if (st === 'compression') { col = `rgb(${111 + 144 * comp},${211 - 80 * comp},${255 - 210 * comp})`; op = 0.12 + 0.28 * comp * comp; }
    if (st === 'power') {
      if (burnT >= 0) { const f = clamp(1 - burnT / 150, 0, 1); col = `rgb(255,${Math.round(90 + 80 * f)},${Math.round(30 * f)})`; op = 0.15 + 0.4 * f; }
      else { col = '#f5a623'; op = 0.35; }
    }
    if (st === 'exhaust') { col = '#7a7a82'; op = 0.22; }
    set(gas, { fill: col, opacity: op });
    // cylinder particles: tumble while air moves, crowd as the volume shrinks
    const h = Math.max(4, top - DECK);
    const li = valveLift(th, 'intake'), le = valveLift(th, 'exhaust');
    const spin = (0.5 + 2.5 * li + (st === 'compression' ? 0.6 : 0) + (st === 'power' ? 1.2 : 0)) * dt * (U.speed / 60);
    const pc = st === 'intake' ? '#8fe3ff' : st === 'compression' ? (comp > 0.85 ? '#ffd27a' : '#bfe8ff') : st === 'power' ? (burnT >= 0 && burnT < 90 ? '#ffe08a' : '#c9a07a') : '#9a9aa3';
    for (const q of P) {
      const du = q.u - 0.5, dv = q.v - 0.5;
      const ca = Math.cos(spin), sa = Math.sin(spin);
      q.u = 0.5 + du * ca - dv * sa;
      q.v = 0.5 + du * sa + dv * ca;
      if (q.u < 0.02 || q.u > 0.98 || q.v < 0.02 || q.v > 0.98) { q.u = clamp(q.u, 0.03, 0.97); q.v = clamp(q.v, 0.03, 0.97); }
      set(q.c, { cx: BORE_L + 6 + q.u * (BORE_R - BORE_L - 12), cy: DECK + 2 + q.v * (h - 4), fill: pc, opacity: st === 'exhaust' ? 0.35 + 0.4 * (1 - le) : 0.75 });
    }
    // port flow
    const flow = (path: SVGPathElement, dots: { s: number; c: SVGCircleElement }[], lift: number) => {
      const len = path.getTotalLength();
      for (const d of dots) {
        d.s = (d.s + lift * dt * 0.9 * (U.speed / 60)) % 1;
        const pt = path.getPointAtLength(d.s * len);
        set(d.c, { cx: pt.x, cy: pt.y + ((d.s * 97) % 1) * 14 - 2, opacity: lift > 0.02 ? 0.9 : 0.35 });
      }
    };
    flow(inFlow, inDots, li);
    flow(exFlow, exDots, le);
    // injection and flame
    const soi = 360 - ENGINE_SPEC.injectionBtdc;
    const inj = cyc.fuel > 0 && th >= soi && th < soi + 8 + 18 * cyc.fuel;
    sprayG.setAttribute('opacity', inj ? '1' : '0');
    if (inj) {
      const len = 24 + 60 * clamp((th - soi) / 10, 0, 1);
      for (const sp of sprays) {
        const r = ((sp.a ?? 0) * Math.PI) / 180;
        const dx = Math.sin(r), dy = Math.cos(r) * 0.42;
        const ex = CX + dx * len, ey = DECK + 2 + dy * len * 1.1 + 8;
        const nx = -dy, ny = dx;
        sp.setAttribute('d', `M${CX} ${DECK - 1} L${ex + nx * 6} ${ey + ny * 6} L${ex - nx * 6} ${ey - ny * 6} Z`);
      }
    }
    const fl = burnT < 0 || burnT > 130 ? 0 : burnT < 14 ? burnT / 14 : 1 - (burnT - 14) / 116;
    flameG.setAttribute('opacity', String(clamp(fl, 0, 1) * (0.5 + 0.5 * cyc.fuel)));
    if (fl > 0) {
      const grow = clamp(burnT / 26, 0.2, 1);
      for (const f of flames) {
        const r = (f.a * Math.PI) / 180;
        set(f.e, { cx: CX + Math.sin(r) * 58 * grow, cy: DECK + 12 + h * 0.45 * grow, rx: 26 + 34 * grow, ry: Math.max(12, h * 0.5 * grow) });
      }
    }
    // oil jet under the piston
    set(oilJet, { d: `M${BORE_R - 22} ${DECK + 250} L${BORE_R - 34} ${top + 70} L${BORE_R - 18} ${top + 70} Z`, opacity: e.state.running ? 0.7 : 0.25 });
    strokeTag.textContent = st.toUpperCase() + (inj ? ' · INJECTING' : '');
    strokeTag.setAttribute('fill', STROKE_COL[st]);

    // text side
    drawChart(cyc);
    set(dot, { cx: xOf(th), cy: yOf(Math.max(0, p)) });
    set(cursor, { x1: xOf(th), x2: xOf(th) });
    const tC = airTempC(th, s.running ? s.intakeTempC : s.ambientC, cyc.sealing);
    (root.querySelector('#egAng') as HTMLElement).textContent = `${Math.round(th)}°`;
    (root.querySelector('#egPos') as HTMLElement).textContent = `${pistonFromTdcMm(th).toFixed(0)} mm`;
    (root.querySelector('#egP') as HTMLElement).textContent = `${Math.max(0, Math.round(p))} psi`;
    (root.querySelector('#egT') as HTMLElement).textContent = st === 'power' && burnT >= 0 && burnT < 80 ? '≈ 1,800 °C flame' : st === 'power' || st === 'exhaust' ? (cyc.fuel > 0 ? `≈ ${Math.round(250 + 400 * cyc.fuel + (st === 'power' ? 200 : 0))} °C` : `${Math.round(tC)} °C`) : `${Math.round(tC)} °C`;
    const showing = U.sel === 'all' ? st : U.sel;
    renderText(showing, st);
    (root.querySelector('#egSpeedNote') as HTMLElement).innerHTML = s.running
      ? `The truck's engine is running at <b>${Math.round(s.rpm)} rpm</b>: one cycle takes ${(120000 / s.rpm).toFixed(0)} ms. This animation is about ${Math.round((s.rpm * 6) / U.speed)} times slower. Boost, fuel and cylinder ${U.cyl}'s condition come from the live truck.`
      : 'Engine stopped: the cylinder is shown being cranked over without fuel, so there is compression but no injection or flame. Start the engine in the Engine shop to see it fire.';
  }

  let lastText = '';
  function renderText(showing: Stroke, now: Stroke) {
    const k = `${showing}|${now}|${U.sel}`;
    if (k === lastText) return;
    lastText = k;
    const info = STROKES.find((x) => x.id === showing)!;
    (root.querySelector('#egStroke') as HTMLElement).innerHTML = `<span style="color:${STROKE_COL[showing]}">${info.title}</span><small>cylinder ${U.cyl} · ${info.range[0]}–${info.range[1]}° · piston ${info.piston}</small>`;
    (root.querySelector('#egExplain') as HTMLElement).innerHTML = info.detail;
    (root.querySelector('#egEvents') as HTMLElement).innerHTML = `<div class="small muted">Key moments (click one to jump there):</div>` +
      info.events.map(([t, l]) => `<button data-t="${t}"><b>${wrap(t) === 0 && t > 0 ? 720 : Math.round(wrap(t))}°</b> ${l}</button>`).join('');
    root.querySelectorAll<HTMLElement>('#egCards button').forEach((b) => {
      b.classList.toggle('on', b.dataset.st === U.sel);
      b.classList.toggle('now', b.dataset.st === now);
    });
    if (U.sel === 'all') set(selBand, { opacity: 0 });
    else set(selBand, { x: xOf(info.range[0]), width: xOf(180) - X0, opacity: 0.06 });
  }

  function step(now: number) {
    requestAnimationFrame(step);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (!root.offsetParent) return;
    if (U.playing) {
      let t = U.theta + U.speed * dt;
      if (U.sel !== 'all') {
        const r = STROKES.find((x) => x.id === U.sel)!.range;
        if (t >= r[1] || t < r[0]) t = r[0] + (((t - r[0]) % 180) + 180) % 180;
        U.theta = t;
      } else U.theta = wrap(t);
    }
    draw(dt);
  }
  requestAnimationFrame(step);

  // ---------------- controls ----------------
  const btn = (id: string) => root.querySelector(id) as HTMLElement;
  const setPlaying = (p: boolean) => { U.playing = p; btn('#egPlay').textContent = p ? 'Pause' : 'Play'; };
  btn('#egPlay').addEventListener('click', () => setPlaying(!U.playing));
  btn('#egSpeed').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-s]') as HTMLElement | null;
    if (!b) return;
    U.speed = +b.dataset.s!;
    root.querySelectorAll('#egSpeed button').forEach((x) => x.classList.toggle('on', x === b));
  });
  const nudge = (d: number) => { setPlaying(false); U.theta = wrap(U.theta + d); lastText = ''; draw(0); };
  btn('#egBack').addEventListener('click', () => nudge(-5));
  btn('#egFwd').addEventListener('click', () => nudge(5));
  btn('#egCards').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-st]') as HTMLElement | null;
    if (!b) return;
    U.sel = b.dataset.st as Stroke | 'all';
    if (U.sel !== 'all') U.theta = STROKES.find((x) => x.id === U.sel)!.range[0];
    setPlaying(true);
    lastText = '';
    draw(0);
  });
  btn('#egEvents').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-t]') as HTMLElement | null;
    if (!b) return;
    const t = wrap(+b.dataset.t!);
    // keep the stroke selection unless the moment belongs to another stroke
    if (U.sel !== 'all' && strokeAt(t) !== U.sel) U.sel = 'all';
    U.theta = t;
    setPlaying(false);
    lastText = '';
    draw(0);
  });
  btn('#egCylSel').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-c]') as HTMLElement | null;
    if (!b) return;
    U.cyl = +b.dataset.c!;
    root.querySelectorAll('#egCylSel button').forEach((x) => x.classList.toggle('on', x === b));
    key = '';
    lastText = '';
    draw(0);
  });
}
