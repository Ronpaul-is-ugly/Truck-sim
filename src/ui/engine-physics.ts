// The basic physics of internal combustion, one idea at a time, each with a small interactive model.
// Numbers come from the same engine as the rest of the page (ENGINE_SPEC and the cylinder pressure model).
import { ENGINE_SPEC, cylinderPressure, pistonFromTdcMm, displacementL } from '../engine';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (x: number, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const BORE = ENGINE_SPEC.boreMm / 1000;
const AREA = (Math.PI / 4) * BORE * BORE; // m²
const THROW = ENGINE_SPEC.strokeMm / 2000;
const ROD = 0.256;
const VD1 = AREA * (ENGINE_SPEC.strokeMm / 1000); // one cylinder, m³
const GAMMA = 1.35; // real compression is between isothermal (1.0) and ideal adiabatic (1.4)

interface Topic {
  id: string;
  title: string;
  lead: string;
  html: () => string;
  wire?: (root: HTMLElement) => void;
}

function slider(id: string, label: string, min: number, max: number, step: number, val: number, unit = '') {
  return `<label class="phS"><span>${esc(label)} <b id="${id}V"></b>${unit ? ` <em>${unit}</em>` : ''}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
}
function read(k: string, v: string) {
  return `<div><span>${esc(k)}</span><b>${v}</b></div>`;
}

const TOPICS: Topic[] = [
  {
    id: 'chain',
    title: '1 · Heat to motion',
    lead: 'An internal combustion engine turns chemical energy in fuel into heat, heat into gas pressure, pressure into force on a piston, and force into rotation.',
    html: () => `
      <svg viewBox="0 0 760 150" class="phSvg">
        ${['Fuel + air', 'Heat', 'Gas pressure', 'Force on piston', 'Torque at crank'].map((t, i) => `
          <rect x="${8 + i * 152}" y="30" width="126" height="56" rx="6" fill="#111115" stroke="${['#f5a623', '#ff3b30', '#ff6b6b', '#6fd3ff', '#69db7c'][i]}"/>
          <text x="${71 + i * 152}" y="63" text-anchor="middle" fill="#e6e6e9" font-size="13" font-family="IBM Plex Mono">${t}</text>
          ${i < 4 ? `<path d="M${136 + i * 152} 58 h14" stroke="#8a8a93" stroke-width="2" marker-end="url(#phA)"/>` : ''}`).join('')}
        <defs><marker id="phA" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#8a8a93"/></marker></defs>
        ${['burning', 'gas expands', 'P × A', 'F × lever'].map((t, i) => `<text x="${143 + i * 152}" y="108" text-anchor="middle" fill="#8a8a93" font-size="11" font-family="IBM Plex Mono">${t}</text>`).join('')}
      </svg>
      <p>The word <b>internal</b> matters: the fuel burns <i>inside</i> the cylinder, so the hot gas pushes directly on the piston. (A steam engine is external combustion: fire boils water in a separate boiler.)</p>
      <p>No engine turns all of the fuel's energy into work. A modern heavy-duty diesel at its best point delivers a bit over 40%:</p>
      <div class="phBal">
        <i style="flex:43;background:#69db7c">43% work at the flywheel</i><i style="flex:29;background:#ff6b6b">29% hot exhaust</i><i style="flex:20;background:#6fd3ff">20% coolant &amp; oil</i><i style="flex:8;background:#8a8a93">8%</i>
      </div>
      <p class="small muted">Typical full-load energy balance; the last 8% is friction, pumping and heat radiated from the block. The turbo recovers some exhaust energy; the radiator and charge air cooler throw the rest away.</p>`,
  },
  {
    id: 'compress',
    title: '2 · Squeezing air makes it hot',
    lead: 'Compress a gas quickly and the work you put in becomes heat. A diesel uses this instead of a spark: the air gets hot enough to light the fuel the moment it is sprayed in.',
    html: () => `
      ${slider('phCr', 'Compression ratio', 8, 24, 0.5, ENGINE_SPEC.compressionRatio, ': 1')}
      ${slider('phT1', 'Air temperature going in', -30, 60, 1, 40, '°C')}
      <div class="egRead phRead" id="phCompOut"></div>
      <svg viewBox="0 0 640 70" class="phSvg" id="phCompBar"></svg>
      <p><b>Compression ratio</b> is the cylinder volume with the piston at the bottom divided by the volume left at the top. At ${ENGINE_SPEC.compressionRatio}:1 the air is squeezed into about one eighteenth of its space.</p>
      <p>For fast compression (no time to lose heat) the temperature follows <span class="mono">T₂ = T₁ × CR<sup>n−1</sup></span> and the pressure <span class="mono">P₂ = P₁ × CR<sup>n</sup></span>, with temperatures in kelvin and n about 1.35 in a real engine. Diesel fuel self-ignites at roughly 250 °C in still air; in a running engine the air needs to be closer to 500 °C for the fuel to light quickly, which is why a cold engine, low compression (worn rings, a leaking valve) or low cranking speed makes a diesel hard to start.</p>
      <p class="small muted">A gasoline engine runs about 9–12:1. Any higher and the fuel-air mix lights on its own before the spark (knock). A diesel only has air in the cylinder during compression, so it can use 15–20:1.</p>`,
    wire: (r) => {
      const cr = r.querySelector('#phCr') as HTMLInputElement, t1 = r.querySelector('#phT1') as HTMLInputElement;
      const up = () => {
        const CR = +cr.value, T1 = +t1.value + 273.15;
        const T2 = T1 * CR ** (GAMMA - 1), P2 = 1.013 * CR ** GAMMA;
        (r.querySelector('#phCrV') as HTMLElement).textContent = fmt(CR, 1);
        (r.querySelector('#phT1V') as HTMLElement).textContent = fmt(+t1.value);
        const c = T2 - 273.15;
        (r.querySelector('#phCompOut') as HTMLElement).innerHTML =
          read('Air at top of stroke', `${fmt(c)} °C / ${fmt(c * 1.8 + 32)} °F`) + read('Pressure (no turbo)', `${fmt(P2, 1)} bar / ${fmt(P2 * 14.5)} psi`) +
          read('Volume left', `${fmt(100 / CR, 1)}%`) + read('Will it light?', c > 500 ? '<span class="ok">Yes, quickly</span>' : c > 350 ? '<span style="color:var(--amber)">Slowly: hard start</span>' : '<span class="bad">No</span>');
        const x = (t: number) => 20 + Math.min(1, Math.max(0, t / 900)) * 600;
        (r.querySelector('#phCompBar') as SVGSVGElement).innerHTML = `
          <rect x="20" y="20" width="600" height="18" fill="#111115" stroke="#2a2a31"/>
          <rect x="${x(250)}" y="20" width="${x(900) - x(250)}" height="18" fill="#ff3b30" opacity=".18"/>
          <rect x="20" y="20" width="${x(c) - 20}" height="18" fill="#f5a623" opacity=".85"/>
          <line x1="${x(250)}" y1="14" x2="${x(250)}" y2="44" stroke="#ff6b6b"/><text x="${x(250)}" y="58" fill="#ff6b6b" font-size="11" text-anchor="middle" font-family="IBM Plex Mono">diesel self-ignites ~250 °C</text>
          <line x1="${x(500)}" y1="14" x2="${x(500)}" y2="44" stroke="#69db7c"/><text x="${x(500)}" y="10" fill="#69db7c" font-size="11" text-anchor="middle" font-family="IBM Plex Mono">fast, clean ignition</text>
          ${[0, 300, 600, 900].map((t) => `<text x="${x(t)}" y="68" fill="#8a8a93" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${t}°C</text>`).join('')}`;
      };
      cr.oninput = up;
      t1.oninput = up;
      up();
    },
  },
  {
    id: 'burn',
    title: '3 · Burning fuel',
    lead: 'Combustion is a fast chemical reaction: hydrocarbon fuel joins with oxygen from the air and releases heat.',
    html: () => `
      <p class="phEq">C<sub>12</sub>H<sub>23</sub> (diesel, average) + O<sub>2</sub> (from air) → CO<sub>2</sub> + H<sub>2</sub>O + <b>heat</b></p>
      ${slider('phAfr', 'Air-fuel ratio (by weight)', 12, 60, 0.5, 25, ': 1')}
      <div class="egRead phRead" id="phBurnOut"></div>
      <p>Air is only about 21% oxygen (the rest is mostly nitrogen, which just gets heated and pushed around). It takes about <b>14.5 kg of air to burn 1 kg of diesel</b> completely: that's the <b>stoichiometric</b> ratio.</p>
      <p>A diesel always runs with extra air, from about 18:1 at full load to over 60:1 at idle, because the fuel is sprayed in as droplets and some of them never find oxygen in time. Push the ratio too close to 14.5:1 and the unburned carbon leaves as <b>black smoke</b> (soot). That's why the ECM limits fuel until the turbo has built boost.</p>
      <p>Diesel holds about <b>43 MJ per kg</b> (about 129,000 BTU per US gallon). The heat from burning also makes <b>NOx</b> when the flame is very hot: EGR and the SCR system exist to deal with it.</p>`,
    wire: (r) => {
      const a = r.querySelector('#phAfr') as HTMLInputElement;
      const up = () => {
        const afr = +a.value, lambda = afr / 14.5;
        (r.querySelector('#phAfrV') as HTMLElement).textContent = fmt(afr, 1);
        const left = Math.max(0, 1 - 1 / lambda) * 100;
        const smoke = lambda < 1.1 ? '<span class="bad">Heavy black smoke</span>' : lambda < 1.35 ? '<span style="color:var(--amber)">Some smoke (full-load limit)</span>' : '<span class="ok">Clean</span>';
        (r.querySelector('#phBurnOut') as HTMLElement).innerHTML =
          read('Excess air (λ)', fmt(lambda, 2)) + read('Oxygen left over', `${fmt(left)}%`) + read('Exhaust', smoke) + read('Where you see it', lambda > 3 ? 'idle' : lambda > 1.6 ? 'cruise' : 'full load');
      };
      a.oninput = up;
      up();
    },
  },
  {
    id: 'force',
    title: '4 · Pressure × area = force',
    lead: 'Pressure is force spread over an area. The hot gas presses on every square inch of the piston crown, and the total adds up fast.',
    html: () => `
      ${slider('phP', 'Cylinder pressure', 0, 220, 1, 160, 'bar')}
      <div class="egRead phRead" id="phForceOut"></div>
      <p>Force = pressure × area. This engine's piston is ${ENGINE_SPEC.boreMm} mm across (${fmt(ENGINE_SPEC.boreMm / 25.4, 2)} in), so its crown is ${fmt(AREA * 1e4, 0)} cm² (${fmt(AREA * 1550, 1)} in²). Peak firing pressure in a modern heavy-duty diesel is about 180–220 bar (2,600–3,200 psi).</p>
      <p>That push goes straight down the connecting rod and into the crank journal and the main bearings, which is why they ride on a pressurized oil film and why low oil pressure ruins them so quickly.</p>`,
    wire: (r) => {
      const p = r.querySelector('#phP') as HTMLInputElement;
      const up = () => {
        const bar = +p.value, N = bar * 1e5 * AREA;
        (r.querySelector('#phPV') as HTMLElement).textContent = `${fmt(bar)} (${fmt(bar * 14.5)} psi)`;
        (r.querySelector('#phForceOut') as HTMLElement).innerHTML =
          read('Force on the piston', `${fmt(N / 1000, 0)} kN`) + read('In pounds', `${fmt(N * 0.2248)} lbf`) + read('Like the weight of', `${fmt(N / 9.81 / 1000, 1)} t`) + read('Per square inch', `${fmt(bar * 14.5)} lb`);
      };
      p.oninput = up;
      up();
    },
  },
  {
    id: 'torque',
    title: '5 · Force × leverage = torque',
    lead: 'The crankshaft is a lever. The rod pushes on the crankpin, which sits off-center by half the stroke, and that twist is torque.',
    html: () => `
      <div class="phTwo">
        <svg viewBox="0 0 240 300" class="phSvg" id="phCrank" style="max-width:240px"></svg>
        <div>
          ${slider('phAng', 'Crank angle after TDC', 0, 180, 1, 30, '°')}
          ${slider('phF', 'Force on the piston', 0, 280, 5, 200, 'kN')}
          <div class="egRead phRead" id="phTqOut" style="grid-template-columns:1fr 1fr"></div>
        </div>
      </div>
      <p>Torque = force × lever arm. The useful lever is not the full throw (${fmt(THROW * 1000)} mm): it depends on the angle. At top dead center the rod pushes straight through the crank center and makes <b>no torque at all</b>, no matter how high the pressure. That's why fuel is burned just after TDC, as the lever arm grows.</p>
      <p><b>Power</b> is torque delivered over time: <span class="mono">kW = N·m × rpm ÷ 9,549</span> (or <span class="mono">hp = lb·ft × rpm ÷ 5,252</span>). Six cylinders taking turns every 120° smooth the pulses into steady torque at the flywheel.</p>
      ${slider('phTq', 'Engine torque', 500, 2800, 50, 2400, 'N·m')}
      ${slider('phRpm', 'Engine speed', 600, 2100, 50, 1200, 'rpm')}
      <div class="egRead phRead" id="phPwrOut"></div>`,
    wire: (r) => {
      const ang = r.querySelector('#phAng') as HTMLInputElement, f = r.querySelector('#phF') as HTMLInputElement;
      const tq = r.querySelector('#phTq') as HTMLInputElement, rpm = r.querySelector('#phRpm') as HTMLInputElement;
      const up = () => {
        const a = (+ang.value * Math.PI) / 180, F = +f.value * 1000;
        const beta = Math.asin((THROW * Math.sin(a)) / ROD);
        const arm = (THROW * Math.sin(a + beta)) / Math.cos(beta); // effective lever for force along the cylinder axis
        const T = F * arm;
        (r.querySelector('#phAngV') as HTMLElement).textContent = ang.value;
        (r.querySelector('#phFV') as HTMLElement).textContent = f.value;
        (r.querySelector('#phTqOut') as HTMLElement).innerHTML = read('Lever arm', `${fmt(arm * 1000)} mm`) + read('Torque, one cylinder', `${fmt(T)} N·m · ${fmt(T * 0.7376)} lb·ft`);
        const S = 300 / 0.62, cx = 120, cy = 245;
        const px = cx + Math.sin(a) * THROW * S, py = cy - Math.cos(a) * THROW * S;
        const wy = py - Math.sqrt(ROD * ROD - (Math.sin(a) * THROW) ** 2) * S;
        (r.querySelector('#phCrank') as SVGSVGElement).innerHTML = `
          <rect x="${cx - 34}" y="10" width="68" height="${wy - 2}" fill="none" stroke="#33333b"/>
          <rect x="${cx - 32}" y="${wy - 30}" width="64" height="40" fill="#b9bec5"/>
          <path d="M${cx} ${wy - 64} v28" stroke="#ff6b6b" stroke-width="3" marker-end="url(#phA2)"/><text x="${cx + 6}" y="${wy - 56}" fill="#ff6b6b" font-size="11" font-family="IBM Plex Mono">F</text>
          <line x1="${cx}" y1="${wy}" x2="${px}" y2="${py}" stroke="#8f949b" stroke-width="9" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="${THROW * S + 16}" fill="none" stroke="#2a2a31" stroke-dasharray="3 4"/>
          <line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="#c9ced5" stroke-width="12" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="7" fill="#e6e6e9"/><circle cx="${px}" cy="${py}" r="6" fill="#f5a623"/>
          <line x1="${cx}" y1="${cy}" x2="${cx + arm * S}" y2="${cy}" stroke="#69db7c" stroke-width="3"/>
          <text x="${cx + 4}" y="${cy + 22}" fill="#69db7c" font-size="11" font-family="IBM Plex Mono">lever ${fmt(arm * 1000)} mm</text>
          <defs><marker id="phA2" viewBox="0 0 8 8" refX="4" refY="7" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 0 L4 8 Z" fill="#ff6b6b" transform="rotate(-90 4 4)"/></marker></defs>`;
        const kw = (+tq.value * +rpm.value) / 9549;
        (r.querySelector('#phTqV') as HTMLElement).textContent = `${fmt(+tq.value)} (${fmt(+tq.value * 0.7376)} lb·ft)`;
        (r.querySelector('#phRpmV') as HTMLElement).textContent = rpm.value;
        (r.querySelector('#phPwrOut') as HTMLElement).innerHTML = read('Power', `${fmt(kw)} kW`) + read('Horsepower', `${fmt(kw * 1.341)} hp`) + read('Crank turns per second', fmt(+rpm.value / 60, 1)) + read('Firing strokes per second', fmt((+rpm.value / 60) * 3, 0));
      };
      [ang, f, tq, rpm].forEach((e) => (e.oninput = up));
      up();
    },
  },
  {
    id: 'pv',
    title: '6 · Work from one cycle (P-V diagram)',
    lead: 'Plot cylinder pressure against cylinder volume for all four strokes and you get a loop. The area inside the loop is the work one cylinder does per cycle.',
    html: () => `
      <svg viewBox="0 0 640 300" class="phSvg" id="phPv"></svg>
      ${slider('phFuel', 'Fuel (load)', 0, 100, 1, 80, '%')}
      ${slider('phBoost', 'Boost', 0, 40, 1, 25, 'psi')}
      ${slider('phRpm2', 'Engine speed', 600, 2100, 50, 1400, 'rpm')}
      <div class="egRead phRead" id="phPvOut"></div>
      <p>Going around the loop: <b style="color:#6fd3ff">intake</b> fills the cylinder at boost pressure, <b style="color:#f5a623">compression</b> squeezes it (the work comes out of the crank), <b style="color:#ff3b30">power</b> pushes back far harder after the fuel burns, and <b style="color:#9a9aa3">exhaust</b> pushes the gas out. The power stroke gives back more than compression took: that difference is the net work. More fuel makes the loop taller; more boost lets more fuel burn cleanly.</p>
      <p class="small muted">Same pressure model as the four-stroke animation below. Indicated work is before friction, so it is higher than what reaches the flywheel.</p>`,
    wire: (r) => {
      const fu = r.querySelector('#phFuel') as HTMLInputElement, bo = r.querySelector('#phBoost') as HTMLInputElement, rp = r.querySelector('#phRpm2') as HTMLInputElement;
      const vc = VD1 / (ENGINE_SPEC.compressionRatio - 1);
      const vol = (t: number) => vc + AREA * (pistonFromTdcMm(t) / 1000);
      const up = () => {
        const inputs = { intakePsiA: 14.7 + +bo.value, sealing: 1, fuel: +fu.value / 100 };
        (r.querySelector('#phFuelV') as HTMLElement).textContent = fu.value;
        (r.querySelector('#phBoostV') as HTMLElement).textContent = bo.value;
        (r.querySelector('#phRpm2V') as HTMLElement).textContent = rp.value;
        const pts: { v: number; p: number; t: number }[] = [];
        for (let t = 0; t <= 720; t += 2) pts.push({ v: vol(t), p: cylinderPressure(t, inputs), t });
        let W = 0;
        for (let i = 1; i < pts.length; i++) W += ((pts[i].p + pts[i - 1].p) / 2) * 6894.76 * (pts[i].v - pts[i - 1].v);
        const vmax = vc + VD1, pmax = 2600;
        const X = (v: number) => 60 + (v / vmax) * 560, Y = (p: number) => 270 - Math.min(1, p / pmax) * 250;
        const seg = (a: number, b: number, col: string) => `<path d="${pts.filter((q) => q.t >= a && q.t <= b).map((q, i) => `${i ? 'L' : 'M'}${X(q.v).toFixed(1)} ${Y(q.p).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
        const peak = Math.max(...pts.map((q) => q.p));
        (r.querySelector('#phPv') as SVGSVGElement).innerHTML = `
          <line x1="60" y1="270" x2="625" y2="270" stroke="#33333b"/><line x1="60" y1="15" x2="60" y2="270" stroke="#33333b"/>
          ${[0, 500, 1000, 1500, 2000, 2500].map((p) => `<text x="52" y="${Y(p) + 4}" fill="#8a8a93" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${p}</text><line x1="60" x2="625" y1="${Y(p)}" y2="${Y(p)}" stroke="#16161b"/>`).join('')}
          <text x="14" y="140" fill="#8a8a93" font-size="10" font-family="IBM Plex Mono" transform="rotate(-90 14 140)">pressure, psi abs</text>
          <text x="340" y="292" fill="#8a8a93" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">cylinder volume → (TDC at left, BDC at right)</text>
          <path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.v).toFixed(1)} ${Y(q.p).toFixed(1)}`).join(' ')} Z" fill="#69db7c" opacity=".08"/>
          ${seg(0, 180, '#6fd3ff')}${seg(180, 360, '#f5a623')}${seg(360, 540, '#ff3b30')}${seg(540, 720, '#9a9aa3')}
          <text x="${X(vol(372)) + 8}" y="${Y(peak) + 4}" fill="#ff6b6b" font-size="11" font-family="IBM Plex Mono">peak ${fmt(peak - 14.7)} psi</text>`;
        const kw = (W * 6 * (+rp.value / 120)) / 1000;
        (r.querySelector('#phPvOut') as HTMLElement).innerHTML =
          read('Work per cycle, one cylinder', `${fmt(W)} J`) + read('Mean effective pressure', `${fmt(W / VD1 / 1e5, 1)} bar`) + read('Indicated power, 6 cyl', `${fmt(kw)} kW · ${fmt(kw * 1.341)} hp`) + read('Displacement', `${fmt(displacementL(), 1)} L`);
      };
      [fu, bo, rp].forEach((e) => (e.oninput = up));
      up();
    },
  },
  {
    id: 'gas',
    title: '7 · Gas laws and the turbo',
    lead: 'How much power an engine can make is set by how much air it can get into the cylinders, because air is what the fuel needs to burn.',
    html: () => `
      ${slider('phB2', 'Boost', 0, 45, 1, 30, 'psi')}
      ${slider('phIat', 'Intake air temperature', 20, 200, 5, 45, '°C')}
      <div class="egRead phRead" id="phGasOut"></div>
      <p>The ideal gas law, <span class="mono">P·V = m·R·T</span>, says that in a fixed volume (one cylinder) the mass of air goes <b>up with pressure</b> and <b>down with temperature</b>. A turbo raises the pressure; the charge air cooler takes out the heat the turbo added. Without the cooler, compressed air leaves the turbo at 150–200 °C and much of the gain is lost.</p>
      <p>This is also why a plugged air filter, a leaking charge air boot or a lazy turbo show up as low power and black smoke: less air in, so less fuel can burn cleanly.</p>`,
    wire: (r) => {
      const b = r.querySelector('#phB2') as HTMLInputElement, t = r.querySelector('#phIat') as HTMLInputElement;
      const up = () => {
        const P = 14.7 + +b.value, T = +t.value + 273.15;
        const rho = (P * 6894.76) / (287 * T);
        const rho0 = 101325 / (287 * 298.15);
        const mass = rho * VD1 * 0.95; // ~95% volumetric efficiency
        (r.querySelector('#phB2V') as HTMLElement).textContent = b.value;
        (r.querySelector('#phIatV') as HTMLElement).textContent = t.value;
        (r.querySelector('#phGasOut') as HTMLElement).innerHTML =
          read('Air density', `${fmt(rho, 2)} kg/m³`) + read('vs. no turbo at 25 °C', `${fmt(rho / rho0, 2)}×`) + read('Air per cylinder fill', `${fmt(mass * 1e6, 0)} mg`) + read('Fuel it can burn (λ 1.4)', `${fmt((mass / (14.5 * 1.4)) * 1e6, 0)} mg`);
      };
      b.oninput = up;
      t.oninput = up;
      up();
    },
  },
  {
    id: 'eff',
    title: '8 · Why a diesel is efficient',
    lead: 'Squeeze the air harder before the fuel burns and more of the heat turns into work. Diesels squeeze much harder than gasoline engines, and they never throttle the air.',
    html: () => `
      ${slider('phCr2', 'Compression ratio', 6, 24, 0.5, ENGINE_SPEC.compressionRatio, ': 1')}
      <svg viewBox="0 0 640 220" class="phSvg" id="phEff"></svg>
      <p>For an ideal engine the best possible efficiency depends only on the compression ratio: <span class="mono">η = 1 − 1 / CR<sup>γ−1</sup></span> (γ ≈ 1.4 for air). Real engines lose some of that to heat flowing into the coolant, friction and pumping, but the trend holds.</p>
      <ul class="small">
        <li><b>Higher compression:</b> 15–20:1 vs. 9–12:1 for gasoline.</li>
        <li><b>No throttle plate:</b> a diesel controls power by how much fuel it injects, so it doesn't waste work sucking air past a half-closed valve at part load.</li>
        <li><b>Lean burning:</b> extra air means cooler gas for the same work, so less heat is lost to the walls.</li>
        <li><b>Denser fuel:</b> a gallon of diesel holds about 13% more energy than a gallon of gasoline.</li>
      </ul>`,
    wire: (r) => {
      const c = r.querySelector('#phCr2') as HTMLInputElement;
      const eta = (cr: number) => 1 - 1 / cr ** 0.4;
      const up = () => {
        const CR = +c.value;
        (r.querySelector('#phCr2V') as HTMLElement).textContent = fmt(CR, 1);
        const X = (v: number) => 50 + ((v - 4) / 22) * 570, Y = (e: number) => 190 - e * 260;
        let d = '';
        for (let v = 4; v <= 26; v += 0.25) d += `${d ? 'L' : 'M'}${X(v).toFixed(1)} ${Y(eta(v)).toFixed(1)}`;
        (r.querySelector('#phEff') as SVGSVGElement).innerHTML = `
          <line x1="50" y1="190" x2="625" y2="190" stroke="#33333b"/><line x1="50" y1="10" x2="50" y2="190" stroke="#33333b"/>
          ${[0, 0.2, 0.4, 0.6].map((e) => `<text x="44" y="${Y(e) + 4}" fill="#8a8a93" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${e * 100}%</text><line x1="50" x2="625" y1="${Y(e)}" y2="${Y(e)}" stroke="#16161b"/>`).join('')}
          ${[4, 8, 12, 16, 20, 24].map((v) => `<text x="${X(v)}" y="206" fill="#8a8a93" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${v}:1</text>`).join('')}
          <rect x="${X(9)}" y="10" width="${X(12) - X(9)}" height="180" fill="#6fd3ff" opacity=".07"/><text x="${(X(9) + X(12)) / 2}" y="24" fill="#6fd3ff" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">gasoline</text>
          <rect x="${X(15)}" y="10" width="${X(20) - X(15)}" height="180" fill="#f5a623" opacity=".07"/><text x="${(X(15) + X(20)) / 2}" y="24" fill="#f5a623" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">diesel</text>
          <path d="${d}" fill="none" stroke="#69db7c" stroke-width="2.5"/>
          <circle cx="${X(CR)}" cy="${Y(eta(CR))}" r="6" fill="#69db7c"/>
          <text x="${X(CR) + 10}" y="${Y(eta(CR)) + 18}" fill="#e6e6e9" font-size="12" font-family="IBM Plex Mono">${fmt(eta(CR) * 100)}% ideal</text>`;
      };
      c.oninput = up;
      up();
    },
  },
];

export function mountPhysics(root: HTMLElement) {
  root.innerHTML = `
    <h2>How an engine works · the basic physics</h2>
    <div class="phGrid">
      <div class="phList" id="phList">${TOPICS.map((t, i) => `<button data-t="${t.id}" class="${i === 0 ? 'on' : ''}"><b>${esc(t.title)}</b></button>`).join('')}</div>
      <div class="phBody" id="phBody"></div>
    </div>`;
  const body = root.querySelector('#phBody') as HTMLElement;
  const show = (id: string) => {
    const t = TOPICS.find((x) => x.id === id)!;
    root.querySelectorAll('#phList button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === id));
    body.innerHTML = `<h3>${esc(t.title.replace(/^\d+ · /, ''))}</h3><p class="phLead">${esc(t.lead)}</p>${t.html()}
      <div class="bar" style="margin-top:12px">${TOPICS.indexOf(t) > 0 ? '<button data-step="-1">◂ Previous</button>' : ''}${TOPICS.indexOf(t) < TOPICS.length - 1 ? '<button data-step="1" class="dark">Next idea ▸</button>' : ''}</div>`;
    t.wire?.(body);
  };
  root.querySelector('#phList')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-t]') as HTMLElement | null;
    if (b) show(b.dataset.t!);
  });
  body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-step]') as HTMLElement | null;
    if (!b) return;
    const cur = root.querySelector('#phList button.on') as HTMLElement;
    const i = TOPICS.findIndex((t) => t.id === cur.dataset.t) + +b.dataset.step!;
    show(TOPICS[i].id);
  });
  show(TOPICS[0].id);
}
