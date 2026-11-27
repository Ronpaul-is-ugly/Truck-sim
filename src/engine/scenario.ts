// Scenario files: the starting truck, the faults (as part modifiers or catalog presets), the answer key.
import type { FaultSpec } from './faults';
import type { InitialState } from './state';
import type { RouteSpec } from './electrical/harness';
import type { EcuKey } from './data/catalog';
import { parsePart } from './faults';
import { PRESETS } from './presets';

export interface ScenarioAnswer {
  circuit: string;
  /** 's2' harness section, 'c1' connector, 'comp' the component, 'mech' a mechanical cause. */
  location: string;
  kind: string;
  wire?: string;
  wire2?: string;
  cause?: string;
}
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  complaint?: string;
  seed?: number;
  initial?: InitialState;
  routes?: Record<string, RouteSpec>;
  faults?: FaultSpec[];
  presets?: { cid: string; key: string }[];
  answer?: ScenarioAnswer;
  /** Flat-rate labor minutes before a time penalty (5.5: 75 for level 4, 120 for level 5). */
  laborBudgetMin?: number;
  expect?: { afterMs?: number; activeCodes?: { ecu: Exclude<EcuKey, 'tool'>; spn: number; fmi: number }[] };
}

export function loadScenario(raw: unknown): Scenario {
  const s = raw as Scenario;
  const bad = (m: string) => {
    throw new Error(`Scenario ${s && (s as Scenario).id ? `"${s.id}" ` : ''}is invalid: ${m}`);
  };
  if (!s || typeof s !== 'object') bad('not an object');
  if (typeof s.id !== 'string' || !s.id) bad('missing id');
  if (typeof s.title !== 'string') bad('missing title');
  for (const f of s.faults ?? []) {
    try {
      parsePart(f.part);
    } catch (e) {
      bad((e as Error).message);
    }
    if (!['open', 'shortToGround', 'shortToPower', 'shortToWire', 'addedOhms', 'leak', 'stuck', 'drift', 'damaged'].includes(f.kind)) bad(`unknown fault kind "${f.kind}"`);
  }
  for (const p of s.presets ?? []) if (!PRESETS[`${p.cid}/${p.key}`]) bad(`unknown preset ${p.cid}/${p.key}`);
  return s;
}
