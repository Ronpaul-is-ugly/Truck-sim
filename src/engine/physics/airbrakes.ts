// Air brake system: compressor, governor, air dryer, supply/primary/secondary tanks, foot valve,
// service chambers, spring brakes and the park control valve. A small pressure/flow solver: every
// volume holds an amount of air, and orifices, check valves and leaks move it between volumes.
//
// It is the same truck as everything else: the compressor is gear-driven, so it only pumps while the
// engine runs and pumps faster at higher rpm. The cluster's primary and secondary pressure sensors read
// the tank pressures written here, so a real leak shows up on the dash gauges, as a low-air warning and
// as SPN 117/118 FMI 1 on the J1939 network. Braking effort drives the vehicle's deceleration.
//
// Faults are part modifiers (see AIR_PARTS). Like the other physics, this file reads them; tools and
// control modules never do.
import type { System, SimContext } from '../system';
import type { FaultSet } from '../faults';
import { WHEEL_IDS, type TruckState, type Wheel } from '../state';

const ATM = 14.7;
/** Free-air cubic inches per second in one standard cubic foot per minute. */
const SCFM = 1728 / 60;

export interface ChamberSpec {
  /** Effective diaphragm area, in² (Type 20 front, Type 30 rear). */
  area: number;
  /** Pushrod stroke at a 90–100 psi application with the slack adjuster in adjustment. */
  stroke: number;
  /** CVSA / FMCSA readjustment limit for this chamber type. */
  limit: number;
  /** Pushrod travel where the chamber bottoms out. */
  max: number;
  type: string;
}

/** Specs a technician would look up. Pressures in psi, volumes in in³. */
export const AIR_SPEC = {
  volume: { supply: 1400, primary: 1800, secondary: 1200, holdoff: 120 },
  governorCutOut: 125,
  governorSpread: 20,
  /** Compressor free-air delivery per engine rpm at 0 psi, and the pressure where it stops delivering. */
  compressorScfmPerRpm: 0.0164,
  compressorStallPsi: 170,
  wornCompressorFactor: 0.35,
  /** Purge valve stuck open: free air (scfm) lost per psi absolute in the dryer. */
  purgeLeakScfmPerPsia: 0.18,
  purgeBurstMs: 2000,
  /** The park control valve pops out (applies the spring brakes) below this supply pressure. */
  parkPopPsi: 40,
  /** It won't stay in (released) below this. */
  parkHoldPsi: 65,
  /** Spring brakes fully released above, fully applied below. */
  springReleasePsi: 65,
  springApplyPsi: 20,
  /** Foot valve delivery at full pedal travel (limited by tank pressure). */
  footValveMaxPsi: 130,
  lowAirWarningPsi: 60,
  /** Default leak rate for a tank leak with no size given: psi/min at 100 psi (a big leak: ~55 psi at cruise rpm). */
  defaultLeakPsiPerMin: 360,
  chambers: {
    lf: { area: 20, stroke: 1.25, limit: 1.75, max: 2.25, type: 'Type 20' },
    rf: { area: 20, stroke: 1.25, limit: 1.75, max: 2.25, type: 'Type 20' },
    lr: { area: 30, stroke: 1.5, limit: 2.0, max: 2.5, type: 'Type 30/30' },
    rr: { area: 30, stroke: 1.5, limit: 2.0, max: 2.5, type: 'Type 30/30' },
  } as Record<Wheel, ChamberSpec>,
  /** Share of total braking at each wheel (loaded tractor). */
  share: { lf: 0.15, rf: 0.15, lr: 0.35, rr: 0.35 } as Record<Wheel, number>,
} as const;

/**
 * Air brake parts that can carry a fault:
 *   mech.airSupply leak            supply (wet) tank or its drain valve; value = psi/min at 100 psi
 *   mech.airPrimary leak           primary (rear) tank and lines
 *   mech.airSecondary leak         secondary (front) tank and lines
 *   mech.brakeLine.primary leak    rear service side (relay valve, hoses): leaks only while applied;
 *   mech.brakeLine.secondary leak  value = psi/min at a 100 psi application
 *   mech.springChamber.lr|rr leak  spring brake diaphragm: leaks hold-off air while the park brake is released
 *   mech.compressor damaged        worn compressor: low output
 *   mech.governor stuck            value = cut-out pressure (0 = stuck unloaded, never pumps)
 *   mech.airDryerPurge stuck       purge valve stuck open: compressor air blows out the purge
 *   mech.airDryer damaged          saturated desiccant: water in the tanks
 *   mech.parkValve stuck           value = pressure where the park knob pops out
 *   mech.slack.lf|rf|lr|rr drift   slack adjuster out of adjustment; value = pushrod stroke in inches
 */
