// Engine teardown bench. A procedurally built inline six (same dimensions as ENGINE_SPEC: 130 mm bore, 162 mm stroke,
// 256 mm rods, firing order 1-5-3-6-2-4) made of separate parts, so it can be taken apart in a realistic order, laid out
// on the floor, and every part opened up into its sub-parts on the inspection bench. The crank turns the real
// kinematics: pistons and rods from the crank throw, cam at half speed, rockers and valves from the valve timing.
// (The MX-13 GLB used by the multimeter and the 3D panel above is one welded mesh per material, so it can't come apart.)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ENGINE_SPEC, cylinderAngle, valveLift } from '../engine';
import { TEARDOWN, type TeardownPart } from './teardown-data';
import { detailHTML, detailFor } from './engine-detail';

type V = [number, number, number];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FIRING = ENGINE_SPEC.firingOrder as readonly number[];

// ---------------- dimensions (meters) ----------------
const CX = (i: number) => 0.4 - i * 0.16; // cylinder 1 at the front (+x)
const BULK = [0.48, 0.32, 0.16, 0, -0.16, -0.32, -0.48];
const R = ENGINE_SPEC.strokeMm / 2000; // crank throw 0.081
const L = 0.256; // rod center to center
const CH = 0.075; // wrist pin to crown
const DECK = 0.415;
const HEAD_TOP = 0.545;
const CAM_Y = 0.605, SHAFT_Y = 0.66;
const FLOOR = -0.62;
const VLIFT = 0.014; // 14 mm valve lift

// ---------------- materials ----------------
const MAT: Record<string, [number, number, number]> = {
  block: [0x4a4f57, 0.45, 0.6], head: [0x575c64, 0.45, 0.55], liner: [0x8a8d94, 0.7, 0.35], steel: [0xc9ced5, 0.85, 0.25],
  forged: [0x8f949b, 0.75, 0.35], dark: [0x2a2c31, 0.4, 0.6], black: [0x151618, 0.3, 0.7], alu: [0xaab0b8, 0.7, 0.35],
  copper: [0xc4793f, 0.8, 0.3], bearing: [0xb59a5a, 0.8, 0.3], gasket: [0x8c9198, 0.6, 0.45], exh: [0x6b584a, 0.6, 0.55],
  rubber: [0x101011, 0, 0.9], blue: [0x24589a, 0.3, 0.5], yellow: [0xe0a800, 0.2, 0.5], spring: [0x6fa0c8, 0.6, 0.4],
  pan: [0x34373c, 0.5, 0.5], piston: [0xb9bec5, 0.6, 0.35], bowl: [0x3a3328, 0.3, 0.8], red: [0x9e3a2a, 0.3, 0.6],
};

