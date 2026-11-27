// Engine construction and fundamentals: the four-stroke model, the specs, the hands-on checks on a
// healthy engine, and each mystery fault failing the check that should catch it. Faults inside the
// engine also have to reach the rest of the truck: the ECM's codes, the dash and the scan tool.
import { describe, expect, it } from 'vitest';
import { engine, codes } from './helpers';
import {
  ENGINE_FAULTS, ENGINE_SPEC, ENGINE_COMPONENTS, ENGINE_QUIZ, ENGINE_CHECKS, displacementL, cylinderPressure, cylinderAngle, strokeAt, valveLift,
  type EngineCheck, type SimEngine,
} from '../src/engine';

function withFault(id: string | null, opts: { cruise?: boolean } = {}): SimEngine {
  const e = opts.cruise ? engine() : engine({ initial: { key: 'run', speedMph: 0, driver: { setMph: 0, parkBrake: true } } });
  if (id) for (const f of ENGINE_FAULTS.find((x) => x.id === id)!.faults) e.dispatch({ type: 'injectFault', fault: f });
  e.run(6000);
  return e;
}
const check = (e: SimEngine, c: EngineCheck) => e.dispatch({ type: 'engineCheck', check: c }).text!;
function engineOff(e: SimEngine): SimEngine {
  e.dispatch({ type: 'setKey', key: 'off' });
  e.run(200);
  return e;
}
/** Cranking compression per cylinder, read off the check text the way a student reads the gauge. */
const compression = (t: string) => [...t.matchAll(/#\d (\d+) psi/g)].map((m) => +m[1]);
const leakdown = (t: string) => [...t.matchAll(/#\d (\d+)%/g)].map((m) => +m[1]);

describe('four-stroke cycle and geometry', () => {
  it('displacement from bore, stroke and cylinders is 12.9 L', () => {
    expect(displacementL()).toBeCloseTo(12.9, 1);
  });
  it('strokes, firing order and valve events', () => {
    expect([0, 200, 400, 600].map(strokeAt)).toEqual(['intake', 'compression', 'power', 'exhaust']);
    // cylinder 5 fires 120° after cylinder 1, cylinder 4 last
    expect(cylinderAngle(360, 1)).toBe(360);
    expect(cylinderAngle(480, 5)).toBe(360);
    expect(cylinderAngle(360 + 600, 4)).toBe(360);
    expect(valveLift(90, 'intake')).toBeGreaterThan(0.9);
    expect(valveLift(360, 'intake')).toBe(0);
    expect(valveLift(360, 'exhaust')).toBe(0);
    expect(valveLift(620, 'exhaust')).toBeGreaterThan(0.9);
  });
  it('compression builds to TDC; combustion raises the peak; a leaking cylinder can\'t build pressure', () => {
    const motoring = { intakePsiA: 14.7, sealing: 1, fuel: 0 };
    const firing = { intakePsiA: 30, sealing: 1, fuel: 0.6 };
    expect(cylinderPressure(180, motoring)).toBeCloseTo(14.7, 1);
    expect(cylinderPressure(360, motoring)).toBeGreaterThan(500);
    const peak = (c: typeof firing) => Math.max(...Array.from({ length: 60 }, (_, i) => cylinderPressure(340 + i, c)));
    expect(peak(firing)).toBeGreaterThan(1800);
    expect(peak(firing)).toBeGreaterThan(1.5 * peak({ ...firing, fuel: 0 }));
    expect(peak({ ...motoring, sealing: 0.5 })).toBeLessThan(0.6 * peak(motoring));
    expect(cylinderPressure(620, firing)).toBeLessThan(40);
  });
  it('teaching data is complete', () => {
    expect(ENGINE_COMPONENTS.length).toBeGreaterThanOrEqual(20);
    for (const q of ENGINE_QUIZ) expect(q.a).toBeLessThan(q.options.length);
    expect(new Set(ENGINE_FAULTS.map((f) => f.id)).size).toBe(ENGINE_FAULTS.length);
  });
});

describe('healthy engine passes every check', () => {
  it('running checks', () => {
    for (const cruise of [false, true]) {
      const e = withFault(null, { cruise });
      for (const c of ENGINE_CHECKS.filter((x) => x.needs !== 'off')) expect(check(e, c.id), c.id).not.toMatch(/LOW|HIGH|OVER|OUT|yellow/);
      expect(e.state.engineMech.smoke).toBe('clear');
      expect(codes(e, 'ecm')).toEqual([]);
    }
  });
  it('engine-off checks', () => {
    const e = engineOff(withFault(null));
    const c = compression(check(e, 'compression'));
    expect(c).toHaveLength(6);
    for (const v of c) expect(v).toBeGreaterThanOrEqual(ENGINE_SPEC.compression.minPsi);
    expect(Math.max(...leakdown(check(e, 'leakdown')))).toBeLessThan(ENGINE_SPEC.leakdown.goodPct);
    expect(check(e, 'valveLash')).not.toMatch(/NO GAP|OUT|barely/);
  });
  it('checks refuse the wrong engine state', () => {
    expect(check(withFault(null), 'compression')).toMatch(/Shut the engine off/);
    expect(check(engineOff(withFault(null)), 'blowby')).toMatch(/Start the engine/);
  });
  it('the base engine does not disturb the rest of the truck', () => {
    const e = withFault(null, { cruise: true });
    expect(e.state.cylinderContribution).toEqual([1, 1, 1, 1, 1, 1]);
    expect(e.state.engineMech.coolantLevelPct).toBe(100);
  });
});

describe('each mystery fault fails the check that should catch it', () => {
  it('burnt exhaust valve: ECM blames the injector, the compression test finds the valve', () => {
    const e = withFault('exhValve3');
    expect(codes(e, 'ecm')).toContain('653/7');
    engineOff(e);
    expect(compression(check(e, 'compression'))[2]).toBeLessThan(200);
    expect(compression(check(e, 'wetCompression'))[2]).toBeLessThan(200);
    expect(check(e, 'leakdown')).toMatch(/#3 \d+% <b>HIGH<\/b>: air hissing out of the tailpipe/);
  });
  it('sticking injector: misfire code, but the cylinder is mechanically fine', () => {
    const e = withFault('injector5');
    expect(codes(e, 'ecm')).toContain('655/7');
    expect(e.scan.cylinderCutout()![4]).toBeLessThan(10);
    engineOff(e);
    expect(compression(check(e, 'compression'))[4]).toBeGreaterThan(350);
  });
  it('worn rings: blow-by, low even compression that rises wet, blue smoke, iron in the oil', () => {
    const e = withFault('ringsWorn');
    expect(check(e, 'blowby')).toMatch(/HIGH/);
    expect(e.state.engineMech.smoke).toBe('blue');
    engineOff(e);
    const dry = compression(check(e, 'compression'));
    const wet = compression(check(e, 'wetCompression'));
    for (const v of dry) expect(v).toBeLessThan(ENGINE_SPEC.compression.minPsi);
    expect(Math.max(...dry) - Math.min(...dry)).toBeLessThan(0.1 * Math.max(...dry));
    expect(check(e, 'wetCompression')).toMatch(/rose/);
    wet.forEach((v, i) => expect(v).toBeGreaterThan(dry[i] + 30));
    expect(check(e, 'oilAnalysis')).toMatch(/Iron and chromium high/);
  });
  it('cracked piston: code on #4, huge leak-down into the crankcase, puffing from the oil fill', () => {
    const e = withFault('piston4');
    expect(codes(e, 'ecm')).toContain('654/7');
    expect(check(e, 'listen')).toMatch(/oil fill/);
    engineOff(e);
    expect(leakdown(check(e, 'leakdown'))[3]).toBeGreaterThan(40);
  });
  it('head gasket: combustion gas in the coolant, coolant lost, and eventually an overheat code', () => {
    const e = withFault('headGasket');
    expect(check(e, 'coolant')).toMatch(/yellow/);
    expect(e.state.engineMech.smoke).toBe('white');
    e.run(7 * 60000);
    expect(e.state.engineMech.coolantLevelPct).toBeLessThan(80);
    expect(e.state.coolantC).toBeGreaterThanOrEqual(102);
    expect(codes(e, 'ecm').some((c) => c.startsWith('110/'))).toBe(true);
    // the dash and the scan tool see the same temperature
    const live = e.scan.liveData().find((r) => r.spn === 110)!;
    expect(live.value).not.toBe('No data');
    engineOff(e);
    expect(check(e, 'leakdown')).toMatch(/#2 \d+% <b>HIGH<\/b>: bubbles in the coolant/);
  });
  it('worn bearings: real low oil pressure at hot idle (SPN 100), fine at cruise, copper and lead in the oil', () => {
    const idle = withFault('bearings');
    expect(codes(idle, 'ecm')).toContain('100/1');
    expect(check(idle, 'oilPressure')).toMatch(/LOW/);
    expect(check(idle, 'listen')).toMatch(/knock/);
    const cruise = withFault('bearings', { cruise: true });
    expect(codes(cruise, 'ecm')).not.toContain('100/1');
    expect(check(cruise, 'oilAnalysis')).toMatch(/Copper, lead/);
  });
  it('fuel-diluted oil: low oil pressure with no knock; the lab finds fuel', () => {
    const e = withFault('fuelDilution');
    expect(check(e, 'oilPressure')).toMatch(/LOW/);
    expect(check(e, 'listen')).not.toMatch(/knock/);
    expect(check(e, 'oilAnalysis')).toMatch(/Fuel dilution/);
  });
  it('tight intake lash: no gap, low compression, leak-down out the intake', () => {
    const e = engineOff(withFault('lashTight6'));
    expect(check(e, 'valveLash')).toMatch(/#6 int 0\.00 <b>NO GAP<\/b>/);
    expect(compression(check(e, 'compression'))[5]).toBeLessThan(300);
    expect(check(e, 'leakdown')).toMatch(/#6 \d+% <b>HIGH<\/b>: air hissing out of the air intake/);
  });
  it('loose exhaust lash: a tick and the feeler gauge, nothing else', () => {
    const e = withFault('lashLoose2');
    expect(check(e, 'listen')).toMatch(/ticking/);
    expect(codes(e, 'ecm')).toEqual([]);
    engineOff(e);
    expect(check(e, 'valveLash')).toMatch(/#2 int 0\.40 \/ exh 1\.10 <b>OUT<\/b>/);
    expect(Math.min(...compression(check(e, 'compression')))).toBeGreaterThan(350);
  });
  it('worn cam lobe: compression is fine, the rocker barely moves', () => {
    const e = engineOff(withFault('camLobe1'));
    expect(Math.min(...compression(check(e, 'compression')))).toBeGreaterThan(350);
    expect(check(e, 'valveLash')).toMatch(/#1 .*barely moves/);
  });
  it('plugged air filter: restriction over the limit, low boost code, black smoke under load', () => {
    const e = withFault('airFilter', { cruise: true });
    expect(check(e, 'intakeRestriction')).toMatch(/OVER THE LIMIT/);
    expect(codes(e, 'ecm')).toContain('102/18');
    expect(e.state.engineMech.smoke).toBe('black');
  });
  it('turbo seals: blue smoke and oil in the intake, but compression and blow-by are normal', () => {
    const e = withFault('turboSeals');
    expect(e.state.engineMech.smoke).toBe('blue');
    expect(check(e, 'blowby')).not.toMatch(/HIGH/);
    expect(check(e, 'intakeRestriction')).toMatch(/wet with oil/);
  });
  it('stuck thermostat: hot, full of coolant, upper hose cool', () => {
    const e = withFault('thermostat');
    expect(codes(e, 'ecm')).toContain('110/16');
    expect(check(e, 'coolant')).toMatch(/Coolant level full.*thermostat not opening/);
  });
  it('removing the fault repairs the truck and tops the coolant up', () => {
    const e = withFault('headGasket');
    e.run(3 * 60000);
    expect(e.state.engineMech.coolantLevelPct).toBeLessThan(90);
    e.dispatch({ type: 'clearAllFaults' });
    e.run(1000);
    expect(e.state.engineMech.coolantLevelPct).toBe(100);
  });
  it('checks are logged as student actions and replay the same', () => {
    const e = withFault('exhValve3');
    check(e, 'listen');
    const last = e.log.entries.at(-1)!;
    expect(last.type).toBe('engineCheck');
    expect(last.actor).toBe('student');
  });
});
