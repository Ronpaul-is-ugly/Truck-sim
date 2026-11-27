// Every fault in the simulator 5.5 catalog, expressed as modifiers on physical parts (or as a real-world
// condition such as a low DEF tank). The control modules have to *detect* each one from the circuit; the
// catalog's SPN/FMI is only the expected answer (checked by the tests).
import type { FaultSpec } from './faults';
import type { Conditions } from './state';
import { C } from './data/catalog';

export interface Preset {
  faults: FaultSpec[];
  conditions?: Partial<Conditions>;
  /** How long a test should run before the code is expected to be active. */
  settleMs?: number;
}

const ERRATIC = { dutyPct: 20, meanOnMs: 300 };
const P: Record<string, Preset> = {};
const f = (part: string, kind: FaultSpec['kind'], extra: Partial<FaultSpec> = {}): FaultSpec => ({ part, kind, ...extra });

// 3-wire 5 V sensors (circuitFaults in 5.5)
for (const cid of ['map', 'maf', 'oilp', 'rail', 'app', 'thr', 'egr', 'vgt', 'def', 'dpf', 'airp', 'airs']) {
  P[`${cid}/gnd`] = { faults: [f(`${cid}.sig@s1`, 'shortToGround')] };
  P[`${cid}/high`] = { faults: [f(`${cid}.sig@s1`, 'shortToWire', { to: 'ref' })] };
  P[`${cid}/open`] = { faults: [f(`${cid}.sig@s1`, 'open')] };
  P[`${cid}/erratic`] = { faults: [f(`${cid}.sig@c1`, 'open', { intermittent: ERRATIC })], settleMs: 20000 };
}
// thermistors (tempFaults)
for (const cid of ['ect', 'tot', 'amb', 'deft']) {
  P[`${cid}/open`] = { faults: [f(`${cid}.sig@s1`, 'open')] };
  P[`${cid}/gnd`] = { faults: [f(`${cid}.sig@s1`, 'shortToGround')] };
}
// magnetic speed sensors
P['crank/open'] = { faults: [f('crank.a@s1', 'open')] };
P['crank/erratic'] = { faults: [f('mech.crankTarget', 'damaged')] };
P['cam/open'] = { faults: [f('cam.a@s1', 'open')] };
P['cam/sync'] = { faults: [f('mech.camTiming', 'drift', { value: 1 })] };
for (const cid of ['oss', 'iss']) {
  P[`${cid}/open`] = { faults: [f(`${cid}.a@s1`, 'open')] };
  P[`${cid}/erratic`] = { faults: [f(`${cid}.a@c1`, 'open', { intermittent: ERRATIC })], settleMs: 20000 };
}
for (const cid of ['wlf', 'wrf', 'wlr', 'wrr']) {
  P[`${cid}/open`] = { faults: [f(`${cid}.a@s1`, 'open')] };
  P[`${cid}/short`] = { faults: [f(`${cid}.a@s1`, 'shortToGround')] };
  P[`${cid}/gap`] = { faults: [f(`${cid}.sensor`, 'drift', { value: 0.2 })] };
  P[`${cid}/erratic`] = { faults: [f(`mech.toneRing.${cid}`, 'damaged')] };
}
// injectors
for (let i = 1; i <= 6; i++) {
  P[`inj${i}/open`] = { faults: [f(`inj${i}.hi@s1`, 'open')] };
  P[`inj${i}/short`] = { faults: [f(`inj${i}.hi@s1`, 'shortToGround', { value: 0.2 })] };
  P[`inj${i}/mech`] = { faults: [f(`mech.injector${i}`, 'stuck')] };
}
// real conditions
Object.assign(P, {
  'map/over': { faults: [f('mech.wastegate', 'stuck')] },
  'map/under': { faults: [f('mech.chargeAir', 'leak')] },
  'maf/drh': { faults: [f('maf.sensor', 'drift', { value: 1.35 })] },
  'maf/drl': { faults: [f('maf.sensor', 'drift', { value: 0.7 })] },
  'oilp/low': { faults: [f('mech.lube', 'leak')] },
  'ect/hot': { faults: [f('mech.coolant', 'leak')] },
  'ect/warm': { faults: [f('mech.thermostat', 'stuck', { value: 0 })] },
  'rail/lowp': { faults: [f('mech.fuelHighPressure', 'leak')] },
  'thr/stuck': { faults: [f('mech.throttle', 'stuck', { value: 35 })] },
  'egr/stuck': { faults: [f('mech.egr', 'stuck', { value: 45 })] },
  'vgt/stuck': { faults: [f('mech.vgt', 'stuck', { value: 15 })] },
  'batt/low': { faults: [f('mech.alternator', 'open')] },
  'batt/high': { faults: [f('mech.alternator', 'stuck', { value: 16.3 })] },
  'sup1/gnd': { faults: [f('map.ref@s1', 'shortToGround', { value: 0.03 })] },
  'sup1/high': { faults: [f('map.ref@s1', 'shortToPower', { value: 0.05 })] },
  'sup2/gnd': { faults: [f('oilp.ref@s1', 'shortToGround', { value: 0.03 })] },
  'sup2/high': { faults: [f('oilp.ref@s1', 'shortToPower', { value: 0.05 })] },
  'tot/hot': { faults: [f('mech.transFluid', 'leak')] },
  'abspwr/low': { faults: [f('abspwr.fuse', 'addedOhms', { value: 1.5 })] },
  'fuel/open': { faults: [f('fuel.sig@s1', 'open')] },
  'fuel/gnd': { faults: [f('fuel.sig@s1', 'shortToGround')] },
  'fuel/float': { faults: [f('mech.fuelFloat', 'stuck', { value: 0 })], settleMs: 480000 },
  'airp/low': { faults: [f('mech.airPrimary', 'leak')] },
  'airs/low': { faults: [f('mech.airSecondary', 'leak')] },
  'def/low': { faults: [], conditions: { defLevelPct: 8 } },
  'def/empty': { faults: [], conditions: { defLevelPct: 0 } },
  'dpf/soot': { faults: [], conditions: { dpf: 'soot' } },
  'dpf/plug': { faults: [], conditions: { dpf: 'plugged' } },
} satisfies Record<string, Preset>);
for (const cid of ['noxin', 'noxout']) {
  P[`${cid}/nocom`] = { faults: [f(`${cid}.fuse`, 'open')] };
  P[`${cid}/drift`] = { faults: [f(`${cid}.sensor`, 'drift', { value: cid === 'noxin' ? 3.5 : 16 })] };
  P[`${cid}/internal`] = { faults: [f(`${cid}.sensor`, 'damaged')] };
}
// network wiring (NETF)
P['net/term'] = { faults: [f('can.termR', 'open')] };
P['net/tcm'] = { faults: [f('can.stub.tcm', 'open')] };
P['net/hl'] = { faults: [f('can.H', 'shortToWire', { to: 'L' })] };
P['net/hg'] = { faults: [f('can.H', 'shortToGround')] };

