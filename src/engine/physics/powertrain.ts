// Engine, driveline and aftertreatment physics, ported from simulator 5.5 values() and stepVehicle().
// The fault table lookups F('ect')==='hot' etc. became modifiers on physical parts (mech.coolant leak…),
// and the derates/limp/held gear now come from what the control modules command.
import type { System, SimContext } from '../system';
import type { FaultSet } from '../faults';
import type { TruckState } from '../state';
import type { ModuleOutputs } from '../modules/outputs';

export const GEARS = [12.8, 9.25, 6.76, 4.9, 3.58, 2.61, 1.89, 1.38, 1.0, 0.73];
export const AXLE = 3.36;
export const REVMI = 500;
export const LOADF = { bobtail: 0.22, loaded: 0.55, grade: 0.95 } as const;

/** Actuator positions the ECM commands for a given load and speed (5.5 formulas). */
export function commandedPositions(running: boolean, load: number, rpm: number) {
  const rf = Math.min(1, rpm / 1500);
  const idle = load < 0.1;
  return {
    throttle: !running ? 100 : idle ? 72 : 98,
    egr: !running ? 0 : Math.round(idle ? 5 : 10 + 50 * load * (1.2 - load)),
    vgt: !running ? 0 : Math.round(20 + 60 * load * rf),
    railMpa: !running ? 0 : 60 + 140 * load * rf,
    boostKpa: !running ? 0 : 5 + 230 * load * rf,
    mafKgh: !running ? 0 : 120 + rpm * (0.25 + 0.6 * load),
  };
}

type Rnd = (a: number) => number;

/** Recompute every physical quantity from inputs, part condition and module commands. */
export function computeVehicle(s: TruckState, F: FaultSet | null, out: ModuleOutputs, rnd: Rnd): void {
  const has = (p: string, k?: string) => (F ? F.has(p, k as never) : undefined);
  const c = s.driver;
  s.stalled = s.key === 'run' && out.ecm.sync === 'none';
  s.running = s.key === 'run' && !s.stalled;

  // cylinders: an injector fires if its driver can drive it; a stuck nozzle contributes little
  s.cylinderContribution = out.ecm.injectorFiring.map((firing, i) => (!s.running || !firing ? 0 : has(`mech.injector${i + 1}`, 'stuck') ? 0.1 : 1));
  const injBad = s.cylinderContribution.filter((x) => x < 0.5).length;

  const mph = s.speedMph;
  const kmh = mph * 1.609344;
  const oss = (mph * REVMI) / 60 * AXLE;
  let gear = 0;
  if (s.running && mph >= 2) {
    if (out.tcm.holdGear && s.heldGear) gear = s.heldGear;
    else {
      gear = 1;
      for (let g = 10; g >= 1; g--) if (oss * GEARS[g - 1] >= 1050) { gear = g; break; }
    }
    if (!out.tcm.holdGear) s.heldGear = gear;
  } else if (!out.tcm.holdGear) s.heldGear = null;
  s.gear = gear;
  s.gearRatio = gear ? GEARS[gear - 1] : 0;
  s.ossRpm = Math.round(oss);

  let rpm = !s.running ? 0 : !gear ? 650 : Math.min(2100, Math.max(700, oss * s.gearRatio));
  if (s.running) {
    rpm += rnd(injBad ? 90 : 10);
    if (has('mech.crankTarget', 'damaged')) rpm += rnd(250);
  }
  s.rpm = rpm;

  const braking = c.brake || s.air.brakeEffort > 0.05;
  let load = !s.running ? 0 : braking ? 0.04 : mph < 2 ? 0.08 : LOADF[c.load] * (0.6 + 0.4 * Math.min(1, mph / 65));
  if (s.accelerating && !braking && s.running) load = Math.min(1, load + 0.25);
  s.load = load;
  const loadPct = load * 100;
  s.pedalPct = s.running && !braking && !out.ecm.limp ? Math.min(100, loadPct * 0.95 + (mph < 2 ? 0 : 3)) : 0;

  const cmd = commandedPositions(s.running, load, rpm);
  const rf = Math.min(1, rpm / 1500);
  const vgtStuck = has('mech.vgt', 'stuck');
  s.boostKpa = !s.running
    ? 0
    : has('mech.wastegate', 'stuck')
      ? 262
      : (has('mech.chargeAir', 'leak') || vgtStuck) && load > 0.3
        ? 55
        : Math.max(0, 5 + 230 * load * rf - injBad * 10 + rnd(3));
  s.mafKgh = !s.running ? 0 : cmd.mafKgh + rnd(15);
  s.oilKpa = !s.running ? 0 : has('mech.lube', 'leak') ? 62 : 100 + 0.16 * rpm + rnd(6);
  s.coolantC = has('mech.coolant', 'leak') ? 112 : has('mech.thermostat', 'stuck') ? 104 : Math.round(86 + 5 * load);
  s.intakeTempC = Math.round(38 + 15 * load);
  const railLow = has('mech.fuelHighPressure', 'leak') || has('mech.fuelFilter', 'addedOhms');
  s.railMpa = !s.running ? 0 : cmd.railMpa * (railLow ? 0.55 : 1);
  const thr = has('mech.throttle', 'stuck');
  const egr = has('mech.egr', 'stuck');
  s.throttlePct = !s.running ? 100 : thr ? thr.value ?? 35 : cmd.throttle;
  s.egrPct = !s.running ? 0 : egr ? egr.value ?? 45 : cmd.egr;
  s.vgtPct = !s.running ? 0 : vgtStuck ? vgtStuck.value ?? 15 : cmd.vgt;
  s.fuelRateLph = !s.running ? 0 : 2 + 0.045 * rpm * load;
  s.kmpl = s.fuelRateLph > 0 ? kmh / s.fuelRateLph : 0;

  const alt = F?.at('mech.alternator')[0];
  s.batteryV = s.key === 'off' ? 12.6 : !s.running ? 12.4 : alt?.kind === 'open' ? 11.4 : alt?.kind === 'stuck' ? alt.value ?? 16.3 : 13.9;

  s.defLevelPct = s.conditions.defLevelPct;
  const dpf = s.conditions.dpf;
  s.dpfDeltaPKpa = !s.running ? 0 : dpf === 'soot' ? 12 : dpf === 'plugged' ? 30 : 1.5 + 3 * load;
  s.noxInPpm = !s.running ? 0 : 150 + 600 * load + rnd(15);
  s.noxOutPpm = !s.running ? 0 : 12 + 20 * load + rnd(3);
  s.transOilC = has('mech.transFluid', 'leak') ? 130 : Math.round(70 + 20 * load);
  s.ambientC = s.conditions.ambientC;
  s.defTempC = 22;
  s.issRpm = s.running ? Math.round(rpm) : 0;
  // what the pulse trains look like: damaged teeth drop pulses, a mistimed cam gear shifts the cam pulse
  const drop: Record<string, number> = {};
  if (has('mech.crankTarget', 'damaged')) drop.crank = 2;
  for (const w of ['wlf', 'wrf', 'wlr', 'wrr', 'oss', 'iss']) if (has(`mech.toneRing.${w}`, 'damaged')) drop[w] = 3;
  s.pulseDropouts = drop;
  const cam = has('mech.camTiming', 'drift');
  s.camPhaseErrorDeg = cam ? (cam.value ?? 1) * 7.5 : 0;

  const absOK = out.abs.absEnabled;
  const slick = c.road !== 'dry';
  s.braking = braking;
  s.absActive = braking && slick && absOK && mph > 3;
  s.lockup = braking && c.road === 'ice' && !absOK && mph > 3;
  s.wheelsKmh = [0, 1, 2, 3].map((i) => {
    let w = kmh * (1 + rnd(0.004));
    if (s.absActive) w *= 0.86 + (rnd(1) + 0.5) * 0.1;
    if (s.lockup && i >= 2) w = 0;
    return Math.max(0, w);
  });
}

