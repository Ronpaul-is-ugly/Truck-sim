// Control-module limit checks and debounce. Each case comes from the fault catalog in simulator 5.5:
// the module must reach the catalog's SPN/FMI from the circuit voltage alone, not from the fault table.
import { describe, expect, it } from 'vitest';
import { codes, engine, parked } from './helpers';

describe('thermistor circuits', () => {
  it('open thermistor: ECM sees about 4.9 V (pull-up) and sets SPN 110 FMI 3', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.run(300);
    const s = e.module('ecm').input('ect');
    expect(s.volts).toBeGreaterThanOrEqual(4.85);
    expect(s.volts).toBeLessThanOrEqual(5.0);
    expect(s.valid).toBe(false);
    e.run(2000);
    expect(codes(e, 'ecm')).toContain('110/3');
  });

  it('thermistor signal shorted to ground reads impossibly hot and sets FMI 4', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'tot.sig@s1', kind: 'shortToGround' } });
    e.run(2500);
    expect(e.module('tcm').input('tot').volts).toBeLessThan(0.15);
    expect(codes(e, 'tcm')).toContain('177/4');
  });
});

describe('3-wire 5 V sensors', () => {
  it('signal below 0.5 V (shorted to ground) sets FMI 4', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'map.sig@s1', kind: 'shortToGround' } });
    e.run(2500);
    expect(e.module('ecm').input('map').volts).toBeLessThan(0.5);
    expect(codes(e, 'ecm')).toContain('102/4');
  });

  it('open signal wire is pulled low by the ECM pull-down: FMI 4', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'oilp.sig@s1', kind: 'open' } });
    e.run(2500);
    expect(e.module('ecm').input('oilp').volts).toBeLessThan(0.25);
    expect(codes(e, 'ecm')).toContain('100/4');
  });

  it('signal shorted to the 5 V reference reads above 4.75 V: FMI 3', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'rail.sig@s1', kind: 'shortToWire', to: 'ref' } });
    e.run(2500);
    expect(e.module('ecm').input('rail').volts).toBeGreaterThan(4.75);
    expect(codes(e, 'ecm')).toContain('157/3');
  });

  it('open sensor return pulls the signal high: FMI 3', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'map.ret@s1', kind: 'open' } });
    e.run(2500);
    expect(codes(e, 'ecm')).toContain('102/3');
  });

  it('broadcasts the 0xFE error indicator for a bad sensor', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'map.sig@s1', kind: 'shortToGround' } });
    e.run(2500);
    const ic1 = e.bus.latest(0x18fef600)!;
    expect(ic1.bytes[1]).toBe(0xfe);
  });
});

describe('debounce and DTC lifecycle', () => {
  it('a code is pending until the condition has lasted 1.5 s, then active with a freeze frame', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.run(1000);
    expect(codes(e, 'ecm')).not.toContain('110/3');
    expect(codes(e, 'ecm', 'pending')).toContain('110/3');
    e.run(1000);
    const d = e.module('ecm').dtcs('active').find((x) => x.spn === 110)!;
    expect(d.fmi).toBe(3);
    expect(d.oc).toBe(1);
    expect(d.freezeFrame).toBeDefined();
  });

  it('modules are asleep with the key off: a fault does not mature', () => {
    const e = parked('off');
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.run(5000);
    expect(codes(e, 'ecm')).toHaveLength(0);
  });

  it('repairing an active fault moves it to previously active (DM2) with its occurrence count', () => {
    const e = parked('on');
    const id = e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } }).faultId!;
    e.run(2500);
    e.dispatch({ type: 'removeFault', id });
    e.run(500);
    expect(codes(e, 'ecm')).not.toContain('110/3');
    expect(codes(e, 'ecm', 'previous')).toContain('110/3');
  });

  it('a second occurrence increments the occurrence count', () => {
    const e = parked('on');
    const a = e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } }).faultId!;
    e.run(2500);
    e.dispatch({ type: 'removeFault', id: a });
    e.run(500);
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.run(2500);
    expect(e.module('ecm').dtcs('active').find((x) => x.spn === 110)!.oc).toBe(2);
  });

  it('an intermittent open sets the erratic FMI 2, not the steady-state FMI 4', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'map.sig@c1', kind: 'open', intermittent: { dutyPct: 20, meanOnMs: 300 } } });
    e.run(30000);
    expect(codes(e, 'ecm')).toContain('102/2');
    expect(codes(e, 'ecm')).not.toContain('102/4');
  });
});

