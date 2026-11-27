// Harness netlists for every circuit type in simulator 5.5 (A–H), built from a route
// (connectors + harness sections), the truck state and the fault modifiers on its parts.
// Component and module values are the ones in 5.5's build()/hCircuit().
import type { Element } from './solver';
import type { FaultSet } from '../faults';
import type { TruckState } from '../state';

export type CircuitType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export const TYPE_OF: Record<string, CircuitType> = {
  thr: 'A', egr: 'A', vgt: 'A', map: 'A', maf: 'A', oilp: 'A', rail: 'A', app: 'A', def: 'A', dpf: 'A', airp: 'A', airs: 'A',
  ect: 'B', tot: 'B', amb: 'B', deft: 'B',
  iss: 'C', crank: 'C', cam: 'C', oss: 'C', wlf: 'C', wrf: 'C', wlr: 'C', wrr: 'C',
  batt: 'E', abspwr: 'E', noxin: 'G', noxout: 'G', fuel: 'H',
  inj1: 'D', inj2: 'D', inj3: 'D', inj4: 'D', inj5: 'D', inj6: 'D',
  net: 'F',
};
export const circuitType = (cid: string): CircuitType | undefined => TYPE_OF[cid];

export const WIRES: Record<CircuitType, string[]> = {
  A: ['ref', 'sig', 'ret'], B: ['sig', 'ret'], C: ['a', 'b'], D: ['hi', 'lo'], E: ['pwr', 'gnd'], F: [], G: ['pwr', 'gnd', 'h', 'l'], H: ['sig', 'ret'],
};

/** Shared 5 V sensor supplies on the ECM (5.5 SUPPLY table). Circuits not listed have their own regulator. */
export const SUPPLY_GROUP: Record<string, 'sup1' | 'sup2'> = { map: 'sup1', rail: 'sup1', thr: 'sup1', egr: 'sup1', oilp: 'sup2', maf: 'sup2', vgt: 'sup2' };
export const SUPPLY_MEMBERS = { sup1: ['map', 'rail', 'thr', 'egr'], sup2: ['oilp', 'maf', 'vgt'] } as const;

export interface RouteNode {
  id: string;
  name?: string;
  pins?: string[];
  /** Hard-wired (no mating connector): both sides are one node. */
  hard?: boolean;
}
export interface RouteSpec {
  nodes: RouteNode[];
  segs: { name?: string }[];
  /** Resistance of one mated terminal pair. */
  mateOhms?: number;
  /** Resistance of the four pieces of each harness section: module end, mid-A, mid-B, component end. */
  segOhms?: [number, number, number, number];
}

/** The bench schematic in 5.5: module pins → harness (0.15 Ω; 0.02 Ω for power feeds) → one connector (0.01 Ω) → component. */
export function defaultRoute(cid: string): RouteSpec {
  const t = TYPE_OF[cid];
  const total = t === 'E' ? 0.02 : 0.15;
  return {
    nodes: [{ id: 'J1', hard: true }, { id: 'C1' }],
    segs: [{}],
    mateOhms: 0.01,
    segOhms: [total / 4, total / 4, total / 4, total / 4],
  };
}
/** Values the 3D harness levels in 5.5 use for every connector and section. */
export const ROUTE_3D: Pick<RouteSpec, 'mateOhms' | 'segOhms'> = { mateOhms: 0.005, segOhms: [0.012, 0.016, 0.016, 0.012] };

/** NTC thermistor used for all temperature sensors in 5.5: 3000 Ω at 25 °C, β = 3600. */
export const ntc = (T: number) => 3000 * Math.exp(3600 * (1 / (T + 273.15) - 1 / 298.15));
export const ntcInverse = (R: number) => 1 / (1 / 298.15 + Math.log(Math.max(1e-6, R) / 3000) / 3600) - 273.15;
/** 5 V sensor transfer in 5.5: 0.5 V at zero, 4.5 V at full scale. */
export const sensorVolts = (x: number, max: number) => 0.5 + 4 * Math.max(0, Math.min(1, x / max));
export const SENSOR_FULL_SCALE: Record<string, number> = { map: 400, maf: 2000, oilp: 1000, rail: 250, app: 100, thr: 100, egr: 100, vgt: 100, def: 100, dpf: 50, airp: 150, airs: 150 };
export const COIL_OHMS: Record<string, number> = { crank: 900, cam: 900, oss: 1000, iss: 1000 };
export const coilOhms = (cid: string) => COIL_OHMS[cid] ?? 1900;
export const temperatureOf = (cid: string, s: TruckState) => ({ ect: s.coolantC, tot: s.transOilC, amb: s.ambientC, deft: s.defTempC } as Record<string, number>)[cid] ?? 25;
/** Fuel sender in 5.5: 33 Ω full, 240 Ω empty. */
export const senderOhms = (levelPct: number) => 33 + 207 * (1 - levelPct / 100);

