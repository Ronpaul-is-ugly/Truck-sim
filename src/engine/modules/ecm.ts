// Engine ECM: crank/cam, 5 V sensors, thermistor, injectors, battery and the two shared 5 V supplies.
import { ControlModule, type ModuleEnv, type Periodic } from './module';
import type { Condition } from './dtc';
import { expectedAc, SUPPLY_HIGH, SUPPLY_LOW, type InputReading } from './inputs';
import { FE1, FE2, le16, type Frame } from '../j1939/frames';
import { commandedPositions } from '../physics/powertrain';
import type { TruckState } from '../state';
import type { TimedFrame } from '../j1939/bus';

const ECM_INPUTS = ['crank', 'cam', 'map', 'maf', 'oilp', 'ect', 'rail', 'app', 'thr', 'egr', 'vgt', 'batt', 'inj1', 'inj2', 'inj3', 'inj4', 'inj5', 'inj6'];

export class Ecm extends ControlModule {
  protected periodic: Periodic[];
  get outputs() {
    return this.env.outputs.ecm;
  }
  cutoutResult: number[] | null = null;

  constructor(env: ModuleEnv) {
    super('ecm', env, ECM_INPUTS, { crank: { shortFmi: 2 }, cam: { shortFmi: 2 } });
    this.watch = [0x0cf00203]; // ETC1 from the TCM
    this.periodic = [
      { id: 0x0cf00400, period: 20, build: () => this.eec1() },
      { id: 0x0cf00300, period: 50, build: () => this.eec2() },
      { id: 0x18feee00, period: 1000, build: () => this.et1() },
      { id: 0x18feef00, period: 500, build: () => this.eflp1() },
      { id: 0x18fef600, period: 500, build: () => this.ic1() },
      { id: 0x0cf00a00, period: 50, build: () => this.egf1() },
      { id: 0x18fef200, period: 100, build: () => this.lfe1() },
      { id: 0x18fef100, period: 100, build: () => this.ccvs() },
      { id: 0x18feca00, period: 1000, build: () => this.dm1() },
    ];
  }

  protected sample(now: number): void {
    super.sample(now);
  }

  protected conditions(now: number, s: TruckState): Condition[] {
    // the two shared 5 V supplies are monitored at the regulator output
    for (const [sup, member] of [['sup1', 'map'], ['sup2', 'oilp']] as const) {
      const v = this.env.electrical.volts(member, 'sup');
      const fmi = v < SUPPLY_LOW ? 4 : v > SUPPLY_HIGH ? 3 : null;
      this.inputsNow.set(sup, { cid: sup, volts: v, value: v, valid: fmi === null, fmi });
    }
    const supplyConds: Condition[] = [];
    for (const sup of ['sup1', 'sup2']) {
      const r = this.inputsNow.get(sup)!;
      if (r.fmi !== null) supplyConds.push(this.cond(sup, r.fmi));
    }
    return [...supplyConds, ...super.conditions(now, s)];
  }

  private v(cid: string): number | null {
    return this.input(cid).value;
  }
  private ok(cid: string): boolean {
    return this.input(cid).valid;
  }

