// Service tool on the 9-pin. Everything it knows comes off the J1939 bus: DM1 broadcasts it overhears,
// and the replies to requests it sends (DM2, DM11/DM3, DM4, proprietary tests).
import type { MessageBus, MonitorRow, TimedFrame } from '../j1939/bus';
import { decodeDtcs, lampLetters, TpReassembler, type Frame } from '../j1939/frames';
import { decodeFreezeFrames, type FreezeFrame } from '../modules/freeze';
import { ECUS, SA2ECU, type EcuKey } from '../data/catalog';

export const TOOL_SA = 0xf9;
const MODULE_SAS = [0, 3, 11, 23, 61];

export interface ScanCode {
  sa: number;
  ecu: EcuKey;
  spn: number;
  fmi: number;
  oc: number;
  /** Lamps the module is requesting (from its DM1 lamp byte). */
  lamps: string;
}
export interface LiveRow {
  name: string;
  spn: number;
  ecu: EcuKey;
  unit: string;
  value: string;
}
export interface ScanHost {
  bus: MessageBus;
  now: () => number;
  log: (type: string, args: unknown, result: unknown) => void;
}

const rb1 = (b: number[], i: number, f: (r: number) => string | number) => (b[i] === 0xfe ? 'ERR' : b[i] === 0xff ? 'N/A' : String(f(b[i])));
const rb2 = (b: number[], i: number, f: (r: number) => string | number) => (b[i + 1] === 0xfe ? 'ERR' : b[i + 1] === 0xff ? 'N/A' : String(f(b[i] | (b[i + 1] << 8))));
/** 5.5 LIVE table: parameter, SPN, sender, ID, decoder, unit. */
export const LIVE: [string, number, EcuKey, number, (b: number[]) => string, string][] = [
  ['Engine speed', 190, 'ecm', 0x0cf00400, (b) => rb2(b, 3, (r) => Math.round(r * 0.125)), 'rpm'],
  ['Accelerator pedal position', 91, 'ecm', 0x0cf00300, (b) => rb1(b, 1, (r) => (r * 0.4).toFixed(0)), '%'],
  ['Engine load at current speed', 92, 'ecm', 0x0cf00300, (b) => rb1(b, 2, (r) => r), '%'],
  ['Coolant temperature', 110, 'ecm', 0x18feee00, (b) => rb1(b, 0, (r) => Math.round((r - 40) * 1.8 + 32)), '°F'],
  ['Engine oil pressure', 100, 'ecm', 0x18feef00, (b) => rb1(b, 3, (r) => Math.round(r * 4 * 0.145)), 'psi'],
  ['Intake manifold pressure (boost)', 102, 'ecm', 0x18fef600, (b) => rb1(b, 1, (r) => (r * 2 * 0.145).toFixed(1)), 'psi'],
  ['Intake manifold temperature', 105, 'ecm', 0x18fef600, (b) => rb1(b, 2, (r) => Math.round((r - 40) * 1.8 + 32)), '°F'],
  ['Intake air mass flow', 132, 'ecm', 0x0cf00a00, (b) => rb2(b, 2, (r) => (r * 0.05).toFixed(0)), 'kg/h'],
  ['Wheel-based vehicle speed', 84, 'ecm', 0x18fef100, (b) => rb2(b, 1, (r) => (r / 256 / 1.609344).toFixed(0)), 'mph'],
  ['Transmission output shaft speed', 191, 'tcm', 0x0cf00203, (b) => rb2(b, 1, (r) => Math.round(r * 0.125)), 'rpm'],
  ['Brake pedal position', 521, 'abs', 0x18f0010b, (b) => rb1(b, 1, (r) => (r * 0.4).toFixed(0)), '%'],
  ['DEF tank level', 1761, 'acm', 0x18fe563d, (b) => rb1(b, 0, (r) => (r * 0.4).toFixed(0)), '%'],
  ['Fuel level', 96, 'clu', 0x18fefc17, (b) => rb1(b, 1, (r) => (r * 0.4).toFixed(0)), '%'],
  ['Current gear', 523, 'tcm', 0x18f00503, (b) => (b[3] === 0xff ? 'N/A' : String(b[3] - 125 || 'N')), ''],
  ['Engine fuel rate', 183, 'ecm', 0x18fef200, (b) => rb2(b, 0, (r) => ((r * 0.05) / 3.785).toFixed(1)), 'gal/h'],
  ['Engine throttle valve 1 position', 51, 'ecm', 0x18fef200, (b) => rb1(b, 6, (r) => (r * 0.4).toFixed(0)), '%'],
  ['Instantaneous fuel economy', 184, 'ecm', 0x18fef200, (b) => rb2(b, 2, (r) => ((r / 512) * 2.352).toFixed(1)), 'mpg'],
  ['Front axle speed', 904, 'abs', 0x18febf0b, (b) => rb2(b, 0, (r) => (r / 256 / 1.609344).toFixed(0)), 'mph'],
  ['Rel. speed, rear axle left wheel', 907, 'abs', 0x18febf0b, (b) => rb1(b, 4, (r) => ((r / 16 - 7.8125) / 1.609344).toFixed(1)), 'mph'],
  ['Rel. speed, rear axle right wheel', 908, 'abs', 0x18febf0b, (b) => rb1(b, 5, (r) => ((r / 16 - 7.8125) / 1.609344).toFixed(1)), 'mph'],
];

