// Commands the control modules put out. Physics reads these (the ECM limits speed, the TCM holds a gear…).
export interface EcmOutputs {
  speedCapMph: number;
  limp: boolean;
  protect: boolean;
  powerLoss: boolean;
  /** Which position signal the ECM is timing the engine from. 'none' = no sync, no fuel. */
  sync: 'crank' | 'cam' | 'none';
  /** Injector drivers that can fire (an open coil cannot; a shorted one is switched off). */
  injectorFiring: boolean[];
}
export interface TcmOutputs {
  holdGear: boolean;
}
export interface AbsOutputs {
  absEnabled: boolean;
}
export interface AcmOutputs {
  inducementCapMph: number;
  regenActiveSinceMs: number | null;
  dpfPlugged: boolean;
}
export interface ModuleOutputs {
  ecm: EcmOutputs;
  tcm: TcmOutputs;
  abs: AbsOutputs;
  acm: AcmOutputs;
}

export function defaultOutputs(): ModuleOutputs {
  return {
    ecm: { speedCapMph: 75, limp: false, protect: false, powerLoss: false, sync: 'crank', injectorFiring: [true, true, true, true, true, true] },
    tcm: { holdGear: false },
    abs: { absEnabled: true },
    acm: { inducementCapMph: 999, regenActiveSinceMs: null, dpfPlugged: false },
  };
}
