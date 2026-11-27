// Replay a logged run on a fresh engine. Same scenario + same seed + same actions at the same
// simulation times = the same truck. Meter readings are compared against what the student saw.
import { SimEngine } from './engine';
import type { Action, LogEntry } from './actions';
import type { Scenario } from './scenario';
import type { MeterRequest, ClampRequest } from './tools/multimeter';

export interface ReplayResult {
  engine: SimEngine;
  /** Logged results that came out differently on replay (should be empty). */
  mismatches: { seq: number; type: string; logged: unknown; replayed: unknown }[];
}

export function replay(scenario: Scenario | undefined, log: LogEntry[], opts: { seed?: number } = {}): ReplayResult {
  const e = new SimEngine({ scenario, seed: opts.seed });
  const mismatches: ReplayResult['mismatches'] = [];
  const check = (x: LogEntry, got: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(x.result)) mismatches.push({ seq: x.seq, type: x.type, logged: x.result, replayed: got });
  };
  for (const x of log) {
    e.runTo(x.t);
    const n = e.log.entries.length;
    switch (x.type) {
      case 'meter.probe': e.meter.probe(x.args as MeterRequest); break;
      case 'meter.clamp': e.meter.clampProbe(x.args as ClampRequest); break;
      case 'scan.requestDM2': e.scan.requestDM2(); break;
      case 'scan.clearCodes': e.scan.clearCodes(); break;
      case 'scan.cylinderCutout': e.scan.cylinderCutout(); break;
      case 'scan.parkedRegen': e.scan.parkedRegen(); break;
      case 'scan.freezeFrame': {
        const a = x.args as { sa: number; spn: number; fmi: number };
        e.scan.freezeFrame(a.sa, a.spn, a.fmi);
        break;
      }
      default: e.dispatch(x.args as Action);
    }
    const got = e.log.entries[n];
    check(x, got?.result);
  }
  return { engine: e, mismatches };
}
