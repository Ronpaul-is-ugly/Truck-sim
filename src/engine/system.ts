// The extension point. Every subsystem (powertrain, air supply, electrical network, control modules,
// the air brake pressure/flow solver…) is a System stepped by the fixed-step clock.
import type { Rng } from './rng';
import type { TruckState } from './state';
import type { FaultSet } from './faults';
import type { Electrical } from './electrical/electrical';
import type { MessageBus } from './j1939/bus';
import type { ModuleOutputs } from './modules/outputs';

export interface SimContext {
  /** Simulation time at the start of this step. */
  timeMs: number;
  dtMs: number;
  state: TruckState;
  rng: Rng;
  /** Physical parts and their modifiers. Physics systems may read these; tools and control modules must not. */
  faults: FaultSet;
  electrical: Electrical;
  bus: MessageBus;
  /** What the control modules are currently commanding (derates, held gear, ABS on/off…). */
  outputs: ModuleOutputs;
}

export interface System {
  /** Unique id. Built-ins: 'powertrain', 'air', 'electrical', 'network'. */
  id: string;
  /** Lower runs first. Built-ins use 100 (powertrain), 200 (air), 300 (electrical), 400 (network). Default 250. */
  order?: number;
  init?(ctx: SimContext): void;
  step(ctx: SimContext): void;
}