/** The physical quantity a 3-wire sensor measures (what its element sees, before drift). */
export function sensedQuantity(cid: string, s: TruckState): number {
  const run = s.key === 'run';
  switch (cid) {
    case 'map': return (run ? Math.max(0, s.boostKpa) : 0) + 101;
    case 'maf': return run ? s.mafKgh : 0;
    case 'oilp': return run ? s.oilKpa : 0;
    case 'rail': return run ? s.railMpa : 0;
    case 'app': return run ? s.pedalPct : 0;
    case 'thr': return run ? s.throttlePct : 100;
    case 'egr': return run ? s.egrPct : 0;
    case 'vgt': return run ? s.vgtPct : 0;
    case 'def': return s.defLevelPct;
    case 'dpf': return run ? s.dpfDeltaPKpa : 0;
    case 'airp': return s.airPrimaryPsi;
    case 'airs': return s.airSecondaryPsi;
  }
  return 0;
}

/** AC amplitude a magnetic speed sensor generates (5.5 hCircuit), before drift. */
export function speedSensorAc(cid: string, s: TruckState, spinning: boolean): number {
  const run = s.running;
  if (cid[0] === 'w') return run && s.speedMph > 1 ? 5.5 * Math.min(1, s.speedMph / 40) : spinning ? 0.6 : 0;
  if (!run) return 0;
  return ({ crank: 6.0, cam: 2.5, oss: s.speedMph > 1 ? 4.0 : 0, iss: 3.0 } as Record<string, number>)[cid] ?? 2.5;
}

export interface BuildCtx {
  cid: string;
  state: TruckState;
  faults: FaultSet | null; // null = known-good reference
  route: RouteSpec;
  unplugged: ReadonlySet<number>;
  /** 3-wire sensor electronics powered (decided by a first solve, as in 5.5). */
  powered: boolean;
  spinning: boolean;
  /** Node the 5 V reference branch hangs from (shared regulator node), for type A. */
  supplyNode: string;
}

/** Local node name → global node name. */
export function nodeName(cid: string, route: RouteSpec, local: string): string {
  if (local === 'gnd') return 'gnd';
  const t = TYPE_OF[cid];
  const m = /^c(\d+)d_(\w+)$/.exec(local);
  if (m && route.nodes[+m[1]]?.hard) local = `c${m[1]}u_${m[2]}`;
  // the ground wire of a power feed starts at chassis ground
  if ((t === 'E' || t === 'G') && local === 'c0u_gnd') return 'gnd';
  return `${cid}:${local}`;
}

