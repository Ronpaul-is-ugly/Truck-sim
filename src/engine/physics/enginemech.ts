// The base engine: block, crank, pistons, rings, valves, cam, head gasket, bearings, air filter, turbo seals.
// A 13-litre inline six laid out like the MX-13 in the 3D levels.
//
// It is the same engine everything else reads. The powertrain decides rpm, load, boost, oil pressure and
// coolant temperature from the driver's inputs; this system then applies what is physically wrong inside
// the engine: a cylinder that can't hold compression contributes less (so the ECM's crank-acceleration
// balance check sets that injector's FMI 7, exactly like a real ECM that can't tell a valve from an
// injector), worn bearings bleed off oil pressure (SPN 100), a head gasket pushes coolant out (SPN 110),
// a plugged air filter starves the turbo (SPN 102). Nothing here touches the control modules or the tools.
//
// Faults are part modifiers (see ENGINE_PARTS). The checks a technician runs (compression, leak-down,
// blow-by, valve lash…) are in engineInspect() and only describe what the tool or the eye would find.
import type { System, SimContext } from '../system';
import type { FaultSet } from '../faults';
import type { TruckState } from '../state';

/** Specs a technician would look up. Training values for this simulated engine: real limits come from the OEM. */
export const ENGINE_SPEC = {
  layout: 'Inline six, four-stroke, direct injection, turbocharged and charge-air cooled, single overhead cam',
  cylinders: 6,
  boreMm: 130,
  strokeMm: 162,
  /** Centre-to-centre connecting rod length. */
  rodMm: 256,
  compressionRatio: 18.5,
  firingOrder: [1, 5, 3, 6, 2, 4],
  lowIdleRpm: 650,
  ratedRpm: 1900,
  governedRpm: 2100,
  /** Injection starts this many degrees before TDC (at idle; the ECM advances it with speed). */
  injectionBtdc: 8,
  valveTiming: { intakeOpens: -15, intakeCloses: 215, exhaustOpens: 500, exhaustCloses: 735 },
  valveLashMm: { intake: 0.4, exhaust: 0.6, tolerance: 0.08 },
  compression: { nominalPsi: 400, minPsi: 350, maxSpreadPct: 10 },
  leakdown: { goodPct: 10, limitPct: 20 },
  oilPsi: { idleMin: 15, ratedMin: 35 },
  intakeRestriction: { cleanInH2O: 9, maxInH2O: 25 },
  /** Blow-by over this many times a new engine's at the same speed and load means wear. */
  blowbyLimitFactor: 1.6,
  thermostatOpensC: 82,
  coolantCapacityL: 45,
} as const;

export const displacementL = (s = ENGINE_SPEC) => (Math.PI / 4) * (s.boreMm / 10) ** 2 * (s.strokeMm / 10) * s.cylinders / 1000;

/** Parts this file reads. N is a cylinder 1–6. */
export const ENGINE_PARTS = [
  'mech.rings (damaged: all rings worn)', 'mech.pistonN (damaged: cracked piston / broken ring land)', 'mech.exhValveN (leak: burnt exhaust valve)',
  'mech.valveLashN (drift: value in mm; negative = intake lash closed up, positive = exhaust lash too loose)', 'mech.headGasket (leak: value = cylinder next to the breach)',
  'mech.mainBearings (damaged)', 'mech.camLobeN (damaged: worn exhaust lobe)', 'mech.airFilter (addedOhms: restricted)', 'mech.turbo (damaged: oil seals)',
  'also read: mech.injectorN stuck, mech.lube leak (fuel-diluted oil), mech.coolant leak, mech.thermostat stuck',
];

export type Smoke = 'clear' | 'black' | 'blue' | 'white';
export type LeakPath = 'crankcase' | 'exhaust' | 'intake' | 'coolant';