export const PRESETS: Readonly<Record<string, Preset>> = P;

/** Catalog entries that have no preset (should be none). */
export const missingPresets = () => C.flatMap((c) => c.faults.map((x) => `${c.id}/${x.key}`)).filter((k) => !P[k]);

// ---------- 3D harness jobs (5.5 hMakeFault kinds) ----------
export interface HarnessFault {
  kind: 'open' | 'gnd' | 'short' | 'res' | 'intermittent' | 'comp' | 'bat' | 'pushed' | 'water' | 'strands' | 'mech' | 'none';
  wire?: string;
  wire2?: string;
  seg?: number;
  conn?: number;
  /** Mechanical fault key (5.5 MFAULT .m) */
  m?: string;
}
const MECH: Record<string, (cid: string) => FaultSpec[]> = {
  'crank/tone': () => [f('mech.crankTarget', 'damaged')],
  'crank/loose': () => [f('crank.sensor', 'drift', { value: 0.3 })],
  'cam/sync': () => [f('mech.camTiming', 'drift', { value: 1 })],
  'map/leak': () => [f('mech.chargeAir', 'leak')],
  'oilp/low': () => [f('mech.lube', 'leak')],
  'ect/tstat': () => [f('mech.thermostat', 'stuck', { value: 0 })],
  'rail/filter': () => [f('mech.fuelFilter', 'addedOhms', { value: 1 })],
  'thr/stuck': () => [f('mech.throttle', 'stuck', { value: 35 })],
  'egr/stuck': () => [f('mech.egr', 'stuck', { value: 45 })],
  'vgt/stuck': () => [f('mech.vgt', 'stuck', { value: 15 })],
  'inj/mech': (cid) => [f(`mech.injector${cid.replace('inj', '')}`, 'stuck')],
  'wss/gap': (cid) => [f(`${cid}.sensor`, 'drift', { value: 0.15 })],
  'wss/ring': (cid) => [f(`mech.toneRing.${cid}`, 'damaged')],
  'fuel/float': () => [f('mech.fuelFloat', 'stuck', { value: 0 })],
  'air/leak': (cid) => [f(cid === 'airp' ? 'mech.airPrimary' : 'mech.airSecondary', 'leak')],
  'def/float': () => [f('mech.defFloat', 'stuck', { value: 8 })],
};
const mechKey = (cid: string) => (cid.startsWith('inj') ? 'inj' : cid[0] === 'w' ? 'wss' : cid === 'airp' || cid === 'airs' ? 'air' : cid);

/** A 3D-level harness fault as part modifiers (values from 5.5 hCircuit: 2500 Ω terminal, 180 Ω strands, 3300 Ω water…). */
export function harnessFaultSpecs(cid: string, hf: HarnessFault, routeConnectors: number): FaultSpec[] {
  const w = hf.wire ?? '';
  const last = routeConnectors - 1;
  switch (hf.kind) {
    case 'none': return [];
    case 'mech': return MECH[`${mechKey(cid)}/${hf.m}`]?.(cid) ?? [];
    case 'open': return [f(`${cid}.${w}@s${hf.seg}`, 'open')];
    case 'gnd': return [f(`${cid}.${w}@s${hf.seg}`, 'shortToGround', { value: w === 'ref' ? 0.05 : 0.4 })];
    case 'short': return [f(`${cid}.${w}@s${hf.seg}`, 'shortToWire', { to: hf.wire2, value: 0.3 })];
    case 'bat': return [f(`${cid}.${w}@s${hf.seg}`, 'shortToPower', { value: 0.5 })];
    case 'strands': return [f(`${cid}.${w}@s${hf.seg}`, 'addedOhms', { value: 180 })];
    case 'intermittent': return [f(`${cid}.${w}@s${hf.seg}`, 'open', { intermittent: { dutyPct: 10, meanOnMs: 200 } })];
    case 'res': return [f(`${cid}.${w}@c${hf.conn}`, 'addedOhms', { value: 2500 })];
    case 'pushed': return [f(`${cid}.${w}@c${hf.conn}`, 'open')];
    case 'water': return [f(`${cid}.${w}@c${hf.conn}`, 'shortToWire', { to: hf.wire2, value: 3300 })];
    case 'comp': return [f(`${cid}.component`, 'damaged')];
  }
  void last;
  return [];
}