  protected checks(_now: number, s: TruckState): Condition[] {
    const c: Condition[] = [];
    const run = s.running;
    const cmd = commandedPositions(run, s.load, s.rpm);
    // engine position signals
    for (const cid of ['crank', 'cam']) {
      const r = this.input(cid);
      if (!r.valid) continue;
      if ((r.dropouts ?? 0) > 0 || (run && (r.acVolts ?? 0) < 0.4 * expectedAc(cid, s))) c.push(this.cond(cid, 2));
    }
    if (run && this.ok('cam') && this.ok('crank') && Math.abs(s.camPhaseErrorDeg) > 3) c.push(this.cond('cam', 7));
    // real-condition limits (5.5 catalog values)
    const boost = this.v('map');
    if (run && boost !== null) {
      if (boost > 250) c.push(this.cond('map', 16));
      else if (s.load > 0.3 && boost < 0.6 * cmd.boostKpa && !this.posError('vgt', s, cmd.vgt)) c.push(this.cond('map', 18));
    }
    const maf = this.v('maf');
    if (run && maf !== null && cmd.mafKgh > 0) {
      const ratio = maf / cmd.mafKgh;
      if (ratio > 1.2) c.push(this.cond('maf', 20));
      else if (ratio < 0.8) c.push(this.cond('maf', 21));
    }
    const oil = this.v('oilp');
    if (run && oil !== null && oil < 100) c.push(this.cond('oilp', 1));
    const ect = this.v('ect');
    if (ect !== null && ect >= 110) c.push(this.cond('ect', 0));
    else if (ect !== null && ect >= 102) c.push(this.cond('ect', 16));
    const rail = this.v('rail');
    if (run && rail !== null && cmd.railMpa > 10 && rail < 0.7 * cmd.railMpa) c.push(this.cond('rail', 18));
    if (this.posError('thr', s, cmd.throttle)) c.push(this.cond('thr', 7));
    if (this.posError('egr', s, cmd.egr)) c.push(this.cond('egr', 7));
    if (this.posError('vgt', s, cmd.vgt)) c.push(this.cond('vgt', 7));
    const batt = this.v('batt');
    if (run && batt !== null) {
      if (batt < 12.0) c.push(this.cond('batt', 18));
      else if (batt > 15.5) c.push(this.cond('batt', 16));
    }
    // cylinder balance from crank acceleration per firing (needs a good crank signal)
    if (run && this.ok('crank'))
      s.cylinderContribution.forEach((x, i) => {
        if (this.ok(`inj${i + 1}`) && x < 0.5) c.push(this.cond(`inj${i + 1}`, 7));
      });
    return c;
  }
  private posError(cid: string, s: TruckState, cmd: number): boolean {
    const v = this.v(cid);
    return s.running && v !== null && Math.abs(v - cmd) > 10;
  }

  protected updateOutputs(s: TruckState): void {
    const o = this.env.outputs.ecm;
    const cmd = commandedPositions(s.running, s.load, s.rpm);
    const oil = this.v('oilp'), ect = this.v('ect'), rail = this.v('rail');
    o.limp = !this.ok('app');
    o.protect = (s.running && oil !== null && oil < 100) || (ect !== null && ect >= 110) || this.env.outputs.acm.dpfPlugged;
    o.powerLoss =
      !this.ok('map') || !this.ok('rail') || (s.running && rail !== null && cmd.railMpa > 10 && rail < 0.7 * cmd.railMpa) ||
      this.posError('thr', s, cmd.throttle) || this.posError('egr', s, cmd.egr) || this.posError('vgt', s, cmd.vgt);
    let cap = 75;
    if (o.limp) cap = 20;
    if (o.protect || o.powerLoss) cap = Math.min(cap, 45);
    o.speedCapMph = cap;
    const circuitOk = (cid: string) => this.input(cid).fmi === null;
    o.sync = circuitOk('crank') ? 'crank' : circuitOk('cam') ? 'cam' : 'none';
    o.injectorFiring = [1, 2, 3, 4, 5, 6].map((i) => this.input(`inj${i}`).fmi === null);
  }

