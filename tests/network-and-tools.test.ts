// Network wiring faults (NETF) and the scan tool, which only talks to the truck over the J1939 bus.
import { describe, expect, it } from 'vitest';
import { codes, engine, parked } from './helpers';

describe('network wiring faults', () => {
  it('open TCM stub: ECM and TCM log SPN 639 FMI 9; road speed goes to "not available"', () => {
    const e = engine();
    e.run(500);
    e.dispatch({ type: 'applyPreset', cid: 'net', key: 'tcm' });
    e.run(4000);
    expect(codes(e, 'ecm')).toContain('639/9');
    expect(codes(e, 'tcm')).toContain('639/9');
    expect(codes(e, 'abs')).not.toContain('639/9');
    const ccvs = e.bus.latest(0x18fef100)!;
    expect([ccvs.bytes[1], ccvs.bytes[2]]).toEqual([0xff, 0xff]);
  });

  it('CAN-H shorted to CAN-L: the bus is dead, every module stores 639/9, the scan tool cannot connect', () => {
    const e = engine();
    e.run(500);
    const r = e.dispatch({ type: 'applyPreset', cid: 'net', key: 'hl' });
    e.run(4000);
    expect(e.scan.connected()).toBe(false);
    for (const m of ['ecm', 'acm', 'tcm', 'abs', 'clu'] as const) expect(codes(e, m)).toContain('639/9');
    // repair, then the stored codes are readable
    e.dispatch({ type: 'clearPreset', cid: 'net' });
    e.run(1500);
    expect(e.scan.connected()).toBe(true);
    void r;
    expect(e.scan.activeCodes().length + e.scan.requestDM2().length).toBeGreaterThan(0);
  });

  it('both terminators removed: frames corrupted, every module logs 639/2', () => {
    const e = parked('on');
    e.dispatch({ type: 'setTerminator', side: 'L', installed: false });
    e.dispatch({ type: 'setTerminator', side: 'R', installed: false });
    e.run(4000);
    for (const m of ['ecm', 'acm', 'tcm', 'abs', 'clu'] as const) expect(codes(e, m)).toContain('639/2');
  });

  it('one terminator removed: the bus still works', () => {
    const e = parked('on');
    e.dispatch({ type: 'setTerminator', side: 'R', installed: false });
    e.run(4000);
    expect(e.scan.connected()).toBe(true);
    expect(codes(e, 'ecm')).not.toContain('639/2');
  });
});

describe('scan tool', () => {
  it('reads active codes from DM1 broadcasts, including multi-packet BAM', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.dispatch({ type: 'injectFault', fault: { part: 'oilp.sig@s1', kind: 'shortToGround' } });
    e.run(3500);
    const list = e.scan.activeCodes().filter((d) => d.sa === 0).map((d) => `${d.spn}/${d.fmi}`);
    expect(list.sort()).toEqual(['100/4', '110/3']);
  });

  it('lists the responding modules by source address', () => {
    const e = parked('on');
    expect(e.scan.modules().map((m) => m.sa).sort((a, b) => a - b)).toEqual([0, 3, 11, 23, 61]);
  });

  it('DM2 request returns previously active codes; DM11 clear brings back a code whose fault is still present', () => {
    const e = parked('on');
    const id = e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } }).faultId!;
    e.dispatch({ type: 'injectFault', fault: { part: 'map.sig@s1', kind: 'shortToGround' } });
    e.run(2500);
    e.dispatch({ type: 'removeFault', id });
    e.run(200);
    expect(e.scan.requestDM2().map((d) => `${d.spn}/${d.fmi}`)).toContain('110/3');
    e.scan.clearCodes();
    expect(e.scan.requestDM2()).toHaveLength(0);
    e.run(2500);
    expect(e.scan.activeCodes().map((d) => `${d.spn}/${d.fmi}`)).toContain('102/4');
  });

  it('freeze frame (DM4) records engine speed and coolant at the moment the code set', () => {
    const e = engine();
    e.run(2000);
    e.dispatch({ type: 'injectFault', fault: { part: 'ect.sig@s1', kind: 'open' } });
    e.run(2500);
    const ff = e.scan.freezeFrame(0, 110, 3)!;
    expect(ff.rpm).toBeGreaterThan(600);
    expect(ff.mph).toBeGreaterThan(30);
  });

  it('live data shows ERR for a sensor sending the error indicator', () => {
    const e = parked('on');
    e.dispatch({ type: 'injectFault', fault: { part: 'oilp.sig@s1', kind: 'open' } });
    e.run(2500);
    const row = e.scan.liveData().find((r) => r.spn === 100)!;
    expect(row.value).toBe('ERR');
  });

  it('cylinder cutout test: a dead cylinder barely drops engine speed', () => {
    const e = engine({ initial: { driver: { setMph: 0 }, speedMph: 0 } });
    e.dispatch({ type: 'injectFault', fault: { part: 'mech.injector3', kind: 'stuck' } });
    e.run(2500);
    const drops = e.scan.cylinderCutout()!;
    expect(drops[2]).toBeLessThan(15);
    expect(drops.filter((d) => d >= 15)).toHaveLength(5);
  });
});