describe('shared 5 V supply', () => {
  it('a 5 V reference shorted to ground on one sensor drops the whole supply: SPN 3509 FMI 4 only', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'map.ref@s1', kind: 'shortToGround' } });
    e.run(2500);
    expect(e.module('ecm').input('sup1').volts).toBeLessThan(0.5); // "Supply 1 reads ≈ 0.1 V"
    expect(codes(e, 'ecm')).toEqual(['3509/4']);
    // every sensor on supply 1 now broadcasts the error indicator (MAP in IC1 byte 2)
    expect(e.bus.latest(0x18fef600)!.bytes[1]).toBe(0xfe);
    // sensors on supply 2 are untouched
    expect(e.module('ecm').input('oilp').valid).toBe(true);
  });
});

describe('speed sensors and injectors', () => {
  it('open crank sensor: FMI 5, the engine keeps running on the cam signal', () => {
    const e = engine();
    e.run(500);
    e.dispatch({ type: 'injectFault', fault: { part: 'crank.a@s1', kind: 'open' } });
    e.run(2500);
    expect(codes(e, 'ecm')).toContain('190/5');
    expect(e.state.running).toBe(true);
  });

  it('crank and cam both open: the engine stalls', () => {
    const e = engine();
    e.run(500);
    e.dispatch({ type: 'injectFault', fault: { part: 'crank.a@s1', kind: 'open' } });
    e.dispatch({ type: 'injectFault', fault: { part: 'cam.a@s1', kind: 'open' } });
    e.run(2500);
    expect(e.state.running).toBe(false);
  });

  it('wheel speed sensor shorted to ground: ABS sets FMI 6 and turns ABS off', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'wlr.a@s1', kind: 'shortToGround' } });
    e.run(2500);
    expect(codes(e, 'abs')).toContain('791/6');
    expect(e.module('abs').outputs.absEnabled).toBe(false);
  });

  it('wheel sensor pushed back from the tone ring: low output at speed sets FMI 1', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'wlf.sensor', kind: 'drift', value: 0.2 } });
    e.run(2500);
    expect(codes(e, 'abs')).toContain('789/1');
  });

  it('open injector coil: SPN 651 FMI 5 and the cylinder stops contributing', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'inj1.hi@s1', kind: 'open' } });
    e.run(2500);
    expect(codes(e, 'ecm')).toContain('651/5');
    expect(e.state.cylinderContribution[0]).toBe(0);
  });
});

describe('real conditions (sensor and wiring are good)', () => {
  it('coolant leak: 112 °C, SPN 110 FMI 0, red stop lamp, 45 mph protection derate', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'mech.coolant', kind: 'leak' } });
    e.run(2500);
    expect(e.state.coolantC).toBe(112);
    expect(codes(e, 'ecm')).toContain('110/0');
    expect(e.module('ecm').dtcs('active').find((d) => d.spn === 110)!.lamps).toContain('R');
    expect(e.module('ecm').outputs.speedCapMph).toBe(45);
  });

  it('VGT vanes stuck: commanded vs actual position sets SPN 2795 FMI 7', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'mech.vgt', kind: 'stuck', value: 15 } });
    e.run(2500);
    expect(codes(e, 'ecm')).toContain('2795/7');
  });

  it('primary air leak: 55 psi, cluster sets SPN 117 FMI 1', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'mech.airPrimary', kind: 'leak' } });
    e.run(2500);
    expect(e.state.airPrimaryPsi).toBe(55);
    expect(codes(e, 'clu')).toContain('117/1');
  });

  it('ABS feed with added resistance: 9.4 V at the ABS ECU while running, SPN 627 FMI 4', () => {
    const e = engine();
    e.dispatch({ type: 'injectFault', fault: { part: 'abspwr.fuse', kind: 'addedOhms', value: 1.5 } });
    e.run(2500);
    expect(e.module('abs').input('abspwr').volts).toBeCloseTo(9.4, 0);
    expect(codes(e, 'abs')).toContain('627/4');
  });
});

describe('catalog presets reproduce every catalog FMI', () => {
  it('each fault in the catalog that has a preset sets its own SPN/FMI', async () => {
    const { C } = await import('../src/engine/data/catalog');
    const { PRESETS } = await import('../src/engine/presets');
    const missed: string[] = [];
    for (const c of C) {
      for (const f of c.faults) {
        const p = PRESETS[`${c.id}/${f.key}`];
        if (!p) { missed.push(`${c.id}/${f.key} (no preset)`); continue; }
        const e = engine({ seed: 7 });
        e.run(300);
        e.dispatch({ type: 'applyPreset', cid: c.id, key: f.key });
        e.run(p.settleMs ?? 4000);
        const all = e.module(c.ecu as 'ecm').dtcs('active').map((d) => `${d.spn}/${d.fmi}`);
        if (!all.includes(`${c.spn}/${f.fmi}`)) missed.push(`${c.id}/${f.key}: wanted ${c.spn}/${f.fmi}, got [${all.join(', ')}]`);
      }
    }
    expect(missed).toEqual([]);
  });
});
