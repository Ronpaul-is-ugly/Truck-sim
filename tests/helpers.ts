import { SimEngine, type EngineOptions } from '../src/engine';

/** Fresh engine with the simulator 5.5 defaults (key RUN, 62 mph, loaded, dry road). */
export function engine(opts: EngineOptions = {}): SimEngine {
  return new SimEngine({ seed: 1939, ...opts });
}

/** Engine with the key in a given position and the truck parked (no road speed). */
export function parked(key: 'off' | 'on' | 'run', opts: EngineOptions = {}): SimEngine {
  const e = engine({ ...opts, initial: { key, driver: { setMph: 0 }, speedMph: 0 } });
  e.run(200);
  return e;
}

export const codes = (e: SimEngine, ecu: 'ecm' | 'acm' | 'tcm' | 'abs' | 'clu', status: 'active' | 'pending' | 'previous' = 'active') =>
  e.module(ecu).dtcs(status).map((d) => `${d.spn}/${d.fmi}`);
