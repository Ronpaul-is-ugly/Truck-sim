# Truck-sim

Simulators for learning and diagnosing medium and heavy trucks. Every module runs on one shared engine, so it is always the same truck:
the J1939 network and fault code simulator, and the air brake simulator (the **Air brakes** tab).

## Air brakes

`src/engine/physics/airbrakes.ts` is a pressure/flow solver that replaced the old fixed air supply (System id `air`):
gear-driven compressor (output follows engine rpm), governor, air dryer and purge, supply/primary/secondary tanks with check valves,
dual-circuit foot valve, rear relay valve, Type 20 front and Type 30/30 rear chambers with pushrod stroke, spring brakes and the park control valve.

How it ties into the rest of the truck:

- Tank pressures feed the cluster's existing primary/secondary pressure sensors, so a real leak shows on the dash gauges, lights the low-air
  lamp and sets SPN 117/118 FMI 1. The cluster now broadcasts AIR1 (PGN 65198, SPN 1087/1088); the ECM's CCVS carries the parking brake switch
  (SPN 70) and brake switch (SPN 597); the ABS EBC1 carries the real brake pedal position (SPN 521). The scan tool shows all of them as live data.
- Braking effort sets the vehicle's deceleration. A brake out of adjustment stops the truck slower; applied spring brakes keep it from moving.
- New actions: `setBrakePedal`, `setParkBrake`, `airCheck` (master gauge, listen, soap test, drain tanks, pushrod stroke). All logged and replayable.

`src/engine/data/airbrakes.ts` holds the standard air brake check (build-up, governor, static and applied leak-down, low-air warning,
park valve pop-out, pushrod stroke) with specs, and 14 mystery faults, each a part modifier (`mech.airPrimary leak`, `mech.governor stuck`,
`mech.slack.lr drift`…). `tests/air-brakes.test.ts` runs each check on a healthy truck and shows each fault failing the check that should catch it.

## J1939 Network & Fault Code Simulator (v6)

The simulator 5.5 single-file app, split into a TypeScript + Vite project around a **headless simulation engine**.
The UI looks and behaves like 5.5, but it no longer simulates anything itself: it reads the engine and sends it actions.

```bash
npm install
npm run dev        # the simulator in the browser
npm test           # Vitest: known-good values, fault detection, J1939 encoding, replay, layering
npm run build      # type-check + production build in dist/
```

`original/` holds the 5.5 file the tables and physics were taken from.

## Layout

```
src/engine/            no DOM, no wall clock, no unseeded randomness
  state.ts             TruckState: the one object holding key, rpm, speed, load, temperatures, battery, air…
  clock.ts, rng.ts     fixed 10 ms step; seeded mulberry32
  system.ts            System interface (powertrain, air, electrical, NOx sensors, network are all Systems)
  faults.ts            fault modifiers on parts
  presets.ts           every 5.5 catalog fault as part modifiers; 3D-job faults → modifiers
  electrical/          nodal solver + harness netlists (types A–H, CAN backbone, shared 5 V supplies)
  physics/             powertrain (5.5 values()/stepVehicle()), air brakes (pressure/flow solver)
  modules/             ECM, TCM, ABS, ACM, cluster: limit checks, debounce, DTC memory, DM1/DM2/DM4, PGNs
  devices/nox.ts       smart NOx sensors on the aftertreatment sub-network
  j1939/               frames, BAM transport, bus, CAN bit layout
  tools/               multimeter + amp clamp, scan tool (they import neither faults nor presets)
  scenario.ts, actions.ts, replay.ts, scoring.ts
  data/                catalog.ts, mechanical.ts: extracted verbatim from 5.5
src/ui/                5.5 markup/CSS/UI script, rewired to the engine; three r128 from npm
scenarios/*.json       example scenarios (each is also a test)
tests/                 Vitest
public/models/         the MX-13-style engine model, unpacked from the inline base64
```

## How a fault becomes a code

1. A **fault** is a modifier on a part: `{ part: 'ect.sig@s1', kind: 'open' }`.
   Kinds: `open`, `shortToGround`, `shortToPower`, `shortToWire` (to the 5 V ref, CAN-L…), `addedOhms`
   (also a restriction in a fluid path), `leak`, `stuck`, `drift` (sensor gain), `damaged`.
   Any fault can be `intermittent: { dutyPct, meanOnMs }`; wiggling a section or connector makes it worse.
   Part addresses: `cid.wire@sN` (harness section N), `cid.wire@cN` (connector N terminal), `cid.component`,
   `cid.sensor`, `cid.fuse`, `mech.*` (coolant, lube, thermostat, vgt, airPrimary…), `can.termL|termR|stub.tcm|H|L`.
