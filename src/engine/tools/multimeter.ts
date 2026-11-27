// Digital multimeter and amp clamp. They only ask the electrical system for voltages and resistances;
// they have no idea what fault (if any) is in the circuit. Logic and wording ported from 5.5 measure()/hClampAmps().
import { resistance, solve, type Element } from '../electrical/solver';
import { ohmNetlist, type Electrical } from '../electrical/electrical';
import { circuitType, ROUTE_3D } from '../electrical/harness';
import type { TruckState } from '../state';
import type { ModuleOutputs } from '../modules/outputs';

export type MeterMode = 'dcv' | 'acv' | 'ohm';
export interface MeterRequest {
  circuit: string;
  red: string;
  black: string;
  mode: MeterMode;
  /** Bench assumption in 5.5 level 1: for ohms the module connector is unplugged too. */
  isolateModule?: boolean;
}
export interface MeterReading {
  text: string;
  value: number | null;
  warn?: string;
  note?: string;
}
export interface ClampRequest {
  circuit: string;
  seg: number;
  /** One wire, or every wire in the loom. */
  wire: string | 'all';
  mode: 'dc' | 'ac';
}
export interface MeterHost {
  electrical: Electrical;
  state: () => TruckState;
  outputs: ModuleOutputs;
  log: (type: string, args: unknown, result: unknown) => void;
}

export function formatOhms(r: number): string {
  if (r > 20e6) return 'OL';
  return r < 1000 ? r.toFixed(r < 10 ? 2 : 1) + ' Ω' : r < 1e6 ? (r / 1000).toFixed(2) + ' kΩ' : (r / 1e6).toFixed(2) + ' MΩ';
}

export class Multimeter {
  constructor(private host: MeterHost) {}

  /** Read the meter (no side effects; the UI calls this continuously). */
  measure(req: MeterRequest, reference = false): MeterReading {
    const { circuit: cid, mode } = req;
    const t = circuitType(cid);
    const key = this.host.state().key;
    const el = this.host.electrical;
    if (!req.red || !req.black) return { text: '- - - -', value: null };
    if (t === 'D' && key === 'run' && mode !== 'ohm')
      return { text: '- - - -', value: null, warn: "Safety: injector circuits carry high-voltage pulses while running (some systems well above 48 V). Don't probe them with the engine running; use a current clamp and a scope." };
    if (mode === 'ohm' && key !== 'off' && t !== 'E')
      return { text: 'Err', value: null, warn: 'Turn the key OFF before measuring resistance. Ohms on a powered circuit gives false readings.' };
    const red = el.node(cid, req.red), black = el.node(cid, req.black);
    if (mode === 'ohm') {
      const note =
        t === 'E' ? 'Resistance on power circuits is measured with the battery disconnected (assumed here). A voltage-drop test with the circuit loaded is usually the better test.'
        : t === 'F' || t === 'G' || !req.isolateModule ? undefined
        : "For resistance checks the module connector is assumed unplugged too, so the module's internal circuits don't affect the reading.";
      if (red === black) return { text: '0.1 Ω', value: 0.1, note };
      const els = ohmNetlist(el.netlist(cid, reference), !!req.isolateModule);
      const r = resistance(els, red, black) + 0.1;
      if (r > 20e6) return { text: 'OL', value: Infinity, note };
      return { text: formatOhms(r), value: r, note };
    }
    const V = el.solveMode(cid, mode === 'acv' ? 'ac' : 'dc', reference, [{ t: 'R', a: red, b: black, r: 10e6 }]);
    let d = V(red) - V(black);
    if (mode === 'acv') {
      d = Math.abs(d);
      return { text: d.toFixed(2) + ' V~', value: d };
    }
    if (Math.abs(d) < 0.005) d = 0;
    return { text: (Math.abs(d) < 10 ? d.toFixed(2) : d.toFixed(1)) + ' V', value: d };
  }

  /** A student placing the leads: measured and recorded in the action log. */
  probe(req: MeterRequest): MeterReading {
    const r = this.measure(req);
    this.host.log('meter.probe', req, r.text);
    return r;
  }

  /** Amp clamp around one wire or the whole loom in a harness section. */
  clamp(req: ClampRequest): number | null {
    const el = this.host.electrical;
    const cid = req.circuit;
    const t = circuitType(cid);
    const wires = req.wire === 'all' ? el.wires(cid) : [req.wire];
    const s = this.host.state();
    if (t === 'D') {
      const run = s.key === 'run' && s.running;
      if (!run) return 0;
      const r = el.ohms(cid, el.node(cid, 'c0u_hi'), el.node(cid, 'c0u_lo'), false);
      const i = Number(cid.replace('inj', '')) - 1;
      const pulsing = r < 5 && this.host.outputs.ecm.injectorFiring[i];
      const I = pulsing ? (req.mode === 'dc' ? 0.62 : 2.4) : 0;
      let sum = 0;
      for (const w of wires) sum += w === 'hi' ? I : req.mode === 'dc' ? -I : I;
      if (req.wire === 'all' && req.mode === 'ac') sum = 0;
      return sum;
    }
    const segR = (el.route(cid).segOhms ?? ROUTE_3D.segOhms!)[1];
    const V = el.solveMode(cid, req.mode === 'ac' ? 'ac' : 'dc');
    let sum = 0;
    for (const w of wires) sum += (V(el.node(cid, `s${req.seg}a_${w}`)) - V(el.node(cid, `s${req.seg}_${w}`))) / segR;
    return req.mode === 'ac' ? Math.abs(sum) : sum;
  }
  clampProbe(req: ClampRequest): number | null {
    const a = this.clamp(req);
    this.host.log('meter.clamp', req, a);
    return a;
  }
}
export type { Element };
export { solve };
