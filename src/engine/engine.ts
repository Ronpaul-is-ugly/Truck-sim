// SimEngine: one truck. Owns the state, the fixed-step clock, the seeded RNG, the systems,
// the fault modifiers, the J1939 bus, the control modules, the tools and the action log.
import { FixedStepClock } from './clock';
import { Rng } from './rng';
import { createTruckState, type InitialState, type TruckState, type Conditions } from './state';
import { FaultSet, type Wiggle } from './faults';
import type { System, SimContext } from './system';
import { Electrical } from './electrical/electrical';
import { MessageBus } from './j1939/bus';
import { PowertrainSystem, computeVehicle } from './physics/powertrain';
import { AirBrakeSystem, airInspect, canReleasePark } from './physics/airbrakes';
import { NoxSensors } from './devices/nox';
import { defaultOutputs, type ModuleOutputs } from './modules/outputs';
import { Ecm } from './modules/ecm';
import { Tcm } from './modules/tcm';
import { Abs } from './modules/abs';
import { Acm } from './modules/acm';
import { Cluster } from './modules/cluster';
import type { ControlModule, ModuleEnv } from './modules/module';
import { Multimeter } from './tools/multimeter';
import { ScanTool } from './tools/scantool';
import { ActionLog, type Action, type ActionResult } from './actions';
import { PRESETS, harnessFaultSpecs, type HarnessFault } from './presets';
import type { Scenario } from './scenario';
import { scoreDiagnosis } from './scoring';
import { SA2ECU } from './data/catalog';
import { MCHK, MFAULT, mechKey } from './data/mechanical';

export interface EngineOptions {
  seed?: number;
  scenario?: Scenario;
  initial?: InitialState;
  stepMs?: number;
  /** Extra systems (for example an air-brake pressure/flow solver). */
  systems?: System[];
  /** Ids of built-in systems to drop when yours replaces them (e.g. 'air'). */
  replaceSystems?: string[];
}

type ModuleMap = { ecm: Ecm; tcm: Tcm; abs: Abs; acm: Acm; clu: Cluster };

export class SimEngine {
  readonly state: TruckState;
  readonly rng: Rng;
  readonly faults = new FaultSet();
  readonly outputs: ModuleOutputs = defaultOutputs();
  readonly electrical: Electrical;
  readonly bus = new MessageBus();
  /** Aftertreatment CAN sub-network (NOx sensors ↔ ACM). */
  readonly subnet = new MessageBus();
  readonly modules: ModuleMap;
  readonly meter: Multimeter;
  readonly scan: ScanTool;
  readonly log = new ActionLog();
  readonly clock: FixedStepClock;
  readonly scenario?: Scenario;
  private systems: System[];
  private t = 0;
  private wiggles: Wiggle[] = [];
  private presetFaults = new Map<string, { key: string; ids: string[]; restore?: Partial<Conditions> }>();
  private refCache: { t: number; s: TruckState } | null = null;
  private ctx: SimContext;

  constructor(opts: EngineOptions = {}) {
    const sc = opts.scenario;
    this.scenario = sc;
    this.rng = new Rng(opts.seed ?? sc?.seed ?? 1);
    this.clock = new FixedStepClock(opts.stepMs ?? 10);
    const init: InitialState = {
      ...sc?.initial,
      ...opts.initial,
      driver: { ...sc?.initial?.driver, ...opts.initial?.driver },
      conditions: { ...sc?.initial?.conditions, ...opts.initial?.conditions },
    };
    this.state = createTruckState(init);
    this.electrical = new Electrical({ state: () => this.state, faults: () => this.faults, referenceState: () => this.referenceState() });
    const env: ModuleEnv = { electrical: this.electrical, bus: this.bus, state: () => this.state, outputs: this.outputs, rng: this.rng, now: () => this.t };
    this.modules = { ecm: new Ecm(env), tcm: new Tcm(env), abs: new Abs(env), acm: new Acm(env, this.subnet), clu: new Cluster(env) };
    this.meter = new Multimeter({ electrical: this.electrical, state: () => this.state, outputs: this.outputs, log: (ty, a, r) => this.log.add(this.t, ty, a, r) });
    this.scan = new ScanTool({ bus: this.bus, now: () => this.t, log: (ty, a, r) => this.log.add(this.t, ty, a, r) });

    const builtIn: System[] = [
      new PowertrainSystem(),
      new AirBrakeSystem(),
      { id: 'electrical', order: 300, step: () => this.electricalStep() },
      new NoxSensors(this.subnet),
      { id: 'network', order: 400, step: (c) => this.networkStep(c) },
    ];
    const drop = new Set(opts.replaceSystems ?? []);
    this.systems = [...builtIn.filter((s) => !drop.has(s.id)), ...(opts.systems ?? [])].sort((a, b) => (a.order ?? 250) - (b.order ?? 250));
    this.ctx = { timeMs: 0, dtMs: this.clock.stepMs, state: this.state, rng: this.rng, faults: this.faults, electrical: this.electrical, bus: this.bus, outputs: this.outputs };

    // scenario setup is not a student action
    this.log.muted = true;
    for (const [cid, r] of Object.entries(sc?.routes ?? {})) this.electrical.harness.routes.set(cid, r);
    for (const f of sc?.faults ?? []) this.faults.add(f);
    for (const p of sc?.presets ?? []) this.dispatch({ type: 'applyPreset', cid: p.cid, key: p.key });
    this.log.muted = false;
    computeVehicle(this.state, this.faults, this.outputs, () => 0);
    for (const s of this.systems) s.init?.(this.ctx);
  }

