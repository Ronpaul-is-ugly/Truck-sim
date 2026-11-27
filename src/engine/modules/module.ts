// Base control module: wakes with the key, samples its inputs every 100 ms, runs limit and plausibility
// checks, debounces them into DTCs, answers J1939 requests and broadcasts its PGNs.
import { DtcMemory, type Condition, type Dtc } from './dtc';
import { ErraticDetector, readInput, type InputReading, type ReadOpts } from './inputs';
import { encodeFreezeFrame, type FreezeFrame } from './freeze';
import type { ModuleOutputs } from './outputs';
import { dmPayload, pgnOf, tpFrames, type Frame } from '../j1939/frames';
import type { MessageBus, TimedFrame } from '../j1939/bus';
import type { Electrical } from '../electrical/electrical';
import type { TruckState } from '../state';
import type { Rng } from '../rng';
import { ECUS, lampsFor, type EcuKey } from '../data/catalog';

export const SAMPLE_MS = 100;
export const TIMEOUT_MS = 1000;

export interface ModuleEnv {
  electrical: Electrical;
  bus: MessageBus;
  state: () => TruckState;
  outputs: ModuleOutputs;
  rng: Rng;
  now: () => number;
}

export interface Periodic {
  id: number;
  period: number;
  build: () => Frame | Frame[];
}

export abstract class ControlModule {
  readonly sa: number;
  readonly name: string;
  readonly dtc = new DtcMemory();
  awake = false;
  protected wakeAt = 0;
  protected inputsNow = new Map<string, InputReading>();
  protected erratic = new Map<string, ErraticDetector>();
  /** Latest frame received from each ID (this module's own view of the bus). */
  protected rx = new Map<number, TimedFrame>();
  protected busErrors = false;
  /** PGNs this module needs from other nodes; silence for TIMEOUT_MS sets SPN 639 FMI 9. */
  protected watch: number[] = [];
  protected abstract periodic: Periodic[];

  constructor(readonly ecu: EcuKey, protected env: ModuleEnv, protected inputIds: string[], protected readOpts: Record<string, ReadOpts> = {}) {
    this.sa = ECUS[ecu].sa;
    this.name = ECUS[ecu].name;
    env.bus.subscribe(this.sa, (f) => this.receive(f));
  }

  // ---------- public views ----------
  owns(cid: string): boolean {
    return this.inputIds.includes(cid);
  }
  inputs(): InputReading[] {
    return [...this.inputsNow.values()];
  }
  input(cid: string): InputReading {
    return this.inputsNow.get(cid) ?? { cid, volts: 0, value: null, valid: false, fmi: null };
  }
  dtcs(status: Dtc['status'] = 'active'): Dtc[] {
    return this.dtc.list(status);
  }
  /** Sensor (or input) currently out of range: broadcast 0xFE instead of a value. */
  err(cid: string): boolean {
    const r = this.inputsNow.get(cid);
    return !!r && !r.valid;
  }

  // ---------- clock ----------
  step(now: number, dt: number): void {
    const s = this.env.state();
    if (s.key === 'off') {
      this.awake = false;
      return;
    }
    if (!this.awake) {
      this.awake = true;
      this.wakeAt = now;
      this.rx.clear();
      this.erratic.forEach((e) => e.reset());
    }
    const since = now - this.wakeAt;
    if (since % SAMPLE_MS === 0) this.sample(now);
    for (const p of this.periodic) {
      if (since % p.period !== 0) continue;
      const out = p.build();
      for (const f of Array.isArray(out) ? out : [out]) this.env.bus.publish(f);
    }
    void dt;
  }

  protected sample(now: number): void {
    const s = this.env.state();
    for (const cid of this.inputIds) this.inputsNow.set(cid, readInput(cid, this.env.electrical, s, this.readOpts[cid]));
    this.busErrors = this.env.bus.health === 'unterminated';
    const present = this.conditions(now, s);
    this.dtc.update(present, SAMPLE_MS, now, () => this.freezeFrame(now));
    this.updateOutputs(s);
  }

  /** Electrical conditions on every input (with erratic detection), plus the module's own checks. */
  protected conditions(now: number, s: TruckState): Condition[] {
    const out: Condition[] = [];
    for (const cid of this.inputIds) {
      const r = this.inputsNow.get(cid)!;
      if (r.inhibited) continue;
      let ed = this.erratic.get(cid);
      if (!ed) this.erratic.set(cid, (ed = new ErraticDetector()));
      const erratic = ed.update(r.fmi === null, now);
      if (erratic) out.push(this.cond(cid, this.erraticFmi(cid)));
      else if (r.fmi !== null) out.push(this.cond(cid, r.fmi));
    }
    out.push(...this.checks(now, s));
    // network: error frames, or a node we need has gone silent
    if (this.busErrors) out.push({ spn: 639, fmi: 2, cid: 'net', lamps: 'A' });
    else if (now - this.wakeAt > TIMEOUT_MS && this.watch.some((id) => !this.heard(id, now))) out.push({ spn: 639, fmi: 9, cid: 'net', lamps: 'A' });
    // one code per SPN: keep the first (electrical faults first, then checks)
    const seen = new Set<number>();
    return out.filter((c) => (seen.has(c.spn) ? false : (seen.add(c.spn), true)));
  }
  protected erraticFmi(_cid: string): number {
    return 2;
  }
  protected heard(id: number, now: number): boolean {
    const f = this.rx.get(id);
    return !!f && now - f.t <= TIMEOUT_MS;
  }
  protected cond(cid: string, fmi: number): Condition {
    const spn = cid === 'net' ? 639 : (spnOf(cid) as number);
    return { spn, fmi, cid, lamps: lampsFor(cid, fmi) };
  }
  /** Module-specific limit/plausibility checks (real conditions). */
  protected checks(_now: number, _s: TruckState): Condition[] {
    return [];
  }
  protected updateOutputs(_s: TruckState): void {}

