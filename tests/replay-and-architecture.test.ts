// Determinism, scenario files, the student action log, the System extension point, and layering rules.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SimEngine, loadScenario, replay, scoreDiagnosis, type System } from '../src/engine';
import { engine } from './helpers';

const fingerprint = (e: SimEngine) =>
  JSON.stringify({
    t: e.timeMs,
    rpm: e.state.rpm,
    wheels: e.state.wheelsKmh,
    dtcs: (['ecm', 'acm', 'tcm', 'abs', 'clu'] as const).map((m) => e.module(m).dtcs('active').map((d) => [d.spn, d.fmi, d.oc, d.setAtMs])),
    frames: e.bus.frameCount,
  });

describe('fixed-step clock and seeded random numbers', () => {
  it('the same seed and the same actions give the same truck, frame for frame', () => {
    const run = () => {
      const e = engine({ seed: 42 });
      e.dispatch({ type: 'injectFault', fault: { part: 'map.sig@c1', kind: 'open', intermittent: { dutyPct: 25, meanOnMs: 250 } } });
      e.run(8000);
      e.dispatch({ type: 'setTargetSpeed', mph: 30 });
      e.run(5000);
      return fingerprint(e);
    };
    expect(run()).toBe(run());
  });

  it('a different seed changes the noise', () => {
    const a = engine({ seed: 1 });
    const b = engine({ seed: 2 });
    a.run(1000);
    b.run(1000);
    expect(a.state.rpm).not.toBe(b.state.rpm);
  });

  it('advance() with ragged real-time chunks equals run() in fixed steps', () => {
    const a = engine({ seed: 5 });
    const b = engine({ seed: 5 });
    for (const ms of [16.7, 33.1, 7.2, 100, 3, 40]) a.advance(ms);
    b.run(Math.floor((16.7 + 33.1 + 7.2 + 100 + 3 + 40) / 10) * 10);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('scenario files and the action log', () => {
  const dir = join(__dirname, '..', 'scenarios');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('ships scenario files', () => expect(files.length).toBeGreaterThan(2));

  for (const f of files) {
    it(`${f} loads, runs and sets its expected codes`, () => {
      const sc = loadScenario(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      const e = new SimEngine({ scenario: sc });
      e.run(sc.expect?.afterMs ?? 5000);
      for (const want of sc.expect?.activeCodes ?? []) {
        const got = e.module(want.ecu).dtcs('active').map((d) => `${d.spn}/${d.fmi}`);
        expect(got).toContain(`${want.spn}/${want.fmi}`);
      }
    });
  }

  it('every student action is logged with its sim time, and replay reproduces the run', () => {
    const sc = loadScenario(JSON.parse(readFileSync(join(dir, 'open-coolant-thermistor.json'), 'utf8')));
    const e = new SimEngine({ scenario: sc });
    e.run(2500);
    e.scan.requestDM2();
    e.run(1000);
    e.dispatch({ type: 'unplug', circuit: 'ect', connector: 1 });
    e.meter.probe({ circuit: 'ect', red: 'c1u_sig', black: 'c1u_ret', mode: 'dcv' });
    e.dispatch({ type: 'setKey', key: 'off' });
    e.meter.probe({ circuit: 'ect', red: 'c0u_sig', black: 'c1u_sig', mode: 'ohm', isolateModule: true });
    e.run(500);
    e.dispatch({ type: 'submitDiagnosis', circuit: 'ect', location: 's1', kind: 'open', wire: 'sig' });

    const types = e.log.entries.map((x) => x.type);
    expect(types).toEqual(['scan.requestDM2', 'unplug', 'meter.probe', 'setKey', 'meter.probe', 'submitDiagnosis']);
    expect(e.log.entries.every((x) => typeof x.t === 'number')).toBe(true);

    const r = replay(sc, e.log.toJSON());
    expect(fingerprint(r.engine)).toBe(fingerprint(e));
    expect(r.mismatches).toEqual([]);
  });

  it('scores a diagnosis against the scenario answer (location 50, fault type 35, wire 15)', () => {
    const sc = loadScenario(JSON.parse(readFileSync(join(dir, 'open-coolant-thermistor.json'), 'utf8')));
    expect(scoreDiagnosis(sc, { circuit: 'ect', location: 's1', kind: 'open', wire: 'sig' }).score).toBe(100);
    expect(scoreDiagnosis(sc, { circuit: 'ect', location: 'c1', kind: 'open', wire: 'sig' }).score).toBe(50);
  });
});

describe('System interface', () => {
  it('a new module (for example an air-brake system) plugs in and is stepped on the fixed clock', () => {
    const seen: number[] = [];
    const airBrake: System = {
      id: 'airBrakeDemo',
      step(ctx) {
        seen.push(ctx.timeMs);
        ctx.state.airPrimaryPsi = 100; // owns the air pressures from now on
      },
    };
    const e = engine({ systems: [airBrake], replaceSystems: ['air'] });
    e.run(100);
    expect(seen.length).toBe(10);
    expect(e.state.airPrimaryPsi).toBe(100);
  });
});

describe('layering', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', 'engine', p), 'utf8');
  it('tools never import the fault model', () => {
    for (const f of readdirSync(join(__dirname, '..', 'src', 'engine', 'tools'))) {
      const text = src(join('tools', f));
      expect(text, f).not.toMatch(/from '\.\.\/faults'|from '\.\.\/presets'/);
    }
  });
  it('control modules never import the fault model', () => {
    for (const f of readdirSync(join(__dirname, '..', 'src', 'engine', 'modules'))) {
      expect(src(join('modules', f)), f).not.toMatch(/from '\.\.\/faults'|from '\.\.\/presets'/);
    }
  });
  it('the engine has no DOM dependency', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)]));
    for (const f of walk(join(__dirname, '..', 'src', 'engine'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bdocument\.|\bwindow\.|performance\.now|Math\.random/);
    }
  });
});
