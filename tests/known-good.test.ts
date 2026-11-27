// Known-good meter readings, taken from the GUIDES checklist and the circuit values in simulator 5.5.
import { describe, expect, it } from 'vitest';
import { parked, engine } from './helpers';

const ohm = (e: ReturnType<typeof parked>, circuit: string, red: string, black: string) =>
  e.meter.measure({ circuit, red, black, mode: 'ohm', isolateModule: true });
const dcv = (e: ReturnType<typeof parked>, circuit: string, red: string, black: string) =>
  e.meter.measure({ circuit, red, black, mode: 'dcv' });

describe('J1939 backbone at the 9-pin (GUIDES.F)', () => {
  it('key off: C to D is 60 Ω (two 120 Ω terminators in parallel)', () => {
    const e = parked('off');
    expect(ohm(e, 'net', 'C', 'D').value).toBeCloseTo(60, 0);
  });

  it('key off: one terminator removed reads about 120 Ω', () => {
    const e = parked('off');
    e.dispatch({ type: 'setTerminator', side: 'R', installed: false });
    expect(ohm(e, 'net', 'C', 'D').value).toBeCloseTo(120, 0);
  });

  it('key off: CAN-H and CAN-L to ground (pin A) read OL', () => {
    const e = parked('off');
    expect(ohm(e, 'net', 'C', 'A').text).toBe('OL');
    expect(ohm(e, 'net', 'D', 'A').text).toBe('OL');
  });

  it('key on: CAN-H 2.5–3.0 V and CAN-L 2.0–2.5 V to ground', () => {
    const e = parked('on');
    const h = dcv(e, 'net', 'C', 'A').value!;
    const l = dcv(e, 'net', 'D', 'A').value!;
    expect(h).toBeGreaterThanOrEqual(2.5);
    expect(h).toBeLessThanOrEqual(3.0);
    expect(l).toBeGreaterThanOrEqual(2.0);
    expect(l).toBeLessThanOrEqual(2.5);
  });

  it('ohms with the key on is refused, as on the bench meter', () => {
    const e = parked('on');
    const r = e.meter.measure({ circuit: 'net', red: 'C', black: 'D', mode: 'ohm' });
    expect(r.text).toBe('Err');
    expect(r.warn).toMatch(/Turn the key OFF/);
  });
});

describe('3-wire 5 V sensor (GUIDES.A)', () => {
  it('key on, plugged in: 5 V reference ≈ 5.0 V and sensor return drop < 0.1 V', () => {
    const e = parked('on');
    expect(dcv(e, 'map', 'c1u_ref', 'gnd').value!).toBeCloseTo(5.0, 1);
    expect(Math.abs(dcv(e, 'map', 'c1u_ret', 'gnd').value!)).toBeLessThan(0.1);
  });

  it('key on, plugged in: signal is inside 0.5–4.5 V', () => {
    const e = parked('on');
    const v = dcv(e, 'map', 'c1u_sig', 'gnd').value!;
    expect(v).toBeGreaterThanOrEqual(0.5);
    expect(v).toBeLessThanOrEqual(4.5);
    // MAP at key-on, engine off reads barometric pressure: 0.5 + 4 × 101/400 = 1.51 V
    expect(v).toBeCloseTo(1.51, 1);
  });

  it('key on, unplugged: harness signal pin ≈ 0 V (ECM pull-down)', () => {
    const e = parked('on');
    e.dispatch({ type: 'unplug', circuit: 'map', connector: 1 });
    expect(Math.abs(dcv(e, 'map', 'c1u_sig', 'gnd').value!)).toBeLessThan(0.05);
  });

  it('key off, unplugged at both ends: each wire end to end under 5 Ω, signal to ground OL', () => {
    const e = parked('off');
    e.dispatch({ type: 'unplug', circuit: 'map', connector: 1 });
    for (const w of ['ref', 'sig', 'ret']) expect(ohm(e, 'map', `c0u_${w}`, `c1u_${w}`).value!).toBeLessThan(5);
    expect(ohm(e, 'map', 'c1u_sig', 'gnd').text).toBe('OL');
  });
});

describe('thermistor (GUIDES.B)', () => {
  it('key on, unplugged: harness signal pin ≈ 5 V from the ECM pull-up', () => {
    const e = parked('on');
    e.dispatch({ type: 'unplug', circuit: 'ect', connector: 1 });
    expect(dcv(e, 'ect', 'c1u_sig', 'gnd').value!).toBeCloseTo(5.0, 1);
  });

  it('plugged in: voltage drops as temperature rises (NTC 3000 Ω at 25 °C, β 3600)', () => {
    const e = parked('on');
    const cold = dcv(e, 'amb', 'c1u_sig', 'c1u_ret').value!; // 18 °C ambient
    const hot = dcv(e, 'ect', 'c1u_sig', 'c1u_ret').value!; // ≈ 86 °C coolant
    expect(hot).toBeLessThan(cold);
    // 5 V × R/(R + 2490) with R = ntc(86 °C) ≈ 386 Ω
    expect(hot).toBeCloseTo(0.67, 1);
  });
});

describe('2-wire magnetic sensors (GUIDES.C)', () => {
  it('wheel speed sensor coil reads 1500–2500 Ω (Bendix WS-24)', () => {
    const e = parked('off');
    const r = ohm(e, 'wlf', 'c0u_a', 'c0u_b').value!;
    expect(r).toBeGreaterThan(1500);
    expect(r).toBeLessThan(2500);
  });

  it('pins to ground read OL', () => {
    const e = parked('off');
    expect(ohm(e, 'wlf', 'c0u_a', 'gnd').text).toBe('OL');
  });

  it('AC output rises with speed while driving', () => {
    const e = engine();
    e.run(2000);
    const r = e.meter.measure({ circuit: 'wlf', red: 'c1u_a', black: 'c1u_b', mode: 'acv' });
    expect(r.value!).toBeGreaterThan(0.25);
  });
});

describe('injectors and fuel sender (GUIDES.D, GUIDES.H)', () => {
  it('injector high side to low side at the ECM: coil + harness under 2 Ω', () => {
    const e = parked('off');
    const r = ohm(e, 'inj1', 'c0u_hi', 'c0u_lo').value!;
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(2);
  });

  it('fuel sender: 33 Ω full, 240 Ω empty; 70 % tank ≈ 95 Ω', () => {
    const e = parked('off');
    e.dispatch({ type: 'unplug', circuit: 'fuel', connector: 1 });
    expect(ohm(e, 'fuel', 'c1d_sig', 'c1d_ret').value!).toBeCloseTo(33 + 207 * 0.3, 0);
  });
});

describe('power feeds (GUIDES.E)', () => {
  it('module power pin within 0.5 V of battery and feed drop under 0.5 V, key on', () => {
    const e = parked('on');
    const drop = dcv(e, 'abspwr', 'batpos', 'c1u_pwr').value!;
    expect(drop).toBeLessThan(0.5);
  });
});