  protected freezeFrame(now: number): FreezeFrame {
    const s = this.env.state();
    return { rpm: s.rpm, mph: s.speedMph, coolantC: s.coolantC, oilKpa: s.oilKpa, boostKpa: s.boostKpa, loadPct: s.load * 100, batteryV: s.batteryV, tSec: (now - this.wakeAt) / 1000 };
  }

  // ---------- bus ----------
  protected receive(f: TimedFrame): void {
    if (!this.awake || f.sa === this.sa) return;
    this.rx.set(f.id, f);
    const pf = (f.id >> 16) & 255;
    const da = (f.id >> 8) & 255;
    if (pf === 0xea && (da === 0xff || da === this.sa)) this.onRequest(f.bytes[0] | (f.bytes[1] << 8) | (f.bytes[2] << 16), f.sa);
    if (pf === 0xef && da === this.sa) this.onProprietary(f);
  }

  protected send(frames: Frame | Frame[]): void {
    for (const f of Array.isArray(frames) ? frames : [frames]) this.env.bus.publish(f);
  }

  protected onRequest(pgn: number, from: number): void {
    if (pgn === 65227) {
      // DM2: previously active codes (no lamps)
      const list = this.dtc.list('previous');
      const p = dmPayload(list.map((d) => ({ ...d, lamps: '' })), false);
      if (list.length <= 1)
        this.send({ id: 0x18fecb00 | this.sa, sa: this.sa, pgn: 65227, acr: 'DM2', name: 'Previously Active DTCs', period: 0, bytes: p, dm: true,
          labels: ['Lamp status', 'Lamp flash', 'SPN low', 'SPN mid', 'SPN high + FMI', 'CM + OC', 'n/a', 'n/a'], hl: [2, 3, 4, 5],
          decode: list.length ? `Inactive: SPN ${list[0].spn} FMI ${list[0].fmi}, OC ${list[0].oc}` : 'No previously active DTCs' });
      else this.send(tpFrames(this.sa, 65227, p, 'DM2', 0));
    } else if (pgn === 65235 || pgn === 65228) {
      // DM11 (clear active) / DM3 (clear previously active)
      this.dtc.clear();
      this.send({ id: 0x18e8ff00 | this.sa, sa: this.sa, pgn: 59392, acr: 'ACKM', name: 'Acknowledgment', period: 0,
        bytes: [0x00, 0xff, 0xff, 0xff, from, pgn & 255, (pgn >> 8) & 255, (pgn >> 16) & 255],
        labels: ['Control byte 0 = positive ACK', 'Group function', 'Reserved', 'Reserved', 'Address acknowledged', 'PGN acknowledged (lo)', '(mid)', '(hi)'], hl: [0, 5, 6, 7],
        decode: `Positive acknowledgment of ${pgn === 65235 ? 'DM11' : 'DM3'}` });
    } else if (pgn === 65229) {
      // DM4 freeze frames
      const recs = this.dtc.list('active').concat(this.dtc.list('previous')).filter((d) => d.freezeFrame);
      const p = recs.flatMap((d) => encodeFreezeFrame(d.spn, d.fmi, d.oc, d.freezeFrame!));
      if (!p.length) p.push(0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
      while (p.length < 8) p.push(0xff);
      if (p.length <= 8) this.send({ id: 0x18fecd00 | this.sa, sa: this.sa, pgn: 65229, acr: 'DM4', name: 'Freeze Frame Parameters', period: 0, bytes: p, decode: 'Freeze frame' });
      else this.send(tpFrames(this.sa, 65229, p, 'DM4', 0));
    }
  }
  protected onProprietary(_f: TimedFrame): void {}

  /** DM1: single frame for 0–1 codes, BAM for more (5.5 dm1Frames). */
  protected dm1(): Frame[] {
    const list = this.dtc.list('active');
    const p = dmPayload(list);
    if (list.length <= 1)
      return [{ id: 0x18feca00 | this.sa, sa: this.sa, pgn: 65226, acr: 'DM1', name: 'Active Diagnostic Trouble Codes', period: 1000, bytes: p, dm: true,
        labels: ['Lamp status (MIL/RSL/AWL/PL)', 'Lamp flash', 'DTC: SPN low 8 bits', 'DTC: SPN next 8 bits', 'DTC: SPN high 3 bits + FMI', 'DTC: CM + occurrence count', 'n/a', 'n/a'], hl: [0, 2, 3, 4, 5],
        decode: list.length ? `1 active DTC: SPN ${list[0].spn} FMI ${list[0].fmi}, OC ${list[0].oc}` : 'No active DTCs (SPN 0 / FMI 0 means "none")' }];
    return tpFrames(this.sa, 65226, p, 'DM1', 1000);
  }
  protected frame(f: Omit<Frame, 'pgn' | 'sa'>): Frame {
    return { ...f, sa: f.id & 255, pgn: pgnOf(f.id) };
  }
}

import { C } from '../data/catalog';
const SPN = new Map(C.map((c) => [c.id, c.spn]));
export const spnOf = (cid: string) => SPN.get(cid);
