// Diagnostic trouble code memory in a control module: pending → active (after the debounce) → previously active.
import type { FreezeFrame } from './freeze';

export const DEBOUNCE_MS = 1500; // 5.5: "detection: pending → active after 1.5 s"

export interface Condition {
  spn: number;
  fmi: number;
  cid: string;
  lamps: string;
}
export interface Dtc extends Condition {
  status: 'pending' | 'active' | 'previous';
  oc: number;
  /** Time the condition has been present while the module was awake. */
  presentMs: number;
  setAtMs?: number;
  freezeFrame?: FreezeFrame;
}
const k = (spn: number, fmi: number) => `${spn}/${fmi}`;

export class DtcMemory {
  private current = new Map<string, Dtc>();
  private prev = new Map<string, Dtc>();

  /** Called once per diagnostic sample while awake, with every condition present right now. */
  update(present: Condition[], dtMs: number, now: number, snapshot: () => FreezeFrame): void {
    const seen = new Set<string>();
    for (const c of present) {
      const key = k(c.spn, c.fmi);
      seen.add(key);
      let d = this.current.get(key);
      if (!d) {
        d = { ...c, status: 'pending', oc: 0, presentMs: 0 };
        this.current.set(key, d);
      }
      d.presentMs += dtMs;
      if (d.status === 'pending' && d.presentMs >= DEBOUNCE_MS) {
        d.status = 'active';
        d.oc = d.oc || (this.prev.get(key)?.oc ?? 0) + 1;
        d.setAtMs = now;
        d.freezeFrame = snapshot();
      }
    }
    for (const [key, d] of this.current) {
      if (seen.has(key)) continue;
      this.current.delete(key);
      if (d.status === 'active') this.prev.set(key, { ...d, status: 'previous' });
    }
  }
  list(status: Dtc['status']): Dtc[] {
    if (status === 'previous') return [...this.prev.values()];
    return [...this.current.values()].filter((d) => d.status === status);
  }
  /** DM11 + DM3: inactive codes erased; active codes go back to pending and must be detected again. */
  clear(): void {
    this.prev.clear();
    for (const d of this.current.values()) {
      d.status = 'pending';
      d.presentMs = 0;
    }
  }
  reset(): void {
    this.current.clear();
    this.prev.clear();
  }
}
