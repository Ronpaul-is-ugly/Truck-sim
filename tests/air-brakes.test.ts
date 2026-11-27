// Air brake system: the standard air brake checks on a healthy truck, and each mystery fault failing
// the check that should catch it. Every number is read the way a technician would: gauges, the cluster,
// the bus, a stopwatch and a ruler.
import { describe, expect, it } from 'vitest';
import { engine, codes } from './helpers';
import { AIR_FAULTS, AIR_SPEC, type SimEngine } from '../src/engine';

const lo = (e: SimEngine) => Math.min(e.state.airPrimaryPsi, e.state.airSecondaryPsi);

/** Parked, engine idling, spring brakes set. */
function idling(faults: string[] = [], empty = false): SimEngine {
  const e = engine({ initial: { key: 'run', speedMph: 0, driver: { setMph: 0, parkBrake: true } } });
  for (const id of faults) for (const f of AIR_FAULTS.find((x) => x.id === id)!.faults) e.dispatch({ type: 'injectFault', fault: f });
  if (empty) {
    e.state.air.supplyPsi = e.state.airPrimaryPsi = e.state.airSecondaryPsi = 0;
    e.state.air.compressorLoaded = true;
  }
  return e;
}

/** Seconds for the lower needle to go from 85 to 100 psi at idle. */
function buildUp(faults: string[] = []): number {
  const e = idling(faults, true);
  let t85 = -1;
  for (let i = 0; i < 6000; i++) {
    e.run(100);
    if (t85 < 0 && lo(e) >= 85) t85 = e.timeMs;
    if (t85 >= 0 && lo(e) >= 100) return (e.timeMs - t85) / 1000;
  }
  return Infinity;
}

/** Governor cut-out and cut-in, the way the check is done: watch the compressor stop and restart. */
function governor(faults: string[] = []): { cutOut: number; cutIn: number } {
  const e = idling(faults);
  e.state.air.supplyPsi = e.state.airPrimaryPsi = e.state.airSecondaryPsi = 90;
  e.state.air.compressorLoaded = true;
  let cutOut = NaN;
  for (let i = 0; i < 3000 && isNaN(cutOut); i++) {
    e.run(100);
    if (!e.state.air.compressorLoaded) cutOut = e.state.air.supplyPsi;
  }
  let cutIn = NaN;
  for (let i = 0; i < 200 && isNaN(cutIn); i++) {
    e.dispatch({ type: 'setBrakePedal', pct: 60 });
    e.run(500);
    e.dispatch({ type: 'setBrakePedal', pct: 0 });
    e.run(500);
    if (e.state.air.compressorLoaded) cutIn = e.state.air.supplyPsi;
  }
  return { cutOut, cutIn };
}

/** Engine off, key on, tanks full: psi lost in one minute on the lower needle, released or applied. */
function leakDown(applied: boolean, faults: string[] = []): number {
  const e = idling(faults);
  e.state.air.supplyPsi = e.state.airPrimaryPsi = e.state.airSecondaryPsi = 124;
  e.dispatch({ type: 'setKey', key: 'on' });
  e.dispatch({ type: 'setParkBrake', applied: false });
  if (applied) e.dispatch({ type: 'setBrakePedal', pct: 100 });
  e.run(5000);
  const p = e.state.airPrimaryPsi, s = e.state.airSecondaryPsi;
  e.run(60000);
  return Math.max(p - e.state.airPrimaryPsi, s - e.state.airSecondaryPsi);
}

