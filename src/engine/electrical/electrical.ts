// The electrical system: owns the harness configuration (routes, plugs, terminators) and solves
// every circuit's netlist on demand. Control modules read their pin voltages here; the meter measures here.
import { resistance, solve, type Element, type Voltages } from './solver';
import {
  buildCircuit, buildNetwork, defaultRoute, nodeName, SUPPLY_GROUP, SUPPLY_MEMBERS, TYPE_OF, WIRES,
  type RouteSpec,
} from './harness';
import type { FaultSet } from '../faults';
import type { TruckState } from '../state';

export type SolveMode = 'dc' | 'ac' | 'ohm';

export interface HarnessConfig {
  routes: Map<string, RouteSpec>;
  unplugged: Map<string, Set<number>>;
  terminators: { L: boolean; R: boolean };
  spinning: Set<string>;
}

export interface ElectricalDeps {
  state: () => TruckState;
  faults: () => FaultSet;
  /** Truck state for a known-good truck under the same driver inputs (for reference readings). */
  referenceState: () => TruckState;
}

interface Built {
  els: Element[];
  regNodes: string[];
}

export type BusHealth = 'ok' | 'shorted' | 'unterminated';

export class Electrical {
  readonly harness: HarnessConfig = { routes: new Map(), unplugged: new Map(), terminators: { L: true, R: true }, spinning: new Set() };
  private cache = new Map<string, unknown>();
  constructor(private deps: ElectricalDeps) {}

  invalidate(): void {
    this.cache.clear();
  }

  route(cid: string): RouteSpec {
    return this.harness.routes.get(cid) ?? defaultRoute(cid);
  }
  unplugged(cid: string): ReadonlySet<number> {
    return this.harness.unplugged.get(cid) ?? EMPTY;
  }
  /** Global node name for a local test point on a circuit. */
  node(cid: string, local: string): string {
    if (local === 'gnd') return 'gnd';
    if (cid === 'net') return `net:${local}`;
    if (local === 'batpos' || local === 'sup') return local === 'sup' ? this.supplyNode(cid) : `${cid}:batpos`;
    return nodeName(cid, this.route(cid), local);
  }
  supplyNode(cid: string): string {
    const g = SUPPLY_GROUP[cid];
    return g ? `ecm:${g}` : `${cid}:reg`;
  }
  /** Circuits solved together (a shared 5 V supply couples them). */
  group(cid: string): string[] {
    const g = SUPPLY_GROUP[cid];
    return g ? [...SUPPLY_MEMBERS[g]] : [cid];
  }

  // ---------- netlists ----------
  private buildGroup(cid: string, reference: boolean, powered: Set<string>, limited: Set<string>): Built {
    const st = reference ? this.deps.referenceState() : this.deps.state();
    if (cid === 'net') {
      return {
        els: buildNetwork({
          state: st,
          faults: reference ? null : this.deps.faults(),
          terminators: reference ? { L: true, R: true } : this.harness.terminators,
          unplugged: reference ? EMPTY : this.unplugged('net'),
        }),
        regNodes: [],
      };
    }
    const els: Element[] = [];
    const regNodes: string[] = [];
    const members = this.group(cid);
    for (const m of members) {
      els.push(
        ...buildCircuit({
          cid: m,
          state: st,
          faults: reference ? null : this.deps.faults(),
          route: this.route(m),
          unplugged: reference ? EMPTY : this.unplugged(m),
          powered: powered.has(m),
          spinning: this.harness.spinning.has(m),
          supplyNode: this.supplyNode(m),
        }),
      );
    }
    // 5 V regulator(s) for 3-wire sensors: 5 V behind 0.05 Ω, folds back to 50 mA above 300 mA
    if (TYPE_OF[cid] === 'A' && st.key !== 'off') {
      const reg = this.supplyNode(cid);
      regNodes.push(reg);
      if (limited.has(reg)) els.push({ t: 'I', a: 'gnd', b: reg, i: 0.05 });
      else if (limited.has(reg + '!off')) {
        /* back-driven above 5 V: the regulator can only source current, so its output stage is off */
      } else {
        els.push({ t: 'V', a: reg + '_i', b: 'gnd', v: 5, kind: 'sup' });
        els.push({ t: 'R', a: reg + '_i', b: reg, r: 0.05, powerOnly: true });
      }
    }
    return { els, regNodes };
  }