export const AIR_PARTS = [
  'mech.airSupply', 'mech.airPrimary', 'mech.airSecondary', 'mech.brakeLine.primary', 'mech.brakeLine.secondary',
  'mech.springChamber.lr', 'mech.springChamber.rr', 'mech.compressor', 'mech.governor', 'mech.airDryerPurge',
  'mech.airDryer', 'mech.parkValve', 'mech.slack.lf', 'mech.slack.rf', 'mech.slack.lr', 'mech.slack.rr',
] as const;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** Air held in a volume, as free-air in³. */
const amount = (psi: number, vol: number) => ((psi + ATM) * vol) / ATM;
const pressure = (amt: number, vol: number) => Math.max(0, (amt * ATM) / vol - ATM);

/** Leak rate (psi/min at 100 psi) of a leak fault, or 0. */
function leakRate(F: FaultSet, part: string): number {
  const f = F.has(part, 'leak');
  return f ? f.value ?? AIR_SPEC.defaultLeakPsiPerMin : 0;
}

/** Governor cut-out pressure, with a stuck or mis-set governor. */
export function governorCutOut(F: FaultSet | null): number {
  const g = F?.has('mech.governor', 'stuck');
  return g ? g.value ?? AIR_SPEC.governorCutOut : AIR_SPEC.governorCutOut;
}

export function pushrodSetting(F: FaultSet | null, w: Wheel): number {
  const f = F?.has(`mech.slack.${w}`, 'drift');
  return f ? f.value ?? AIR_SPEC.chambers[w].stroke : AIR_SPEC.chambers[w].stroke;
}

export class AirBrakeSystem implements System {
  id = 'air';
  order = 200;
  private purgeUntil = -1;