export function buildCircuit(ctx: BuildCtx): Element[] {
  const { cid, state: s, route } = ctx;
  const t = TYPE_OF[cid];
  const W = WIRES[t];
  const E: Element[] = [];
  const N = (l: string) => nodeName(cid, route, l);
  const R = (a: string, b: string, r: number, extra?: { mod?: boolean; powerOnly?: boolean }) => E.push({ t: 'R', a: N(a), b: N(b), r, ...extra });
  const Vs = (a: string, b: string, v: number, kind: 'sup' | 'ser' | 'ac') => E.push({ t: 'V', a: N(a), b: N(b), v, kind });
  const F = ctx.faults;
  const at = (part: string) => (F ? F.at(part) : []);
  const has = (part: string, kind: string) => at(part).find((f) => f.kind === kind);
  const n = route.nodes.length;
  const mate = route.mateOhms ?? 0.01;
  const seg = route.segOhms ?? [0.0375, 0.0375, 0.0375, 0.0375];
  const on = s.key !== 'off';
  const mu = (w: string) => `c0u_${w}`;
  const cd = (w: string) => `c${n - 1}d_${w}`;
  const female = (j: number) => (j === n - 1 ? 'u' : 'd');

  // ---- connectors ----
  for (let j = 0; j < n; j++) {
    const hard = route.nodes[j].hard;
    for (const w of W) {
      const pin = `${cid}.${w}@c${j}`;
      if (!hard && !ctx.unplugged.has(j) && !has(pin, 'open')) {
        const added = at(pin).filter((f) => f.kind === 'addedOhms').reduce((a, f) => a + (f.value ?? 2500), 0);
        R(`c${j}u_${w}`, `c${j}d_${w}`, mate + added);
      }
      const side = hard ? 'u' : female(j);
      for (const f of at(pin)) {
        if (f.kind === 'shortToWire' && f.to) R(`c${j}${side}_${w}`, `c${j}${side}_${f.to}`, f.value ?? 3300);
        if (f.kind === 'shortToGround') R(`c${j}${side}_${w}`, 'gnd', f.value ?? 0.4);
      }
    }
  }
  // ---- harness sections ----
  for (let j = 1; j < n; j++) {
    for (const w of W) {
      const part = `${cid}.${w}@s${j}`;
      const A = `s${j}a_${w}`, mid = `s${j}_${w}`, B = `s${j}b_${w}`;
      R(`c${j - 1}d_${w}`, A, seg[0]);
      R(A, mid, seg[1]);
      if (!has(part, 'open')) {
        const added = at(part).filter((f) => f.kind === 'addedOhms').reduce((a, f) => a + (f.value ?? 180), 0);
        R(mid, B, seg[2] + added);
      }
      R(B, `c${j}u_${w}`, seg[3]);
      for (const f of at(part)) {
        if (f.kind === 'shortToGround') R(mid, 'gnd', f.value ?? (w === 'ref' ? 0.05 : 0.4));
        if (f.kind === 'shortToWire' && f.to) R(mid, `s${j}_${f.to}`, f.value ?? 0.3);
        if (f.kind === 'shortToPower') {
          const src = `bat_${f.id}`;
          Vs(src, 'gnd', s.batteryV, 'sup');
          R(src, mid, f.value ?? 0.5);
        }
      }
    }
  }
  const compBad = at(`${cid}.component`)[0];
  const sensorFault = at(`${cid}.sensor`)[0];
  const gain = sensorFault?.kind === 'drift' ? sensorFault.value ?? 1 : 1;

  switch (t) {
    case 'A': {
      if (on) E.push({ t: 'R', a: ctx.supplyNode, b: N(mu('ref')), r: 2, powerOnly: true });
      R(mu('ret'), 'gnd', 0.3, { mod: true });
      R(mu('sig'), 'gnd', 100e3, { mod: true });
      R(cd('ref'), cd('ret'), 500);
      if (compBad) R(cd('sig'), cd('ret'), 5);
      if (ctx.powered) {
        // powered: the output stage drives the signal through 200 Ω (5.5 bench schematic)
        Vs('so', cd('ret'), sensorOutputVolts(cid, s, gain, F), 'ser');
        R('so', cd('sig'), 200);
      } else {
        // unpowered (open return, lost ground…): the signal floats toward the reference (5.5 3D harness)
        R(cd('sig'), cd('ref'), 2000);
      }
      break;
    }
    case 'B': {
      if (on) {
        Vs('pu', 'gnd', 5, 'sup');
        R('pu', mu('sig'), 2490, { powerOnly: true });
      }
      R(mu('ret'), 'gnd', 0.3, { mod: true });
      if (!compBad) R(cd('sig'), cd('ret'), ntc(temperatureOf(cid, s)));
      break;
    }
    case 'C': {
      if (on) {
        Vs('bias', 'gnd', 2.5, 'sup');
        R('bias', mu('a'), 47e3, { powerOnly: true });
      }
      R(mu('a'), mu('b'), 20e3, { mod: true });
      R(mu('b'), 'gnd', 1e3, { mod: true });
      if (!compBad) {
        Vs('cm', cd('b'), speedSensorAc(cid, s, ctx.spinning) * gain, 'ac');
        R(cd('a'), 'cm', coilOhms(cid));
      }
      break;
    }
    case 'D': {
      R(mu('hi'), 'gnd', 100e3, { mod: true });
      R(mu('lo'), 'gnd', 100e3, { mod: true });
      if (!compBad) R(cd('hi'), cd('lo'), 0.8);
      break;
    }
    case 'E': {
      const fuse = F ? F.at(`${cid}.fuse`) : [];
      Vs('bat_i', 'gnd', s.batteryV, 'sup');
      R('bat_i', 'batpos', 0.005);
      if (!fuse.some((f) => f.kind === 'open')) R('batpos', mu('pwr'), 0.02 + fuse.filter((f) => f.kind === 'addedOhms').reduce((a, f) => a + (f.value ?? 1.5), 0));
      if (on && !compBad) R(cd('pwr'), cd('gnd'), cid === 'abspwr' ? 3.2 : 2.8);
      break;
    }
    case 'G': {
      const fuse = F ? F.at(`${cid}.fuse`) : [];
      Vs('bat_i', 'gnd', s.batteryV, 'sup');
      if (on && !fuse.some((f) => f.kind === 'open')) R('bat_i', mu('pwr'), 0.03);
      R(mu('h'), mu('l'), 60, { mod: true });
      if (on) {
        Vs('nh', 'gnd', 2.62, 'sup');
        R('nh', mu('h'), 30, { powerOnly: true });
        Vs('nl', 'gnd', 2.38, 'sup');
        R('nl', mu('l'), 30, { powerOnly: true });
      }
      if (!compBad) {
        R(cd('pwr'), cd('gnd'), 60);
        R(cd('h'), cd('l'), 50e3);
      }
      break;
    }
    case 'H': {
      if (on) {
        Vs('pu', 'gnd', 5, 'sup');
        R('pu', mu('sig'), 300, { powerOnly: true });
      }
      R(mu('ret'), 'gnd', 0.3, { mod: true });
      if (!compBad) R(cd('sig'), cd('ret'), senderOhms(fuelSenderLevel(s, F)));
      break;
    }
  }
  return E;
}