2. The **harness netlist** for the circuit changes. The solver gives node voltages; physics changes truck state for `mech.*` parts.
3. Each **control module** samples its pins every 100 ms and applies the 5.5 limits
   (3-wire 0.25/4.75 V, thermistor 0.15/4.85 V, sender 0.05/4.8 V, supply 4.5–5.5 V…).
   A condition present for 1.5 s becomes an active DTC with a freeze frame; when it clears, the DTC moves to DM2.
   Five valid/invalid flips in 10 s make it FMI 2 (FMI 8 on wheel sensors).
4. The module broadcasts DM1 (BAM when there are 2 or more codes), sends 0xFE error indicators and changes its commands
   (derate, limp, held gear, ABS off). Physics reads those commands.
5. The **scan tool** knows only what it reads off the bus. The **meter** knows only what the solver says.

The test `catalog presets reproduce every catalog FMI` injects every fault in the 5.5 catalog (about 150)
and checks that the module reaches the catalog's SPN/FMI on its own.

## Scenarios, the action log and replay

```ts
const sc = loadScenario(json);                 // seed, starting truck, faults or presets, answer key
const e = new SimEngine({ scenario: sc });
e.dispatch({ type: 'unplug', circuit: 'ect', connector: 1 });
e.meter.probe({ circuit: 'ect', red: 'c1u_sig', black: 'gnd', mode: 'dcv' });
e.scan.requestDM2();
e.dispatch({ type: 'submitDiagnosis', circuit: 'ect', location: 's1', kind: 'open', wire: 'sig' });
e.log.toJSON();                                 // every action with its sim time, actor and result
replay(sc, log).mismatches;                     // [] if the run reproduces exactly
scoreLog(sc, log);                              // 5.5 rules: location 50 / type 35 / wire 15, labor penalty
```

In the browser, `window.simEngine.log.entries` holds the current session's log.

## Adding a system

```ts
const airBrakes: System = {
  id: 'airBrakes', order: 200,
  step(ctx) { /* solve pressures/flows from ctx.faults (leak, addedOhms = restriction, stuck valve…) */
              ctx.state.airPrimaryPsi = /* … */; },
};
new SimEngine({ systems: [airBrakes], replaceSystems: ['air'] });
```

Systems run in `order` every step and get the state, the seeded RNG, the faults, the electrical system, the bus and the module commands.

## Where behavior differs from 5.5

5.5 set codes straight from the fault table. Here the modules detect them from the circuit, which changes a few things:

- **Shared 5 V supplies are physical.** A short on one sensor's 5 V reference pulls down the whole supply. A current-limited regulator gives the 0.1 V that 5.5's text describes. The ECM sets 3509/3510 and suppresses the per-sensor codes, as 5.5 did.
- **3D harness jobs only use faults the truck can detect.** For example, 2.5 kΩ in series with a 100 kΩ signal input barely moves the reading, so it sets no code. Before a job starts, the UI dry-runs it on a scratch engine and re-rolls it if no code sets.
- **Intermittent faults happen on their own** (and more often while wiggled), so the module sees the dropouts and sets FMI 2.
- **One 3-wire sensor model for every level.** Powered, the output drives the signal through 200 Ω (bench values). Unpowered, the signal floats toward the reference through 2 kΩ (3D values). Wheel and OSS AC output scales with road speed, as in the 3D levels.
- **Real conditions are physics.** A coolant leak gives 112 °C and the ECM limit check sets 110/0. A stuck VGT gives 2795/7 from commanded-versus-actual position. A low DEF tank or a sooted DPF is a *condition*, not a broken part.
- **Code clearing (DM11/DM3) goes over the bus.** Codes whose fault is still present re-detect after 1.5 s, as before.
- **Cluster gauges, lamps and messages** come from the frames the cluster actually receives (including every module's DM1), not from internal flags.
- **Fuel level "float stuck" (96/2)** is a plausibility check: about 4 L burned with no sender movement. At cruise that takes about 7 minutes of sim time.
- **Thresholds 5.5 never stated** (battery 12.0 / 15.5 V at the ECM pin, oil < 100 kPa, coolant 102/110 °C, ±10 % actuator error, NOx > 2× model…) were chosen so that each catalog fault lands on its catalog FMI and a healthy truck sets nothing. They are in `src/engine/modules/*.ts`.

## Not done yet

- `src/ui/app.ts` is the 5.5 UI code with `// @ts-nocheck`. It works and is wired to the engine, but it is not typed yet.
- The 3D route geometry (`HROUTES`) stays in the UI; only route topology goes to the engine.