/** Road speed toward the set speed, limited by the module-commanded cap (5.5 stepVehicle). */
export function stepSpeed(s: TruckState, out: ModuleOutputs, dtMs: number): void {
  const c = s.driver;
  const cap = s.running ? Math.min(out.ecm.speedCapMph, out.acm.inducementCapMph) : 0;
  // dragging spring brakes (parked, or air too low to hold them off) stop the truck
  const springs = s.air.springApply;
  const target = s.key === 'run' && !s.stalled ? (c.brake || springs > 0.5 ? 0 : Math.min(c.setMph, cap)) : 0;
  const dts = dtMs / 1000;
  // full braking on each surface (5.5 values) scaled by what the air brakes actually deliver
  const full = { dry: 9, wet: 6.5, ice: out.abs.absEnabled ? 3.5 : 2.5 }[c.road];
  const brakeRate = full * Math.max(s.air.brakeEffort, 0.6 * springs);
  const rate = target > s.speedMph ? 2.2 : Math.max(c.brake ? 1 : 3.5, brakeRate);
  if (brakeRate > 0.2 && s.speedMph > 0) {
    s.speedMph = Math.max(0, s.speedMph - rate * dts);
    s.accelerating = false;
  } else if (s.speedMph < target - 0.01) {
    s.speedMph = Math.min(target, s.speedMph + rate * dts);
    s.accelerating = true;
  } else {
    s.speedMph = Math.max(target, s.speedMph - rate * dts);
    s.accelerating = false;
  }
  if (c.brake && s.speedMph <= 0.05) {
    c.brake = false;
    c.setMph = 0;
  }
}

export class PowertrainSystem implements System {
  id = 'powertrain';
  order = 100;
  step(ctx: SimContext): void {
    const s = ctx.state;
    stepSpeed(s, ctx.outputs, ctx.dtMs);
    computeVehicle(s, ctx.faults, ctx.outputs, (a) => ctx.rng.spread(a));
    s.fuelUsedL += (s.fuelRateLph * ctx.dtMs) / 3600000;
    s.fuelLevelPct = Math.max(0, s.conditions.fuelStartPct - (s.fuelUsedL / s.conditions.fuelTankL) * 100);
    // parked regeneration burns the soot off after 6 s (5.5 runRegen)
    const since = ctx.outputs.acm.regenActiveSinceMs;
    if (since !== null && ctx.timeMs - since >= 6000) {
      s.conditions.dpf = 'normal';
      ctx.outputs.acm.regenActiveSinceMs = null;
    }
  }
}
