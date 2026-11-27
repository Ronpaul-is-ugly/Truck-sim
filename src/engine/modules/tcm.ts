// Transmission TCM: output/input shaft speed sensors and the oil temperature thermistor.
import { ControlModule, type ModuleEnv, type Periodic } from './module';
import type { Condition } from './dtc';
import { expectedAc } from './inputs';
import { FE2, le16, type Frame } from '../j1939/frames';
import type { TruckState } from '../state';

export class Tcm extends ControlModule {
  protected periodic: Periodic[];
  get outputs() {
    return this.env.outputs.tcm;
  }
  constructor(env: ModuleEnv) {
    super('tcm', env, ['oss', 'iss', 'tot'], { oss: { shortFmi: 2 }, iss: { shortFmi: 2 } });
    this.watch = [0x0cf00400]; // EEC1 from the ECM
    this.periodic = [
      { id: 0x0cf00203, period: 10, build: () => this.etc1() },
      { id: 0x18f00503, period: 100, build: () => this.etc2() },
      { id: 0x18feca03, period: 1000, build: () => this.dm1() },
    ];
  }
  protected checks(_now: number, s: TruckState): Condition[] {
    const c: Condition[] = [];
    for (const cid of ['oss', 'iss']) {
      const r = this.input(cid);
      const exp = expectedAc(cid, s);
      if (r.valid && ((r.dropouts ?? 0) > 0 || (exp > 0.5 && (r.acVolts ?? 0) < 0.4 * exp))) c.push(this.cond(cid, 2));
    }
    const t = this.input('tot').value;
    if (t !== null && t > 120) c.push(this.cond('tot', 16));
    return c;
  }
  protected updateOutputs(): void {
    // any output-speed problem: hold the current gear (limp)
    this.env.outputs.tcm.holdGear = this.dtc.list('pending').concat(this.dtc.list('active')).some((d) => d.cid === 'oss') || !this.input('oss').valid;
  }
  private etc1(): Frame {
    const s = this.env.state();
    const bad = !this.input('oss').valid;
    return this.frame({ id: 0x0cf00203, acr: 'ETC1', name: 'Electronic Transmission Controller 1', period: 10,
      bytes: [0xff, ...(bad ? FE2 : le16(Math.round(s.ossRpm / 0.125))), 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['Status n/a', 'SPN 191 output shaft speed (lo)', 'SPN 191 output shaft speed (hi)', 'SPN 522 n/a', 'n/a', 'SPN 161 n/a', 'SPN 161 n/a', 'SPN 1482 n/a'], hl: [1, 2],
      decode: bad ? 'Output shaft speed: ERROR indicator (0xFE00)' : `Output shaft ${s.ossRpm} rpm` });
  }
  private etc2(): Frame {
    const s = this.env.state();
    return this.frame({ id: 0x18f00503, acr: 'ETC2', name: 'Electronic Transmission Controller 2', period: 100,
      bytes: [125 + s.gear, ...le16(Math.round(s.gearRatio * 1000)), 125 + s.gear, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 524 selected gear (−125 offset)', 'SPN 526 actual gear ratio (lo, 0.001/bit)', 'SPN 526 actual gear ratio (hi)', 'SPN 523 current gear (−125 offset)', 'SPN 162 n/a', 'SPN 162 n/a', 'SPN 163 n/a', 'SPN 163 n/a'], hl: [0, 1, 2, 3],
      decode: `Current gear ${s.gear || 'neutral'}${s.gear ? `, ratio ${s.gearRatio.toFixed(2)}:1` : ''}${this.env.outputs.tcm.holdGear ? ' (TCM holding gear: output speed sensor fault)' : ''}` });
  }
}