  get timeMs(): number {
    return this.t;
  }

  module<K extends keyof ModuleMap>(ecu: K): ModuleMap[K] {
    return this.modules[ecu];
  }
  moduleBySa(sa: number): ControlModule | undefined {
    return this.modules[SA2ECU[sa] as keyof ModuleMap];
  }

  // ---------- clock ----------
  stepOnce(): void {
    const dt = this.clock.stepMs;
    this.ctx.timeMs = this.t;
    this.faults.step(dt, this.rng, this.wiggles, this.t);
    for (const s of this.systems) s.step(this.ctx);
    this.t += dt;
    this.state.timeMs = this.t;
  }
  /** Run a whole number of fixed steps covering `ms`. */
  run(ms: number): void {
    const n = Math.floor(ms / this.clock.stepMs + 1e-9);
    for (let i = 0; i < n; i++) this.stepOnce();
  }
  /** Run until simulation time reaches `t`. */
  runTo(t: number): void {
    while (this.t < t) this.stepOnce();
  }
  /** Feed real elapsed time (any size); runs as many fixed steps as fit. */
  advance(ms: number): number {
    return this.clock.advance(ms, () => this.stepOnce());
  }

  private electricalStep(): void {
    this.electrical.invalidate();
    this.refCache = null;
    const h = this.electrical.busHealth();
    this.bus.health = h.health;
    this.bus.attached = (sa) => h.attached[SA2ECU[sa]] ?? true;
    this.bus.now = this.t;
  }
  private networkStep(c: SimContext): void {
    for (const m of Object.values(this.modules)) m.step(c.timeMs, c.dtMs);
  }

  /** The same truck with nothing wrong, for "known-good" reference readings. */
  referenceState(): TruckState {
    if (this.refCache && this.refCache.t === this.t) return this.refCache.s;
    const s = structuredClone(this.state);
    s.conditions = { ...s.conditions, dpf: 'normal' };
    computeVehicle(s, null, defaultOutputs(), () => 0);
    this.refCache = { t: this.t, s };
    return s;
  }

  // ---------- actions ----------
  dispatch(a: Action): ActionResult {
    const r = this.apply(a);
    if (r.ok) this.log.add(this.t, a.type, a, r.text ?? r.faultId ?? r.faultIds);
    this.electrical.invalidate();
    return r;
  }

