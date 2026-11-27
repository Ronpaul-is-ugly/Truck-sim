// Instrument cluster: its own sensors (fuel sender, air pressures, ambient) plus everything it shows,
// which it only learns from J1939 frames it receives (gauges from PGNs, lamps from every module's DM1).
import { ControlModule, TIMEOUT_MS, type ModuleEnv, type Periodic } from './module';
import type { Condition } from './dtc';
import { decodeDtcs, lampByte, TpReassembler, type Frame } from '../j1939/frames';
import type { TimedFrame } from '../j1939/bus';
import type { TruckState } from '../state';
import { SA2ECU, type EcuKey } from '../data/catalog';

export interface ClusterDisplay {
  lamps: { rsl: boolean; awl: boolean; mil: boolean; pl: boolean; abs: boolean; regen: boolean; def: boolean; com: boolean; lowAir: boolean; park: boolean };
  /** Dash air gauges, from the cluster's own pressure sensors. */
  air: { primaryPsi: number | 'ERR'; secondaryPsi: number | 'ERR' };
  /** null = dashes. 'ERR' = sender says its sensor is bad. */
  gauges: Record<'rpm' | 'mph' | 'gear' | 'coolantF' | 'oilPsi' | 'boostPsi' | 'fuelPct' | 'defPct' | 'mpg', string | number | null>;
  codes: { sa: number; ecu: EcuKey; spn: number; fmi: number; oc: number; red: boolean }[];
  noData: EcuKey[];
}

const rb1 = (b: number[], i: number, f: (r: number) => number | string) => (b[i] === 0xfe ? 'ERR' : b[i] === 0xff ? null : f(b[i]));
const rb2 = (b: number[], i: number, f: (r: number) => number | string | null) => (b[i + 1] === 0xfe ? 'ERR' : b[i + 1] === 0xff ? null : f(b[i] | (b[i + 1] << 8)));

export class Cluster extends ControlModule {
  protected periodic: Periodic[];
  private tp = new TpReassembler();
  private dm1BySa = new Map<number, { t: number; data: number[] }>();
  private fuelUsedSinceMove = 0;
  private lastSenderLevel: number | null = null;

  constructor(env: ModuleEnv) {
    super('clu', env, ['fuel', 'airp', 'airs', 'amb']);
    this.watch = [0x0cf00400];
    this.periodic = [
      { id: 0x18fefc17, period: 1000, build: () => this.dd() },
      { id: 0x18feae17, period: 1000, build: () => this.air1() },
      { id: 0x18feca17, period: 1000, build: () => this.dm1() },
    ];
  }
  protected receive(f: TimedFrame): void {
    super.receive(f);
    if (!this.awake) return;
    const m = this.tp.push(f);
    if (m && m.pgn === 65226) this.dm1BySa.set(m.sa, { t: f.t, data: m.data });
    // fuel used, from the ECM's fuel rate (LFE1, 0.05 L/h per bit, every 100 ms)
    if (f.id === 0x18fef200) this.fuelUsedSinceMove += ((f.bytes[0] | (f.bytes[1] << 8)) * 0.05 * 0.1) / 3600;
  }
  protected checks(_now: number, _s: TruckState): Condition[] {
    const c: Condition[] = [];
    for (const cid of ['airp', 'airs']) {
      const v = this.input(cid).value;
      if (v !== null && v < 60) c.push(this.cond(cid, 1));
    }
    // fuel level plausibility: 4 L burned and the sender has not moved (a healthy sender moves ~0.7 %)
    const lvl = this.input('fuel').value;
    if (lvl !== null) {
      if (this.lastSenderLevel === null || Math.abs(lvl - this.lastSenderLevel) > 0.3) {
        this.lastSenderLevel = lvl;
        this.fuelUsedSinceMove = 0;
      } else if (this.fuelUsedSinceMove > 4) c.push(this.cond('fuel', 2));
    }
    return c;
  }
  private dd(): Frame {
    const f = this.input('fuel');
    const bad = !f.valid;
    return this.frame({ id: 0x18fefc17, acr: 'DD', name: 'Dash Display', period: 1000,
      bytes: [0xff, bad ? 0xfe : Math.round((f.value ?? 0) / 0.4), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 80 n/a', 'SPN 96 fuel level (0.4 %/bit)', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'], hl: [1],
      decode: bad ? 'Fuel level: ERROR indicator (0xFE)' : `Fuel level ${Math.round(f.value ?? 0)}%` });
  }

