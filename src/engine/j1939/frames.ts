// J1939 frame helpers from simulator 5.5: PGN math, DM1/DM2 payloads, lamp byte, BAM transport protocol.
export interface Frame {
  id: number;
  bytes: number[];
  /** Source address. */
  sa: number;
  pgn: number;
  acr: string;
  name: string;
  /** Broadcast period in ms; 0 = on request. */
  period: number;
  seq?: number;
  labels?: string[];
  hl?: number[];
  decode?: string;
  dm?: boolean;
}

export const le16 = (v: number) => [v & 255, (v >> 8) & 255];
export const FE1 = 0xfe;
export const FE2 = [0x00, 0xfe];

export function pgnOf(id: number): number {
  const pf = (id >> 16) & 255, ps = (id >> 8) & 255, dp = (id >> 24) & 1;
  return (dp << 16) | (pf << 8) | (pf < 240 ? 0 : ps);
}
export interface DtcLike { spn: number; fmi: number; oc: number; lamps?: string }
export function lampByte(list: { lamps?: string }[]): number {
  let b = 0;
  for (const d of list) {
    const l = d.lamps ?? '';
    if (l.includes('M')) b |= 0x40;
    if (l.includes('R')) b |= 0x10;
    if (l.includes('A')) b |= 0x04;
    if (l.includes('P')) b |= 0x01;
  }
  return b;
}
export const dtcBytes = (d: DtcLike) => [d.spn & 255, (d.spn >> 8) & 255, (((d.spn >> 16) & 7) << 5) | (d.fmi & 31), d.oc & 127];
export function dmPayload(list: DtcLike[], withLamps = true): number[] {
  if (!list.length) return [0x00, 0xff, 0, 0, 0, 0, 0xff, 0xff];
  const p = [withLamps ? lampByte(list) : 0, 0xff];
  list.forEach((d) => p.push(...dtcBytes(d)));
  while (p.length < 8) p.push(0xff);
  return p;
}
/** DTCs out of a DM1/DM2 payload (bytes 3 onward, 4 bytes each). SPN 0 / FMI 0 means none. */
export function decodeDtcs(p: number[]): { spn: number; fmi: number; oc: number }[] {
  const out: { spn: number; fmi: number; oc: number }[] = [];
  for (let i = 2; i + 3 < p.length; i += 4) {
    const spn = p[i] | (p[i + 1] << 8) | ((p[i + 2] >> 5) << 16);
    const fmi = p[i + 2] & 31;
    const oc = p[i + 3] & 127;
    if (spn === 0 && fmi === 0) continue;
    if (p[i] === 0xff && p[i + 1] === 0xff && p[i + 2] === 0xff) continue;
    out.push({ spn, fmi, oc });
  }
  return out;
}
export function lampLetters(b: number): string {
  return (b & 0x10 ? 'R' : '') + (b & 0x04 ? 'A' : '') + (b & 0x40 ? 'M' : '') + (b & 0x01 ? 'P' : '');
}

/** BAM: TP.CM announce, then TP.DT packets of 7 bytes. */
export function tpFrames(sa: number, pgn: number, payload: number[], acr: string, period: number): Frame[] {
  const n = Math.ceil(payload.length / 7);
  const fr: Frame[] = [{
    id: 0x1cecff00 | sa, sa, pgn: 60416, acr: 'TP.CM BAM', name: `Announces ${acr} (${payload.length} bytes, ${n} packets)`, period,
    bytes: [0x20, ...le16(payload.length), n, 0xff, pgn & 255, (pgn >> 8) & 255, (pgn >> 16) & 255],
    labels: ['Control byte 32 = BAM', 'Total size (lo)', 'Total size (hi)', 'Number of packets', 'Reserved (0xFF)', 'PGN being sent (lo)', 'PGN (mid)', 'PGN (hi)'],
    hl: [0, 1, 2, 3, 5, 6, 7],
    decode: `BAM: ${acr} (PGN ${pgn}) follows in ${n} TP.DT packets, ${payload.length} bytes total`,
  }];
  for (let i = 0; i < n; i++) {
    const chunk = payload.slice(i * 7, i * 7 + 7);
    while (chunk.length < 7) chunk.push(0xff);
    fr.push({
      id: 0x1cebff00 | sa, seq: i + 1, sa, pgn: 60160, acr: 'TP.DT', name: `${acr} packet ${i + 1} of ${n}`, period, bytes: [i + 1, ...chunk],
      labels: ['Sequence number', ...chunk.map((_, j) => `${acr} byte ${i * 7 + j + 1}`)], hl: [0],
      decode: `Packet ${i + 1}: bytes ${i * 7 + 1}–${i * 7 + 7} of the ${acr} message`,
    });
  }
  return fr;
}

/** Reassembles BAM transfers and passes single-frame messages straight through. */
export class TpReassembler {
  private open = new Map<number, { pgn: number; size: number; n: number; data: number[]; next: number }>();
  /** Returns a complete message (pgn + payload) when one finishes, else null. */
  push(f: Frame): { sa: number; pgn: number; data: number[] } | null {
    const pf = (f.id >> 16) & 255;
    if (pf === 0xec && f.bytes[0] === 0x20) {
      this.open.set(f.sa, { pgn: f.bytes[5] | (f.bytes[6] << 8) | (f.bytes[7] << 16), size: f.bytes[1] | (f.bytes[2] << 8), n: f.bytes[3], data: [], next: 1 });
      return null;
    }
    if (pf === 0xeb) {
      const t = this.open.get(f.sa);
      if (!t || f.bytes[0] !== t.next) return null;
      t.data.push(...f.bytes.slice(1));
      t.next++;
      if (t.next > t.n) {
        this.open.delete(f.sa);
        return { sa: f.sa, pgn: t.pgn, data: t.data.slice(0, t.size) };
      }
      return null;
    }
    return { sa: f.sa, pgn: f.pgn, data: f.bytes };
  }
}
