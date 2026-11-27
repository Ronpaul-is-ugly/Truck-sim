// How a control module turns pin voltages into a reading and an electrical verdict.
// Thresholds are the ones simulator 5.5 used in ecmSees().
import type { Electrical } from '../electrical/electrical';
import { ntcInverse, SENSOR_FULL_SCALE, speedSensorAc, TYPE_OF } from '../electrical/harness';
import type { TruckState } from '../state';

export interface InputReading {
  cid: string;
  /** Primary voltage the module sees on this input (signal to return, supply, or AC amplitude for speed sensors). */
  volts: number;
  acVolts?: number;
  /** Engineering value decoded from the input (kPa, °C, %, ohms…), null when the input is not usable. */
  value: number | null;
  /** Usable for control (in range and its supply is good). */
  valid: boolean;
  /** Electrical FMI the input shows right now, before debounce. */
  fmi: number | null;
  /** Supply out of range: no electrical code is set for this input (the supply code covers it). */
  inhibited?: boolean;
  /** Injector driver diagnostics. */
  driverOhms?: number;
  dropouts?: number;
}

export const A_LOW = 0.25, A_HIGH = 4.75; // 3-wire sensors
export const B_LOW = 0.15, B_HIGH = 4.85; // thermistors
export const H_LOW = 0.05, H_HIGH = 4.8; // fuel sender
export const SUPPLY_LOW = 4.5, SUPPLY_HIGH = 5.5;

/** Ratio of a sensor's voltage to its engineering value (inverse of 0.5 V + 4 V × x/max). */
export function decodeVolts(cid: string, v: number): number {
  const max = SENSOR_FULL_SCALE[cid] ?? 100;
  const x = Math.max(0, ((v - 0.5) / 4) * max);
  return cid === 'map' ? Math.max(0, x - 101) : x;
}

export interface ReadOpts {
  /** FMI to set when a 2-wire speed sensor is shorted (6 for wheel sensors, 2 for engine/transmission sensors). */
  shortFmi?: number;
}

export function readInput(cid: string, el: Electrical, s: TruckState, opts: ReadOpts = {}): InputReading {
  const t = TYPE_OF[cid];
  const V = (p: string) => el.volts(cid, p);
  switch (t) {
    case 'A': {
      const v = V('c0u_sig') - V('c0u_ret');
      const sup = el.volts(cid, 'sup');
      const inhibited = sup < SUPPLY_LOW || sup > SUPPLY_HIGH;
      const fmi = v < A_LOW ? 4 : v > A_HIGH ? 3 : null;
      const valid = !inhibited && fmi === null;
      return { cid, volts: v, value: valid ? decodeVolts(cid, v) : null, valid, fmi: inhibited ? null : fmi, inhibited };
    }
    case 'B': {
      const v = V('c0u_sig') - V('c0u_ret');
      const fmi = v < B_LOW ? 4 : v > B_HIGH ? 3 : null;
      const R = (2490 * v) / Math.max(1e-6, 5 - v);
      return { cid, volts: v, value: fmi === null ? Math.round(ntcInverse(R) * 10) / 10 : null, valid: fmi === null, fmi };
    }
    case 'C': {
      const a = V('c0u_a'), b = V('c0u_b');
      const dc = a - b;
      const ac = el.acVolts(cid, 'c0u_a', 'c0u_b');
      let fmi: number | null = null;
      if (s.key !== 'off') {
        if (dc > 0.4) fmi = 5;
        else if (a < 0.03) fmi = opts.shortFmi ?? 2;
      }
      return { cid, volts: ac, acVolts: ac, value: fmi === null ? ac : null, valid: fmi === null, fmi, dropouts: s.pulseDropouts[cid] ?? 0 };
    }
    case 'D': {
      const rhl = el.moduleOhms(cid, 'c0u_hi', 'c0u_lo');
      const rhg = el.moduleOhms(cid, 'c0u_hi', 'gnd');
      const vhi = s.key !== 'off' ? V('c0u_hi') : 0;
      const fmi = rhg < 10 || rhl < 0.3 || vhi > 2 ? 6 : rhl > 20 ? 5 : null;
      return { cid, volts: vhi, value: rhl, valid: fmi === null, fmi, driverOhms: rhl };
    }
    case 'E': {
      const v = V('c1d_pwr') - V('c1d_gnd');
      return { cid, volts: v, value: v, valid: true, fmi: null };
    }
    case 'G': {
      const v = V('c1d_pwr') - V('c1d_gnd');
      return { cid, volts: v, value: v, valid: v >= 9, fmi: null };
    }
    case 'H': {
      const v = V('c0u_sig') - V('c0u_ret');
      const fmi = v > H_HIGH ? 3 : v < H_LOW ? 4 : null;
      const R = (300 * v) / Math.max(1e-6, 5 - v);
      const level = Math.max(0, Math.min(100, (1 - (R - 33) / 207) * 100));
      return { cid, volts: v, value: fmi === null ? level : null, valid: fmi === null, fmi };
    }
  }
  return { cid, volts: 0, value: null, valid: false, fmi: null };
}

/** Amplitude a module expects from a magnetic speed sensor right now. */
export const expectedAc = (cid: string, s: TruckState) => speedSensorAc(cid, s, false);

/** Counts valid↔invalid flips; five within 10 s is "erratic, intermittent" (FMI 2, or 8 on wheel sensors).
 *  (Unplugging and replugging a sensor twice is four flips, which is not erratic.) */
export class ErraticDetector {
  private last: boolean | null = null;
  private flips: number[] = [];
  update(valid: boolean, now: number): boolean {
    if (this.last !== null && valid !== this.last) this.flips.push(now);
    this.last = valid;
    while (this.flips.length && now - this.flips[0] > 10000) this.flips.shift();
    return this.flips.length >= 5;
  }
  reset(): void {
    this.last = null;
    this.flips = [];
  }
}