/** Fan the brakes until the park knob pops: pressure at the low-air warning and at pop-out. */
function fan(faults: string[] = []): { warn: number; pop: number; fans: number } {
  const e = idling(faults);
  e.state.air.supplyPsi = e.state.airPrimaryPsi = e.state.airSecondaryPsi = 120;
  e.dispatch({ type: 'setKey', key: 'on' });
  e.dispatch({ type: 'setParkBrake', applied: false });
  e.run(1000);
  let warn = NaN, pop = NaN, fans = 0;
  while (isNaN(pop) && fans < 80) {
    fans++;
    e.dispatch({ type: 'setBrakePedal', pct: 100 });
    for (let i = 0; i < 6 && isNaN(pop); i++) {
      e.run(100);
      if (isNaN(warn) && e.module('clu').display()?.lamps.lowAir) warn = lo(e);
      if (e.state.driver.parkBrake) pop = Math.max(e.state.airPrimaryPsi, e.state.airSecondaryPsi);
    }
    e.dispatch({ type: 'setBrakePedal', pct: 0 });
    for (let i = 0; i < 6 && isNaN(pop); i++) {
      e.run(100);
      if (isNaN(warn) && e.module('clu').display()?.lamps.lowAir) warn = lo(e);
      if (e.state.driver.parkBrake) pop = Math.max(e.state.airPrimaryPsi, e.state.airSecondaryPsi);
    }
  }
  return { warn, pop, fans };
}

/** Pushrod stroke at each wheel, measured at a full application held. */
function strokes(faults: string[] = []): Record<string, number> {
  const e = idling(faults);
  e.dispatch({ type: 'setKey', key: 'off' });
  e.state.air.supplyPsi = e.state.airPrimaryPsi = e.state.airSecondaryPsi = 105;
  e.dispatch({ type: 'setParkBrake', applied: false });
  e.dispatch({ type: 'setBrakePedal', pct: 100 });
  e.run(2000);
  expect(e.dispatch({ type: 'airCheck', check: 'stroke' }).text).toMatch(/Pushrod stroke/);
  return { ...e.state.air.strokeIn };
}

describe('healthy truck passes the air brake check', () => {
  it('build-up 85 → 100 psi at idle in under 45 s', () => {
    const t = buildUp();
    expect(t).toBeGreaterThan(15);
    expect(t).toBeLessThan(45);
  });
  it('governor cuts out at about 125 psi and back in about 20 psi lower', () => {
    const g = governor();
    expect(g.cutOut).toBeGreaterThanOrEqual(120);
    expect(g.cutOut).toBeLessThanOrEqual(135);
    expect(g.cutOut - g.cutIn).toBeLessThanOrEqual(25);
    expect(g.cutOut - g.cutIn).toBeGreaterThan(10);
  });
  it('static and applied leak-down are within 2 and 3 psi per minute', () => {
    expect(leakDown(false)).toBeLessThan(2);
    expect(leakDown(true)).toBeLessThan(3);
  });
  it('low-air warning by 60 psi, park knob pops between 20 and 45 psi', () => {
    const f = fan();
    expect(f.warn).toBeLessThanOrEqual(60);
    expect(f.warn).toBeGreaterThan(50);
    expect(f.pop).toBeGreaterThanOrEqual(20);
    expect(f.pop).toBeLessThanOrEqual(45);
    expect(f.fans).toBeGreaterThan(8);
  });
  it('pushrod strokes are inside the readjustment limits', () => {
    const s = strokes();
    for (const w of ['lf', 'rf', 'lr', 'rr'] as const) expect(s[w]).toBeLessThan(AIR_SPEC.chambers[w].limit);
  });
});

describe('each air fault fails the check that should catch it', () => {
  it('primary leak: static leak-down fails on the primary needle only', () => {
    expect(leakDown(false, ['primaryLeak'])).toBeGreaterThan(2);
  });
  it('spring chamber leak: fails released, passes with the park brake set', () => {
    expect(leakDown(false, ['springChamber'])).toBeGreaterThan(2);
  });
  it('applied leak: passes released, fails applied', () => {
    expect(leakDown(false, ['appliedLeak'])).toBeLessThan(2);
    expect(leakDown(true, ['appliedLeak'])).toBeGreaterThan(3);
  });
  it('worn compressor and stuck purge valve fail the build-up test', () => {
    expect(buildUp(['wornCompressor'])).toBeGreaterThan(45);
    expect(buildUp(['purgeStuck'])).toBeGreaterThan(45);
  });
  it('governor set high or low fails the governor check', () => {
    expect(governor(['governorHigh']).cutOut).toBeGreaterThan(135);
    expect(governor(['governorLow']).cutOut).toBeLessThan(120);
  });
  it('park valve that pops too late fails the pop-out check', () => {
    expect(fan(['parkValveLow']).pop).toBeLessThan(20);
  });
  it('out-of-adjustment slack adjusters fail pushrod stroke', () => {
    expect(strokes(['slackRear']).lr).toBeGreaterThan(AIR_SPEC.chambers.lr.limit);
    expect(strokes(['slackFront']).rf).toBeGreaterThan(AIR_SPEC.chambers.rf.limit);
  });
  it('saturated dryer only shows when the tanks are drained', () => {
    const e = idling(['dryerSaturated']);
    expect(e.dispatch({ type: 'airCheck', check: 'drainTanks' }).text).toMatch(/milky/);
    expect(idling().dispatch({ type: 'airCheck', check: 'drainTanks' }).text).toMatch(/few drops/);
  });
  it('every mystery fault is a valid part modifier', () => {
    for (const f of AIR_FAULTS) expect(() => idling([f.id])).not.toThrow();
  });
});

