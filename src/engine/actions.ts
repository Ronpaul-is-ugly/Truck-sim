// Everything a student (or instructor) does goes through SimEngine.dispatch() or a tool, and is logged
// with the simulation time, so a run can be scored and replayed exactly.
import type { FaultSpec } from './faults';
import type { KeyPos, LoadCase, Road, Conditions } from './state';
import type { RouteSpec } from './electrical/harness';

export type Action =
  | { type: 'setKey'; key: KeyPos }
  | { type: 'setTargetSpeed'; mph: number }
  | { type: 'setLoad'; load: LoadCase }
  | { type: 'setRoad'; road: Road }
  | { type: 'brake' }
  | { type: 'unplug'; circuit: string; connector: number }
  | { type: 'plug'; circuit: string; connector: number }
  | { type: 'wiggle'; circuit: string; seg?: number; connector?: number; ms?: number }
  | { type: 'spinWheel'; circuit: string; on: boolean }
  | { type: 'setTerminator'; side: 'L' | 'R'; installed: boolean }
  | { type: 'injectFault'; fault: FaultSpec; id?: string }
  | { type: 'removeFault'; id: string }
  | { type: 'applyPreset'; cid: string; key: string }
  | { type: 'clearPreset'; cid: string }
  | { type: 'clearAllFaults' }
  | { type: 'setCondition'; conditions: Partial<Conditions> }
  | { type: 'setRoute'; circuit: string; route: RouteSpec | null }
  | { type: 'inspect'; check: string; circuit: string }
  | { type: 'labor'; what: string; minutes: number }
  | { type: 'submitDiagnosis'; circuit: string; location: string; kind: string; wire?: string; cause?: string };

export const INSTRUCTOR_ACTIONS = new Set(['injectFault', 'removeFault', 'applyPreset', 'clearPreset', 'clearAllFaults', 'setCondition', 'setRoute']);

export interface ActionResult {
  ok: boolean;
  faultId?: string;
  faultIds?: string[];
  text?: string;
  error?: string;
}

export interface LogEntry {
  seq: number;
  /** Simulation time, ms. */
  t: number;
  actor: 'student' | 'instructor';
  type: string;
  args: unknown;
  result?: unknown;
}

export class ActionLog {
  entries: LogEntry[] = [];
  /** Muted while replaying or while the engine applies a scenario's own setup. */
  muted = false;
  add(t: number, type: string, args: unknown, result?: unknown): void {
    if (this.muted) return;
    const actor = INSTRUCTOR_ACTIONS.has(type) ? 'instructor' : 'student';
    this.entries.push({ seq: this.entries.length + 1, t, actor, type, args: structuredClone(args), result: result === undefined ? undefined : structuredClone(result) });
  }
  toJSON(): LogEntry[] {
    return structuredClone(this.entries);
  }
  laborMinutes(): number {
    return this.entries.filter((e) => e.type === 'labor').reduce((a, e) => a + ((e.args as { minutes: number }).minutes ?? 0), 0);
  }
}