// ---------------- scene building helpers ----------------
interface Comp {
  part: TeardownPart;
  order: number;
  g: THREE.Group; // moved as a whole when removed
  mats: Map<string, THREE.MeshStandardMaterial>;
  removed: boolean;
  bench: THREE.Vector3; // offset that puts it on the floor
  rideWith?: string;
  inst: THREE.Object3D[];
}
let cur: Comp;
// Procedural surface textures: sand-cast grain for castings, plateau-hone cross-hatch for liner bores.
const CAST = new Set(['block', 'head', 'exh', 'pan', 'alu']);
const TEX: Record<string, THREE.Texture> = {};
function surfaceTex(kind: 'cast' | 'hone') {
  if (TEX[kind]) return TEX[kind];
  const n = 256, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const x = cv.getContext('2d')!;
  x.fillStyle = kind === 'cast' ? '#d8d8d8' : '#ffffff';
  x.fillRect(0, 0, n, n);
  if (kind === 'cast') {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 9000; k++) {
      const v = 190 + rnd() * 65;
      x.fillStyle = `rgb(${v},${v},${v})`;
      const r = 0.6 + rnd() * 1.6;
      x.beginPath(); x.arc(rnd() * n, rnd() * n, r, 0, Math.PI * 2); x.fill();
    }
  } else {
    x.strokeStyle = 'rgba(150,150,150,0.6)';
    x.lineWidth = 1;
    for (let k = -n; k < n * 2; k += 6) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k + n * 0.5, n); x.stroke();
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k - n * 0.5, n); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === 'cast' ? 3 : 6, kind === 'cast' ? 3 : 2);
  return (TEX[kind] = t);
}
function mat(k: string) {
  let m = cur.mats.get(k);
  if (!m) {
    const [c, metal, rough] = MAT[k];
    m = new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, side: THREE.DoubleSide });
    if (CAST.has(k)) m.roughnessMap = surfaceTex('cast');
    if (k === 'liner') { m.map = surfaceTex('hone'); m.roughnessMap = m.map; }
    cur.mats.set(k, m);
  }
  return m;
}
function put(o: THREE.Object3D, parent: THREE.Object3D, p: V, sub?: string, ex?: V) {
  o.position.set(p[0], p[1], p[2]);
  if (sub) o.userData.sub = sub;
  if (ex) o.userData.ex = new THREE.Vector3(ex[0], ex[1], ex[2]);
  o.userData.p0 = o.position.clone();
  parent.add(o);
  return o;
}
function box(parent: THREE.Object3D, s: V, p: V, m: string, sub?: string, ex?: V) {
  return put(new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
function cyl(parent: THREE.Object3D, r: number, len: number, p: V, axis: 'x' | 'y' | 'z', m: string, sub?: string, ex?: V, seg = 28, open = false, r2 = r) {
  const geo = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  return put(new THREE.Mesh(geo, mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
function torus(parent: THREE.Object3D, r: number, t: number, p: V, axis: 'x' | 'y' | 'z', m: string, sub?: string, ex?: V, arc = Math.PI * 2) {
  const geo = new THREE.TorusGeometry(r, t, 10, 40, arc);
  if (axis === 'x') geo.rotateY(Math.PI / 2);
  if (axis === 'y') geo.rotateX(Math.PI / 2);
  return put(new THREE.Mesh(geo, mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
function tube(parent: THREE.Object3D, pts: V[], r: number, m: string, sub?: string, ex?: V) {
  const c = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
  return put(new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(20, pts.length * 12), r, 8, false), mat(m)), parent, [0, 0, 0], sub, ex) as THREE.Mesh;
}
/** A flat outline with round holes, extruded upward from y0 by h. Outline points and holes are [x, z]. */
function plate(parent: THREE.Object3D, outline: [number, number][], holes: [number, number, number][], y0: number, h: number, m: string, sub?: string, ex?: V) {
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const [x, z, r] of holes) {
    const hp = new THREE.Path();
    hp.absarc(x, -z, r, 0, Math.PI * 2, true);
    sh.holes.push(hp);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 28 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return put(new THREE.Mesh(geo, mat(m)), parent, [0, 0, 0], sub, ex) as THREE.Mesh;
}
/** A shape drawn in the (z, y) plane, extruded along x by t, centered on x. */
function profileX(parent: THREE.Object3D, draw: (s: THREE.Shape) => void, t: number, p: V, m: string, sub?: string, ex?: V) {
  const sh = new THREE.Shape();
  draw(sh);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 24 });
  geo.translate(0, 0, -t / 2);
  geo.rotateY(Math.PI / 2); // shape x -> world -z, extrusion -> world x
  return put(new THREE.Mesh(geo, mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
function helix(parent: THREE.Object3D, r: number, y0: number, y1: number, turns: number, wire: number, p: V, m: string, sub?: string, ex?: V) {
  const pts: THREE.Vector3[] = [];
  const n = turns * 16;
  for (let i = 0; i <= n; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + ((y1 - y0) * i) / n, Math.sin(a) * r));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, wire, 6, false);
  return put(new THREE.Mesh(geo, mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
function gear(parent: THREE.Object3D, r: number, w: number, teeth: number, p: V, m: string, sub?: string, ex?: V) {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(r * 0.92, r * 0.92, w, 40);
  body.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(body, mat(m)));
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, r * 0.12, (Math.PI * 2 * r) / teeth / 2), mat(m));
    t.position.set(0, Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
    t.rotation.x = -a;
    g.add(t);
  }
  return put(g, parent, p, sub, ex);
}

// ---------------- detail helpers ----------------
type Dir = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
function rbox(parent: THREE.Object3D, s: V, p: V, m: string, sub?: string, ex?: V, r = 0.006) {
  const rr = Math.min(r, s[0] / 2 - 1e-4, s[1] / 2 - 1e-4, s[2] / 2 - 1e-4);
  return put(new THREE.Mesh(new RoundedBoxGeometry(s[0], s[1], s[2], 2, rr), mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
/** A turned part: profile points are [radius, height]; revolved around y (or laid along x / z). */
function lathe(parent: THREE.Object3D, pts: [number, number][], p: V, m: string, sub?: string, ex?: V, axis: 'x' | 'y' | 'z' = 'y', seg = 40) {
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  return put(new THREE.Mesh(geo, mat(m)), parent, p, sub, ex) as THREE.Mesh;
}
/** Hex-head bolt (head + washer). p is the center of the head; dir points out of the part. */
function bolt(parent: THREE.Object3D, p: V, dir: Dir, r: number, sub?: string, ex?: V, m = 'dark') {
  const ax = dir.replace('-', '') as 'x' | 'y' | 'z';
  const sg = dir.startsWith('-') ? -1 : 1;
  const off = (d: number): V => [p[0] + (ax === 'x' ? d * sg : 0), p[1] + (ax === 'y' ? d * sg : 0), p[2] + (ax === 'z' ? d * sg : 0)];
  const h = cyl(parent, r, r * 0.75, p, ax, m, sub, ex, 6);
  cyl(parent, r * 1.35, r * 0.18, off(-r * 0.46), ax, 'steel', sub, ex, 16);
  return h;
}
/** Bolts evenly spaced along a straight line. */
function boltRow(parent: THREE.Object3D, a: V, b: V, n: number, dir: Dir, r: number, sub?: string, ex?: V, m = 'dark') {
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    bolt(parent, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], dir, r, sub, ex, m);
  }
}
/** Bolts around a circle in the plane normal to x. */
function boltCircleX(parent: THREE.Object3D, x: number, cy: number, cz: number, rad: number, n: number, dir: Dir, r: number, sub?: string, ex?: V, m = 'dark', a0 = 0) {
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    bolt(parent, [x, cy + Math.cos(a) * rad, cz + Math.sin(a) * rad], dir, r, sub, ex, m);
  }
}
/** Hose clamp / V-band ring. */
function clamp(parent: THREE.Object3D, r: number, p: V, axis: 'x' | 'y' | 'z', sub?: string, ex?: V) {
  return torus(parent, r, 0.004, p, axis, 'steel', sub, ex);
}
const HEAD_BOLTS: [number, number][] = [];
for (const x of [...BULK, ...Array.from({ length: 6 }, (_, i) => CX(i))]) for (const z of [0.125, -0.125]) HEAD_BOLTS.push([x, z]);

// ---------------- the parts ----------------
const builders: Record<string, (g: THREE.Group, c: Comp) => void> = {
  block(g) {
    const holes = Array.from({ length: 6 }, (_, i) => [CX(i), 0, 0.074] as [number, number, number]);
    plate(g, [[-0.56, -0.155], [0.56, -0.155], [0.56, 0.155], [-0.56, 0.155]], holes, 0.17, DECK - 0.17, 'block', 'bCasting');
    // crankcase skirt, front and rear walls, bulkheads with main bearing saddles
    for (const s of [1, -1]) {
      box(g, [1.12, 0.22, 0.02], [0, 0.06, s * 0.185], 'block', 'bCasting');
      box(g, [1.12, 0.03, 0.04], [0, 0.155, s * 0.165], 'block', 'bCasting');
      box(g, [1.13, 0.014, 0.034], [0, -0.043, s * 0.19], 'block', 'bCasting'); // pan rail
    }
    for (const x of [...BULK, 0.56, -0.56]) {
      const end = Math.abs(x) > 0.5;
      profileX(g, (sh) => {
        sh.moveTo(-0.175, -0.05);
        sh.lineTo(-0.058, -0.05);
        sh.lineTo(-0.058, 0);
        sh.absarc(0, 0, 0.058, Math.PI, 0, true);
        sh.lineTo(0.058, -0.05);
        sh.lineTo(0.175, -0.05);
        sh.lineTo(0.175, 0.17);
        sh.lineTo(-0.175, 0.17);
      }, end ? 0.03 : 0.024, [x, 0, 0], 'block', 'bCasting');
    }
    // stiffening ribs on the outside of the water jacket and the skirt, one at each bulkhead
    for (const s of [1, -1]) {
      for (const x of BULK) {
        rbox(g, [0.014, DECK - 0.2, 0.012], [x, (DECK + 0.17) / 2 - 0.01, s * 0.161], 'block', 'bCasting', undefined, 0.004);
        rbox(g, [0.014, 0.2, 0.014], [x, 0.06, s * 0.2], 'block', 'bCasting', undefined, 0.004);
      }
      rbox(g, [1.1, 0.014, 0.01], [0, 0.36, s * 0.16], 'block', 'bCasting', undefined, 0.003);
      // engine mount pads at the front corners
      rbox(g, [0.1, 0.09, 0.03], [0.45, 0.08, s * 0.21], 'block', 'bCasting', undefined, 0.008);
      for (const dy of [0.05, 0.11]) for (const dx of [0.42, 0.48]) bolt(g, [dx, dy, s * 0.229], s > 0 ? 'z' : '-z', 0.008, 'bCasting');
    }
    // coolant core plugs, oil gallery plugs, and the long main oil gallery
    for (const s of [1, -1]) for (let i = 0; i < 6; i++) cyl(g, 0.022, 0.012, [CX(i), 0.3, s * 0.161], 'z', 'steel', 'bCasting');
    cyl(g, 0.02, 1.12, [0, 0.18, 0.15], 'x', 'block', 'bCasting', undefined, 16);
    for (const x of [0.567, -0.567]) for (const [y, z] of [[0.18, 0.15], [0.3, -0.1], [0.08, 0.12]] as const) bolt(g, [x, y, z], x > 0 ? 'x' : '-x', 0.009, 'bCasting', undefined, 'steel');
    // tapped head bolt holes and dowels in the deck
    for (const [x, z] of HEAD_BOLTS) cyl(g, 0.009, 0.002, [x, DECK + 0.0005, z], 'y', 'black', 'bCasting', undefined, 12);
    for (const x of [0.5, -0.5]) cyl(g, 0.006, 0.012, [x, DECK + 0.004, 0.1], 'y', 'steel', 'bCasting', undefined, 10);
    // coolant transfer holes beside each bore
    for (let i = 0; i < 6; i++) for (const z of [0.1, -0.1]) cyl(g, 0.007, 0.002, [CX(i) + 0.05, DECK + 0.0005, z], 'y', 'black', 'bCasting', undefined, 10);
  },
  liners(g, c) {
    for (let i = 0; i < 6; i++) {
      const li = new THREE.Group();
      put(li, g, [CX(i), 0, 0]);
      li.userData.inst = i;
      c.inst.push(li);
      // one turned piece: thin wall, upper seal band, flange that sits in the block counterbore
      lathe(li, [[0.065, 0.17], [0.0672, 0.17], [0.0672, 0.31], [0.0685, 0.315], [0.0685, DECK - 0.016], [0.0738, DECK - 0.012], [0.0738, DECK], [0.065, DECK], [0.065, 0.17]], [0, 0, 0], 'liner', 'lSleeve', [0, 0.12, 0], 'y', 48);
      for (const y of [0.19, 0.205]) torus(li, 0.067, 0.0035, [0, y, 0], 'y', 'rubber', 'lSeals', [0, -0.05, 0]);
    }
  },
  headGasket(g) {
    const holes: [number, number, number][] = Array.from({ length: 6 }, (_, i) => [CX(i), 0, 0.066] as [number, number, number]);
    for (const [x, z] of HEAD_BOLTS) holes.push([x, z, 0.0085]);
    for (let i = 0; i < 6; i++) for (const z of [0.1, -0.1]) holes.push([CX(i) + 0.05, z, 0.0065]);
    plate(g, [[-0.56, -0.155], [0.56, -0.155], [0.56, 0.155], [-0.56, 0.155]], holes, DECK, 0.003, 'gasket', 'hgBody');
    for (let i = 0; i < 6; i++) torus(g, 0.0675, 0.0028, [CX(i), DECK + 0.002, 0], 'y', 'steel', 'hgRings', [0, 0.06, 0]);
  },
  head(g) {
    rbox(g, [1.12, HEAD_TOP - DECK - 0.003, 0.31], [0, (HEAD_TOP + DECK + 0.003) / 2, 0], 'head', 'hCasting', undefined, 0.01);
    for (let i = 0; i < 6; i++) {
      // intake ports (with their flange faces) and exhaust ports with studs
      rbox(g, [0.1, 0.05, 0.03], [CX(i), 0.49, 0.168], 'head', 'hCasting', undefined, 0.008);
      rbox(g, [0.09, 0.045, 0.03], [CX(i), 0.49, -0.168], 'head', 'hCasting', undefined, 0.008);
      // valve seats and the injector bore on the fire deck (seen when the head is turned over)
      for (const [dx, dz] of [[0.025, 0.04], [-0.025, 0.04], [0.025, -0.04], [-0.025, -0.04]] as const) torus(g, 0.019, 0.003, [CX(i) + dx, DECK + 0.003, dz], 'y', 'steel', 'hCasting');
      cyl(g, 0.012, 0.002, [CX(i), DECK + 0.002, 0], 'y', 'copper', 'hCasting', undefined, 16);
      // side bosses between the ports
      for (const s of [1, -1]) rbox(g, [0.03, 0.06, 0.012], [CX(i) - 0.08, 0.48, s * 0.159], 'head', 'hCasting', undefined, 0.004);
      // injector bores and the valve guide bosses on top
      cyl(g, 0.02, 0.01, [CX(i), HEAD_TOP + 0.005, 0], 'y', 'head', 'hCasting', undefined, 20);
    }
    // head bolts: hex heads with washers on top, long shanks hidden inside until it comes apart
    for (const [x, z] of HEAD_BOLTS) {
      bolt(g, [x, HEAD_TOP + 0.007, z], 'y', 0.011, 'hBolts', [0, 0.25, 0]);
      cyl(g, 0.006, 0.14, [x, HEAD_TOP - 0.065, z], 'y', 'dark', 'hBolts', [0, 0.25, 0], 6);
    }
    // cam towers, lifting eyes, coolant outlet
    for (const x of BULK) rbox(g, [0.026, 0.05, 0.07], [x, HEAD_TOP + 0.025, 0], 'head', 'hCasting', undefined, 0.006);
    for (const x of [0.5, -0.5]) {
      rbox(g, [0.06, 0.02, 0.03], [x, HEAD_TOP + 0.01, -0.172], 'forged', 'hCasting', undefined, 0.004);
      torus(g, 0.022, 0.007, [x, HEAD_TOP + 0.035, -0.172], 'z', 'forged', 'hCasting');
    }
    rbox(g, [0.03, 0.06, 0.1], [0.575, 0.49, 0.06], 'head', 'hCasting', undefined, 0.008);
  },
  valves(g, c) {
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.Group();
      put(cg, g, [CX(i), 0, 0]);
      cg.userData.inst = i;
      c.inst.push(cg);
      for (const [dx, dz] of [[0.025, 0.04], [-0.025, 0.04], [0.025, -0.04], [-0.025, -0.04]] as const) {
        const intake = dz > 0;
        const vg = new THREE.Group();
        put(vg, cg, [dx, 0, dz]);
        vg.userData.valve = intake ? 'intake' : 'exhaust';
        const sub = intake ? 'vIntake' : 'vExhaust';
        const exv: V = [dx * 3, -0.12, dz * 2.5];
        const R0 = intake ? 0.02 : 0.018;
        // tulip valve: stem, radiused neck, 30/45 degree face, margin, keeper grooves at the tip
        lathe(vg, [[0, DECK], [R0, DECK], [R0, DECK + 0.0025], [R0 - 0.004, DECK + 0.006], [0.009, DECK + 0.011], [0.0055, DECK + 0.02], [0.0045, DECK + 0.03], [0.0045, 0.585], [0.0038, 0.586], [0.0045, 0.588], [0.0045, 0.592], [0, 0.593]], [0, 0, 0], intake ? 'steel' : 'forged', sub, exv, 'y', 24);
        cyl(vg, 0.009, 0.01, [0, HEAD_TOP + 0.006, 0], 'y', 'rubber', 'vSprings', [dx * 3, 0.07, dz * 2.5], 14); // stem seal
        cyl(vg, 0.016, 0.0015, [0, HEAD_TOP + 0.001, 0], 'y', 'steel', 'vSprings', [dx * 3, 0.07, dz * 2.5], 18); // spring seat
        helix(vg, 0.013, HEAD_TOP + 0.002, 0.585, 6, 0.0022, [0, 0, 0], 'spring', 'vSprings', [dx * 3, 0.07, dz * 2.5]);
        lathe(vg, [[0.0048, 0.584], [0.016, 0.585], [0.016, 0.59], [0.0048, 0.59]], [0, 0, 0], 'steel', 'vRetainers', [dx * 3, 0.13, dz * 2.5], 'y', 20);
        cyl(vg, 0.0062, 0.006, [0, 0.589, 0], 'y', 'dark', 'vRetainers', [dx * 3, 0.16, dz * 2.5], 10, false, 0.0052); // split keepers
      }
    }
  },
  injectors(g, c) {
    for (let i = 0; i < 6; i++) {
      const ig = new THREE.Group();
      put(ig, g, [CX(i), 0, 0]);
      ig.userData.inst = i;
      c.inst.push(ig);
      // stepped body: nozzle nut, body, fuel inlet boss, solenoid, connector
      lathe(ig, [[0, 0.375], [0.0025, 0.375], [0.0035, 0.385], [0.0055, 0.4], [0.0055, 0.42], [0.009, 0.425], [0.009, 0.44], [0.0105, 0.445], [0.0105, 0.525], [0.0125, 0.528], [0.0125, 0.536], [0, 0.536]], [0, 0, 0], 'steel', 'injBody', [0, 0.05, 0], 'y', 24);
      cyl(ig, 0.0035, 0.008, [0, 0.371, 0], 'y', 'forged', 'injNozzle', [0, -0.06, 0], 10, false, 0.0025);
      cyl(ig, 0.0056, 0.028, [0, 0.405, 0], 'y', 'forged', 'injNozzle', [0, -0.06, 0], 14);
      cyl(ig, 0.015, 0.03, [0, 0.551, 0], 'y', 'black', 'injBody', [0, 0.05, 0], 20);
      rbox(ig, [0.022, 0.014, 0.016], [0, 0.574, 0.008], 'black', 'injBody', [0, 0.05, 0], 0.003);
      for (const dx of [-0.004, 0.004]) cyl(ig, 0.0012, 0.008, [dx, 0.584, 0.008], 'y', 'copper', 'injBody', [0, 0.05, 0], 6);
      torus(ig, 0.0085, 0.0022, [0, 0.428, 0], 'y', 'copper', 'injWasher', [0, -0.02, 0.05]);
      // hold-down clamp and bolt
      rbox(ig, [0.05, 0.008, 0.02], [-0.03, 0.53, 0], 'forged', 'injBody', [0, 0.05, 0], 0.003);
      bolt(ig, [-0.05, 0.538, 0], 'y', 0.006, 'injBody', [0, 0.05, 0]);
      // fuel quill to the rail line
      cyl(ig, 0.004, 0.17, [0, 0.445, 0.085], 'z', 'steel', 'injBody', [0, 0.05, 0], 8);
      cyl(ig, 0.007, 0.012, [0, 0.445, 0.165], 'z', 'forged', 'injBody', [0, 0.05, 0], 6);
    }
  },
  fuel(g) {
    const ex: V = [0, 0.15, 0.12];
    cyl(g, 0.022, 0.86, [0.02, 0.36, 0.215], 'x', 'forged', 'fRail', ex);
    // rail pressure sensor at the front, pressure relief valve at the back, outlet fittings and mounting brackets
    lathe(g, [[0.026, 0], [0.026, 0.015], [0.016, 0.02], [0.016, 0.04], [0.012, 0.045], [0.012, 0.06], [0, 0.06]], [0.45, 0.36, 0.215], 'forged', 'fRail', ex, 'x', 6);
    cyl(g, 0.012, 0.03, [0.52, 0.36, 0.215], 'x', 'black', 'fRail', ex, 16);
    rbox(g, [0.02, 0.022, 0.016], [0.545, 0.36, 0.215], 'black', 'fRail', ex, 0.003);
    lathe(g, [[0.026, 0], [0.026, 0.012], [0.015, 0.016], [0.015, 0.05], [0, 0.05]], [-0.41, 0.36, 0.215], 'forged', 'fRail', ex, 'x', 6);
    (g.children[g.children.length - 1] as THREE.Object3D).rotation.z = Math.PI;
    for (let i = 0; i < 6; i++) cyl(g, 0.009, 0.02, [CX(i), 0.38, 0.215], 'y', 'forged', 'fRail', ex, 6);
    for (const x of [0.25, -0.05, -0.33]) {
      rbox(g, [0.03, 0.05, 0.03], [x, 0.335, 0.195], 'forged', 'fRail', ex, 0.004);
      bolt(g, [x, 0.32, 0.215], 'z', 0.007, 'fRail', ex);
    }
    // high-pressure lines to each injector quill, with their nuts
    for (let i = 0; i < 6; i++) {
      tube(g, [[CX(i), 0.39, 0.215], [CX(i), 0.42, 0.205], [CX(i), 0.445, 0.175]], 0.0045, 'steel', 'fLines', [0, 0.25, 0.05]);
      cyl(g, 0.007, 0.012, [CX(i), 0.445, 0.178], 'z', 'forged', 'fLines', [0, 0.25, 0.05], 6);
    }
    // gear-driven high-pressure pump: body, two pumping heads, inlet metering valve, drive flange
    const pe: V = [0.15, -0.1, 0.1];
    rbox(g, [0.12, 0.12, 0.1], [0.47, 0.2, 0.235], 'alu', 'fPump', pe, 0.012);
    for (const x of [0.44, 0.5]) {
      cyl(g, 0.02, 0.04, [x, 0.275, 0.235], 'y', 'forged', 'fPump', pe, 20);
      cyl(g, 0.011, 0.015, [x, 0.302, 0.235], 'y', 'forged', 'fPump', pe, 6);
    }
    cyl(g, 0.05, 0.05, [0.47, 0.2, 0.31], 'z', 'alu', 'fPump', pe);
    cyl(g, 0.016, 0.035, [0.47, 0.16, 0.302], 'z', 'black', 'fPump', pe, 18);
    rbox(g, [0.02, 0.016, 0.014], [0.47, 0.14, 0.32], 'black', 'fPump', pe, 0.003);
    for (const [dx, dy] of [[0.045, 0.045], [-0.045, 0.045], [0.045, -0.045], [-0.045, -0.045]]) bolt(g, [0.47 + dx, 0.2 + dy, 0.289], 'z', 0.006, 'fPump', pe);
    cyl(g, 0.008, 0.02, [0.53, 0.2, 0.235], 'x', 'forged', 'fPump', pe, 6); // low-pressure inlet fitting
    tube(g, [[0.47, 0.31, 0.235], [0.47, 0.34, 0.225], [0.45, 0.36, 0.215]], 0.0045, 'steel', 'fLines', [0, 0.25, 0.05]);
  },
  rockers(g, c) {
    cyl(g, 0.011, 1.1, [0, SHAFT_Y, 0], 'x', 'steel', 'rShaft', [0, 0.18, 0], 14);
    // rocker shaft pedestals with their bolts, and the end plugs
    for (const x of BULK) {
      for (const z of [0.03, -0.03]) box(g, [0.02, 0.06, 0.012], [x, 0.625, z], 'forged', 'rShaft', [0, 0.18, 0]);
      rbox(g, [0.022, 0.024, 0.074], [x, SHAFT_Y + 0.004, 0], 'forged', 'rShaft', [0, 0.18, 0], 0.005);
      for (const z of [0.03, -0.03]) bolt(g, [x, SHAFT_Y + 0.02, z], 'y', 0.007, 'rShaft', [0, 0.18, 0]);
    }
    for (const x of [0.55, -0.55]) cyl(g, 0.012, 0.006, [x, SHAFT_Y, 0], 'x', 'steel', 'rShaft', [0, 0.18, 0], 16);
    for (let i = 0; i < 6; i++) {
      for (const valve of ['intake', 'exhaust'] as const) {
        const s = valve === 'intake' ? 1 : -1;
        const rg = new THREE.Group();
        put(rg, g, [CX(i) + s * 0.022, SHAFT_Y, 0], 'rArms', [s * 0.04, 0.09, s * 0.06]);
        rg.userData.rocker = { cyl: i + 1, valve };
        c.inst.push(rg);
        cyl(rg, 0.017, 0.02, [0, 0, 0], 'x', 'forged', 'rArms', undefined, 20);
        cyl(rg, 0.0115, 0.021, [0, 0, 0], 'x', 'bearing', 'rArms', undefined, 16); // bushing
        // arm from the hub out to the bridge over the valve pair
        const dx = -s * 0.022, dz = s * 0.04, dy = 0.597 - SHAFT_Y;
        const len = Math.hypot(dx, dz);
        const arm = rbox(rg, [0.016, 0.016, len], [dx / 2, dy / 2 + 0.004, dz / 2], 'forged', 'rArms', undefined, 0.004);
        arm.rotation.y = Math.atan2(dx, dz);
        arm.rotation.x = Math.atan2(-dy, len) * Math.sign(dz) * -1;
        cyl(rg, 0.0045, 0.03, [dx, dy + 0.012, dz], 'y', 'steel', 'rArms', undefined, 8); // adjusting screw
        cyl(rg, 0.0075, 0.005, [dx, dy + 0.022, dz], 'y', 'dark', 'rArms', undefined, 6); // lock nut
        cyl(rg, 0.006, 0.005, [dx, dy - 0.003, dz], 'y', 'steel', 'rArms', undefined, 12); // elephant foot
        cyl(rg, 0.008, 0.012, [0, CAM_Y + 0.031 - SHAFT_Y, -s * 0.012], 'x', 'steel', 'rRollers', [0, -0.04, 0], 16);
        cyl(rg, 0.003, 0.02, [0, CAM_Y + 0.031 - SHAFT_Y, -s * 0.012], 'x', 'dark', 'rRollers', [0, -0.04, 0], 8);
        for (const sx of [1, -1]) box(rg, [0.003, 0.026, 0.014], [sx * 0.0075, -0.016, -s * 0.012], 'forged', 'rArms');
      }
      for (const dz of [0.04, -0.04]) {
        const br = rbox(g, [0.07, 0.01, 0.016], [CX(i), 0.594, dz], 'forged', 'rBridges', [0, 0.04, dz * 2], 0.003);
        br.userData.bridge = { cyl: i + 1, valve: dz > 0 ? 'intake' : 'exhaust' };
      }
    }
  },
  camshaft(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, CAM_Y, 0]);
    spin.userData.spin = 'cam';
    c.inst.push(spin);
    cyl(spin, 0.016, 1.12, [0, 0, 0], 'x', 'forged', 'cShaft', undefined, 18);
    for (const x of BULK) {
      cyl(spin, 0.022, 0.024, [x, 0, 0], 'x', 'steel', 'cShaft', undefined, 22);
      cyl(spin, 0.0035, 0.004, [x, 0.021, 0], 'y', 'black', 'cShaft', undefined, 8); // oil hole
    }
    const vt = ENGINE_SPEC.valveTiming;
    const peak = { intake: (vt.intakeOpens + vt.intakeCloses) / 2, exhaust: (vt.exhaustOpens + vt.exhaustCloses) / 2 };
    for (let i = 0; i < 6; i++) {
      const n = i + 1, idx = FIRING.indexOf(n);
      for (const valve of ['intake', 'exhaust'] as const) {
        const lobe = profileX(spin, (sh) => {
          sh.absarc(0, 0, 0.022, Math.PI * 0.85, Math.PI * 0.15 + Math.PI * 2, false);
          sh.quadraticCurveTo(0.012, 0.03, 0, 0.033);
          sh.quadraticCurveTo(-0.012, 0.03, -0.0187, 0.0116);
        }, 0.018, [CX(i) + (valve === 'intake' ? 0.022 : -0.022), 0, 0], 'steel', 'cShaft');
        lobe.rotation.x = (-(peak[valve] + 120 * idx) / 2) * (Math.PI / 180);
      }
    }
    // thrust flange, gear hub with its bolts, and the timing mark
    cyl(spin, 0.03, 0.008, [-0.54, 0, 0], 'x', 'steel', 'cShaft', undefined, 24);
    gear(spin, 0.11, 0.03, 48, [-0.6, 0, 0], 'forged', 'cGear', [-0.15, 0, 0]);
    cyl(spin, 0.035, 0.035, [-0.6, 0, 0], 'x', 'steel', 'cGear', [-0.15, 0, 0], 24);
    boltCircleX(spin, -0.62, 0, 0, 0.055, 6, '-x', 0.006, 'cGear', [-0.15, 0, 0]);
    box(spin, [0.032, 0.012, 0.004], [-0.6, 0.1, 0], 'yellow', 'cGear', [-0.15, 0, 0]);
  },
  valveCover(g) {
    const ex: V = [0, 0.12, 0];
    rbox(g, [1.1, 0.16, 0.3], [0, 0.64, 0], 'alu', 'vcBody', ex, 0.03);
    rbox(g, [1.13, 0.014, 0.33], [0, 0.563, 0], 'alu', 'vcBody', ex, 0.006); // sealing flange
    for (let k = 0; k < 5; k++) rbox(g, [0.9, 0.012, 0.014], [0, 0.725, -0.1 + k * 0.05], 'alu', 'vcBody', ex, 0.005);
    for (let k = 0; k < 7; k++) rbox(g, [0.012, 0.01, 0.22], [-0.45 + k * 0.15, 0.723, 0], 'alu', 'vcBody', ex, 0.004);
    // isolated cover bolts around the flange
    for (const s of [1, -1]) boltRow(g, [-0.5, 0.575, s * 0.155], [0.5, 0.575, s * 0.155], 7, 'y', 0.008, 'vcBody', ex);
    for (const x of [0.555, -0.555]) bolt(g, [x, 0.575, 0], 'y', 0.008, 'vcBody', ex);
    // oil fill cap with grip, crankcase breather, harness pass-through connector, maker's plate
    lathe(g, [[0, 0], [0.032, 0], [0.032, 0.012], [0.028, 0.02], [0.028, 0.03], [0, 0.03]], [0.3, 0.722, 0.08], 'yellow', 'vcCap', [0, 0.25, 0], 'y', 32);
    box(g, [0.05, 0.012, 0.01], [0.3, 0.756, 0.08], 'yellow', 'vcCap', [0, 0.25, 0]);
    cyl(g, 0.05, 0.05, [-0.38, 0.745, -0.05], 'y', 'black', 'vcBody', ex, 32);
    cyl(g, 0.018, 0.08, [-0.38, 0.745, -0.12], 'z', 'rubber', 'vcBody', ex, 16);
    clamp(g, 0.019, [-0.38, 0.745, -0.1], 'z', 'vcBody', ex);
    rbox(g, [0.05, 0.03, 0.02], [0.1, 0.62, 0.158], 'black', 'vcBody', ex, 0.004);
    rbox(g, [0.18, 0.006, 0.07], [0.05, 0.721, -0.11], 'dark', 'vcBody', ex, 0.003);
    plate(g, [[-0.555, -0.15], [0.555, -0.15], [0.555, 0.15], [-0.555, 0.15]], [], HEAD_TOP, 0.004, 'rubber', 'vcGasket', [0, -0.04, 0]);
  },
  intakeManifold(g) {
    const ex: V = [0, 0, 0.12];
    rbox(g, [1.0, 0.09, 0.09], [0, 0.535, 0.27], 'alu', 'imPlenum', ex, 0.03);
    for (let i = 0; i < 6; i++) {
      rbox(g, [0.085, 0.055, 0.07], [CX(i), 0.495, 0.215], 'alu', 'imPlenum', ex, 0.014);
      rbox(g, [0.11, 0.07, 0.008], [CX(i), 0.49, 0.186], 'alu', 'imPlenum', ex, 0.004);
      for (const dx of [-0.045, 0.045]) bolt(g, [CX(i) + dx, 0.49, 0.193], 'z', 0.006, 'imPlenum', ex);
    }
    for (let k = 0; k < 8; k++) rbox(g, [0.008, 0.07, 0.01], [-0.42 + k * 0.12, 0.535, 0.318], 'alu', 'imPlenum', ex, 0.003);
    // boost (pressure + temperature) sensor on top
    cyl(g, 0.012, 0.03, [0.2, 0.592, 0.27], 'y', 'black', 'imPlenum', ex, 16);
    rbox(g, [0.022, 0.014, 0.016], [0.2, 0.612, 0.278], 'black', 'imPlenum', ex, 0.003);
    // grid heater between the inlet and the plenum, then the charge-air inlet elbow and hose
    const ie: V = [0.12, 0.15, 0.12];
    rbox(g, [0.13, 0.025, 0.13], [0.48, 0.592, 0.27], 'dark', 'imInlet', ie, 0.004);
    for (const dz of [-0.04, 0.04]) {
      cyl(g, 0.006, 0.03, [0.548, 0.592, 0.27 + dz], 'x', 'copper', 'imInlet', ie, 8);
      cyl(g, 0.009, 0.006, [0.565, 0.592, 0.27 + dz], 'x', 'dark', 'imInlet', ie, 6);
    }
    tube(g, [[0.48, 0.6, 0.27], [0.48, 0.68, 0.27], [0.5, 0.75, 0.27], [0.56, 0.78, 0.27]], 0.05, 'alu', 'imInlet', ie);
    clamp(g, 0.053, [0.48, 0.64, 0.27], 'y', 'imInlet', ie);
    cyl(g, 0.054, 0.08, [0.6, 0.78, 0.27], 'x', 'rubber', 'imInlet', ie, 28);
    for (const x of [0.575, 0.625]) clamp(g, 0.056, [x, 0.78, 0.27], 'x', 'imInlet', ie);
  },
  exhaustManifold(g) {
    for (const [sub, x0, x1, ex] of [['emFront', 0.0, 0.48, 0.12], ['emRear', -0.48, 0.0, -0.12]] as const) {
      const e: V = [ex, 0, -0.1];
      cyl(g, 0.042, x1 - x0 - 0.03, [(x0 + x1) / 2 + (ex > 0 ? 0.01 : -0.01), 0.49, -0.255], 'x', 'exh', sub, e, 24);
      for (let i = 0; i < 6; i++) {
        if (CX(i) > x0 && CX(i) < x1) {
          // runner from the port into the log, flange with studs and nuts
          tube(g, [[CX(i), 0.49, -0.185], [CX(i), 0.49, -0.215], [CX(i) + (ex > 0 ? -0.01 : 0.01), 0.49, -0.245]], 0.03, 'exh', sub, e);
          rbox(g, [0.11, 0.065, 0.012], [CX(i), 0.49, -0.188], 'exh', sub, e, 0.006);
          for (const dx of [-0.042, 0.042]) {
            cyl(g, 0.0045, 0.03, [CX(i) + dx, 0.49, -0.192], 'z', 'steel', sub, e, 8);
            cyl(g, 0.0075, 0.008, [CX(i) + dx, 0.49, -0.198], 'z', 'dark', sub, e, 6);
          }
          rbox(g, [0.11, 0.065, 0.004], [CX(i), 0.49, -0.181], 'gasket', 'emGasket', [ex, 0, -0.03], 0.002);
        }
      }
    }
    // slip joint between the halves: bellows rings
    for (const x of [-0.012, -0.004, 0.004, 0.012]) torus(g, 0.043, 0.004, [x, 0.49, -0.255], 'x', 'steel', 'emRear', [-0.12, 0, -0.1]);
    // riser to the turbo with its mounting flange and studs
    cyl(g, 0.045, 0.12, [-0.02, 0.56, -0.27], 'y', 'exh', 'emRear', [-0.12, 0, -0.1], 24);
    rbox(g, [0.11, 0.014, 0.11], [-0.02, 0.62, -0.27], 'exh', 'emRear', [-0.12, 0, -0.1], 0.005);
    for (const [dx, dz] of [[0.042, 0.042], [-0.042, 0.042], [0.042, -0.042], [-0.042, -0.042]]) cyl(g, 0.007, 0.012, [-0.02 + dx, 0.632, -0.27 + dz], 'y', 'dark', 'emRear', [-0.12, 0, -0.1], 6);
  },
  turbo(g) {
    const X = -0.02, Y = 0.68, Z = -0.27;
    const te: V = [-0.2, 0, 0], ce: V = [0.22, 0, 0], he: V = [0, 0.1, -0.1];
    // turbine housing (volute), outlet and the VGT actuator
    torus(g, 0.07, 0.04, [X - 0.06, Y, Z], 'x', 'exh', 'tTurbHsg', te);
    cyl(g, 0.045, 0.06, [X - 0.06, Y, Z], 'x', 'exh', 'tTurbHsg', te);
    lathe(g, [[0.04, 0], [0.04, 0.07], [0.05, 0.075], [0.05, 0.09], [0.04, 0.09]], [X - 0.06, Y, Z - 0.04], 'exh', 'tTurbHsg', te, 'z', 32);
    (g.children[g.children.length - 1] as THREE.Object3D).rotation.y = Math.PI;
    rbox(g, [0.06, 0.05, 0.05], [X - 0.08, Y + 0.09, Z + 0.06], 'black', 'tTurbHsg', te, 0.01);
    rbox(g, [0.022, 0.016, 0.018], [X - 0.05, Y + 0.12, Z + 0.06], 'black', 'tTurbHsg', te, 0.003);
    tube(g, [[X - 0.08, Y + 0.065, Z + 0.06], [X - 0.08, Y + 0.05, Z + 0.045], [X - 0.065, Y + 0.035, Z + 0.035]], 0.003, 'steel', 'tTurbHsg', te);
    // center (bearing) housing, V-band clamps, oil feed and drain, coolant lines
    cyl(g, 0.036, 0.07, [X + 0.02, Y, Z], 'x', 'dark', 'tCenter');
    for (const x of [X - 0.012, X + 0.052]) torus(g, 0.047, 0.006, [x, Y, Z], 'x', 'steel', 'tCenter');
    tube(g, [[X + 0.02, Y + 0.035, Z], [X + 0.05, Y + 0.045, Z + 0.08], [X + 0.09, Y - 0.1, Z + 0.11], [X + 0.1, Y - 0.25, Z + 0.1]], 0.0045, 'steel', 'tCenter', he);
    tube(g, [[X + 0.02, Y - 0.035, Z], [X + 0.03, Y - 0.06, Z + 0.06], [X + 0.04, Y - 0.15, Z + 0.09], [X + 0.04, Y - 0.32, Z + 0.1]], 0.011, 'rubber', 'tCenter', he);
    // compressor housing, inlet bell and outlet
    torus(g, 0.068, 0.036, [X + 0.1, Y, Z], 'x', 'alu', 'tCompHsg', ce);
    lathe(g, [[0.04, 0], [0.042, 0.06], [0.05, 0.068], [0.05, 0.075], [0.04, 0.075]], [X + 0.12, Y, Z], 'alu', 'tCompHsg', ce, 'x', 36);
    clamp(g, 0.044, [X + 0.18, Y, Z], 'x', 'tCompHsg', ce);
    tube(g, [[X + 0.1, Y + 0.1, Z + 0.02], [X + 0.1, Y + 0.16, Z + 0.06], [X + 0.18, Y + 0.18, Z + 0.12]], 0.032, 'alu', 'tCompHsg', ce);
    // wheels and shaft, hidden inside until the housings come off
    cyl(g, 0.006, 0.2, [X + 0.02, Y, Z], 'x', 'steel', 'tShaft', [-0.08, -0.14, 0], 10);
    cyl(g, 0.009, 0.01, [X + 0.11, Y, Z], 'x', 'dark', 'tShaft', [-0.08, -0.14, 0], 6);
    const wheel = (x: number, r: number, m: string, sub: string, ex: V, n: number, back: number) => {
      lathe(g, [[0, -0.015], [r * 0.4, -0.015], [r, -0.012 * back], [r * 0.95, -0.009 * back], [r * 0.3, 0.015], [0, 0.015]], [x, Y, Z], m, sub, ex, 'x', 28);
      for (let k = 0; k < n; k++) {
        const b = box(g, [0.026, r, 0.0025], [x, Y, Z], m, sub, ex);
        b.rotation.x = (k / n) * Math.PI * 2;
        b.geometry.translate(0, r / 2, 0);
        b.geometry.rotateY(0.25);
      }
    };
    wheel(X - 0.06, 0.04, 'forged', 'tShaft', [-0.08, -0.14, 0], 11, 1);
    wheel(X + 0.1, 0.038, 'alu', 'tCompWheel', [0.1, -0.14, 0], 14, -1);
  },
  damper(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    lathe(spin, [[0.05, -0.028], [0.145, -0.028], [0.15, -0.023], [0.15, 0.023], [0.145, 0.028], [0.05, 0.028]], [0.66, 0, 0], 'dark', 'dHousing', [0.08, 0, 0], 'x', 56);
    torus(spin, 0.12, 0.003, [0.689, 0, 0], 'x', 'dark', 'dHousing', [0.08, 0, 0]); // weld seam of the sealed housing
    box(spin, [0.004, 0.02, 0.006], [0.69, 0.13, 0], 'yellow', 'dHousing', [0.08, 0, 0]); // timing mark
    cyl(spin, 0.1, 0.05, [0.72, 0, 0], 'x', 'forged', 'dPulley', [0.18, 0, 0], 36);
    for (const x of [0.703, 0.711, 0.719, 0.727, 0.735]) torus(spin, 0.1, 0.0028, [x, 0, 0], 'x', 'dark', 'dPulley', [0.18, 0, 0]);
    cyl(spin, 0.045, 0.02, [0.755, 0, 0], 'x', 'steel', 'dPulley', [0.18, 0, 0], 24);
    boltCircleX(spin, 0.769, 0, 0, 0.032, 6, 'x', 0.007, 'dPulley', [0.18, 0, 0]);
  },
  waterPump(g) {
    const ex: V = [0.12, 0, 0];
    // volute housing bolted to the front of the block, with the outlet to the oil cooler
    lathe(g, [[0, 0], [0.085, 0], [0.09, 0.01], [0.09, 0.05], [0.07, 0.06], [0, 0.06]], [0.57, 0.3, -0.04], 'alu', 'wpBody', ex, 'x', 40);
    rbox(g, [0.05, 0.1, 0.06], [0.595, 0.22, 0.04], 'alu', 'wpBody', ex, 0.012);
    boltCircleX(g, 0.633, 0.3, -0.04, 0.058, 6, 'x', 0.006, 'wpBody', ex, 'dark', 0.3);
    // bearing hub, pulley with poly-V grooves, weep hole
    cyl(g, 0.025, 0.04, [0.65, 0.3, -0.04], 'x', 'alu', 'wpBody', [0.2, 0, 0], 20);
    cyl(g, 0.07, 0.03, [0.685, 0.3, -0.04], 'x', 'forged', 'wpBody', [0.2, 0, 0], 32);
    for (const x of [0.675, 0.683, 0.691]) torus(g, 0.07, 0.0026, [x, 0.3, -0.04], 'x', 'dark', 'wpBody', [0.2, 0, 0]);
    boltCircleX(g, 0.703, 0.3, -0.04, 0.03, 4, 'x', 0.006, 'wpBody', [0.2, 0, 0]);
    cyl(g, 0.003, 0.004, [0.645, 0.274, -0.04], 'y', 'black', 'wpBody', ex, 8);
    // impeller inside, seen when it comes apart
    cyl(g, 0.045, 0.012, [0.575, 0.3, -0.04], 'x', 'dark', 'wpBody', [0.3, 0, 0], 12);
    for (let k = 0; k < 6; k++) {
      const v = box(g, [0.012, 0.04, 0.003], [0.567, 0.3, -0.04], 'dark', 'wpBody', [0.3, 0, 0]);
      v.rotation.x = (k / 6) * Math.PI * 2;
      v.geometry.translate(0, 0.02, 0);
    }
    // thermostat housing: two thermostats, outlet neck to the radiator hose
    const se: V = [0.1, 0.12, 0];
    rbox(g, [0.08, 0.06, 0.12], [0.6, 0.48, 0.06], 'alu', 'wpStat', se, 0.012);
    lathe(g, [[0.03, 0], [0.03, 0.04], [0.033, 0.045], [0.03, 0.05], [0.03, 0.06], [0, 0.06]], [0.6, 0.51, 0.04], 'alu', 'wpStat', se, 'y', 28);
    for (const [dx, dz] of [[0.03, 0.04], [-0.03, 0.04], [0.03, -0.04], [-0.03, -0.04]] as const) bolt(g, [0.6 + dx, 0.514, 0.06 + dz], 'y', 0.006, 'wpStat', se);
    for (const dz of [-0.025, 0.025]) {
      cyl(g, 0.022, 0.004, [0.6, 0.45, 0.06 + dz], 'y', 'steel', 'wpStat', [0.1, 0.2, 0.1], 24);
      cyl(g, 0.009, 0.03, [0.6, 0.432, 0.06 + dz], 'y', 'copper', 'wpStat', [0.1, 0.2, 0.1], 16);
      helix(g, 0.011, 0.43, 0.448, 4, 0.0012, [0.6, 0, 0.06 + dz], 'steel', 'wpStat', [0.1, 0.2, 0.1]);
    }
  },
  frontCover(g) {
    const ex: V = [0.12, 0, 0];
    rbox(g, [0.016, 0.44, 0.36], [0.575, 0.17, 0], 'alu', 'fcCover', ex, 0.006);
    for (const y of [0.0, 0.3]) rbox(g, [0.01, 0.012, 0.3], [0.587, y, 0], 'alu', 'fcCover', ex, 0.004);
    for (const z of [-0.12, 0.12]) rbox(g, [0.01, 0.38, 0.012], [0.587, 0.17, z], 'alu', 'fcCover', ex, 0.004);
    for (const z of [-0.165, 0.165]) boltRow(g, [0.586, -0.03, z], [0.586, 0.37, z], 5, 'x', 0.007, 'fcCover', ex);
    boltRow(g, [0.586, 0.375, -0.1], [0.586, 0.375, 0.1], 3, 'x', 0.007, 'fcCover', ex);
    boltRow(g, [0.586, -0.035, -0.1], [0.586, -0.035, 0.1], 3, 'x', 0.007, 'fcCover', ex);
    cyl(g, 0.058, 0.012, [0.586, 0, 0], 'x', 'alu', 'fcCover', ex, 32);
    torus(g, 0.045, 0.008, [0.593, 0, 0], 'x', 'rubber', 'fcSeal', [0.2, 0, 0]);
    torus(g, 0.052, 0.002, [0.593, 0, 0], 'x', 'steel', 'fcSeal', [0.2, 0, 0]);
  },
  oilModule(g) {
    const ex: V = [0, 0, 0.1];
    rbox(g, [0.36, 0.13, 0.06], [-0.16, 0.24, 0.215], 'alu', 'omHousing', ex, 0.012);
    // plate-type oil cooler stack (coolant on one side, oil on the other)
    for (let k = 0; k < 12; k++) rbox(g, [0.3, 0.09, 0.0035], [-0.16, 0.25, 0.25 + k * 0.006], 'alu', 'omHousing', ex, 0.0015);
    rbox(g, [0.31, 0.1, 0.008], [-0.16, 0.25, 0.322], 'alu', 'omHousing', ex, 0.003);
    boltRow(g, [-0.3, 0.29, 0.329], [-0.02, 0.29, 0.329], 4, 'z', 0.006, 'omHousing', ex);
    boltRow(g, [-0.3, 0.21, 0.329], [-0.02, 0.21, 0.329], 4, 'z', 0.006, 'omHousing', ex);
    // oil pressure sensor and the filter heads
    cyl(g, 0.01, 0.03, [0.03, 0.27, 0.23], 'x', 'black', 'omHousing', ex, 16);
    rbox(g, [0.016, 0.02, 0.016], [0.05, 0.27, 0.23], 'black', 'omHousing', ex, 0.003);
    for (const x of [-0.26, -0.08]) {
      cyl(g, 0.058, 0.03, [x, 0.19, 0.23], 'y', 'alu', 'omHousing', ex, 32);
      const fe: V = [0, -0.15, 0.12];
      lathe(g, [[0, -0.11], [0.04, -0.11], [0.05, -0.1], [0.052, -0.08], [0.052, 0.09], [0.054, 0.095], [0.054, 0.105], [0.045, 0.11], [0, 0.11]], [x, 0.065, 0.23], 'blue', 'omFilters', fe, 'y', 36);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        box(g, [0.006, 0.012, 0.006], [x + Math.cos(a) * 0.053, 0.163, 0.23 + Math.sin(a) * 0.053], 'blue', 'omFilters', fe);
      }
      cyl(g, 0.012, 0.012, [x, -0.05, 0.23], 'y', 'dark', 'omFilters', fe, 6);
    }
  },
  flywheel(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    lathe(spin, [[0.06, -0.025], [0.228, -0.025], [0.235, -0.018], [0.235, 0.025], [0.06, 0.025]], [-0.66, 0, 0], 'forged', 'fwBody', undefined, 'x', 64);
    lathe(spin, [[0.09, 0], [0.17, 0], [0.17, 0.004], [0.09, 0.004]], [-0.685, 0, 0], 'steel', 'fwBody', undefined, 'x', 64);
    (spin.children[spin.children.length - 1] as THREE.Object3D).rotation.z = Math.PI;
    gear(spin, 0.245, 0.03, 90, [-0.66, 0, 0], 'steel', 'fwRing', [-0.12, 0, 0]);
    for (let k = 0; k < 8; k++) bolt(spin, [-0.688, Math.cos(k * 0.785) * 0.06, Math.sin(k * 0.785) * 0.06], '-x', 0.009, 'fwBody');
    for (let k = 0; k < 6; k++) cyl(spin, 0.007, 0.004, [-0.687, Math.cos(k * 1.047 + 0.3) * 0.2, Math.sin(k * 1.047 + 0.3) * 0.2], 'x', 'black', 'fwBody', undefined, 12); // clutch cover bolt holes
    cyl(spin, 0.02, 0.012, [-0.688, 0, 0], 'x', 'steel', 'fwBody', undefined, 20); // pilot bearing
    for (const a of [0.8, 2.6, 4.1]) cyl(spin, 0.012, 0.004, [-0.636, Math.cos(a) * 0.2, Math.sin(a) * 0.2], 'x', 'black', 'fwBody', undefined, 12); // balance drillings
    // crank position sensor target holes drilled in the rim
    for (let k = 0; k < 36; k++) {
      if (k % 18 === 17) continue; // missing tooth gap marks TDC
      const a = (k / 36) * Math.PI * 2;
      cyl(spin, 0.005, 0.003, [-0.639, Math.cos(a) * 0.236, Math.sin(a) * 0.236], 'z', 'black', 'fwBody', undefined, 8).lookAt(new THREE.Vector3(-0.639, 0, 0));
    }
  },
  flywheelHousing(g) {
    const ex: V = [-0.25, 0, 0];
    cyl(g, 0.29, 0.1, [-0.635, 0, 0], 'x', 'block', 'fhHousing', ex, 48, true, 0.31);
    profileX(g, (sh) => {
      sh.absarc(0, 0, 0.29, 0, Math.PI * 2, false);
      const h = new THREE.Path();
      h.absarc(0, 0, 0.09, 0, Math.PI * 2, true);
      sh.holes.push(h);
    }, 0.014, [-0.59, 0, 0], 'block', 'fhHousing', ex);
    // radial ribs, transmission bolt bosses on the rim (SAE 1 bolt circle), starter pad
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.13;
      const rib = box(g, [0.08, 0.012, 0.02], [-0.635, Math.cos(a) * 0.3, Math.sin(a) * 0.3], 'block', 'fhHousing', ex);
      rib.rotation.x = -a;
      bolt(g, [-0.69, Math.cos(a) * 0.3, Math.sin(a) * 0.3], '-x', 0.009, 'fhHousing', ex);
    }
    rbox(g, [0.07, 0.13, 0.05], [-0.64, -0.12, 0.3], 'block', 'fhHousing', ex, 0.01);
    for (const y of [-0.165, -0.075]) bolt(g, [-0.64, y, 0.329], 'z', 0.009, 'fhHousing', ex);
    cyl(g, 0.02, 0.01, [-0.64, -0.2, -0.29], 'z', 'dark', 'fhHousing', ex, 6); // timing pin access plug
    // rear gear train housing and its cover with bolts
    rbox(g, [0.04, 0.5, 0.2], [-0.595, 0.4, 0], 'block', 'fhHousing', ex, 0.012);
    boltRow(g, [-0.617, 0.18, 0.09], [-0.617, 0.63, 0.09], 5, '-x', 0.007, 'fhHousing', ex);
    boltRow(g, [-0.617, 0.18, -0.09], [-0.617, 0.63, -0.09], 5, '-x', 0.007, 'fhHousing', ex);
    // gear train: crank gear drives idlers up to the cam; each gear on a hub
    const ge: V = [-0.08, 0, 0.12];
    for (const [y, z, r, n] of [[0.16, 0.06, 0.075, 34], [0.34, 0.03, 0.065, 30], [0.48, -0.03, 0.06, 28]] as const) {
      gear(g, r, 0.03, n, [-0.575, y, z], 'forged', 'fhGears', ge);
      cyl(g, 0.022, 0.035, [-0.575, y, z], 'x', 'steel', 'fhGears', ge, 20);
      boltCircleX(g, -0.592, y, z, 0.014, 3, '-x', 0.005, 'fhGears', ge);
    }
  },
  oilPan(g) {
    const ex: V = [0, 0, 0];
    const Y0 = -0.05, Y1 = -0.31, YS = -0.17, XS = -0.12;
    // deep sump at the front (under the pickup), shallow section at the back
    rbox(g, [0.56 - XS, 0.012, 0.38], [(0.56 + XS) / 2, Y1, 0], 'pan', 'opPan', ex, 0.004);
    rbox(g, [XS + 0.56, 0.012, 0.38], [(XS - 0.56) / 2, YS, 0], 'pan', 'opPan', ex, 0.004);
    for (const s of [1, -1]) {
      rbox(g, [0.56 - XS, Y0 - Y1, 0.012], [(0.56 + XS) / 2, (Y0 + Y1) / 2, s * 0.19], 'pan', 'opPan', ex, 0.004);
      rbox(g, [XS + 0.56, Y0 - YS, 0.012], [(XS - 0.56) / 2, (Y0 + YS) / 2, s * 0.19], 'pan', 'opPan', ex, 0.004);
      // flange with bolts all the way round
      rbox(g, [1.14, 0.01, 0.03], [0, Y0, s * 0.2], 'pan', 'opPan', ex, 0.003);
      boltRow(g, [-0.52, Y0 - 0.009, s * 0.205], [0.52, Y0 - 0.009, s * 0.205], 10, '-y', 0.007, 'opPan', ex);
      // stiffening ribs
      for (let k = 0; k < 4; k++) rbox(g, [0.012, Y0 - Y1 - 0.04, 0.01], [0.05 + k * 0.15, (Y0 + Y1) / 2, s * 0.198], 'pan', 'opPan', ex, 0.003);
    }
    rbox(g, [0.012, Y0 - Y1, 0.38], [0.56, (Y0 + Y1) / 2, 0], 'pan', 'opPan', ex, 0.004);
    rbox(g, [0.012, Y0 - YS, 0.38], [-0.56, (Y0 + YS) / 2, 0], 'pan', 'opPan', ex, 0.004);
    rbox(g, [0.012, YS - Y1, 0.38], [XS, (YS + Y1) / 2, 0], 'pan', 'opPan', ex, 0.004);
    for (const x of [0.56, -0.56]) {
      rbox(g, [0.03, 0.01, 0.4], [x, Y0, 0], 'pan', 'opPan', ex, 0.003);
      boltRow(g, [x, Y0 - 0.009, -0.15], [x, Y0 - 0.009, 0.15], 4, '-y', 0.007, 'opPan', ex);
    }
    for (let k = 0; k < 3; k++) rbox(g, [0.6, 0.008, 0.012], [0.22, Y1 - 0.009, -0.12 + k * 0.12], 'pan', 'opPan', ex, 0.003);
    // magnetic drain plug, oil level sensor, dipstick tube and handle
    bolt(g, [0.35, Y1 - 0.012, 0.12], '-y', 0.014, 'opPlug', [0, -0.1, 0], 'steel');
    cyl(g, 0.018, 0.02, [0.0, YS - 0.012, 0.0], 'y', 'black', 'opPan', ex, 16);
    tube(g, [[0.15, -0.1, 0.197], [0.15, 0.1, 0.22], [0.15, 0.3, 0.255], [0.15, 0.43, 0.262]], 0.006, 'steel', 'opPan', ex);
    torus(g, 0.016, 0.004, [0.15, 0.452, 0.262], 'z', 'yellow', 'opPan', ex);
  },
  oilPump(g) {
    const ex: V = [0, 0.08, 0];
    rbox(g, [0.14, 0.08, 0.12], [0.32, -0.15, 0], 'block', 'pBody', ex, 0.01);
    for (const [dx, dz] of [[0.055, 0.045], [-0.055, 0.045], [0.055, -0.045], [-0.055, -0.045]] as const) bolt(g, [0.32 + dx, -0.105, dz], 'y', 0.007, 'pBody', ex);
    cyl(g, 0.03, 0.02, [0.32, -0.15, 0.065], 'z', 'steel', 'pBody', [0, 0.08, 0.1], 16);
    gear(g, 0.03, 0.02, 14, [0.32, -0.15, 0.08], 'forged', 'pBody', [0, 0.08, 0.14]).rotation.y = Math.PI / 2;
    cyl(g, 0.016, 0.04, [0.38, -0.15, -0.03], 'x', 'block', 'pBody', ex, 16); // relief valve boss
    cyl(g, 0.012, 0.006, [0.403, -0.15, -0.03], 'x', 'dark', 'pBody', ex, 6);
    const pe: V = [0, -0.05, 0];
    tube(g, [[0.28, -0.19, 0], [0.22, -0.24, 0], [0.12, -0.27, 0]], 0.014, 'steel', 'pPickup', pe);
    rbox(g, [0.04, 0.008, 0.04], [0.28, -0.192, 0], 'steel', 'pPickup', pe, 0.003);
    lathe(g, [[0.016, 0.012], [0.05, 0.004], [0.05, 0], [0.016, 0]], [0.1, -0.29, 0], 'steel', 'pPickup', pe, 'y', 32);
    // screen mesh
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.048, 24), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.4, wireframe: true }));
    mesh.rotation.x = Math.PI / 2;
    put(mesh, g, [0.1, -0.292, 0], 'pPickup', pe);
    // support bracket to a main cap
    rbox(g, [0.012, 0.06, 0.02], [0.16, -0.24, 0.02], 'steel', 'pPickup', pe, 0.003);
  },
  pistons(g, c) {
    // valve reliefs and bowl as a turned profile: skirt, three ring grooves, crown with a re-entrant "Mexican hat" bowl
    const prof: [number, number][] = [[0.058, -0.055], [0.0645, -0.055], [0.0645, -0.01]];
    for (const gy of [CH - 0.038, CH - 0.024, CH - 0.012]) prof.push([0.0645, gy - 0.0028], [0.0605, gy - 0.0028], [0.0605, gy + 0.0028], [0.0645, gy + 0.0028]);
    prof.push([0.0645, CH - 0.003], [0.0625, CH], [0.043, CH], [0.041, CH - 0.004], [0.038, CH - 0.015], [0.03, CH - 0.021], [0.018, CH - 0.019], [0.008, CH - 0.011], [0, CH - 0.006]);
    prof.push([0, CH - 0.034], [0.05, CH - 0.04], [0.056, -0.01], [0.058, -0.055]);
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.Group();
      put(cg, g, [CX(i), 0, 0]);
      cg.userData.inst = i;
      c.inst.push(cg);
      const pg = new THREE.Group();
      put(pg, cg, [0, R + L, 0]);
      pg.userData.piston = i + 1;
      lathe(pg, prof, [0, 0, 0], 'piston', 'pPiston', [0, 0.14, 0], 'y', 48);
      for (const [dx, dz] of [[0.025, 0.04], [-0.025, 0.04], [0.025, -0.04], [-0.025, -0.04]] as const) cyl(pg, 0.012, 0.0012, [dx * 1.05, CH - 0.0003, dz * 1.05], 'y', 'bowl', 'pPiston', [0, 0.14, 0], 20);
      for (const s of [1, -1]) cyl(pg, 0.021, 0.004, [s * 0.0625, 0, 0], 'x', 'bowl', 'pPiston', [0, 0.14, 0], 20); // pin bores
      torus(pg, 0.0628, 0.0024, [0, CH - 0.012, 0], 'y', 'steel', 'pRing1', [0, 0.34, 0]);
      torus(pg, 0.0628, 0.0024, [0, CH - 0.024, 0], 'y', 'forged', 'pRing2', [0, 0.3, 0]);
      torus(pg, 0.0628, 0.0028, [0, CH - 0.038, 0], 'y', 'dark', 'pRing3', [0, 0.26, 0]);
      lathe(pg, [[0.012, -0.05], [0.02, -0.05], [0.02, 0.05], [0.012, 0.05]], [0, 0, 0], 'steel', 'pPin', [0.2, 0, 0], 'x', 24);
      for (const s of [1, -1]) torus(pg, 0.018, 0.0018, [s * 0.051, 0, 0], 'x', 'steel', 'pPin', [s * 0.3, 0, 0]);
      // I-beam rod: small end with bushing, tapered beam, fracture-split big end, cap bolts
      const rod = new THREE.Group();
      put(rod, cg, [0, R + L, 0]);
      rod.userData.rod = i + 1;
      cyl(rod, 0.03, 0.04, [0, 0, 0], 'x', 'forged', 'pRod', undefined, 24);
      cyl(rod, 0.0205, 0.041, [0, 0, 0], 'x', 'bearing', 'pRod', undefined, 20);
      cyl(rod, 0.004, 0.012, [0, 0.032, 0], 'y', 'black', 'pRod', undefined, 8); // oil hole to the pin
      const beamLen = L - 0.09;
      for (const s of [1, -1]) {
        const fl = box(rod, [0.03, beamLen, 0.006], [0, -L / 2, s * 0.012], 'forged', 'pRod');
        fl.geometry.dispose();
        fl.geometry = new THREE.CylinderGeometry(0.013, 0.019, beamLen, 4, 1);
        fl.geometry.rotateY(Math.PI / 4);
        fl.geometry.scale(1, 1, 0.2);
      }
      box(rod, [0.01, beamLen, 0.024], [0, -L / 2, 0], 'forged', 'pRod');
      torus(rod, 0.055, 0.012, [0, -L, 0], 'x', 'forged', 'pRod', undefined, Math.PI);
      for (const s of [1, -1]) rbox(rod, [0.036, 0.03, 0.022], [0, -L + 0.004, s * 0.058], 'forged', 'pRod', undefined, 0.004);
      const cap = torus(rod, 0.055, 0.012, [0, -L, 0], 'x', 'forged', 'pCap', [0, -0.16, 0], Math.PI);
      cap.rotation.x = Math.PI;
      for (const s of [1, -1]) {
        rbox(rod, [0.036, 0.026, 0.022], [0, -L - 0.017, s * 0.058], 'forged', 'pCap', [0, -0.16, 0], 0.004);
        cyl(rod, 0.006, 0.07, [0, -L - 0.01, s * 0.058], 'y', 'steel', 'pCap', [0, -0.26, 0], 8);
        bolt(rod, [0, -L - 0.035, s * 0.058], '-y', 0.008, 'pCap', [0, -0.26, 0]);
      }
      const sh1 = cyl(rod, 0.046, 0.034, [0, -L, 0], 'x', 'bearing', 'pShells', [0, -0.06, 0], 24, true);
      sh1.material = mat('bearing');
      (sh1.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
  },
  mainCaps(g) {
    BULK.forEach((x, k) => {
      profileX(g, (sh) => {
        sh.moveTo(-0.08, -0.105);
        sh.lineTo(0.08, -0.105);
        sh.lineTo(0.08, -0.05);
        sh.lineTo(0.058, -0.05);
        sh.lineTo(0.058, 0);
        sh.absarc(0, 0, 0.058, 0, -Math.PI, true);
        sh.lineTo(-0.058, -0.05);
        sh.lineTo(-0.08, -0.05);
      }, 0.024, [x, 0, 0], 'block', 'mcCaps', [0, -0.12, 0]);
      for (const s of [1, -1]) bolt(g, [x, -0.112, s * 0.065], '-y', 0.011, 'mcBolts', [0, -0.22, 0]);
      // position number and front arrow cast into each cap
      for (let d = 0; d <= k; d++) cyl(g, 0.003, 0.002, [x + 0.0125, -0.095, -0.03 + d * 0.009], 'x', 'black', 'mcCaps', [0, -0.12, 0], 8);
      box(g, [0.002, 0.004, 0.02], [x + 0.0125, -0.08, 0.03], 'black', 'mcCaps', [0, -0.12, 0]);
    });
  },
  crankshaft(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    for (const x of BULK) {
      cyl(spin, 0.05, 0.03, [x, 0, 0], 'x', 'steel', 'ckMain', undefined, 28);
      cyl(spin, 0.004, 0.004, [x, 0.049, 0], 'y', 'black', 'ckMain', undefined, 8); // oil hole
    }
    // nose with keyway and the rear flange with its flywheel bolt holes
    cyl(spin, 0.035, 0.12, [0.63, 0, 0], 'x', 'steel', 'ckMain', undefined, 20);
    box(spin, [0.06, 0.006, 0.01], [0.66, 0.034, 0], 'black', 'ckMain');
    cyl(spin, 0.075, 0.03, [-0.555, 0, 0], 'x', 'forged', 'ckMain', undefined, 32);
    for (let k = 0; k < 8; k++) cyl(spin, 0.007, 0.031, [-0.555, Math.cos(k * 0.785) * 0.06, Math.sin(k * 0.785) * 0.06], 'x', 'black', 'ckMain', undefined, 10);
    gear(spin, 0.07, 0.025, 30, [-0.52, 0, 0], 'steel', 'ckGear', [-0.15, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const n = i + 1, idx = FIRING.indexOf(n);
      const throwG = new THREE.Group();
      put(throwG, spin, [CX(i), 0, 0]);
      throwG.rotation.x = ((-120 * idx) * Math.PI) / 180;
      cyl(throwG, 0.045, 0.048, [0, R, 0], 'x', 'steel', 'ckPins', undefined, 28);
      cyl(throwG, 0.004, 0.004, [0, R + 0.044, 0], 'y', 'black', 'ckPins', undefined, 8);
      for (const s of [1, -1]) {
        torus(throwG, 0.045, 0.004, [s * 0.024, R, 0], 'x', 'steel', 'ckPins'); // fillet roll
        profileX(throwG, (sh) => {
          sh.moveTo(-0.052, 0);
          sh.lineTo(-0.045, R);
          sh.absarc(0, R, 0.05, Math.PI, 0, true);
          sh.lineTo(0.052, 0);
          sh.absarc(0, -0.02, 0.105, 0.2, Math.PI - 0.2, true);
        }, 0.026, [s * 0.04, 0, 0], 'forged', 'ckWeights');
      }
    }
  },
  mainBearings(g) {
    for (const x of BULK) {
      const sh = cyl(g, 0.051, 0.028, [x, 0, 0], 'x', 'bearing', 'mbUpper', [0, 0.1, 0], 28, true);
      (sh.geometry as THREE.CylinderGeometry).dispose();
      sh.geometry = new THREE.CylinderGeometry(0.051, 0.051, 0.028, 28, 1, true, -Math.PI / 2, Math.PI);
      sh.geometry.rotateZ(Math.PI / 2);
      (sh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      // oil groove and feed hole in each upper shell
      const gr = torus(g, 0.0505, 0.002, [x, 0, 0], 'x', 'dark', 'mbUpper', [0, 0.1, 0], Math.PI);
      cyl(g, 0.004, 0.004, [x, 0.05, 0], 'y', 'black', 'mbUpper', [0, 0.1, 0], 8);
    }
    for (const s of [1, -1]) torus(g, 0.062, 0.004, [s * 0.015, 0, 0], 'x', 'bearing', 'mbThrust', [s * 0.08, 0.1, 0], Math.PI);
  },
};

// ---------------- mount ----------------
export function mountTeardown(root: HTMLElement) {
  root.innerHTML = `
  <h2>Engine teardown · take it apart</h2>
  <div class="v3wrap tdWrap">
    <div>
      <div class="v3box" id="td3d"><div class="tdTip" id="tdTip"></div><div class="tdInspect" id="tdInspect" hidden>
        <b id="tdInsName"></b><label>Explode <input type="range" id="tdExplode" min="0" max="100" value="100"></label><button id="tdBack">Back to the engine</button></div></div>
      <div class="bar tdBar">
        <button id="tdNext" class="dark">Remove next part</button><button id="tdPrev">Install last part</button>
        <button id="tdStrip">Strip to the block</button><button id="tdBuild">Rebuild it</button>
        <button id="tdTurn">Turn the crank</button><button id="tdView">Look at the bench</button>
      </div>
      <p class="note" style="margin:6px 0 0">Inline six, 130 mm bore, 162 mm stroke, firing order 1-5-3-6-2-4. Click a part to select it; drag to orbit, scroll to zoom. Parts come off in a real shop order: a part can only come off once everything covering it is off, and goes back on in reverse.</p>
    </div>
    <div>
      <div class="tdProg"><span id="tdCount"></span><i><b id="tdBarFill"></b></i></div>
      <ol class="tdSteps" id="tdSteps"></ol>
      <div class="egCard" id="tdCard"></div>
    </div>
  </div>`;
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement;
  const box3d = $('td3d');

  // ----- build components -----
  const world = new THREE.Group();
  const comps: Comp[] = [];
  const byId = new Map<string, Comp>();
  TEARDOWN.forEach((part, order) => {
    const c: Comp = { part, order, g: new THREE.Group(), mats: new Map(), removed: false, bench: new THREE.Vector3(), inst: [] };
    if (part.id === 'valves') c.rideWith = 'head';
    cur = c;
    c.g.userData.comp = part.id;
    builders[part.id](c.g, c);
    world.add(c.g);
    comps.push(c);
    byId.set(part.id, c);
  });
  // bench spots: rows on the floor on both sides of the engine, packed by size, in removal order
  {
    const rows = [{ z: 0.95, x: -1.2 }, { z: -0.95, x: -1.2 }, { z: 1.55, x: -1.2 }, { z: -1.55, x: -1.2 }, { z: 2.15, x: -1.2 }, { z: -2.15, x: -1.2 }];
    for (const c of comps) {
      if (c.part.id === 'block') continue;
      const bb = new THREE.Box3().setFromObject(c.g);
      const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
      const host = c.rideWith ? byId.get(c.rideWith)! : null;
      let row = rows.reduce((a, b) => (b.x < a.x ? b : a));
      if (row.x + size.x > 1.6) row = rows.reduce((a, b) => (b.x < a.x ? b : a));
      const tx = row.x + size.x / 2, tz = row.z;
      row.x += size.x + 0.12;
      c.bench.set(tx - ctr.x, FLOOR - bb.min.y + 0.005, tz - ctr.z);
      if (host) c.bench.y += 0.25; // valves sit on a rack above the floor
    }
  }

  // ----- renderer -----
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050507);
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202026, 0.9));
  for (const [c, i, p] of [[0xffffff, 0.9, [3, 6, 4]], [0x88aaff, 0.35, [-4, 2, -3]], [0xfff2e0, 0.45, [4, 1, -4]]] as [number, number, V][]) {
    const d = new THREE.DirectionalLight(c, i);
    d.position.set(p[0], p[1], p[2]);
    scene.add(d);
  }
  scene.add(world);
  const grid = new THREE.GridHelper(6, 30, 0x1d1d25, 0x121217);
  grid.position.y = FLOOR;
  scene.add(grid);
  // engine stand: pedestal at the rear bolted to the block, so the engine stays up while everything comes off
  {
    cur = { mats: new Map() } as Comp;
    const st = new THREE.Group();
    box(st, [0.5, 0.03, 0.6], [-1.0, FLOOR + 0.015, 0], 'red');
    box(st, [0.08, 0.6, 0.08], [-1.0, FLOOR + 0.3, 0], 'red');
    box(st, [0.32, 0.06, 0.06], [-0.86, 0.0, 0], 'red');
    for (const s of [1, -1]) box(st, [0.06, 0.06, 0.32], [-0.74, 0.0, s * 0.12], 'red');
    for (const s of [1, -1]) box(st, [0.06, 0.04, 0.04], [-0.71, 0.0, s * 0.27], 'red');
    scene.add(st);
  }
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  let controls: OrbitControls | null = null;
  const labels = document.createElement('div');
  labels.className = 'h3labels';
  box3d.appendChild(labels);

  // ----- state -----
  const S = {
    sel: null as string | null,
    phi: 0,
    turning: false,
    inspect: null as string | null,
    explode: 1,
    subSel: null as string | null,
    queue: [] as { c: Comp; to: boolean }[],
    anim: null as null | { c: Comp; t0: number; from: THREE.Vector3; to: THREE.Vector3; lift: number },
    tween: null as null | { t0: number; fp: THREE.Vector3; tp: THREE.Vector3; ft: THREE.Vector3; tt: THREE.Vector3 },
    subLabs: [] as { el: HTMLElement; obj: THREE.Object3D }[],
  };
  const canRemove = (c: Comp) => !c.removed && c.part.id !== 'block' && c.part.needs.every((n) => byId.get(n)!.removed);
  const blockersOff = (c: Comp) => c.part.needs.filter((n) => !byId.get(n)!.removed).map((n) => byId.get(n)!.part.name);
  // install X only when everything X sits on is back in place (valves ride the head, so they go back into it on the bench first)
  const installBlockers = (c: Comp) => comps.filter((d) => d.part.needs.includes(c.part.id) && d.rideWith !== c.part.id && d.removed).map((d) => d.part.name);
  const restPos = (c: Comp): THREE.Vector3 => {
    if (c.removed) return c.bench.clone();
    if (c.rideWith) {
      const h = byId.get(c.rideWith)!;
      if (h.removed) return h.bench.clone();
    }
    return new THREE.Vector3();
  };

  // ----- pose: crank, pistons, rods, cam, rockers, valves -----
  function pose(phi: number) {
    for (const c of comps) {
      const live = !c.removed && !(c.rideWith && byId.get(c.rideWith)!.removed);
      if (!live && S.inspect !== c.part.id) continue;
      const p = S.inspect === c.part.id ? 0 : phi;
      const pr = (p * Math.PI) / 180;
      for (const o of c.inst) {
        if (o.userData.spin === 'crank') o.rotation.x = pr;
        if (o.userData.spin === 'cam') o.rotation.x = pr / 2;
      }
      if (c.part.id === 'pistons') {
        for (const cg of c.inst) {
          cg.children.forEach((ch) => {
            const n = (ch.userData.piston ?? ch.userData.rod) as number | undefined;
            if (!n) return;
            const a = (cylinderAngle(p, n) * Math.PI) / 180;
            const yp = R * Math.cos(a), zp = R * Math.sin(a);
            const yw = yp + Math.sqrt(L * L - zp * zp);
            ch.position.y = yw;
            if (ch.userData.rod) ch.rotation.x = Math.asin(zp / L);
          });
        }
      }
      if (c.part.id === 'rockers') {
        for (const o of c.inst) {
          const r = o.userData.rocker;
          if (!r) continue;
          const lift = valveLift(cylinderAngle(p, r.cyl), r.valve);
          o.rotation.x = (r.valve === 'intake' ? 1 : -1) * lift * 0.3;
        }
        c.g.children.forEach((o) => {
          const b = o.userData.bridge;
          if (b) o.position.y = (o.userData.p0 as THREE.Vector3).y - valveLift(cylinderAngle(p, b.cyl), b.valve) * VLIFT * (S.inspect === c.part.id ? 0 : 1);
        });
      }
      if (c.part.id === 'valves') {
        for (const cg of c.inst) {
          const n = (cg.userData.inst as number) + 1;
          cg.children.forEach((vg) => {
            if (!vg.userData.valve) return;
            vg.position.y = -valveLift(cylinderAngle(p, n), vg.userData.valve) * VLIFT;
          });
        }
      }
    }
  }

  // ----- highlight -----
  function paint() {
    for (const c of comps) {
      const on = S.sel === c.part.id && !S.inspect;
      c.mats.forEach((m) => m.emissive.setHex(on ? 0x3a2a00 : 0x000000));
    }
  }

  // ----- UI -----
  const stepsEl = $('tdSteps');
  function renderSteps() {
    const off = comps.filter((c) => c.removed).length;
    const total = comps.length - 1;
    $('tdCount').textContent = off === 0 ? `Assembled · ${total} parts to remove` : off === total ? `Stripped to the bare block · ${total} of ${total} off` : `${off} of ${total} parts off`;
    ($('tdBarFill') as HTMLElement).style.width = `${(off / total) * 100}%`;
    stepsEl.innerHTML = comps
      .filter((c) => c.part.id !== 'block')
      .map((c) => {
        const st = c.removed ? 'off' : canRemove(c) ? 'next' : '';
        return `<li data-id="${c.part.id}" class="${st}${S.sel === c.part.id ? ' sel' : ''}"><span>${c.order + 1}</span>${esc(c.part.name)}</li>`;
      })
      .join('') + `<li data-id="block" class="${S.sel === 'block' ? 'sel' : ''}"><span>·</span>Cylinder block (stays on the stand)</li>`;
    ($('tdNext') as HTMLButtonElement).disabled = !comps.some(canRemove);
    ($('tdPrev') as HTMLButtonElement).disabled = !comps.some((c) => c.removed);
  }
  function renderCard() {
    const card = $('tdCard');
    const c = S.sel ? byId.get(S.sel) : null;
    if (!c) {
      card.innerHTML = `<p class="muted">Press <b>Remove next part</b> to take the engine apart one step at a time, or click any part. Every part can then be opened on the inspection bench to see the pieces it is made of.</p>`;
      return;
    }
    const p = c.part;
    const block = p.id === 'block';
    const why = !c.removed && !block && !canRemove(c) ? `<p class="small muted">Comes off after: ${esc(blockersOff(c).join(', '))}.</p>` : '';
    const ib = c.removed ? installBlockers(c) : [];
    const whyIn = c.removed && ib.length ? `<p class="small muted">Goes back on after: ${esc(ib.join(', '))}.</p>` : '';
    const sub = S.inspect && S.subSel ? p.subs.find((s) => s.id === S.subSel) : null;
    card.innerHTML = `
      <h4>${esc(p.name)} <span class="muted small" style="letter-spacing:.08em">${block ? '· stays on the stand' : `· step ${c.order + 1} of ${comps.length - 1}`}</span></h4>
      <div class="egDetail">${detailHTML(p.id, esc) || `<p>${esc(p.does)}</p>`}</div>
      <p><span class="k">Made of</span>${esc(p.made)}</p>
      <p><span class="k">Inspect</span>${esc(p.inspect)}</p>
      <p><span class="k">Removal</span>${esc(p.removal)}</p>
      ${why}${whyIn}
      <div class="bar" style="margin-top:8px;flex-wrap:wrap">
        ${block ? '' : c.removed ? `<button id="tdIn" ${ib.length ? 'disabled' : ''}>Install</button>` : `<button id="tdOut" ${canRemove(c) ? '' : 'disabled'}>Remove</button>`}
        <button id="tdIns" class="dark">${S.inspect === p.id ? 'Close inspection' : 'Take it apart on the bench'}</button>
      </div>
      <div class="tdSubs"><div class="lab" style="margin:10px 0 4px">Made up of</div>${p.subs.map((s) => `<button data-sub="${s.id}" class="${S.subSel === s.id ? 'on' : ''}">${esc(s.name)}</button>`).join('')}</div>
      ${sub ? `<div class="tdSub"><b>${esc(sub.name)}</b><p>${esc(sub.does)}</p><p><span class="k">Made of</span>${esc(sub.made)}</p>${detailFor(sub.id) && detailFor(sub.id) !== detailFor(p.id) ? `<details><summary>More on ${esc(detailFor(sub.id)!.title.toLowerCase())}</summary>${detailHTML(sub.id, esc)}</details>` : ''}</div>` : ''}`;
  }
  function select(id: string | null) {
    S.sel = id;
    if (!S.inspect) S.subSel = null;
    paint();
    renderSteps();
    renderCard();
  }

  // ----- removal / install animation -----
  function enqueue(c: Comp, removed: boolean) {
    S.queue.push({ c, to: removed });
  }
  function startNext() {
    if (S.anim || !S.queue.length) return;
    const { c, to } = S.queue.shift()!;
    if (to ? !canRemove(c) : installBlockers(c).length || !c.removed) {
      startNext();
      return;
    }
    const from = c.g.position.clone();
    c.removed = to;
    S.anim = { c, t0: performance.now(), from, to: restPos(c), lift: 0.45 + (c.g.userData.liftExtra || 0) };
    renderSteps();
    renderCard();
  }
  function stepAnim(now: number) {
    const a = S.anim;
    if (!a) return;
    const dur = S.queue.length > 3 ? 450 : 900;
    const t = Math.min(1, (now - a.t0) / dur);
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const p = a.from.clone().lerp(a.to, k);
    p.y += Math.sin(Math.PI * t) * a.lift;
    a.c.g.position.copy(p);
    for (const r of comps) if (r.rideWith === a.c.part.id && !r.removed) r.g.position.copy(p);
    if (t >= 1) {
      S.anim = null;
      for (const r of comps) if (r.rideWith === a.c.part.id) r.g.position.copy(restPos(r));
      startNext();
    }
  }
  function removeNext() {
    const c = comps.find((x) => canRemove(x) && !S.queue.some((q) => q.c === x));
    if (c) {
      enqueue(c, true);
      select(c.part.id);
      startNext();
    }
  }
  function installLast() {
    const c = [...comps].reverse().find((x) => x.removed && !installBlockers(x).length);
    if (c) {
      enqueue(c, false);
      select(c.part.id);
      startNext();
    }
  }
  function stripAll() {
    exitInspect();
    const sim = new Set(comps.filter((c) => c.removed).map((c) => c.part.id));
    for (const c of comps) {
      if (sim.has(c.part.id) || c.part.id === 'block') continue;
      if (c.part.needs.every((n) => sim.has(n))) {
        enqueue(c, true);
        sim.add(c.part.id);
      }
    }
    // second pass catches parts whose prerequisites come later in the list
    for (let pass = 0; pass < 3; pass++)
      for (const c of comps) {
        if (sim.has(c.part.id) || c.part.id === 'block') continue;
        if (c.part.needs.every((n) => sim.has(n))) {
          enqueue(c, true);
          sim.add(c.part.id);
        }
      }
    startNext();
    flyBench();
  }
  function buildAll() {
    exitInspect();
    const off = new Set(comps.filter((c) => c.removed).map((c) => c.part.id));
    for (let pass = 0; pass < 30 && off.size; pass++) {
      for (const c of [...comps].reverse()) {
        if (!off.has(c.part.id)) continue;
        const blocked = comps.some((d) => d.part.needs.includes(c.part.id) && d.rideWith !== c.part.id && off.has(d.part.id));
        if (!blocked) {
          enqueue(c, false);
          off.delete(c.part.id);
        }
      }
    }
    startNext();
    flyHome();
  }

  // ----- inspection bench -----
  function setExplode() {
    const c = S.inspect ? byId.get(S.inspect)! : null;
    for (const cc of comps) {
      cc.g.traverse((o) => {
        if (!o.userData.ex) return;
        const k = c === cc ? S.explode : 0;
        o.position.copy(o.userData.p0 as THREE.Vector3).addScaledVector(o.userData.ex as THREE.Vector3, k);
      });
    }
  }
  function enterInspect(id: string) {
    const c = byId.get(id)!;
    S.inspect = id;
    S.subSel = null;
    S.turning = false;
    $('tdTurn').textContent = 'Turn the crank';
    for (const cc of comps) cc.g.visible = cc === c;
    grid.visible = false;
    scene.children.forEach((o) => {
      if (o.type === 'Group' && o !== world) o.visible = false;
    });
    // only one cylinder's set for the per-cylinder parts, so its pieces can spread out
    for (const o of c.inst) if (typeof o.userData.inst === 'number') o.visible = o.userData.inst === 0;
    c.g.position.set(0, 0, 0);
    pose(0);
    S.explode = 1;
    ($('tdExplode') as HTMLInputElement).value = '100';
    setExplode();
    world.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    c.g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && visibleUp(o)) bb.expandByObject(o);
    });
    const ctr = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()).length();
    const dir = new THREE.Vector3(0.9, 0.55, 1.1).normalize();
    fly(ctr.clone().addScaledVector(dir, Math.max(0.4, size * 1.35)), ctr);
    $('tdInspect').hidden = false;
    $('tdInsName').textContent = c.part.name;
    buildSubLabels(c);
    paint();
    renderCard();
  }
  function exitInspect() {
    if (!S.inspect) return;
    const c = byId.get(S.inspect)!;
    S.inspect = null;
    S.subSel = null;
    for (const cc of comps) cc.g.visible = true;
    for (const o of c.inst) o.visible = true;
    grid.visible = true;
    scene.children.forEach((o) => {
      if (o.type === 'Group') o.visible = true;
    });
    setExplode();
    c.g.position.copy(restPos(c));
    pose(S.phi);
    $('tdInspect').hidden = true;
    labels.innerHTML = '';
    S.subLabs = [];
    paint();
    renderCard();
    flyHome();
  }
  function visibleUp(o: THREE.Object3D | null) {
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }
  function buildSubLabels(c: Comp) {
    labels.innerHTML = '';
    S.subLabs = [];
    const seen = new Set<string>();
    c.g.traverse((o) => {
      const id = o.userData.sub as string | undefined;
      if (!id || seen.has(id) || !(o as THREE.Mesh).isMesh || !visibleUp(o)) return;
      seen.add(id);
      const s = c.part.subs.find((x) => x.id === id);
      if (!s) return;
      const el = document.createElement('div');
      el.className = 'h3lab v3spot';
      el.textContent = s.name;
      el.dataset.sub = id;
      el.addEventListener('click', () => pickSub(id));
      labels.appendChild(el);
      S.subLabs.push({ el, obj: o });
    });
  }
  function pickSub(id: string) {
    S.subSel = S.subSel === id ? null : id;
    S.subLabs.forEach((l) => l.el.classList.toggle('on', l.el.dataset.sub === S.subSel));
    const c = byId.get(S.inspect!)!;
    // tint the chosen sub-part by giving its meshes a temporary emissive material
    c.g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mine = (o.userData.sub ?? o.parent?.userData.sub) === S.subSel && S.subSel;
      if (mine) {
        if (!o.userData.baseMat) {
          o.userData.baseMat = mesh.material;
          const m2 = (mesh.material as THREE.MeshStandardMaterial).clone();
          m2.emissive.setHex(0x4a3300);
          mesh.material = m2;
        }
      } else if (o.userData.baseMat) {
        mesh.material = o.userData.baseMat;
        delete o.userData.baseMat;
      }
    });
    renderCard();
  }

  // ----- camera -----
  function fly(pos: THREE.Vector3, tgt: THREE.Vector3) {
    if (!controls) {
      camera.position.copy(pos);
      return;
    }
    S.tween = { t0: performance.now(), fp: camera.position.clone(), tp: pos, ft: controls.target.clone(), tt: tgt };
  }
  const flyHome = () => fly(new THREE.Vector3(1.55, 1.05, 1.75), new THREE.Vector3(0, 0.15, 0));
  const flyBench = () => fly(new THREE.Vector3(2.4, 2.9, 3.6), new THREE.Vector3(0, -0.3, 0));

  // ----- events -----
  $('tdNext').addEventListener('click', () => {
    exitInspect();
    removeNext();
  });
  $('tdPrev').addEventListener('click', () => {
    exitInspect();
    installLast();
  });
  $('tdStrip').addEventListener('click', stripAll);
  $('tdBuild').addEventListener('click', buildAll);
  $('tdTurn').addEventListener('click', () => {
    if (S.inspect) exitInspect();
    S.turning = !S.turning;
    $('tdTurn').textContent = S.turning ? 'Stop the crank' : 'Turn the crank';
  });
  let benchView = false;
  $('tdView').addEventListener('click', () => {
    exitInspect();
    benchView = !benchView;
    $('tdView').textContent = benchView ? 'Look at the engine' : 'Look at the bench';
    if (benchView) flyBench();
    else flyHome();
  });
  $('tdBack').addEventListener('click', exitInspect);
  $('tdExplode').addEventListener('input', (e) => {
    S.explode = +(e.target as HTMLInputElement).value / 100;
    setExplode();
  });
  stepsEl.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li[data-id]') as HTMLElement | null;
    if (!li) return;
    if (S.inspect && li.dataset.id !== S.inspect) exitInspect();
    select(li.dataset.id!);
  });
  $('tdCard').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const c = S.sel ? byId.get(S.sel) : null;
    if (!c) return;
    if (t.id === 'tdOut') {
      exitInspect();
      enqueue(c, true);
      startNext();
    } else if (t.id === 'tdIn') {
      exitInspect();
      enqueue(c, false);
      startNext();
    } else if (t.id === 'tdIns') {
      if (S.inspect === c.part.id) exitInspect();
      else enterInspect(c.part.id);
    } else if (t.dataset.sub) {
      if (S.inspect !== c.part.id) enterInspect(c.part.id);
      pickSub(t.dataset.sub);
    }
  });

  // ----- init 3D lazily (when the page is shown) -----
  function init() {
    if (renderer) return;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      box3d.insertAdjacentHTML('afterbegin', '<p class="muted" style="padding:20px">WebGL is not available in this browser.</p>');
      return;
    }
    const r = renderer;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    box3d.insertBefore(r.domElement, box3d.firstChild);
    controls = new OrbitControls(camera, r.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    camera.position.set(1.55, 1.05, 1.75);
    controls.target.set(0, 0.15, 0);
    const resize = () => {
      const w = box3d.clientWidth || 600, h = box3d.clientHeight || 420;
      r.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    new ResizeObserver(resize).observe(box3d);
    const ray = new THREE.Raycaster();
    const pickAt = (ev: PointerEvent) => {
      const rc = r.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(world.children, true).find((h) => visibleUp(h.object));
      return hit ? hit.object : null;
    };
    const compOf = (o: THREE.Object3D | null) => {
      while (o && !o.userData.comp) o = o.parent;
      return o ? (o.userData.comp as string) : null;
    };
    const subOf = (o: THREE.Object3D | null) => {
      while (o && !o.userData.sub) o = o.parent;
      return o ? (o.userData.sub as string) : null;
    };
    let down: [number, number] | null = null;
    let hoverT = 0;
    r.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5;
      down = null;
      if (moved) return;
      const o = pickAt(e);
      if (S.inspect) {
        const s = subOf(o);
        if (s) pickSub(s);
        return;
      }
      const id = compOf(o);
      select(id === S.sel ? null : id);
    });
    const tip = $('tdTip');
    r.domElement.addEventListener('pointermove', (e) => {
      if (performance.now() - hoverT < 60) return;
      hoverT = performance.now();
      const o = pickAt(e);
      let name = '';
      if (S.inspect) {
        const s = subOf(o);
        name = s ? byId.get(S.inspect)!.part.subs.find((x) => x.id === s)?.name ?? '' : '';
      } else {
        const id = compOf(o);
        name = id ? byId.get(id)!.part.name : '';
      }
      tip.textContent = name;
      tip.style.display = name ? 'block' : 'none';
      const rc = box3d.getBoundingClientRect();
      tip.style.left = `${e.clientX - rc.left + 14}px`;
      tip.style.top = `${e.clientY - rc.top + 10}px`;
    });
    r.domElement.addEventListener('pointerleave', () => (tip.style.display = 'none'));
    let last = performance.now();
    const v = new THREE.Vector3();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!box3d.offsetParent) return;
      stepAnim(now);
      if (S.turning && !S.inspect) {
        S.phi = (S.phi + dt * 90) % 720; // 15 rpm: slow enough to follow every stroke
        pose(S.phi);
      }
      if (S.tween && controls) {
        const t = Math.min(1, (now - S.tween.t0) / 800), k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(S.tween.fp, S.tween.tp, k);
        controls.target.lerpVectors(S.tween.ft, S.tween.tt, k);
        if (t >= 1) S.tween = null;
      }
      controls!.update();
      r.render(scene, camera);
      if (S.subLabs.length) {
        const w = box3d.clientWidth, h = box3d.clientHeight;
        for (const l of S.subLabs) {
          new THREE.Box3().setFromObject(l.obj).getCenter(v);
          v.project(camera);
          l.el.style.left = `${((v.x + 1) / 2) * w}px`;
          l.el.style.top = `${((1 - v.y) / 2) * h}px`;
        }
      }
    };
    requestAnimationFrame(loop);
  }
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) init();
  });
  io.observe(box3d);
  pose(0);
  renderSteps();
  renderCard();
}
