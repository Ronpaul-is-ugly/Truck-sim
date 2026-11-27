// Smart NOx sensors: powered through their own fused feed, they measure NOx and report it on the
// aftertreatment CAN sub-network (AT1IG1 / AT1OG1). They are physical devices, so they see their own element's condition.
import type { System, SimContext } from '../system';
import type { MessageBus } from '../j1939/bus';
import { le16 } from '../j1939/frames';
import { NOX_IDS } from '../modules/acm';

export class NoxSensors implements System {
  id = 'noxSensors';
  order = 350;
  constructor(private subnet: MessageBus) {}
  step(ctx: SimContext): void {
    this.subnet.now = ctx.timeMs;
    const s = ctx.state;
    if (s.key === 'off' || ctx.timeMs % 50 !== 0) return;
    for (const cid of ['noxin', 'noxout'] as const) {
      const el = ctx.electrical;
      const supply = el.volts(cid, 'c1d_pwr') - el.volts(cid, 'c1d_gnd');
      if (supply < 9) continue;
      const elem = ctx.faults.at(`${cid}.sensor`)[0];
      const gain = elem?.kind === 'drift' ? elem.value ?? 1 : 1;
      const ppm = (cid === 'noxin' ? s.noxInPpm : s.noxOutPpm) * gain;
      const id = NOX_IDS[cid];
      this.subnet.publish({ id, sa: id & 255, pgn: (id >> 8) & 0xffff, acr: cid === 'noxin' ? 'AT1IG1' : 'AT1OG1', name: 'NOx sensor', period: 50,
        bytes: [...le16(Math.round((ppm + 200) / 0.05)), 0xff, 0xff, 0x55, elem?.kind === 'damaged' ? 12 : 0x1f, 0xff, 0xff] });
    }
  }
}
