// CAN 2.0B frame bit layout with CRC-15 and stuff bits (simulator 5.5 buildBits), for the scope and bus load.
export interface Bit { v: number; g: 'SOF' | 'ID' | 'CTL' | 'DATA' | 'CRC' | 'ACK' | 'EOF'; stuff?: 1 }
export function buildBits(id: number, bytes: number[]): Bit[] {
  const raw: Bit[] = [];
  const P = (v: number, g: Bit['g']) => raw.push({ v, g });
  P(0, 'SOF');
  for (let i = 28; i >= 18; i--) P((id >> i) & 1, 'ID');
  P(1, 'ID'); P(1, 'ID');
  for (let i = 17; i >= 0; i--) P((id >> i) & 1, 'ID');
  P(0, 'ID');
  P(0, 'CTL'); P(0, 'CTL');
  for (let i = 3; i >= 0; i--) P((bytes.length >> i) & 1, 'CTL');
  for (const b of bytes) for (let i = 7; i >= 0; i--) P((b >> i) & 1, 'DATA');
  let crc = 0;
  for (const r of raw) {
    const nx = r.v ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (nx) crc ^= 0x4599;
  }
  for (let i = 14; i >= 0; i--) P((crc >> i) & 1, 'CRC');
  const bits: Bit[] = [];
  let run = 0, prev = -1;
  for (const r of raw) {
    bits.push(r);
    if (r.v === prev) run++;
    else { run = 1; prev = r.v; }
    if (run === 5) {
      const s: Bit = { v: 1 - r.v, g: r.g, stuff: 1 };
      bits.push(s);
      prev = s.v;
      run = 1;
    }
  }
  bits.push({ v: 1, g: 'CRC' }, { v: 0, g: 'ACK' }, { v: 1, g: 'ACK' });
  for (let i = 0; i < 7; i++) bits.push({ v: 1, g: 'EOF' });
  return bits;
}
const FB = new Map<string, number>();
/** Bits on the wire including 3 bits of interframe space. */
export function frameBits(id: number, bytes: number[]): number {
  const k = id + ':' + bytes.join(',');
  let n = FB.get(k);
  if (n === undefined) {
    if (FB.size > 500) FB.clear();
    n = buildBits(id, bytes).length + 3;
    FB.set(k, n);
  }
  return n;
}
