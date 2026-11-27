// Faults are modifiers on parts. Physics and the harness netlist read them; tools and control modules never do.
import type { Rng } from './rng';

export type FaultKind =
  | 'open' // wire, terminal, fuse, terminator or stub broken
  | 'shortToGround'
  | 'shortToPower' // to battery voltage
  | 'shortToWire' // to another wire of the same circuit (5 V ref, CAN-L…), `to` names it
  | 'addedOhms' // extra series resistance (corrosion, fretting, broken strands, a restriction in a fluid path)
  | 'leak' // a fluid or air system losing pressure
  | 'stuck' // a moving part stuck; `value` is where it is stuck
  | 'drift' // a sensing element's gain is off; `value` is the gain (1 = good)
  | 'damaged'; // a part physically damaged (tone wheel, smart-sensor element, sensor shorted inside)

export interface Intermittent {
  /** Percent of the time the fault is present. */
  dutyPct: number;
  /** Average length of each episode. */
  meanOnMs: number;
}

export interface FaultSpec {
  part: string;
  kind: FaultKind;
  value?: number;
  to?: string;
  intermittent?: Intermittent;
}

export interface Fault extends FaultSpec {
  id: string;
  /** Present right now (always true unless intermittent). */
  present: boolean;
}

/**
 * Part addresses:
 *   map.sig@s1      signal wire of circuit "map" in harness section 1
 *   map.sig@c1      signal terminal at connector 1
 *   map.component   the sensor/actuator itself
 *   maf.sensor      the sensing element (drift/damage)
 *   abspwr.fuse     a feed fuse / power supply
 *   mech.coolant    a mechanical part or fluid system
 *   can.termR       CAN parts: termL, termR, stub.<ecu>, H, L
 */
export type PartRef =
  | { kind: 'wire'; circuit: string; wire: string; seg: number }
  | { kind: 'pin'; circuit: string; wire: string; conn: number }
  | { kind: 'component'; circuit: string }
  | { kind: 'sensor'; circuit: string }
  | { kind: 'fuse'; circuit: string }
  | { kind: 'mech'; name: string }
  | { kind: 'can'; name: string };

export function parsePart(part: string): PartRef {
  const m = /^([\w]+)\.(\w+)@([sc])(\d+)$/.exec(part);
  if (m) return m[3] === 's' ? { kind: 'wire', circuit: m[1], wire: m[2], seg: +m[4] } : { kind: 'pin', circuit: m[1], wire: m[2], conn: +m[4] };
  if (part.startsWith('mech.')) return { kind: 'mech', name: part.slice(5) };
  if (part.startsWith('can.')) return { kind: 'can', name: part.slice(4) };
  const p = /^(\w+)\.(component|sensor|fuse)$/.exec(part);
  if (p) return { kind: p[2] as 'component' | 'sensor' | 'fuse', circuit: p[1] };
  throw new Error(`Unknown part address "${part}"`);
}

export interface Wiggle {
  circuit: string;
  seg?: number;
  conn?: number;
  untilMs: number;
}

export class FaultSet {
  private items: Fault[] = [];
  private nextId = 1;
  version = 0;

  add(spec: FaultSpec, id?: string): string {
    parsePart(spec.part); // validate
    const fid = id ?? `f${this.nextId++}`;
    this.items.push({ ...spec, id: fid, present: !spec.intermittent });
    this.version++;
    return fid;
  }
  remove(id: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((f) => f.id !== id);
    this.version++;
    return this.items.length !== n;
  }
  clear(): void {
    this.items = [];
    this.version++;
  }
  list(): readonly Fault[] {
    return this.items;
  }

  /** Advance intermittent faults one step (two-state Markov chain, sped up while the spot is being wiggled). */
  step(dtMs: number, rng: Rng, wiggles: Wiggle[], nowMs: number): void {
    for (const f of this.items) {
      if (!f.intermittent) continue;
      const w = wiggles.some((g) => g.untilMs > nowMs && matchesWiggle(f, g));
      const duty = w ? 55 : f.intermittent.dutyPct;
      const meanOn = w ? 150 : f.intermittent.meanOnMs;
      const meanOff = (meanOn * (100 - duty)) / Math.max(1, duty);
      const was = f.present;
      if (f.present) {
        if (rng.next() < dtMs / meanOn) f.present = false;
      } else if (rng.next() < dtMs / Math.max(1, meanOff)) f.present = true;
      if (f.present !== was) this.version++;
    }
  }

  /** Faults present right now at an exact part address. */
  at(part: string): Fault[] {
    return this.items.filter((f) => f.present && f.part === part);
  }
  has(part: string, kind?: FaultKind): Fault | undefined {
    return this.items.find((f) => f.present && f.part === part && (!kind || f.kind === kind));
  }
  /** Present faults whose part belongs to a circuit. */
  onCircuit(circuit: string): Fault[] {
    return this.items.filter((f) => f.present && f.part.startsWith(circuit + '.'));
  }
}

function matchesWiggle(f: Fault, g: Wiggle): boolean {
  const p = parsePart(f.part);
  if (p.kind === 'wire') return p.circuit === g.circuit && (g.seg == null || g.seg === p.seg);
  if (p.kind === 'pin') return p.circuit === g.circuit && (g.conn == null || g.conn === p.conn);
  return false;
}