export interface CylinderMech {
  /** How well the cylinder holds compression, 0–1. */
  sealing: number;
  /** Where the air that escapes goes. */
  leakPath: LeakPath;
  /** Cranking compression a gauge would read, psi. */
  compressionPsi: number;
  /** Cylinder leakage, % of the air put in. */
  leakPct: number;
  /** Peak cylinder pressure on the last cycle, psi (0 when not running). */
  peakPsi: number;
}

/** What the base engine is doing: the things a gauge, a meter or your eyes would find. */
export interface EngineMechState {
  /** Crankshaft position, 0–720°. 0 = cylinder 1 at TDC starting its intake stroke. */
  crankDeg: number;
  cyl: CylinderMech[];
  blowbyCfm: number;
  /** What a new engine would blow by at this speed and load. */
  blowbyNewCfm: number;
  coolantLevelPct: number;
  intakeRestrictionInH2O: number;
  exhaustTempC: number;
  smoke: Smoke;
  /** Engine run time since the last oil change, minutes (for the oil analysis). */
  runMinutes: number;
}

// small fixed differences between healthy cylinders (no RNG: the base engine must not change the seeded sequence)
const HEALTHY_VAR = [1.0, 0.985, 0.995, 0.975, 0.99, 0.98];
const HEALTHY_LEAK = [5, 6, 5, 7, 6, 6];