  private apply(a: Action): ActionResult {
    const s = this.state;
    const h = this.electrical.harness;
    switch (a.type) {
      case 'setKey':
        s.key = a.key;
        if (a.key !== 'run') s.driver.brake = false;
        return { ok: true };
      case 'setTargetSpeed':
        s.driver.setMph = a.mph;
        return { ok: true };
      case 'setLoad':
        s.driver.load = a.load;
        return { ok: true };
      case 'setRoad':
        s.driver.road = a.road;
        return { ok: true };
      case 'brake':
        if (s.key === 'run' && s.speedMph > 1) s.driver.brake = true;
        return { ok: true };
      case 'setBrakePedal':
        s.driver.brakePedalPct = Math.max(0, Math.min(100, a.pct));
        return { ok: true };
      case 'setParkBrake':
        if (!a.applied && !canReleasePark(s)) return { ok: true, text: 'The park knob won\'t stay in: there isn\'t enough air to hold the spring brakes off (it needs about 65 psi).' };
        s.driver.parkBrake = a.applied;
        if (!a.applied) s.air.parkPopped = false;
        return { ok: true };
      case 'airCheck':
        return { ok: true, text: airInspect(s, this.faults, a.check) };
      case 'unplug':
      case 'plug': {
        const set = h.unplugged.get(a.circuit) ?? new Set<number>();
        if (a.type === 'unplug') set.add(a.connector);
        else set.delete(a.connector);
        h.unplugged.set(a.circuit, set);
        return { ok: true };
      }
      case 'wiggle':
        this.wiggles = this.wiggles.filter((w) => w.untilMs > this.t);
        this.wiggles.push({ circuit: a.circuit, seg: a.seg, conn: a.connector, untilMs: this.t + (a.ms ?? 6000) });
        return { ok: true };
      case 'spinWheel':
        if (a.on) h.spinning.add(a.circuit);
        else h.spinning.delete(a.circuit);
        return { ok: true };
      case 'setTerminator':
        h.terminators[a.side] = a.installed;
        return { ok: true };
      case 'injectFault':
        return { ok: true, faultId: this.faults.add(a.fault, a.id) };
      case 'removeFault':
        return { ok: this.faults.remove(a.id) };
      case 'applyPreset': {
        const p = PRESETS[`${a.cid}/${a.key}`];
        if (!p) return { ok: false, error: `No preset ${a.cid}/${a.key}` };
        this.clearPreset(a.cid);
        const ids = p.faults.map((f) => this.faults.add(f));
        let restore: Partial<Conditions> | undefined;
        if (p.conditions) {
          restore = {};
          for (const k of Object.keys(p.conditions) as (keyof Conditions)[]) (restore as Record<string, unknown>)[k] = s.conditions[k];
          Object.assign(s.conditions, p.conditions);
        }
        this.presetFaults.set(a.cid, { key: a.key, ids, restore });
        return { ok: true, faultIds: ids };
      }
      case 'clearPreset':
        return { ok: this.clearPreset(a.cid) };
      case 'clearAllFaults':
        for (const cid of [...this.presetFaults.keys()]) this.clearPreset(cid);
        this.faults.clear();
        return { ok: true };
      case 'setCondition':
        Object.assign(s.conditions, a.conditions);
        return { ok: true };
      case 'setRoute':
        if (a.route) h.routes.set(a.circuit, a.route);
        else h.routes.delete(a.circuit);
        return { ok: true };
      case 'inspect':
        return { ok: true, text: this.inspect(a.circuit, a.check) };
      case 'labor':
        return { ok: true };
      case 'submitDiagnosis': {
        const sc = this.scenario;
        const text = sc?.answer ? JSON.stringify(scoreDiagnosis(sc, a, this.log.laborMinutes())) : undefined;
        return { ok: true, text };
      }
    }
  }

  private clearPreset(cid: string): boolean {
    const p = this.presetFaults.get(cid);
    if (!p) return false;
    p.ids.forEach((id) => this.faults.remove(id));
    if (p.restore) Object.assign(this.state.conditions, p.restore);
    this.presetFaults.delete(cid);
    return true;
  }
  /** Catalog preset currently applied to a component (instructor bench view). */
  presetOn(cid: string): string | null {
    return this.presetFaults.get(cid)?.key ?? null;
  }

  /** Put a 3D-level harness fault on a circuit; returns the fault ids. */
  injectHarnessFault(cid: string, hf: HarnessFault): string[] {
    const n = this.electrical.route(cid).nodes.length;
    return harnessFaultSpecs(cid, hf, n).map((f) => this.dispatch({ type: 'injectFault', fault: f }).faultId!);
  }

  /** Back to a good truck: no faults, harness restored, module memories and bus history erased. */
  resetTruck(): void {
    for (const cid of [...this.presetFaults.keys()]) this.clearPreset(cid);
    this.faults.clear();
    const h = this.electrical.harness;
    h.unplugged.clear();
    h.terminators.L = h.terminators.R = true;
    h.spinning.clear();
    this.wiggles = [];
    for (const m of Object.values(this.modules)) m.dtc.reset();
    this.bus.clearHistory();
    this.electrical.invalidate();
  }

  /** A mechanical check (5.5 MCHK): physically looking at, or gauging, the real part. */
  private inspect(cid: string, check: string): string {
    const mk = mechKey(cid);
    const c = MCHK[mk]?.find((x) => x[0] === check);
    if (!c) return 'No such check.';
    let t: string | undefined;
    for (const m of MFAULT[mk] ?? []) {
      const specs = harnessFaultSpecs(cid, { kind: 'mech', m: m.m }, 2);
      if (specs.length && specs.every((f) => this.faults.has(f.part, f.kind))) t = m.chk[check];
      if (t) break;
    }
    if (!t) {
      const ecu = (['ecm', 'tcm', 'abs', 'acm', 'clu'] as const).find((e) => this.modules[e].owns(cid));
      const invalid = ecu ? !this.modules[ecu].input(cid).valid : false;
      t = invalid ? c[4] ?? c[3] : c[3];
    }
    return t.replace(/\{n\}/g, cid.replace('inj', ''));
  }
}