export class ScanTool {
  private tp = new TpReassembler();
  private dm1 = new Map<number, { t: number; data: number[] }>();
  private heardAt = new Map<number, number>();
  private last = new Map<number, TimedFrame>();
  private inbox: { sa: number; pgn: number; data: number[]; f: TimedFrame }[] = [];

  constructor(private host: ScanHost) {
    host.bus.subscribe(null, (f) => this.rx(f));
  }
  private rx(f: TimedFrame): void {
    if (f.sa === TOOL_SA) return;
    this.heardAt.set(f.sa, f.t);
    this.last.set(f.id, f);
    const m = this.tp.push(f);
    if (!m) return;
    if (m.pgn === 65226) this.dm1.set(m.sa, { t: f.t, data: m.data });
    else this.inbox.push({ ...m, f });
  }
  private send(f: Omit<Frame, 'sa'>): boolean {
    return this.host.bus.publish({ ...f, sa: TOOL_SA });
  }
  private request(pgn: number, acr: string, name: string): { sa: number; pgn: number; data: number[] }[] {
    this.inbox = [];
    this.send({ id: 0x18eafff9, pgn: 59904, acr: 'Request', name, period: 0, bytes: [pgn & 255, (pgn >> 8) & 255, (pgn >> 16) & 255],
      labels: ['Requested PGN (lo)', 'Requested PGN (mid)', 'Requested PGN (hi)'], hl: [0, 1, 2], decode: `Request for PGN ${pgn} (${acr}), sent to global address 0xFF` });
    return this.inbox.filter((m) => m.pgn === pgn || m.pgn === 59392);
  }

