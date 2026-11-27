/** Seeded pseudo-random generator (mulberry32). Every random draw in the engine comes from here. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Same as the original simulator's rnd(a): uniform in (−a/2, a/2). */
  spread(a: number): number {
    return (this.next() - 0.5) * a;
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  get seedState(): number {
    return this.s;
  }
}

/** Stateless noise for tools (meter jitter): same inputs give the same number, and the engine RNG is untouched. */
export function hashNoise(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return ((h >>> 0) % 1000000) / 1000000;
}