export function initialEngineMech(): EngineMechState {
  return {
    crankDeg: 0,
    cyl: HEALTHY_VAR.map((v, i) => ({ sealing: 1, leakPath: 'crankcase' as LeakPath, compressionPsi: Math.round(ENGINE_SPEC.compression.nominalPsi * v), leakPct: HEALTHY_LEAK[i], peakPsi: 0 })),
    blowbyCfm: 0,
    blowbyNewCfm: 0,
    coolantLevelPct: 100,
    intakeRestrictionInH2O: 0,
    exhaustTempC: 20,
    smoke: 'clear',
    runMinutes: 250 * 60,
  };
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Sealing and leak path of each cylinder, from the parts. */
export function cylinderCondition(F: FaultSet | null): { sealing: number; leakPath: LeakPath; leakPct: number }[] {
  const has = (p: string, k?: string) => (F ? F.has(p, k as never) : undefined);
  const hg = has('mech.headGasket', 'leak');
  const hgCyl = hg ? clamp(Math.round(hg.value ?? 2), 1, 6) : 0;
  return HEALTHY_LEAK.map((base, i) => {
    const n = i + 1;
    let sealing = 1;
    let path: LeakPath = 'crankcase';
    let leak = base;
    const lash = has(`mech.valveLash${n}`, 'drift');
    if (has('mech.rings', 'damaged')) { sealing = 0.8 - (i % 3) * 0.01; leak = 24 + (i % 3); }
    if (has(`mech.piston${n}`, 'damaged')) { sealing = 0.45; leak = 55; }
    if (hgCyl === n) { sealing = Math.min(sealing, 0.82); path = 'coolant'; leak = Math.max(leak, 24); }
    if (lash && (lash.value ?? 0) < -0.3) { sealing = Math.min(sealing, 0.7); path = 'intake'; leak = Math.max(leak, 30); }
    if (has(`mech.exhValve${n}`, 'leak')) { sealing = Math.min(sealing, 0.5); path = 'exhaust'; leak = Math.max(leak, 48); }
    return { sealing, leakPath: path, leakPct: leak };
  });
}

/** Cranking compression a gauge reads on cylinder i (0-based). `wet`: a few drops of oil squirted in first. */
export function compressionPsi(cond: { sealing: number; leakPath: LeakPath }, i: number, wet = false): number {
  let sealing = cond.sealing;
  // oil seals worn rings for a few strokes; it does nothing for a valve or a gasket
  if (wet && cond.leakPath === 'crankcase' && sealing < 0.95) sealing = Math.min(1, sealing + 0.5 * (1 - sealing) + 0.04);
  return Math.round(ENGINE_SPEC.compression.nominalPsi * HEALTHY_VAR[i] * sealing ** 1.3);
}

// ---------- cylinder geometry and the four-stroke pressure model ----------

/** Piston distance from TDC, mm, at crank angle θ (any angle; 0 = TDC). */
export function pistonFromTdcMm(thetaDeg: number, s = ENGINE_SPEC): number {
  const r = s.strokeMm / 2;
  const a = (thetaDeg * Math.PI) / 180;
  return r * (1 - Math.cos(a)) + s.rodMm - Math.sqrt(s.rodMm ** 2 - (r * Math.sin(a)) ** 2);
}
/** Cylinder volume over swept volume. */
function volRatio(thetaDeg: number): number {
  const vc = 1 / (ENGINE_SPEC.compressionRatio - 1);
  return vc + pistonFromTdcMm(thetaDeg) / ENGINE_SPEC.strokeMm;
}
const wrap720 = (x: number) => ((x % 720) + 720) % 720;
export type Stroke = 'intake' | 'compression' | 'power' | 'exhaust';
/** θ is the cylinder's own angle: 0 = TDC at the start of intake, 360 = TDC firing. */
export function strokeAt(thetaDeg: number): Stroke {
  const t = wrap720(thetaDeg);
  return t < 180 ? 'intake' : t < 360 ? 'compression' : t < 540 ? 'power' : 'exhaust';
}
/** Angle of cylinder `n` (1-based) when cylinder 1 is at `crankDeg`. Cylinders fire 120° apart in firing order. */
export function cylinderAngle(crankDeg: number, n: number): number {
  const k = (ENGINE_SPEC.firingOrder as readonly number[]).indexOf(n);
  return wrap720(crankDeg - 120 * k);
}
/** Valve lift 0–1 at the cylinder's angle θ. */
export function valveLift(thetaDeg: number, valve: 'intake' | 'exhaust'): number {
  const t = wrap720(thetaDeg);
  const vt = ENGINE_SPEC.valveTiming;
  const [o, c] = valve === 'intake' ? [vt.intakeOpens, vt.intakeCloses] : [vt.exhaustOpens, vt.exhaustCloses];
  // unwrap so the open window is continuous
  let x = t;
  if (valve === 'intake' && t > 600) x = t - 720;
  if (valve === 'exhaust' && t < 100) x = t + 720;
  if (x <= o || x >= c) return 0;
  return Math.sin((Math.PI * (x - o)) / (c - o));
}

export interface CycleInputs {
  /** Intake manifold pressure, psi absolute. */
  intakePsiA: number;
  sealing: number;
  /** Fuel burned this cycle relative to full load, 0–1 (0 = motoring / cranking). */
  fuel: number;
}

/** Cylinder pressure (psi absolute) at the cylinder's angle θ. A teaching model: polytropic compression and
 *  expansion, a combustion rise starting at injection, blow-down when the exhaust valve opens. */
export function cylinderPressure(thetaDeg: number, c: CycleInputs): number {
  const t = wrap720(thetaDeg);
  const n = 1.32;
  const pIn = c.intakePsiA;
  const pExh = pIn * 1.08 + 1;
  const vBdc = volRatio(180);
  const kTdc = 0.86 * c.sealing; // heat loss and leakage by TDC
  const comp = (th: number) => {
    const prog = (th - 180) / 180;
    return pIn * (vBdc / volRatio(th)) ** n * (1 - (1 - kTdc) * prog * prog);
  };
  if (t < 180) return pIn;
  if (t <= 360) return comp(t);
  const pTdc = comp(360);
  const motor = (th: number) => pTdc * (volRatio(360) / volRatio(th)) ** n;
  const soi = 360 - ENGINE_SPEC.injectionBtdc;
  const add = c.fuel > 0 ? 300 + 1250 * c.fuel : 0;
  const burn = (th: number) => {
    if (!add || th < soi + 4) return 0;
    const ramp = clamp((th - soi - 4) / 14, 0, 1);
    const sm = ramp * ramp * (3 - 2 * ramp);
    return add * sm * (th > 372 ? (volRatio(372) / volRatio(th)) ** n : 1);
  };
  const expand = (th: number) => motor(th) + burn(th);
  if (t < 490) return expand(t);
  if (t < 560) {
    const f = (t - 490) / 70;
    return expand(490) * (1 - f) + pExh * f;
  }
  if (t < 700) return pExh;
  return pExh + (pIn - pExh) * ((t - 700) / 20);
}
/** Compression-only pressure (also handy for the cranking trace). Kept for tests and the chart. */
export function cycleForCylinder(s: TruckState, n: number): CycleInputs {
  const c = s.engineMech.cyl[n - 1];
  const running = s.running;
  const intakePsiA = 14.7 + (running ? Math.max(0, s.boostKpa) * 0.145 : 0);
  const fuel = running ? (s.cylinderContribution[n - 1] ?? 0) * (0.12 + 0.88 * s.load) : 0;
  return { intakePsiA, sealing: c?.sealing ?? 1, fuel };
}
/** Compression air temperature, °C, at angle θ (from the intake air temperature). */
export function airTempC(thetaDeg: number, intakeC: number, sealing = 1): number {
  const t = wrap720(thetaDeg);
  if (t < 180 || t > 360) return intakeC;
  return (intakeC + 273) * (volRatio(180) / volRatio(t)) ** (0.32 * (0.85 + 0.15 * sealing)) - 273;
}

// ---------- the system ----------

export class EngineMechSystem implements System {
  id = 'engineMech';
  /** After the powertrain sets rpm/load, before the air system, electrical solver and modules read them. */
  order = 150;
  step(ctx: SimContext): void {
    stepEngineMech(ctx.state, ctx.faults, ctx.dtMs);
  }
}

export function stepEngineMech(s: TruckState, F: FaultSet, dtMs: number): void {
  const m = s.engineMech;
  const has = (p: string, k?: string) => F.has(p, k as never);
  const dts = dtMs / 1000;
  m.crankDeg = wrap720(m.crankDeg + s.rpm * 6 * dts);
  if (s.running) m.runMinutes += dtMs / 60000;

  // cylinders: what each one can hold, and so what it can give
  const cond = cylinderCondition(F);
  let rough = 0;
  cond.forEach((c, i) => {
    const cyl = m.cyl[i];
    cyl.sealing = c.sealing;
    cyl.leakPath = c.leakPath;
    cyl.leakPct = c.leakPct;
    cyl.compressionPsi = compressionPsi(c, i);
    let give = c.sealing < 0.6 ? 0.3 : c.sealing < 0.9 ? 0.75 : 1;
    if (has(`mech.camLobe${i + 1}`, 'damaged')) give = Math.min(give, 0.7);
    if (s.running && give < 1) {
      s.cylinderContribution[i] = Math.min(s.cylinderContribution[i], give);
      rough += 1 - give;
    }
  });
  // a weak cylinder shakes the crank speed (deterministic, so the seeded RNG sequence stays the same)
  if (s.running && rough > 0) s.rpm += Math.sin(s.timeMs * 0.037) * 70 * Math.min(1, rough);

  // air filter and turbo
  const restricted = !!has('mech.airFilter', 'addedOhms');
  const flow = s.running ? clamp(s.mafKgh / 1600, 0, 1.4) : 0;
  m.intakeRestrictionInH2O = s.running ? (2 + (ENGINE_SPEC.intakeRestriction.cleanInH2O - 2) * flow * flow) * (restricted ? 5 : 1) + (restricted ? 8 : 0) : 0;
  if (s.running && restricted) {
    s.mafKgh *= 0.86;
    if (s.load > 0.3) s.boostKpa *= 0.55;
  }

  // oil: worn main and rod bearings let oil escape past them, so pressure falls (most at hot idle)
  if (s.running && has('mech.mainBearings', 'damaged')) s.oilKpa *= 0.45;

  // coolant: a head gasket breach pressurizes the cooling system and pushes coolant out of the overflow
  const hg = has('mech.headGasket', 'leak');
  if (s.running && hg) m.coolantLevelPct = Math.max(0, m.coolantLevelPct - (5 + 3 * s.load) * dts / 60);
  if (s.running && has('mech.coolant', 'leak')) m.coolantLevelPct = Math.max(40, m.coolantLevelPct - 1.5 * dts / 60);
  if (!hg && !has('mech.coolant', 'leak')) m.coolantLevelPct = 100; // repaired and topped up
  if (m.coolantLevelPct < 85) s.coolantC += (85 - m.coolantLevelPct) * 1.2;

  // blow-by: combustion gas past the rings into the crankcase
  const base = s.running ? 0.9 + 0.0009 * s.rpm + 2.2 * s.load : 0;
  const excess = cond.reduce((a, c, i) => a + (c.leakPath === 'crankcase' ? Math.max(0, c.leakPct - HEALTHY_LEAK[i]) / 100 : 0), 0);
  m.blowbyNewCfm = base;
  m.blowbyCfm = base * (1 + 3 * excess);

  // peak pressures and exhaust temperature
  m.cyl.forEach((c, i) => (c.peakPsi = s.running ? Math.round(maxPressure(cycleForCylinder(s, i + 1))) : 0));
  m.exhaustTempC = s.running ? 180 + 420 * s.load + (restricted && s.load > 0.3 ? 90 : 0) : Math.max(s.ambientC, m.exhaustTempC - 2 * dts);

  m.smoke = !s.running
    ? 'clear'
    : restricted && s.load > 0.3
      ? 'black'
      : hg
        ? 'white'
        : has('mech.rings', 'damaged') || has('mech.turbo', 'damaged')
          ? 'blue'
          : [1, 2, 3, 4, 5, 6].some((n) => has(`mech.injector${n}`, 'stuck')) && s.load > 0.3
            ? 'black'
            : 'clear';
}

function maxPressure(c: CycleInputs): number {
  let p = 0;
  for (let t = 330; t <= 420; t += 2) p = Math.max(p, cylinderPressure(t, c));
  return p;
}

// ---------- hands-on checks ----------

export type EngineCheck =
  | 'compression' | 'wetCompression' | 'leakdown' | 'blowby' | 'oilPressure' | 'coolant' | 'valveLash' | 'listen' | 'smoke' | 'oilAnalysis' | 'intakeRestriction';

export const ENGINE_CHECKS: { id: EngineCheck; label: string; minutes: number; needs: 'off' | 'running' | 'any'; how: string }[] = [
  { id: 'compression', label: 'Compression test', minutes: 60, needs: 'off', how: 'Fuel shut off, an adapter in each injector bore in turn, engine cranked about 200 rpm. Read the gauge after 4–6 compression strokes.' },
  { id: 'wetCompression', label: 'Wet compression', minutes: 20, needs: 'off', how: 'A few drops of engine oil in the low cylinder, then test again. Oil seals worn rings for a moment; it does nothing for a valve or a gasket. (Never more than a few drops: oil doesn\'t compress.)' },
  { id: 'leakdown', label: 'Cylinder leak-down', minutes: 45, needs: 'off', how: 'Each piston at TDC on its compression stroke, shop air at 100 psi through a calibrated orifice. Read the % lost, then listen for where it goes.' },
  { id: 'blowby', label: 'Blow-by meter', minutes: 15, needs: 'running', how: 'Meter on the crankcase breather tube, other openings sealed. Compare with a new engine at the same speed and load.' },
  { id: 'oilPressure', label: 'Mechanical oil gauge', minutes: 15, needs: 'running', how: 'A master gauge in the main oil gallery, engine at operating temperature.' },
  { id: 'coolant', label: 'Cooling system checks', minutes: 20, needs: 'running', how: 'Coolant level, combustion leak (block) tester on the surge tank, and an infrared thermometer on the upper and lower radiator hoses.' },
  { id: 'valveLash', label: 'Valve lash (feeler gauge)', minutes: 50, needs: 'off', how: 'Valve cover off, engine barred over so each cylinder is at TDC compression in turn. Feeler gauge between rocker and valve bridge; watch each rocker move as you bar it over.' },
  { id: 'listen', label: 'Listen (stethoscope)', minutes: 10, needs: 'running', how: 'Mechanic\'s stethoscope on the block, valve cover and oil pan; listen at the air intake, the tailpipe and the oil fill.' },
  { id: 'smoke', label: 'Exhaust smoke', minutes: 5, needs: 'running', how: 'Watch the stack at idle and on a snap acceleration.' },
  { id: 'oilAnalysis', label: 'Oil analysis (lab)', minutes: 10, needs: 'any', how: 'An oil sample sent to the lab: wear metals, coolant, fuel and soot.' },
  { id: 'intakeRestriction', label: 'Intake restriction', minutes: 10, needs: 'running', how: 'A water manometer on the air cleaner outlet. Restriction is highest at full airflow (rated rpm, full load).' },
];

const CYL = [1, 2, 3, 4, 5, 6];
const LEAK_WHERE: Record<LeakPath, string> = {
  crankcase: 'air out of the oil fill / crankcase breather',
  exhaust: 'air hissing out of the tailpipe',
  intake: 'air hissing out of the air intake',
  coolant: 'bubbles in the coolant surge tank',
};

/** What a technician finds. Reads state and parts; it never looks at the control modules. */
export function engineInspect(s: TruckState, F: FaultSet, check: EngineCheck): string {
  const m = s.engineMech;
  const has = (p: string, k?: string) => F.has(p, k as never);
  const meta = ENGINE_CHECKS.find((c) => c.id === check)!;
  if (meta.needs === 'off' && s.running) return `Shut the engine off first: the ${meta.label.toLowerCase()} is done with the engine stopped.`;
  if (meta.needs === 'running' && !s.running) return `Start the engine first: the ${meta.label.toLowerCase()} is done with it running.`;
  const cond = cylinderCondition(F);
  const spec = ENGINE_SPEC;

  if (check === 'compression' || check === 'wetCompression') {
    const dry = cond.map((c, i) => compressionPsi(c, i));
    const vals = check === 'wetCompression' ? cond.map((c, i) => compressionPsi(c, i, true)) : dry;
    const hi = Math.max(...vals);
    const rows = vals.map((v, i) => {
      const low = v < spec.compression.minPsi || (hi - v) / hi > spec.compression.maxSpreadPct / 100;
      const delta = check === 'wetCompression' ? ` (dry ${dry[i]}${vals[i] - dry[i] > 15 ? ', <b>rose</b>' : ', no change'})` : '';
      return `#${i + 1} ${v} psi${delta}${low ? ' <b>LOW</b>' : ''}`;
    });
    const tail = check === 'wetCompression'
      ? 'A reading that rises with oil points to the rings. One that stays low points to a valve or the head gasket.'
      : `Spec: at least ${spec.compression.minPsi} psi, and no cylinder more than ${spec.compression.maxSpreadPct}% below the highest.`;
    return `Cranking compression: ${rows.join(' · ')}. ${tail}`;
  }

  if (check === 'leakdown') {
    const rows = cond.map((c, i) => {
      const bad = c.leakPct > spec.leakdown.limitPct;
      const fair = c.leakPct > spec.leakdown.goodPct;
      return `#${i + 1} ${c.leakPct}%${bad ? ` <b>HIGH</b>: ${LEAK_WHERE[c.leakPath]}` : fair ? ` (${LEAK_WHERE[c.leakPath]})` : ''}`;
    });
    return `Leak-down: ${rows.join(' · ')}. Under ${spec.leakdown.goodPct}% is good; over ${spec.leakdown.limitPct}% find where it goes. A little air out of the oil fill is normal (ring end gaps).`;
  }

  if (check === 'blowby') {
    const lim = m.blowbyNewCfm * spec.blowbyLimitFactor;
    const over = m.blowbyCfm > lim;
    return `Blow-by ${m.blowbyCfm.toFixed(1)} cfm at ${Math.round(s.rpm)} rpm, ${Math.round(s.load * 100)}% load. A new engine: about ${m.blowbyNewCfm.toFixed(1)} cfm; limit about ${lim.toFixed(1)} cfm.${over ? ' <b>HIGH</b>: combustion gas is getting past the rings or a piston.' : ''}`;
  }

  if (check === 'oilPressure') {
    const psi = s.oilKpa * 0.145;
    const min = s.rpm < 900 ? spec.oilPsi.idleMin : s.rpm >= 1500 ? spec.oilPsi.ratedMin : spec.oilPsi.idleMin + ((s.rpm - 900) / 600) * (spec.oilPsi.ratedMin - spec.oilPsi.idleMin);
    const low = psi < min;
    return `Master gauge: ${psi.toFixed(0)} psi at ${Math.round(s.rpm)} rpm (minimum about ${min.toFixed(0)} psi here). ${low ? '<b>LOW</b>: this is real low oil pressure, not a sensor problem.' : 'Matches the dash: the pressure is real.'}`;
  }

  if (check === 'coolant') {
    const hg = has('mech.headGasket', 'leak');
    const tstat = has('mech.thermostat', 'stuck');
    const level = m.coolantLevelPct >= 97 ? 'full' : `${Math.round(m.coolantLevelPct)}% (<b>LOW</b>)`;
    const block = hg ? 'The block tester fluid turns from blue to <b>yellow</b>: there is combustion gas in the coolant. Bubbles keep rising in the surge tank.' : 'The block tester fluid stays blue: no combustion gas in the coolant.';
    const upper = Math.round(s.coolantC * 1.8 + 32);
    const hoses = tstat
      ? `Upper radiator hose only about ${Math.round(110 + s.ambientC)}°F while the engine reads ${upper}°F: coolant isn't getting to the radiator (thermostat not opening).`
      : `Upper radiator hose ${upper - 4}°F, lower about ${upper - 22}°F: coolant is flowing through the radiator.`;
    const ext = has('mech.coolant', 'leak') ? ' Coolant is dripping from a hose clamp at the water pump.' : '';
    return `Coolant level ${level}. ${block} ${hoses}${ext}`;
  }

  if (check === 'valveLash') {
    const rows = CYL.map((n) => {
      const d = has(`mech.valveLash${n}`, 'drift');
      const dv = d?.value ?? 0;
      const iL = spec.valveLashMm.intake + (d && dv < 0 ? dv : 0);
      const eL = spec.valveLashMm.exhaust + (d && dv > 0 ? dv : 0) + (has(`mech.camLobe${n}`, 'damaged') ? 0.05 : 0);
      const fmt = (v: number, nominal: number) => {
        const x = Math.max(0, v);
        const off = Math.abs(x - nominal) > spec.valveLashMm.tolerance;
        return `${x.toFixed(2)}${x === 0 ? ' <b>NO GAP</b>' : off ? ' <b>OUT</b>' : ''}`;
      };
      const lobe = has(`mech.camLobe${n}`, 'damaged') ? ' <b>exhaust rocker barely moves</b> as the engine is barred over (low lift)' : '';
      return `#${n} int ${fmt(iL, spec.valveLashMm.intake)} / exh ${fmt(eL, spec.valveLashMm.exhaust)} mm${lobe}`;
    });
    return `Valve lash: ${rows.join(' · ')}. Spec intake ${spec.valveLashMm.intake.toFixed(2)} mm, exhaust ${spec.valveLashMm.exhaust.toFixed(2)} mm (±${spec.valveLashMm.tolerance.toFixed(2)}). A valve with no gap may be held off its seat.`;
  }

  if (check === 'listen') {
    const found: string[] = [];
    if (has('mech.mainBearings', 'damaged')) found.push(s.load > 0.3 ? 'A deep, heavy knock from the bottom end, loudest under load.' : 'A dull knock from the bottom end; it gets louder when the engine is loaded.');
    CYL.forEach((n) => {
      const d = has(`mech.valveLash${n}`, 'drift');
      if (d && (d.value ?? 0) > 0.2) found.push(`A sharp ticking under the valve cover near cylinder ${n}.`);
      if (d && (d.value ?? 0) < -0.3) found.push('A rhythmic chuffing at the air intake.');
      if (has(`mech.exhValve${n}`, 'leak')) found.push('A rhythmic puff at the tailpipe, once every two revolutions.');
      if (has(`mech.piston${n}`, 'damaged')) found.push('Gas puffing hard out of the oil fill and the breather.');
    });
    if (has('mech.rings', 'damaged')) found.push('Steady fumes from the breather tube.');
    if (has('mech.headGasket', 'leak')) found.push('Gurgling in the surge tank.');
    if (has('mech.turbo', 'damaged')) found.push('A normal turbo whine; no scraping.');
    if (s.cylinderContribution.some((x) => x < 0.9) && !found.length) found.push('The idle is a little uneven: one cylinder isn\'t pulling its weight. Nothing knocks or ticks.');
    return found.length ? found.join(' ') : 'Nothing unusual: injectors ticking evenly, a smooth bottom end, no puffing from the oil fill.';
  }

  if (check === 'smoke') {
    const t: Record<Smoke, string> = {
      clear: 'Clear stack at idle and only a brief light haze on a snap acceleration. Normal.',
      black: 'Black smoke under load: more fuel than air. Look at the air supply (filter, turbo, charge air) or a leaking injector.',
      blue: 'Blue-gray smoke with an oily smell, worst at idle and light load: the engine is burning oil (rings, valve guides or turbo seals).',
      white: 'White smoke with a sweet smell that doesn\'t clear when the engine warms up: coolant is getting into a cylinder.',
    };
    return t[m.smoke];
  }

  if (check === 'oilAnalysis') {
    const r: string[] = [];
    if (has('mech.mainBearings', 'damaged')) r.push('<b>Copper, lead and tin high</b> (bearing material)');
    if (has('mech.rings', 'damaged') || CYL.some((n) => has(`mech.piston${n}`, 'damaged'))) r.push('<b>Iron and chromium high</b> (liners and rings); soot high');
    if (has('mech.headGasket', 'leak')) r.push('<b>Glycol positive, sodium and potassium high</b> (coolant in the oil)');
    if (has('mech.lube', 'leak')) r.push('<b>Fuel dilution 7%</b> (limit 2.5%) and viscosity low: the oil is thinned by diesel');
    if (has('mech.airFilter', 'addedOhms')) r.push('Silicon a little high (dirt getting past the filter)');
    if (has('mech.turbo', 'damaged')) r.push('Soot slightly high');
    return `Oil analysis after ${Math.round(m.runMinutes / 60)} engine hours: ${r.length ? r.join('; ') : 'all wear metals, coolant, fuel and soot normal'}.`;
  }

  // intake restriction
  const r = m.intakeRestrictionInH2O;
  const lim = spec.intakeRestriction.maxInH2O;
  return `Intake restriction ${r.toFixed(1)} inH₂O at ${Math.round(s.rpm)} rpm, ${Math.round(s.load * 100)}% load. Maximum ${lim} inH₂O at full airflow.${r > lim ? ' <b>OVER THE LIMIT</b>: the air filter is plugged.' : s.load < 0.3 ? ' Load the engine (or run it at rated rpm) to see the worst case.' : ''}${has('mech.turbo', 'damaged') ? ' The charge air cooler boots are wet with oil.' : ''}`;
}
