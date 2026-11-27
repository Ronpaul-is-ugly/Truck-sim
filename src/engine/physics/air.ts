// Air supply, as simple as in simulator 5.5: governed tank pressures, or 55 psi with a leak.
// Replace this System (id 'air') with a pressure/flow solver to build the air-brake module.
import type { System, SimContext } from '../system';

export class AirSupplySystem implements System {
  id = 'air';
  order = 200;
  step(ctx: SimContext): void {
    const s = ctx.state;
    const base = (run: number) => (s.key === 'run' ? run : 112);
    s.airPrimaryPsi = ctx.faults.has('mech.airPrimary', 'leak') ? 55 : base(118);
    s.airSecondaryPsi = ctx.faults.has('mech.airSecondary', 'leak') ? 55 : base(120);
  }
}
