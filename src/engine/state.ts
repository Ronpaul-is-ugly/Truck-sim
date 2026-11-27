// The single truck state object. Systems write it; everything else reads it. Nothing keeps its own copy.
export type KeyPos = 'off' | 'on' | 'run';
export type LoadCase = 'bobtail' | 'loaded' | 'grade';
export type Road = 'dry' | 'wet' | 'ice';
export type DpfLoading = 'normal' | 'soot' | 'plugged';

export interface DriverInputs {
  setMph: number;
  load: LoadCase;
  road: Road;
  brake: boolean;
}

/** Real-world conditions that are not faults (a nearly empty DEF tank is not a broken part). */
export interface Conditions {
  defLevelPct: number;
  dpf: DpfLoading;
  ambientC: number;
  fuelTankL: number;
  fuelStartPct: number;
}

export interface TruckState {
  timeMs: number;
  key: KeyPos;
  driver: DriverInputs;
  conditions: Conditions;
  running: boolean;
  stalled: boolean;
  rpm: number;
  speedMph: number;
  accelerating: boolean;
  /** Engine load 0–1 (the original's loadF). */
  load: number;
  pedalPct: number;
  gear: number;
  gearRatio: number;
  heldGear: number | null;
  ossRpm: number;
  issRpm: number;
  boostKpa: number;
  mafKgh: number;
  oilKpa: number;
  coolantC: number;
  intakeTempC: number;
  railMpa: number;
  throttlePct: number;
  egrPct: number;
  vgtPct: number;
  fuelRateLph: number;
  fuelUsedL: number;
  kmpl: number;
  batteryV: number;
  defLevelPct: number;
  dpfDeltaPKpa: number;
  noxInPpm: number;
  noxOutPpm: number;
  transOilC: number;
  airPrimaryPsi: number;
  airSecondaryPsi: number;
  ambientC: number;
  defTempC: number;
  fuelLevelPct: number;
  wheelsKmh: number[];
  braking: boolean;
  absActive: boolean;
  lockup: boolean;
  /** 1 = full contribution, 0 = dead cylinder. */
  cylinderContribution: number[];
  /** Teeth missing from each speed sensor's pulse train (damaged tone wheel / ring). */
  pulseDropouts: Record<string, number>;
  /** Cam signal position error versus the crank reference, in crank degrees. */
  camPhaseErrorDeg: number;
}

export interface InitialState {
  key?: KeyPos;
  speedMph?: number;
  driver?: Partial<DriverInputs>;
  conditions?: Partial<Conditions>;
}

export const DEFAULT_CONDITIONS: Conditions = { defLevelPct: 65, dpf: 'normal', ambientC: 18, fuelTankL: 568, fuelStartPct: 70 };

/** Simulator 5.5 start-up: key RUN, 62 mph, loaded, dry road. */
export function createTruckState(init: InitialState = {}): TruckState {
  const driver: DriverInputs = { setMph: 62, load: 'loaded', road: 'dry', brake: false, ...init.driver };
  const conditions: Conditions = { ...DEFAULT_CONDITIONS, ...init.conditions };
  return {
    timeMs: 0,
    key: init.key ?? 'run',
    driver,
    conditions,
    running: false,
    stalled: false,
    rpm: 0,
    speedMph: init.speedMph ?? driver.setMph,
    accelerating: false,
    load: 0,
    pedalPct: 0,
    gear: 0,
    gearRatio: 0,
    heldGear: null,
    ossRpm: 0,
    issRpm: 0,
    boostKpa: 0,
    mafKgh: 0,
    oilKpa: 0,
    coolantC: 86,
    intakeTempC: 38,
    railMpa: 0,
    throttlePct: 100,
    egrPct: 0,
    vgtPct: 0,
    fuelRateLph: 0,
    fuelUsedL: 0,
    kmpl: 0,
    batteryV: 12.6,
    defLevelPct: conditions.defLevelPct,
    dpfDeltaPKpa: 0,
    noxInPpm: 0,
    noxOutPpm: 0,
    transOilC: 70,
    airPrimaryPsi: 112,
    airSecondaryPsi: 112,
    ambientC: conditions.ambientC,
    defTempC: 22,
    fuelLevelPct: conditions.fuelStartPct,
    wheelsKmh: [0, 0, 0, 0],
    braking: false,
    absActive: false,
    lockup: false,
    cylinderContribution: [1, 1, 1, 1, 1, 1],
    pulseDropouts: {},
    camPhaseErrorDeg: 0,
  };
}
