// The J1939 message bus. Modules publish frames; whether a frame reaches anyone depends on the
// backbone's electrical health (solved by the electrical system) and on each node's stub.
import { frameBits } from './bits';
import type { Frame } from './frames';
import type { BusHealth } from '../electrical/electrical';

export interface TimedFrame extends Frame { t: number }
export interface MonitorRow extends TimedFrame { key: string; count: number; delivered: boolean; firstT: number }
type Listener = (f: TimedFrame) => void;

export const monKey = (f: Frame) => f.id.toString(16) + (f.seq ? '-' + f.seq : '');

export class MessageBus {
  health: BusHealth = 'ok';
  /** Node attached to the backbone (stub intact), by source address. */
  attached: (sa: number) => boolean = () => true;
  private subs: { sa: number | null; fn: Listener }[] = [];
  private last = new Map<string, MonitorRow>();
  private lastDelivered = new Map<string, TimedFrame>();
  private bitLog: { t: number; bits: number }[] = [];
  frameCount = 0;
  now = 0;

  /** Subscribe as a node (receives only while attached and the bus is healthy). sa null = a passive listener on the 9-pin. */
  subscribe(sa: number | null, fn: Listener): () => void {
    const s = { sa, fn };
    this.subs.push(s);
    return () => (this.subs = this.subs.filter((x) => x !== s));
  }

  get carrying(): boolean {
    return this.health === 'ok';
  }

  publish(f: Frame): boolean {
    const t = this.now;
    const tf: TimedFrame = { ...f, t };
    const delivered = this.carrying && this.attached(f.sa);
    const k = monKey(f);
    const prev = this.last.get(k);
    this.last.set(k, { ...tf, key: k, count: (prev?.count ?? 0) + (delivered ? 1 : 0), delivered, firstT: prev?.firstT ?? t });
    if (!delivered) return false;
    this.frameCount++;
    this.lastDelivered.set(k, tf);
    this.bitLog.push({ t, bits: frameBits(f.id, f.bytes) });
    for (const s of this.subs) if (s.sa === null || s.sa === f.sa || this.attached(s.sa)) s.fn(tf);
    return true;
  }

  /** Last frame with this ID that actually went out on the bus. */
  latest(id: number, seq?: number): TimedFrame | undefined {
    return this.lastDelivered.get(id.toString(16) + (seq ? '-' + seq : ''));
  }
  /** Every ID seen, for the bus monitor. */
  rows(): MonitorRow[] {
    return [...this.last.values()];
  }
  /** Bus load over the last second, percent of 250 kbit/s. */
  loadPct(): number {
    const t0 = this.now - 1000;
    while (this.bitLog.length && this.bitLog[0].t < t0) this.bitLog.shift();
    return (this.bitLog.reduce((a, b) => a + b.bits, 0) / 250000) * 100;
  }
  clearHistory(): void {
    this.last.clear();
    this.lastDelivered.clear();
    this.bitLog = [];
  }
}
