// DC nodal analysis (modified nodal analysis with voltage sources), ported from simulator 5.5 solve().
export type Element =
  | { t: 'R'; a: string; b: string; r: number; mod?: boolean; powerOnly?: boolean }
  | { t: 'V'; a: string; b: string; v: number; kind: 'sup' | 'ser' | 'ac' }
  | { t: 'I'; a: string; b: string; i: number };

export interface Injection {
  a: string;
  b: string;
  i: number;
}
export type Voltages = (node: string) => number;

/** Solve a netlist. 'gnd' is the reference node. Each node also gets a 1 nS leak to ground (as in 5.5). */
export function solve(els: Element[], inj?: Injection): Voltages {
  const idx = new Map<string, number>();
  const node = (n: string) => {
    if (n === 'gnd') return -1;
    let i = idx.get(n);
    if (i === undefined) {
      i = idx.size;
      idx.set(n, i);
    }
    return i;
  };
  for (const e of els) {
    node(e.a);
    node(e.b);
  }
  if (inj) {
    node(inj.a);
    node(inj.b);
  }
  const vs = els.filter((e): e is Extract<Element, { t: 'V' }> => e.t === 'V');
  const n = idx.size,
    m = vs.length,
    N = n + m;
  const A = Array.from({ length: N }, () => new Float64Array(N));
  const z = new Float64Array(N);
  const stamp = (i: number, j: number, g: number) => {
    if (i >= 0) A[i][i] += g;
    if (j >= 0) A[j][j] += g;
    if (i >= 0 && j >= 0) {
      A[i][j] -= g;
      A[j][i] -= g;
    }
  };
  for (const e of els) {
    if (e.t === 'R') stamp(node(e.a), node(e.b), 1 / e.r);
    else if (e.t === 'I') {
      const a = node(e.a),
        b = node(e.b);
      // current i flows from a through the source into b
      if (a >= 0) z[a] -= e.i;
      if (b >= 0) z[b] += e.i;
    }
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-9;
  vs.forEach((e, k) => {
    const a = node(e.a),
      b = node(e.b),
      r = n + k;
    if (a >= 0) {
      A[a][r] += 1;
      A[r][a] += 1;
    }
    if (b >= 0) {
      A[b][r] -= 1;
      A[r][b] -= 1;
    }
    z[r] = e.v;
  });
  if (inj) {
    const a = node(inj.a),
      b = node(inj.b);
    if (a >= 0) z[a] += inj.i;
    if (b >= 0) z[b] -= inj.i;
  }
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-20) continue;
    [A[c], A[p]] = [A[p], A[c]];
    [z[c], z[p]] = [z[p], z[c]];
    for (let r = c + 1; r < N; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < N; k++) A[r][k] -= f * A[c][k];
      z[r] -= f * z[c];
    }
  }
  const x = new Float64Array(N);
  for (let r = N - 1; r >= 0; r--) {
    let s = z[r];
    for (let k = r + 1; k < N; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-20 ? 0 : s / A[r][r];
  }
  return (nn) => {
    if (nn === 'gnd') return 0;
    const i = idx.get(nn);
    return i == null ? 0 : x[i];
  };
}

/** Resistance between two nodes: remove/zero sources, push 1 mA, read the voltage (as the meter did in 5.5). */
export function resistance(els: Element[], a: string, b: string): number {
  if (a === b) return 0;
  const V = solve(els, { a, b, i: 1e-3 });
  return (V(a) - V(b)) / 1e-3;
}
