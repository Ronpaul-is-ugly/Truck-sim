/** Fixed-step clock: real elapsed time goes in, whole simulation steps come out. */
export class FixedStepClock {
  private acc = 0;
  constructor(readonly stepMs = 10) {}
  /** Feed real (or scaled) elapsed time; calls step() once per whole step. Returns steps taken. */
  advance(ms: number, step: () => void): number {
    this.acc += ms;
    let n = 0;
    while (this.acc >= this.stepMs - 1e-9) {
      this.acc -= this.stepMs;
      step();
      n++;
    }
    return n;
  }
  reset(): void {
    this.acc = 0;
  }
}