/** Float position the fuel sender reports: the tank level, unless the float is stuck. */
export function fuelSenderLevel(s: TruckState, F: FaultSet | null): number {
  const stuck = F?.has('mech.fuelFloat', 'stuck');
  return stuck ? stuck.value ?? 0 : s.fuelLevelPct;
}

/** Output voltage of a powered 3-wire sensor. A stuck DEF float reports where it is stuck. */
export function sensorOutputVolts(cid: string, s: TruckState, gain: number, F: FaultSet | null): number {
  let q = sensedQuantity(cid, s);
  if (cid === 'def') {
    const stuck = F?.has('mech.defFloat', 'stuck');
    if (stuck) q = stuck.value ?? 8;
  }
  if (cid === 'map') q = (q - 101) * gain + 101;
  else q *= gain;
  return sensorVolts(q, SENSOR_FULL_SCALE[cid] ?? 100);
}

// ---------------- J1939 backbone at the 9-pin (type F) ----------------
export interface NetworkCtx {
  state: TruckState;
  faults: FaultSet | null;
  terminators: { L: boolean; R: boolean };
  unplugged: ReadonlySet<number>;
}
/** Nodes: C (CAN-H) and D (CAN-L) at the 9-pin, A ground, B battery +, tcm_h/tcm_l harness side at the TCM, tcmm_h/tcmm_l TCM pins. */
export function buildNetwork(ctx: NetworkCtx): Element[] {
  const E: Element[] = [];
  const R = (a: string, b: string, r: number, extra?: { mod?: boolean; powerOnly?: boolean }) => E.push({ t: 'R', a: g(a), b: g(b), r, ...extra });
  const Vs = (a: string, b: string, v: number) => E.push({ t: 'V', a: g(a), b: g(b), v, kind: 'sup' });
  const has = (p: string, k?: string) => (ctx.faults ? ctx.faults.has(p, k as never) : undefined);
  const on = ctx.state.key !== 'off';
  if (ctx.terminators.L && !has('can.termL', 'open')) R('C', 'D', 120);
  if (ctx.terminators.R && !has('can.termR', 'open')) R('C', 'D', 120);
  if (on) {
    Vs('sh', 'gnd', 2.62);
    R('sh', 'C', 30, { powerOnly: true });
    Vs('sl', 'gnd', 2.38);
    R('sl', 'D', 30, { powerOnly: true });
  }
  R('A', 'gnd', 0.01);
  Vs('B', 'gnd', ctx.state.batteryV);
  if (!has('can.stub.tcm', 'open')) {
    R('C', 'tcm_h', 0.1);
    R('D', 'tcm_l', 0.1);
  }
  if (!ctx.unplugged.has(1)) {
    R('tcm_h', 'tcmm_h', 0.01);
    R('tcm_l', 'tcmm_l', 0.01);
  }
  R('tcmm_h', 'tcmm_l', 60e3);
  const hl = has('can.H', 'shortToWire');
  if (hl) R('C', 'D', hl.value ?? 0.2);
  const hg = has('can.H', 'shortToGround');
  if (hg) R('C', 'gnd', hg.value ?? 0.2);
  const lg = has('can.L', 'shortToGround');
  if (lg) R('D', 'gnd', lg.value ?? 0.2);
  const hp = has('can.H', 'shortToPower');
  if (hp) R('B', 'C', hp.value ?? 0.2);
  return E;
}
const g = (l: string) => (l === 'gnd' ? 'gnd' : `net:${l}`);
