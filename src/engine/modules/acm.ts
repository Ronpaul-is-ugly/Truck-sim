// Aftertreatment ACM: smart NOx sensors (on their own CAN sub-network), DEF level and temperature, DPF ΔP.
import { ControlModule, TIMEOUT_MS, type ModuleEnv, type Periodic } from './module';
import type { Condition } from './dtc';
import type { Frame } from '../j1939/frames';
import type { MessageBus, TimedFrame } from '../j1939/bus';
import type { TruckState } from '../state';

export const NOX_IDS = { noxin: 0x18f00e51, noxout: 0x18f00f52 } as const;

export class Acm extends ControlModule {
  protected periodic: Periodic[];
  get outputs() {
    return this.env.outputs.acm;
  }
  private nox = new Map<number, TimedFrame>();
  regenMsg = '';
  constructor(env: ModuleEnv, private subnet: MessageBus) {
    super('acm', env, ['noxin', 'noxout', 'def', 'dpf', 'deft']);
    this.watch = [0x0cf00400];
    subnet.subscribe(0x3d, (f) => this.awake && this.nox.set(f.id, f));
    this.periodic = [
      { id: 0x18fe563d, period: 1000, build: () => this.at1t1i() },
      { id: 0x18feca3d, period: 1000, build: () => this.dm1() },
    ];
  }
  /** NOx value as reported by the smart sensor, or null if it is silent or reporting an error. */
  noxPpm(cid: 'noxin' | 'noxout'): number | null {
    const f = this.nox.get(NOX_IDS[cid]);
    if (!f || this.env.now() - f.t > TIMEOUT_MS) return null;
    return (f.bytes[0] | (f.bytes[1] << 8)) * 0.05 - 200;
  }
  protected checks(now: number, s: TruckState): Condition[] {
    const c: Condition[] = [];
    for (const cid of ['noxin', 'noxout'] as const) {
      const f = this.nox.get(NOX_IDS[cid]);
      const silent = !f || now - f.t > TIMEOUT_MS;
      if (silent) {
        if (now - this.wakeAt > TIMEOUT_MS) c.push(this.cond(cid, 9));
        continue;
      }
      if ((f!.bytes[5] & 31) === 12) c.push(this.cond(cid, 12));
      else if (s.running) {
        const model = cid === 'noxin' ? 150 + 600 * s.load : 12 + 20 * s.load;
        const ppm = this.noxPpm(cid)!;
        if (ppm / model > 2) c.push(this.cond(cid, 20));
      }
    }
    const def = this.input('def').value;
    if (def !== null && def <= 1) c.push(this.cond('def', 1));
    else if (def !== null && def < 10) c.push(this.cond('def', 17));
    const dp = this.input('dpf').value;
    if (s.running && dp !== null) {
      if (dp > 25) c.push(this.cond('dpf', 0));
      else if (dp > 8) c.push(this.cond('dpf', 16));
    }
    return c;
  }
  protected updateOutputs(): void {
    const o = this.env.outputs.acm;
    const def = this.input('def').value;
    o.inducementCapMph = def !== null && def <= 1 ? 5 : 999;
    const dp = this.input('dpf').value;
    o.dpfPlugged = this.env.state().running && dp !== null && dp > 25;
  }
  /** Parked regen request from the service tool (5.5 runRegen). */
  protected onProprietary(f: TimedFrame): void {
    if (f.bytes[0] !== 0x02) return;
    const s = this.env.state();
    const dp = this.input('dpf').value;
    let code = 0;
    if (dp !== null && dp > 25) code = 2; // refused: too much soot
    else if (dp === null || dp <= 8 || !s.running) code = 1; // not needed
    else this.env.outputs.acm.regenActiveSinceMs = this.env.now();
    this.regenMsg = ['Parked regen started.', 'Parked regen not needed: DPF soot load is normal.', 'Parked regen refused: soot load is too high for a safe regen. Remove the DPF for cleaning (follow OEM procedure).'][code];
    this.send({ id: 0x18ef0000 | (f.sa << 8) | this.sa, sa: this.sa, pgn: 61184, acr: 'PropA', name: 'Parked regen response', period: 0, bytes: [0x02, code, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], decode: this.regenMsg });
  }
  private at1t1i(): Frame {
    const d = this.input('def');
    const bad = !d.valid;
    return this.frame({ id: 0x18fe563d, acr: 'AT1T1I', name: 'Aftertreatment 1 DEF Tank 1 Info', period: 1000,
      bytes: [bad ? 0xfe : Math.round((d.value ?? 0) / 0.4), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 1761 DEF tank volume (0.4 %/bit)', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [0],
      decode: bad ? 'DEF level: ERROR indicator (0xFE)' : `DEF tank ${Math.round(d.value ?? 0)}%` });
  }
}