  /** Traffic seen on the 9-pin in the last second. */
  connected(): boolean {
    const now = this.host.now();
    return this.host.bus.carrying && [...this.heardAt.values()].some((t) => now - t <= 1000);
  }
  modules(): { sa: number; ecu: EcuKey; name: string; responding: boolean }[] {
    const now = this.host.now();
    return MODULE_SAS.filter((sa) => now - (this.heardAt.get(sa) ?? -1e9) <= 2000).map((sa) => ({ sa, ecu: SA2ECU[sa], name: ECUS[SA2ECU[sa]].name, responding: true }));
  }
  responding(sa: number): boolean {
    return this.host.now() - (this.heardAt.get(sa) ?? -1e9) <= 2000;
  }
  /** Active codes from each module's most recent DM1. */
  activeCodes(): ScanCode[] {
    const now = this.host.now();
    const out: ScanCode[] = [];
    for (const [sa, m] of this.dm1) {
      if (now - m.t > 3000 || !SA2ECU[sa]) continue;
      for (const d of decodeDtcs(m.data)) out.push({ sa, ecu: SA2ECU[sa], ...d, lamps: lampLetters(m.data[0]) });
    }
    return out;
  }
  /** DM2 request: previously active codes from every module that answers. */
  requestDM2(): ScanCode[] {
    const replies = this.request(65227, 'DM2', 'Request PGN 65227 (DM2) from all');
    const out: ScanCode[] = [];
    for (const r of replies) if (r.pgn === 65227) for (const d of decodeDtcs(r.data)) out.push({ sa: r.sa, ecu: SA2ECU[r.sa], ...d, lamps: '' });
    const answered = [...new Set(replies.map((r) => r.sa))];
    this.host.log('scan.requestDM2', {}, { answered, codes: out.map((c) => `${c.sa}:${c.spn}/${c.fmi}`) });
    this.lastAnswered = answered;
    return out;
  }
  lastAnswered: number[] = [];
  /** DM11 + DM3: clear active and previously active codes. Returns the modules that acknowledged. */
  clearCodes(): number[] {
    const a = this.request(65235, 'DM11', 'Request PGN 65235 (DM11) from all').filter((r) => r.pgn === 59392).map((r) => r.sa);
    this.request(65228, 'DM3', 'Request PGN 65228 (DM3) from all');
    this.dm1.clear();
    this.host.log('scan.clearCodes', {}, { acked: a });
    return a;
  }
  /** DM4 freeze frame for one code. */
  freezeFrame(sa: number, spn: number, fmi: number): FreezeFrame | null {
    const r = this.request(65229, 'DM4', 'Request PGN 65229 (DM4)').filter((m) => m.sa === sa && m.pgn === 65229);
    const ff = r.flatMap((m) => decodeFreezeFrames(m.data)).find((x) => x.spn === spn && x.fmi === fmi)?.ff ?? null;
    this.host.log('scan.freezeFrame', { sa, spn, fmi }, ff ? 'ok' : 'none');
    return ff;
  }
  liveData(): LiveRow[] {
    const now = this.host.now();
    return LIVE.map(([name, spn, ecu, id, fn, unit]) => {
      const f = this.last.get(id);
      return { name, spn, ecu, unit, value: !f || now - f.t > Math.max(3000, 4 * f.period) ? 'No data' : fn(f.bytes) };
    });
  }
  /** Cylinder cutout test (proprietary request to the ECM). Drops in rpm per cylinder, or null if refused. */
  cylinderCutout(): number[] | null {
    this.inbox = [];
    this.send({ id: 0x18ef00f9, pgn: 61184, acr: 'PropA', name: 'Cylinder cutout request', period: 0, bytes: [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], decode: 'Proprietary request: run cylinder cutout test' });
    const r = this.inbox.find((m) => m.sa === 0 && m.data[0] === 0x01);
    const drops = r && r.data[1] !== 0xff ? r.data.slice(1, 7) : null;
    this.host.log('scan.cylinderCutout', {}, drops);
    return drops;
  }
  /** Parked regen request to the ACM. Returns the ACM's answer code: 0 started, 1 not needed, 2 refused, null no answer. */
  parkedRegen(): number | null {
    this.inbox = [];
    this.send({ id: 0x18ef3df9, pgn: 61184, acr: 'PropA', name: 'Parked regen request', period: 0, bytes: [0x02, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], decode: 'Proprietary request: parked DPF regeneration' });
    const r = this.inbox.find((m) => m.sa === 61 && m.data[0] === 0x02);
    const code = r ? r.data[1] : null;
    this.host.log('scan.parkedRegen', {}, code);
    return code;
  }
  /** Bus monitor rows (what a CAN logger on the 9-pin shows). */
  monitor(): MonitorRow[] {
    return this.host.bus.rows();
  }
}
