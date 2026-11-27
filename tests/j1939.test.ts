// J1939 encodings from simulator 5.5: PGN math, DM1 layout, lamp byte, transport protocol, PGN scaling.
import { describe, expect, it } from 'vitest';
import { dmPayload, dtcBytes, lampByte, pgnOf, tpFrames, decodeDtcs } from '../src/engine/j1939/frames';
import { buildBits } from '../src/engine/j1939/bits';
import { engine, parked } from './helpers';

describe('identifiers and PGNs', () => {
  it('derives PGNs from 29-bit IDs (PDU2 keeps PS, PDU1 drops it)', () => {
    expect(pgnOf(0x0cf00400)).toBe(61444); // EEC1
    expect(pgnOf(0x18feca00)).toBe(65226); // DM1
    expect(pgnOf(0x18eafff9)).toBe(59904); // Request (PDU1)
    expect(pgnOf(0x1cecff00)).toBe(60416); // TP.CM
  });
});

describe('DTC and lamp bytes', () => {
  it('packs SPN low/mid/high bits, FMI and occurrence count (DM1 bytes 3–6)', () => {
    expect(dtcBytes({ spn: 110, fmi: 3, oc: 1 })).toEqual([0x6e, 0x00, 0x03, 0x01]);
    expect(dtcBytes({ spn: 3509, fmi: 4, oc: 2 })).toEqual([0xb5, 0x0d, 0x04, 0x02]);
    expect(dtcBytes({ spn: 520192, fmi: 31, oc: 127 })).toEqual([0x00, 0xf0, 0xff, 0x7f]);
  });

  it('lamp byte: MIL 0x40, red stop 0x10, amber 0x04, protect 0x01', () => {
    expect(lampByte([{ lamps: 'AM' }])).toBe(0x44);
    expect(lampByte([{ lamps: 'R' }, { lamps: 'A' }])).toBe(0x14);
    expect(lampByte([])).toBe(0);
  });

  it('no active codes is sent as SPN 0 / FMI 0', () => {
    expect(dmPayload([])).toEqual([0x00, 0xff, 0, 0, 0, 0, 0xff, 0xff]);
  });

  it('two codes need the transport protocol: BAM announce + TP.DT packets', () => {
    const p = dmPayload([{ spn: 110, fmi: 3, oc: 1, lamps: 'A' }, { spn: 100, fmi: 1, oc: 1, lamps: 'R' }]);
    expect(p.length).toBe(10);
    const fr = tpFrames(0, 65226, p, 'DM1', 1000);
    expect(fr[0].id).toBe(0x1cecff00);
    expect(fr[0].bytes).toEqual([0x20, 10, 0, 2, 0xff, 0xca, 0xfe, 0x00]);
    expect(fr.slice(1).map((f) => f.bytes[0])).toEqual([1, 2]);
    expect(decodeDtcs(p)).toEqual([{ spn: 110, fmi: 3, oc: 1 }, { spn: 100, fmi: 1, oc: 1 }]);
  });
});

describe('CAN frame bits', () => {
  it('an EEC1 frame with stuff bits is a little over 130 bits', () => {
    const bits = buildBits(0x0cf00400, [0xf1, 125, 125, 0xe0, 0x2e, 0xff, 0xff, 0xff]);
    expect(bits.length).toBeGreaterThan(128);
    expect(bits.length).toBeLessThan(160);
  });
});

describe('broadcast scaling', () => {
  it('EEC1 engine speed is 0.125 rpm/bit in bytes 4–5', () => {
    const e = engine();
    e.run(2000);
    const f = e.bus.latest(0x0cf00400)!;
    const rpm = (f.bytes[3] | (f.bytes[4] << 8)) * 0.125;
    expect(Math.abs(rpm - e.state.rpm)).toBeLessThan(1);
  });

  it('ET1 coolant is 1 °C/bit with a −40 offset', () => {
    const e = parked('on');
    const f = e.bus.latest(0x18feee00)!;
    expect(f.bytes[0] - 40).toBe(Math.round(e.state.coolantC));
  });

  it('CCVS road speed is computed by the ECM from the TCM output shaft speed in ETC1', () => {
    const e = engine();
    e.run(2000);
    const f = e.bus.latest(0x18fef100)!;
    const kmh = (f.bytes[1] | (f.bytes[2] << 8)) / 256;
    expect(kmh / 1.609344).toBeCloseTo(e.state.speedMph, 0);
  });

  it('no traffic at all with the key off', () => {
    const e = parked('off');
    expect(e.bus.latest(0x0cf00400)).toBeUndefined();
  });
});