  /** The full netlist for a circuit's group with sensors powered as they really are. */
  netlist(cid: string, reference = false): Element[] {
    const key = `nl|${cid}|${reference}`;
    const hit = this.cache.get(key) as Element[] | undefined;
    if (hit) return hit;
    const members = this.group(cid);
    const limited = new Set<string>();
    let powered = new Set<string>();
    let b = this.buildGroup(cid, reference, powered, limited);
    if (TYPE_OF[cid] === 'A') {
      for (let pass = 0; pass < 3; pass++) {
        const V = solve(dcOnly(b.els));
        let changed = false;
        for (const reg of b.regNodes) {
          const i = (V(reg + '_i') - V(reg)) / 0.05;
          if (limited.has(reg) || limited.has(reg + '!off')) continue;
          if (i > 0.3) {
            limited.add(reg); // overload: fold back to 50 mA
            changed = true;
          } else if (i < -0.01) {
            limited.add(reg + '!off'); // something is driving the supply above 5 V
            changed = true;
          }
        }
        const p2 = new Set<string>();
        for (const m of members) {
          if (TYPE_OF[m] !== 'A') continue;
          const r = this.route(m);
          const last = r.nodes.length - 1;
          const ref = V(nodeName(m, r, `c${last}d_ref`)) - V(nodeName(m, r, `c${last}d_ret`));
          if (ref > 4.5) p2.add(m);
        }
        if (!sameSet(p2, powered)) changed = true;
        powered = p2;
        b = this.buildGroup(cid, reference, powered, limited);
        if (!changed) break;
      }
    }
    this.cache.set(key, b.els);
    return b.els;
  }

  /** Node voltages in DC, AC or (with a 1 mA injection) ohms mode. */
  solveMode(cid: string, mode: Exclude<SolveMode, 'ohm'>, reference = false, extra: Element[] = []): Voltages {
    const key = `v|${cid}|${mode}|${reference}`;
    if (!extra.length) {
      const hit = this.cache.get(key) as Voltages | undefined;
      if (hit) return hit;
    }
    const els = this.netlist(cid, reference);
    const V = solve([...(mode === 'dc' ? dcOnly(els) : acOnly(els)), ...extra]);
    if (!extra.length) this.cache.set(key, V);
    return V;
  }

  ohms(cid: string, a: string, b: string, isolateModule: boolean, reference = false): number {
    const els = ohmNetlist(this.netlist(cid, reference), isolateModule);
    return resistance(els, a, b);
  }

  // ---------- module-facing readings ----------
  /** DC voltage at a local point of a circuit, relative to chassis ground. */
  volts(cid: string, local: string): number {
    return this.solveMode(cid, 'dc')(this.node(cid, local));
  }
  acVolts(cid: string, a: string, b: string): number {
    const V = this.solveMode(cid, 'ac');
    return Math.abs(V(this.node(cid, a)) - V(this.node(cid, b)));
  }
  /** Resistance seen from the module pins with the module's own circuits out of the path (driver diagnostics). */
  moduleOhms(cid: string, a: string, b: string): number {
    const key = `mo|${cid}|${a}|${b}`;
    const hit = this.cache.get(key) as number | undefined;
    if (hit !== undefined) return hit;
    const r = this.ohms(cid, this.node(cid, a), this.node(cid, b), true);
    this.cache.set(key, r);
    return r;
  }

  /** Backbone health derived from the backbone's resistances (not from a fault list). */
  busHealth(): { health: BusHealth; attached: Record<string, boolean>; rCD: number } {
    const hit = this.cache.get('bus') as ReturnType<Electrical['busHealth']> | undefined;
    if (hit) return hit;
    const els = ohmNetlist(this.netlist('net'), false);
    const rCD = resistance(els, 'net:C', 'net:D');
    const rCg = resistance(els, 'net:C', 'gnd');
    const rDg = resistance(els, 'net:D', 'gnd');
    const dcV = solve(dcOnly(this.netlist('net')));
    const shortedToPower = dcV('net:C') > 5 || dcV('net:D') > 5;
    const health: BusHealth = rCD < 10 || rCg < 10 || rDg < 10 || shortedToPower ? 'shorted' : rCD > 500 ? 'unterminated' : 'ok';
    const tcm = resistance(els, 'net:C', 'net:tcmm_h') < 10 && resistance(els, 'net:D', 'net:tcmm_l') < 10;
    const f = this.deps.faults();
    const stub = (e: string) => !f.has(`can.stub.${e}`, 'open');
    const out = { health, rCD, attached: { ecm: stub('ecm'), acm: stub('acm'), tcm, abs: stub('abs'), clu: stub('clu'), tool: true } as Record<string, boolean> };
    this.cache.set('bus', out);
    return out;
  }

  wires(cid: string): string[] {
    return WIRES[TYPE_OF[cid]] ?? [];
  }
}

const EMPTY: ReadonlySet<number> = new Set();
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
export const dcOnly = (els: Element[]) => els.map((e) => (e.t === 'V' && e.kind === 'ac' ? { ...e, v: 0 } : e));
export const acOnly = (els: Element[]) =>
  els.filter((e) => e.t !== 'I').map((e) => (e.t === 'V' && e.kind !== 'ac' ? { ...e, v: 0 } : e));
export function ohmNetlist(els: Element[], isolateModule: boolean): Element[] {
  return els
    .filter((e) => !(e.t === 'V' && e.kind === 'sup') && e.t !== 'I')
    .filter((e) => !(e.t === 'R' && (e.powerOnly || (isolateModule && e.mod))))
    .map((e) => (e.t === 'V' ? { ...e, v: 0 } : e));
}