  // ---------- cylinder cutout (proprietary request from the service tool) ----------
  protected onProprietary(f: TimedFrame): void {
    if (f.bytes[0] !== 0x01) return;
    const s = this.env.state();
    let drops: number[] | null = null;
    if (s.running) drops = s.cylinderContribution.map((x) => (x < 0.5 ? 2 + this.env.rng.next() * 4 : 38 + this.env.rng.next() * 16));
    this.cutoutResult = drops;
    this.send({ id: 0x18ef0000 | (f.sa << 8) | this.sa, sa: this.sa, pgn: 61184, acr: 'PropA', name: 'Cylinder cutout result', period: 0,
      bytes: drops ? [0x01, ...drops.map((d) => Math.round(d))] : [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      decode: drops ? `Cutout drops (rpm): ${drops.map((d) => d.toFixed(0)).join(', ')}` : 'Cutout refused: engine not running' });
  }

  // ---------- broadcasts (5.5 msgs) ----------
  private rpmSensed(): number | null {
    return this.env.outputs.ecm.sync === 'none' ? null : this.env.state().rpm;
  }
  private eec1(): Frame {
    const s = this.env.state();
    const rpm = this.rpmSensed();
    return this.frame({ id: 0x0cf00400, acr: 'EEC1', name: 'Electronic Engine Controller 1', period: 20,
      bytes: [0xf1, 125 + Math.round(s.pedalPct * 0.9), 125 + Math.round(s.load * 100 * 0.85), ...(rpm === null ? FE2 : le16(Math.round(rpm / 0.125))), 0xff, 0xff, 0xff],
      labels: ['SPN 899 torque mode', 'SPN 512 driver demand %', 'SPN 513 actual torque %', 'SPN 190 engine speed (lo)', 'SPN 190 engine speed (hi)', 'SPN 1483 n/a', 'SPN 1675 n/a', 'SPN 2432 n/a'], hl: [3, 4],
      decode: `Engine speed ${Math.round(rpm ?? 0)} rpm` });
  }
  private eec2(): Frame {
    const s = this.env.state();
    const bad = this.err('app');
    return this.frame({ id: 0x0cf00300, acr: 'EEC2', name: 'Electronic Engine Controller 2', period: 50,
      bytes: [0xff, bad ? FE1 : Math.round(s.pedalPct / 0.4), Math.round(s.load * 100), 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['Pedal switches n/a', 'SPN 91 accelerator pedal position', 'SPN 92 % load at current speed', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [1, 2],
      decode: bad ? 'Pedal position: ERROR indicator (0xFE)' : `Pedal ${s.pedalPct.toFixed(0)}%, load ${Math.round(s.load * 100)}%` });
  }
  private et1(): Frame {
    const ect = this.v('ect');
    const bad = this.err('ect') || ect === null;
    return this.frame({ id: 0x18feee00, acr: 'ET1', name: 'Engine Temperature 1', period: 1000,
      bytes: [bad ? FE1 : Math.round(ect! + 40), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 110 coolant temp (1 °C/bit, −40)', 'SPN 174 n/a', 'SPN 175 n/a', 'SPN 175 n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [0],
      decode: bad ? 'Coolant temp: ERROR indicator (0xFE)' : `Coolant ${Math.round(ect!)} °C` });
  }
  private eflp1(): Frame {
    const oil = this.v('oilp');
    const bad = oil === null;
    return this.frame({ id: 0x18feef00, acr: 'EFL/P1', name: 'Engine Fluid Level/Pressure 1', period: 500,
      bytes: [0xff, 0xff, 0xff, bad ? FE1 : Math.round(oil! / 4), 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 94 n/a', 'SPN 22 n/a', 'SPN 98 n/a', 'SPN 100 oil pressure (4 kPa/bit)', 'SPN 101 n/a', 'SPN 101 n/a', 'SPN 109 n/a', 'SPN 111 n/a'], hl: [3],
      decode: bad ? 'Oil pressure: ERROR indicator (0xFE)' : `Oil pressure ${Math.round(oil! / 4) * 4} kPa` });
  }
  private ic1(): Frame {
    const s = this.env.state();
    const b = this.v('map');
    const bad = b === null;
    return this.frame({ id: 0x18fef600, acr: 'IC1', name: 'Inlet/Exhaust Conditions 1', period: 500,
      bytes: [0xff, bad ? FE1 : Math.max(0, Math.round(b! / 2)), s.intakeTempC + 40, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 81 n/a', 'SPN 102 boost (2 kPa/bit, gauge)', 'SPN 105 intake manifold temp', 'SPN 106 n/a', 'SPN 107 n/a', 'SPN 173 n/a', 'SPN 173 n/a', 'SPN 112 n/a'], hl: [1],
      decode: bad ? 'Boost: ERROR indicator (0xFE)' : `Boost ${Math.round(b! / 2) * 2} kPa gauge` });
  }
  private egf1(): Frame {
    const m = this.v('maf');
    const raw = Math.round((m ?? 0) / 0.05);
    return this.frame({ id: 0x0cf00a00, acr: 'EGF1', name: 'Engine Gas Flow Rate', period: 50,
      bytes: [0xff, 0xff, ...(m === null ? FE2 : le16(raw)), 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 2659 n/a', 'SPN 2659 n/a', 'SPN 132 air mass flow (lo)', 'SPN 132 air mass flow (hi)', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [2, 3],
      decode: m === null ? 'Air flow: ERROR indicator (0xFE00)' : `Intake air ${(raw * 0.05).toFixed(0)} kg/h` });
  }
  private lfe1(): Frame {
    const s = this.env.state();
    const fl = Math.round(s.fuelRateLph / 0.05);
    const fe = s.speedMph < 1 ? 0 : Math.min(64255, Math.round(s.kmpl * 512));
    const thr = this.v('thr');
    return this.frame({ id: 0x18fef200, acr: 'LFE1', name: 'Fuel Economy (Liquid)', period: 100,
      bytes: [...le16(fl), ...le16(fe), 0xff, 0xff, thr === null ? FE1 : Math.round(thr / 0.4), 0xff],
      labels: ['SPN 183 fuel rate (lo)', 'SPN 183 fuel rate (hi)', 'SPN 184 instantaneous fuel economy (lo)', 'SPN 184 instantaneous fuel economy (hi)', 'SPN 185 n/a', 'SPN 185 n/a', 'SPN 51 throttle valve 1 position (0.4 %/bit)', 'SPN 3673 n/a'], hl: [0, 1, 2, 3, 6],
      decode: `Fuel rate ${(fl * 0.05).toFixed(1)} L/h (${((fl * 0.05) / 3.785).toFixed(1)} gal/h) · economy ${(fe / 512).toFixed(2)} km/L (${((fe / 512) * 2.352).toFixed(1)} mpg) · throttle ${thr === null ? 'ERROR (0xFE)' : Math.round(thr) + '%'}` });
  }
  /** Road speed is calculated from the TCM's output shaft speed in ETC1 (received over the bus). */
  private ccvs(): Frame {
    const now = this.env.now();
    const etc1 = this.heard(0x0cf00203, now) ? this.rx.get(0x0cf00203)! : null;
    let bytes: number[];
    let decode: string;
    if (!etc1) {
      bytes = [0xff, 0xff];
      decode = 'Vehicle speed: not available (no ETC1 from TCM)';
    } else if (etc1.bytes[2] === 0xfe) {
      bytes = FE2;
      decode = 'Vehicle speed: ERROR indicator (from bad output shaft data)';
    } else {
      const oss = (etc1.bytes[1] | (etc1.bytes[2] << 8)) * 0.125;
      const mph = (oss / 3.36 / 500) * 60;
      const raw = Math.round(mph * 1.609344 * 256);
      bytes = le16(raw);
      decode = `Vehicle speed ${(raw / 256).toFixed(1)} km/h (${mph.toFixed(0)} mph)`;
    }
    return this.frame({ id: 0x18fef100, acr: 'CCVS', name: 'Cruise Control/Vehicle Speed', period: 100,
      bytes: [0xff, ...bytes, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['Status n/a', 'SPN 84 wheel-based speed (lo)', 'SPN 84 wheel-based speed (hi)', 'Switches n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [1, 2], decode });
  }
}
export type { InputReading };
