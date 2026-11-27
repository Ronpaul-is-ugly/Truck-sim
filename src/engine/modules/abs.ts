// ABS ECU: four wheel speed sensors and its own supply voltage.
import { ControlModule, type ModuleEnv, type Periodic } from './module';
import type { Condition } from './dtc';
import { expectedAc } from './inputs';
import { le16, type Frame } from '../j1939/frames';
import type { TruckState } from '../state';

const WHEELS = ['wlf', 'wrf', 'wlr', 'wrr'];

export class Abs extends ControlModule {
  protected periodic: Periodic[];
  get outputs() {
    return this.env.outputs.abs;
  }
  constructor(env: ModuleEnv) {
    super('abs', env, [...WHEELS, 'abspwr'], Object.fromEntries(WHEELS.map((w) => [w, { shortFmi: 6 }])));
    this.watch = [0x0cf00400];
    this.periodic = [
      { id: 0x18f0010b, period: 100, build: () => this.ebc1() },
      { id: 0x18febf0b, period: 100, build: () => this.ebc2() },
      { id: 0x18feca0b, period: 1000, build: () => this.dm1() },
    ];
  }
  protected erraticFmi(): number {
    return 8;
  }
  protected checks(_now: number, s: TruckState): Condition[] {
    const c: Condition[] = [];
    for (const w of WHEELS) {
      const r = this.input(w);
      if (!r.valid) continue;
      if ((r.dropouts ?? 0) > 0) c.push(this.cond(w, 8));
      else if (s.speedMph > 6 && (r.acVolts ?? 0) < 0.4 * expectedAc(w, s)) c.push(this.cond(w, 1));
    }
    const v = this.input('abspwr').value;
    if (v !== null && v < 10.5) c.push(this.cond('abspwr', 4));
    return c;
  }
  protected updateOutputs(): void {
    const mine = new Set([...WHEELS, 'abspwr']);
    this.env.outputs.abs.absEnabled = !this.dtc.list('pending').concat(this.dtc.list('active')).some((d) => mine.has(d.cid));
  }
  private ebc1(): Frame {
    const s = this.env.state();
    const dis = !this.env.outputs.abs.absEnabled;
    return this.frame({ id: 0x18f0010b, acr: 'EBC1', name: 'Electronic Brake Controller 1', period: 100,
      bytes: [(s.absActive ? 0x10 : 0) | (s.braking ? 0x40 : 0), s.braking ? 175 : 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['Bits 5–6 SPN 563 ABS active · bits 7–8 SPN 1121 EBS brake switch', 'SPN 521 brake pedal position (0.4 %/bit)', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [0, 1],
      decode: (s.braking ? `Brake pedal 70%${s.absActive ? ', <b>ABS ACTIVE</b>' : s.lockup ? ', ABS NOT active (disabled by fault): wheels locking' : ''}` : 'Brakes released, ABS not active') + (dis ? ' · ABS function disabled by a fault (see ABS DM1)' : '') });
  }
  private ebc2(): Frame {
    const s = this.env.state();
    const w = s.wheelsKmh;
    const fa = (w[0] + w[1]) / 2;
    const rel = (x: number) => Math.max(0, Math.min(250, Math.round((x - fa + 7.8125) * 16)));
    const bad = WHEELS.map((id) => !this.input(id).valid);
    return this.frame({ id: 0x18febf0b, acr: 'EBC2', name: 'Wheel Speed Information', period: 100,
      bytes: [...le16(Math.round(fa * 256)), ...w.map((x, k) => (bad[k] ? 0xfe : rel(x))), 0xff, 0xff],
      labels: ['SPN 904 front axle speed (lo, 1/256 km/h)', 'SPN 904 front axle speed (hi)', 'SPN 905 rel. speed front left (1/16 km/h, −7.8125)', 'SPN 906 rel. speed front right', 'SPN 907 rel. speed rear #1 left', 'SPN 908 rel. speed rear #1 right', 'SPN 909 n/a', 'SPN 910 n/a'], hl: [0, 1, 2, 3, 4, 5],
      decode: `Front axle ${(fa / 1.609344).toFixed(0)} mph · wheels vs front axle (mph): ${w.map((x, k) => (bad[k] ? 'ERR' : ((x - fa) / 1.609344).toFixed(1))).join(' / ')}${s.lockup ? ' · rear wheels LOCKED' : ''}${s.absActive ? ' · ABS modulating' : ''}` });
  }
}