describe('same truck: the air system is tied to the engine, the cluster and the network', () => {
  it('the compressor only pumps with the engine running, and faster at higher rpm', () => {
    const off = idling([], true);
    off.dispatch({ type: 'setKey', key: 'on' });
    off.run(5000);
    expect(off.state.airPrimaryPsi).toBe(0);
    const idle = idling([], true);
    idle.run(100);
    const cruise = engine();
    cruise.state.air.supplyPsi = 0;
    cruise.state.air.compressorLoaded = true;
    cruise.run(100);
    expect(cruise.state.air.compressorScfm).toBeGreaterThan(1.8 * idle.state.air.compressorScfm);
  });
  it('the cluster broadcasts AIR1 with both circuit pressures, and the scan tool reads them', () => {
    const e = engine();
    e.run(3000);
    const live = e.scan.liveData().find((r) => r.spn === 1087);
    expect(Number(live?.value)).toBeGreaterThan(110);
  });
  it('fanning the brakes with the key on sets SPN 117 and 118 FMI 1 on the cluster', () => {
    const e = idling();
    e.dispatch({ type: 'setKey', key: 'on' });
    e.dispatch({ type: 'setParkBrake', applied: false });
    for (let i = 0; i < 16; i++) {
      e.dispatch({ type: 'setBrakePedal', pct: 100 });
      e.run(600);
      e.dispatch({ type: 'setBrakePedal', pct: 0 });
      e.run(600);
    }
    e.run(2000);
    expect(lo(e)).toBeLessThan(60);
    expect(codes(e, 'clu')).toEqual(expect.arrayContaining(['117/1', '118/1']));
  });
  it('the ECM reports the parking brake switch and the ABS reports brake pedal position', () => {
    const e = idling();
    e.run(500);
    expect(e.scan.liveData().find((r) => r.spn === 70)?.value).toBe('SET');
    e.dispatch({ type: 'setBrakePedal', pct: 50 });
    e.run(500);
    expect(Number(e.scan.liveData().find((r) => r.spn === 521)?.value)).toBe(50);
    expect(e.scan.liveData().find((r) => r.spn === 597)?.value).toBe('ON');
  });
  it('a brake out of adjustment makes the truck stop slower', () => {
    const stop = (faults: string[]) => {
      const e = engine();
      for (const id of faults) for (const f of AIR_FAULTS.find((x) => x.id === id)!.faults) e.dispatch({ type: 'injectFault', fault: f });
      e.run(500);
      e.dispatch({ type: 'brake' });
      let t = 0;
      while (e.state.speedMph > 0.1 && t < 60000) { e.run(100); t += 100; }
      return t;
    };
    expect(stop(['slackRear'])).toBeGreaterThan(stop([]) + 500);
  });
  it('with the park knob out the truck will not drive away', () => {
    const e = engine({ initial: { key: 'run', speedMph: 0, driver: { setMph: 30, parkBrake: true } } });
    e.run(5000);
    expect(e.state.speedMph).toBeLessThan(0.5);
    e.dispatch({ type: 'setParkBrake', applied: false });
    e.run(5000);
    expect(e.state.speedMph).toBeGreaterThan(5);
  });
});
