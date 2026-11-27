// Freeze frame (DM4, PGN 65229). Standard fields first, then the module-specific ones 5.5 showed.
import { le16 } from '../j1939/frames';

export interface FreezeFrame {
  rpm: number;
  mph: number;
  coolantC: number;
  oilKpa: number;
  boostKpa: number;
  loadPct: number;
  batteryV: number;
  tSec: number;
}

/** One DM4 record: length, SPN/FMI/OC, torque mode, boost, speed, load, coolant, road speed, then oil, battery, time. */
export function encodeFreezeFrame(spn: number, fmi: number, oc: number, ff: FreezeFrame): number[] {
  const body = [
    spn & 255, (spn >> 8) & 255, (((spn >> 16) & 7) << 5) | (fmi & 31), oc & 127,
    0xf1,
    Math.max(0, Math.min(250, Math.round(ff.boostKpa / 2))),
    ...le16(Math.round(ff.rpm / 0.125)),
    Math.round(ff.loadPct),
    Math.round(ff.coolantC + 40),
    ...le16(Math.round(ff.mph * 1.609344 * 256)),
    Math.max(0, Math.min(250, Math.round(ff.oilKpa / 4))),
    ...le16(Math.round(ff.batteryV / 0.05)),
    ...le16(Math.round(ff.tSec)),
  ];
  return [body.length, ...body];
}

export function decodeFreezeFrames(p: number[]): { spn: number; fmi: number; oc: number; ff: FreezeFrame }[] {
  const out: { spn: number; fmi: number; oc: number; ff: FreezeFrame }[] = [];
  let i = 0;
  while (i < p.length && p[i] && p[i] !== 0xff) {
    const len = p[i];
    const b = p.slice(i + 1, i + 1 + len);
    out.push({
      spn: b[0] | (b[1] << 8) | ((b[2] >> 5) << 16),
      fmi: b[2] & 31,
      oc: b[3] & 127,
      ff: {
        boostKpa: b[5] * 2,
        rpm: (b[6] | (b[7] << 8)) * 0.125,
        loadPct: b[8],
        coolantC: b[9] - 40,
        mph: (b[10] | (b[11] << 8)) / 256 / 1.609344,
        oilKpa: b[12] * 4,
        batteryV: (b[13] | (b[14] << 8)) * 0.05,
        tSec: b[15] | (b[16] << 8),
      },
    });
    i += 1 + len;
  }
  return out;
}
