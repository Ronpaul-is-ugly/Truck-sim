// Scoring rules from the 5.5 harness levels: electrical faults score location 50 / fault type 35 / wire 15,
// mechanical faults score location 35 / type 25 / cause 40, minus 1 point per 3 min over the flat rate (max 25).
import type { Scenario } from './scenario';
import type { LogEntry } from './actions';

export interface Diagnosis {
  circuit: string;
  location: string;
  kind: string;
  wire?: string;
  cause?: string;
}
export interface Score {
  score: number;
  raw: number;
  timePenalty: number;
  locationOk: boolean;
  kindOk: boolean;
  wireOrCauseOk: boolean;
}

export function scoreDiagnosis(sc: Scenario, d: Diagnosis, laborMin = 0): Score {
  const a = sc.answer;
  if (!a) throw new Error(`Scenario ${sc.id} has no answer key`);
  const sameCircuit = d.circuit === a.circuit;
  let raw: number, locationOk: boolean, kindOk: boolean, third: boolean;
  if (a.kind === 'mech') {
    locationOk = sameCircuit && d.location === 'mech';
    kindOk = d.kind === 'mech';
    third = d.cause === a.cause;
    raw = (locationOk ? 35 : 0) + (kindOk ? 25 : 0) + (third ? 40 : 0);
  } else {
    locationOk = sameCircuit && d.location === a.location;
    kindOk = d.kind === a.kind;
    third = a.kind === 'comp' || d.wire === a.wire || (!!a.wire2 && d.wire === a.wire2);
    raw = (locationOk ? 50 : 0) + (kindOk ? 35 : 0) + (third ? 15 : 0);
  }
  const budget = sc.laborBudgetMin;
  const timePenalty = raw && budget ? Math.min(25, Math.ceil(Math.max(0, laborMin - budget) / 3)) : 0;
  return { score: Math.max(0, raw - timePenalty), raw, timePenalty, locationOk, kindOk, wireOrCauseOk: third };
}

/** Score the last diagnosis in a log. */
export function scoreLog(sc: Scenario, log: LogEntry[]): Score | null {
  const sub = [...log].reverse().find((e) => e.type === 'submitDiagnosis');
  if (!sub) return null;
  const labor = log.filter((e) => e.type === 'labor').reduce((a, e) => a + ((e.args as { minutes: number }).minutes ?? 0), 0);
  return scoreDiagnosis(sc, sub.args as Diagnosis, labor);
}