  step(ctx: SimContext): void {
    const s = ctx.state;
    const a = s.air;
    const F = ctx.faults;
    const dt = ctx.dtMs / 1000;
    const V = AIR_SPEC.volume;

    let sup = amount(a.supplyPsi, V.supply);
    let pri = amount(s.airPrimaryPsi, V.primary);
    let sec = amount(s.airSecondaryPsi, V.secondary);

    // ---- governor and compressor (gear-driven: only while the engine turns) ----
    const cutOut = governorCutOut(F);
    const cutIn = cutOut - AIR_SPEC.governorSpread;
    if (cutOut <= 0) a.compressorLoaded = false;
    else if (a.supplyPsi >= cutOut && a.compressorLoaded) {
      a.compressorLoaded = false;
      this.purgeUntil = ctx.timeMs + AIR_SPEC.purgeBurstMs;
    } else if (a.supplyPsi <= cutIn) a.compressorLoaded = true;
    let q = 0;
    if (s.running && a.compressorLoaded) {
      q = AIR_SPEC.compressorScfmPerRpm * s.rpm * Math.max(0, 1 - a.supplyPsi / AIR_SPEC.compressorStallPsi);
      if (F.has('mech.compressor', 'damaged')) q *= AIR_SPEC.wornCompressorFactor;
    }
    const purgeStuck = !!F.has('mech.airDryerPurge', 'stuck');
    if (purgeStuck && q > 0) q = Math.max(0, q - AIR_SPEC.purgeLeakScfmPerPsia * (a.supplyPsi + ATM));
    a.compressorScfm = q;
    a.purging = (purgeStuck && s.running && a.compressorLoaded) || ctx.timeMs < this.purgeUntil;
    sup += q * SCFM * dt;

    // ---- single check valves: supply tank feeds the primary and secondary tanks ----
    const G = 150; // free-air in³/s per psi of difference
    const ps = pressure(sup, V.supply);
    for (const which of ['p', 's'] as const) {
      const tankPsi = which === 'p' ? pressure(pri, V.primary) : pressure(sec, V.secondary);
      const flow = Math.max(0, ps - tankPsi) * G * dt;
      sup -= flow;
      if (which === 'p') pri += flow;
      else sec += flow;
    }

    // ---- tank leaks (linear in gauge pressure: psi/min at 100 psi) ----
    const leak = (amt: number, vol: number, rate: number) => amt - ((rate / 6000) * pressure(amt, vol) * dt * vol) / ATM;
    sup = leak(sup, V.supply, leakRate(F, 'mech.airSupply'));
    pri = leak(pri, V.primary, leakRate(F, 'mech.airPrimary'));
    sec = leak(sec, V.secondary, leakRate(F, 'mech.airSecondary'));

    // ---- park control valve and spring brakes (fed by a double check valve: the higher tank) ----
    const pp = pressure(pri, V.primary);
    const pse = pressure(sec, V.secondary);
    const parkSupply = Math.max(pp, pse);
    const popAt = F.has('mech.parkValve', 'stuck')?.value ?? AIR_SPEC.parkPopPsi;
    if (!s.driver.parkBrake && parkSupply < popAt) {
      s.driver.parkBrake = true;
      a.parkPopped = true;
    }
    const takeFromHigher = (amt: number) => {
      if (pp >= pse) pri -= amt;
      else sec -= amt;
    };
    const hold0 = amount(a.holdoffPsi, V.holdoff);
    if (s.driver.parkBrake) a.holdoffPsi += (0 - a.holdoffPsi) * (1 - Math.exp(-dt / 0.3));
    else {
      a.holdoffPsi += (parkSupply - a.holdoffPsi) * (1 - Math.exp(-dt / 0.2));
      const draw = amount(a.holdoffPsi, V.holdoff) - hold0;
      if (draw > 0) takeFromHigher(draw);
      // a leaking spring brake diaphragm bleeds hold-off air, which the tanks keep replacing
      const springLeak = leakRate(F, 'mech.springChamber.lr') + leakRate(F, 'mech.springChamber.rr');
      if (springLeak > 0) {
        const tankVol = pp >= pse ? V.primary : V.secondary;
        takeFromHigher(((springLeak / 6000) * a.holdoffPsi * dt * tankVol) / ATM);
      }
    }
    a.springApply = clamp((AIR_SPEC.springReleasePsi - a.holdoffPsi) / (AIR_SPEC.springReleasePsi - AIR_SPEC.springApplyPsi), 0, 1);

    // ---- foot valve: primary circuit to the rear chambers, secondary to the front ----
    const pedal = clamp(s.driver.brake ? 100 : s.driver.brakePedalPct, 0, 100);
    const want = (pedal / 100) * AIR_SPEC.footValveMaxPsi;
    a.appPrimaryPsi = pedal > 0 ? Math.min(pressure(pri, V.primary), want) : 0;
    a.appSecondaryPsi = pedal > 0 ? Math.min(pressure(sec, V.secondary), want) : 0;
    const k = 1 - Math.exp(-dt / 0.12);
    let effort = 0;
    for (const w of WHEEL_IDS) {
      const spec = AIR_SPEC.chambers[w];
      const rear = w === 'lr' || w === 'rr';
      const target = rear ? a.appPrimaryPsi : a.appSecondaryPsi;
      const p0 = a.chamberPsi[w];
      const p1 = p0 + (target - p0) * k;
      const setting = pushrodSetting(F, w);
      const strokeAt = (p: number) => Math.min(spec.max, setting * Math.min(1, p / 8) + 0.001 * p);
      const vol = (p: number) => 8 + spec.area * strokeAt(p);
      const fill = amount(p1, vol(p1)) - amount(p0, vol(p0));
      if (fill > 0) {
        if (rear) pri -= fill;
        else sec -= fill;
      }
      a.chamberPsi[w] = p1;
      // anti-compounding: the spring and the service brake don't add up on the same pushrod
      const springPsiEq = rear ? a.springApply * 90 : 0;
      const pEff = Math.max(p1, springPsiEq);
      a.strokeIn[w] = pEff > 0.5 ? strokeAt(pEff) : 0;
      const eff = setting <= spec.limit ? 1 : setting >= spec.max ? 0.1 : 1 - (0.9 * (setting - spec.limit)) / (spec.max - spec.limit);
      a.wheelForce[w] = clamp((pEff / 100) * eff, 0, 1);
      effort += a.wheelForce[w] * AIR_SPEC.share[w];
    }
    a.brakeEffort = clamp(effort, 0, 1);

    // ---- applied leaks: air lost on the service side while the brakes are applied ----
    const lp = leakRate(F, 'mech.brakeLine.primary');
    const ls = leakRate(F, 'mech.brakeLine.secondary');
    if (lp) pri -= ((lp / 6000) * a.appPrimaryPsi * dt * V.primary) / ATM;
    if (ls) sec -= ((ls / 6000) * a.appSecondaryPsi * dt * V.secondary) / ATM;

    a.supplyPsi = pressure(sup, V.supply);
    s.airPrimaryPsi = pressure(pri, V.primary);
    s.airSecondaryPsi = pressure(sec, V.secondary);
  }
}

/** Can the park knob be pushed in (spring brakes released) right now? */
export function canReleasePark(s: TruckState): boolean {
  return Math.max(s.airPrimaryPsi, s.airSecondaryPsi) >= AIR_SPEC.parkHoldPsi;
}

/** Things a technician can do with eyes, ears, soapy water, a ruler and a master gauge. */
export type AirCheck = 'masterGauge' | 'listen' | 'soap' | 'drainTanks' | 'stroke';