  /** AIR1 (PGN 65198): service brake circuit pressures from the cluster's own sensors, 8 kPa/bit. */
  private air1(): Frame {
    const raw = (cid: string) => {
      const r = this.input(cid);
      return !r.valid || r.value === null ? 0xfe : Math.max(0, Math.min(250, Math.round((r.value * 6.894757) / 8)));
    };
    const p = raw('airp');
    const q = raw('airs');
    const psi = (b: number) => (b === 0xfe ? 'ERROR' : `${Math.round((b * 8) / 6.894757)} psi`);
    return this.frame({ id: 0x18feae17, acr: 'AIR1', name: 'Air Supply Pressure', period: 1000,
      bytes: [0xff, 0xff, p, q, 0xff, 0xff, 0xff, 0xff],
      labels: ['SPN 46 pneumatic supply n/a', 'SPN 1086 parking/trailer air n/a', 'SPN 1087 service brake circuit 1 air pressure (8 kPa/bit)', 'SPN 1088 service brake circuit 2 air pressure (8 kPa/bit)', 'SPN 1089 n/a', 'SPN 1090 n/a', 'SPN 1351 n/a', 'n/a'], hl: [2, 3],
      decode: `Primary (circuit 1) ${psi(p)} · secondary (circuit 2) ${psi(q)}` });
  }

  /** What the driver sees. Built only from received frames and the cluster's own inputs and codes. */
  display(): ClusterDisplay | null {
    if (!this.awake) return null;
    const now = this.env.now();
    const fr = (id: number) => (this.heard(id, now) ? this.rx.get(id)!.bytes : null);
    const g = <T,>(id: number, fn: (b: number[]) => T) => {
      const b = fr(id);
      return b ? fn(b) : null;
    };
    const codes: ClusterDisplay['codes'] = [];
    let lb = 0;
    const own = this.dtc.list('active');
    const lists: [number, { spn: number; fmi: number; oc: number }[], number][] = [[this.sa, own, lampByte(own)]];
    for (const [sa, m] of this.dm1BySa) if (now - m.t <= 3000) lists.push([sa, decodeDtcs(m.data), m.data[0]]);
    let absLamp = false, regen = false, defLamp = false;
    for (const [sa, list, lamp] of lists) {
      lb |= lamp;
      for (const d of list) {
        codes.push({ sa, ecu: SA2ECU[sa], spn: d.spn, fmi: d.fmi, oc: d.oc, red: !!(lamp & 0x10) });
        if (sa === 11) absLamp = true;
        if (d.spn === 3251 && (d.fmi === 16 || d.fmi === 0)) regen = true;
        if (d.spn === 1761 && (d.fmi === 17 || d.fmi === 1)) defLamp = true;
      }
    }
    const noData = (['ecm', 'tcm', 'abs', 'acm'] as EcuKey[]).filter((e) => {
      const id = { ecm: 0x0cf00400, tcm: 0x0cf00203, abs: 0x18febf0b, acm: 0x18feca3d }[e as 'ecm']!;
      return now - this.wakeAt > TIMEOUT_MS && !this.heard(id, now);
    });
    const ownFuel = this.input('fuel');
    const airG = (cid: string) => {
      const r = this.input(cid);
      return r.valid && r.value !== null ? Math.round(r.value) : ('ERR' as const);
    };
    const air = { primaryPsi: airG('airp'), secondaryPsi: airG('airs') };
    // low-air warning: a pressure reading under 60 psi in either circuit (lamp and buzzer, no debounce)
    const lowAir = [air.primaryPsi, air.secondaryPsi].some((v) => v !== 'ERR' && v < 60);
    const ccvs = fr(0x18fef100);
    const park = !!ccvs && (ccvs[0] & 0x0c) === 0x04;
    return {
      air,
      lamps: { rsl: !!(lb & 0x10), awl: !!(lb & 0x04), mil: !!(lb & 0x40), pl: !!(lb & 0x01), abs: absLamp, regen, def: defLamp, com: noData.length > 0, lowAir, park },
      gauges: {
        rpm: g(0x0cf00400, (b) => rb2(b, 3, (r) => Math.round(r * 0.125))),
        mph: g(0x18fef100, (b) => rb2(b, 1, (r) => Math.round(r / 256 / 1.609344))),
        gear: g(0x18f00503, (b) => (b[3] === 0xff ? null : b[3] - 125 || 'N')),
        coolantF: g(0x18feee00, (b) => rb1(b, 0, (r) => Math.round((r - 40) * 1.8 + 32))),
        oilPsi: g(0x18feef00, (b) => rb1(b, 3, (r) => Math.round(r * 4 * 0.145))),
        boostPsi: g(0x18fef600, (b) => rb1(b, 1, (r) => Math.round(r * 2 * 0.145))),
        fuelPct: ownFuel.valid ? Math.round(ownFuel.value ?? 0) : 'ERR',
        defPct: g(0x18fe563d, (b) => rb1(b, 0, (r) => Math.round(r * 0.4))),
        mpg: g(0x18fef200, (b) => rb2(b, 2, (r) => (r >= 64255 ? null : ((r / 512) * 2.352).toFixed(1)))),
      },
      codes,
      noData,
    };
  }
}