export const AIR_CHECKS: { id: AirCheck; label: string; minutes: number }[] = [
  { id: 'masterGauge', label: 'Read a master air gauge at each tank', minutes: 3 },
  { id: 'listen', label: 'Walk around and listen for leaks', minutes: 3 },
  { id: 'soap', label: 'Soap-test the fittings, valves and chambers', minutes: 15 },
  { id: 'drainTanks', label: 'Open the tank drain valves', minutes: 3 },
  { id: 'stroke', label: 'Measure pushrod stroke at each wheel', minutes: 10 },
];

const WHEEL_NAME: Record<Wheel, string> = { lf: 'left front', rf: 'right front', lr: 'left rear', rr: 'right rear' };

/** Result of a hands-on air brake check. Uses the physical truck (state and parts), like 5.5's mechanical checks. */
export function airInspect(s: TruckState, F: FaultSet, check: AirCheck): string {
  const a = s.air;
  const applied = a.appPrimaryPsi > 5 || a.appSecondaryPsi > 5;
  const released = !s.driver.parkBrake;
  if (check === 'masterGauge')
    return `Master gauge: supply (wet) tank ${a.supplyPsi.toFixed(0)} psi, primary ${s.airPrimaryPsi.toFixed(0)} psi, secondary ${s.airSecondaryPsi.toFixed(0)} psi.`;

  if (check === 'stroke') {
    if (a.appPrimaryPsi < 80 || a.appSecondaryPsi < 80)
      return 'Pushrod stroke has to be measured with a full brake application of 90–100 psi held, engine off, spring brakes released. Hold the pedal down (or have a helper do it), then measure.';
    const rows = WHEEL_IDS.map((w) => {
      const sp = AIR_SPEC.chambers[w];
      const st = a.strokeIn[w];
      const over = st > sp.limit + 0.01;
      return `${WHEEL_NAME[w]} (${sp.type}): ${st.toFixed(2)}" (limit ${sp.limit.toFixed(2)}")${over ? ' <b>OVER THE LIMIT</b>' : ''}`;
    });
    return `Application ${Math.round((a.appPrimaryPsi + a.appSecondaryPsi) / 2)} psi. Pushrod stroke: ${rows.join(' · ')}.`;
  }

  if (check === 'drainTanks') {
    const wet = F.has('mech.airDryer', 'damaged');
    return wet
      ? 'A lot of water comes out of the supply tank, and some out of the primary and secondary tanks. It is milky with oil. The air dryer isn\'t drying the air: its desiccant cartridge is saturated.'
      : 'Only a few drops of water come out of the supply tank and the others stay dry. The air dryer is working.';
  }

  // listen / soap: what is actually blowing right now
  const fine = check === 'soap';
  const found: string[] = [];
  const size = (r: number) => (r >= 30 ? 'loud' : r >= 3 ? 'steady' : 'faint');
  const tank = (part: string, where: string) => {
    const r = F.has(part, 'leak') ? F.has(part, 'leak')!.value ?? AIR_SPEC.defaultLeakPsiPerMin : 0;
    if (!r) return;
    if (fine || r >= 3) found.push(fine ? `Bubbles at ${where}.` : `A ${size(r)} hiss from ${where}.`);
  };
  tank('mech.airSupply', 'the supply (wet) tank drain valve');
  tank('mech.airPrimary', 'a fitting on the primary (rear circuit) tank');
  tank('mech.airSecondary', 'a fitting on the secondary (front circuit) tank');
  for (const w of ['lr', 'rr'] as const) {
    const r = F.has(`mech.springChamber.${w}`, 'leak');
    if (!r) continue;
    if (released) found.push(fine ? `Bubbles at the ${WHEEL_NAME[w]} spring brake chamber breather hole, with the parking brake released.` : `A hiss from the ${WHEEL_NAME[w]} spring brake chamber while the parking brake is released.`);
  }
  if (applied) {
    if (F.has('mech.brakeLine.primary', 'leak')) found.push(fine ? 'Bubbles at the rear relay valve delivery port while the brakes are applied.' : 'A hiss from the rear relay valve while the brakes are applied.');
    if (F.has('mech.brakeLine.secondary', 'leak')) found.push(fine ? 'Bubbles at a front brake hose fitting while the brakes are applied.' : 'A hiss from a front brake hose while the brakes are applied.');
  }
  if (F.has('mech.airDryerPurge', 'stuck') && s.running && a.compressorLoaded) found.push('Air blows steadily out of the air dryer purge valve while the compressor is pumping.');
  if (found.length) return found.join(' ');
  const hints = [!applied ? 'Some leaks only show with the brakes applied.' : '', !released ? 'The spring brakes are applied, so their hold-off side isn\'t pressurized.' : ''].filter(Boolean).join(' ');
  return (fine ? 'No bubbles anywhere you can reach.' : 'You don\'t hear any leaks.') + (hints ? ' ' + hints : '');
}
