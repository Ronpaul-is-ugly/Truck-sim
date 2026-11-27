// Engine teardown bench. A procedurally built inline six (same dimensions as ENGINE_SPEC: 130 mm bore, 162 mm stroke,
// 256 mm rods, firing order 1-5-3-6-2-4) made of separate parts, so it can be taken apart in a realistic order, laid out
// on the floor, and every part opened up into its sub-parts on the inspection bench. The crank turns the real
// kinematics: pistons and rods from the crank throw, cam at half speed, rockers and valves from the valve timing.
// (The MX-13 GLB used by the multimeter and the 3D panel above is one welded mesh per material, so it can't come apart.)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ENGINE_SPEC, cylinderAngle, valveLift } from '../engine';
import { TEARDOWN, type TeardownPart } from './teardown-data';

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
function mat(k: string) {
  let m = cur.mats.get(k);
  if (!m) {
    const [c, metal, rough] = MAT[k];
    m = new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, side: k === 'liner' ? THREE.DoubleSide : THREE.FrontSide });
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

// ---------------- the parts ----------------
const builders: Record<string, (g: THREE.Group, c: Comp) => void> = {
  block(g) {
    const holes = Array.from({ length: 6 }, (_, i) => [CX(i), 0, 0.074] as [number, number, number]);
    plate(g, [[-0.56, -0.155], [0.56, -0.155], [0.56, 0.155], [-0.56, 0.155]], holes, 0.17, DECK - 0.17, 'block', 'bCasting');
    // crankcase skirt, front and rear walls, bulkheads with main bearing saddles
    for (const s of [1, -1]) {
      box(g, [1.12, 0.22, 0.02], [0, 0.06, s * 0.185], 'block', 'bCasting');
      box(g, [1.12, 0.03, 0.04], [0, 0.155, s * 0.165], 'block', 'bCasting');
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
    // coolant and oil gallery bosses, core plugs
    for (const s of [1, -1]) for (let i = 0; i < 6; i++) cyl(g, 0.022, 0.012, [CX(i), 0.3, s * 0.161], 'z', 'steel', 'bCasting');
    cyl(g, 0.02, 1.12, [0, 0.18, 0.15], 'x', 'block', 'bCasting', undefined, 16);
  },
  liners(g, c) {
    for (let i = 0; i < 6; i++) {
      const li = new THREE.Group();
      put(li, g, [CX(i), 0, 0]);
      li.userData.inst = i;
      c.inst.push(li);
      cyl(li, 0.0665, 0.245, [0, 0.293, 0], 'y', 'liner', 'lSleeve', [0, 0.12, 0], 40, true);
      cyl(li, 0.0655, 0.245, [0, 0.293, 0], 'y', 'liner', 'lSleeve', [0, 0.12, 0], 40, true);
      torus(li, 0.071, 0.006, [0, DECK - 0.004, 0], 'y', 'liner', 'lSleeve', [0, 0.12, 0]);
      for (const y of [0.19, 0.205]) torus(li, 0.067, 0.0035, [0, y, 0], 'y', 'rubber', 'lSeals', [0, -0.05, 0]);
    }
  },
  headGasket(g) {
    const holes = Array.from({ length: 6 }, (_, i) => [CX(i), 0, 0.066] as [number, number, number]);
    plate(g, [[-0.56, -0.155], [0.56, -0.155], [0.56, 0.155], [-0.56, 0.155]], holes, DECK, 0.003, 'gasket', 'hgBody');
    for (let i = 0; i < 6; i++) torus(g, 0.0675, 0.0028, [CX(i), DECK + 0.002, 0], 'y', 'steel', 'hgRings', [0, 0.06, 0]);
  },
  head(g) {
    box(g, [1.12, HEAD_TOP - DECK - 0.003, 0.31], [0, (HEAD_TOP + DECK + 0.003) / 2, 0], 'head', 'hCasting');
    for (let i = 0; i < 6; i++) {
      // port stubs, valve seats and the injector bore on the fire deck (seen when the head is turned over)
      box(g, [0.1, 0.05, 0.03], [CX(i), 0.49, 0.168], 'head', 'hCasting');
      box(g, [0.09, 0.045, 0.03], [CX(i), 0.49, -0.168], 'head', 'hCasting');
      for (const [dx, dz] of [[0.025, 0.04], [-0.025, 0.04], [0.025, -0.04], [-0.025, -0.04]] as const) torus(g, 0.019, 0.003, [CX(i) + dx, DECK + 0.003, dz], 'y', 'steel', 'hCasting');
      for (const s of [1, -1]) cyl(g, 0.012, 0.03, [CX(i) + 0.08, HEAD_TOP + 0.012, s * 0.125], 'y', 'dark', 'hBolts', [0, 0.25, 0], 6);
      for (const s of [1, -1]) cyl(g, 0.006, 0.14, [CX(i) + 0.08, HEAD_TOP - 0.045, s * 0.125], 'y', 'dark', 'hBolts', [0, 0.25, 0], 6);
    }
    for (const s of [1, -1]) cyl(g, 0.012, 0.03, [-0.48, HEAD_TOP + 0.012, s * 0.125], 'y', 'dark', 'hBolts', [0, 0.25, 0], 6);
    // cam towers
    for (const x of BULK) box(g, [0.026, 0.05, 0.06], [x, HEAD_TOP + 0.025, 0], 'head', 'hCasting');
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
        cyl(vg, 0.0045, 0.17, [0, DECK + 0.09, 0], 'y', intake ? 'steel' : 'forged', sub, exv, 10);
        cyl(vg, intake ? 0.02 : 0.018, 0.005, [0, DECK + 0.004, 0], 'y', intake ? 'steel' : 'forged', sub, exv, 24, false, 0.008);
        helix(vg, 0.013, HEAD_TOP, 0.585, 6, 0.0022, [0, 0, 0], 'spring', 'vSprings', [dx * 3, 0.07, dz * 2.5]);
        cyl(vg, 0.016, 0.005, [0, 0.587, 0], 'y', 'steel', 'vRetainers', [dx * 3, 0.13, dz * 2.5], 20);
      }
    }
  },
  injectors(g, c) {
    for (let i = 0; i < 6; i++) {
      const ig = new THREE.Group();
      put(ig, g, [CX(i), 0, 0]);
      ig.userData.inst = i;
      c.inst.push(ig);
      cyl(ig, 0.011, 0.11, [0, 0.47, 0], 'y', 'steel', 'injBody', [0, 0.05, 0], 16);
      cyl(ig, 0.016, 0.03, [0, 0.54, 0], 'y', 'black', 'injBody', [0, 0.05, 0], 16);
      cyl(ig, 0.004, 0.008, [0, 0.564, 0], 'y', 'copper', 'injBody', [0, 0.05, 0], 8);
      cyl(ig, 0.006, 0.05, [0, 0.4, 0], 'y', 'forged', 'injNozzle', [0, -0.06, 0], 12, false, 0.0035);
      torus(ig, 0.011, 0.0025, [0, 0.43, 0], 'y', 'copper', 'injWasher', [0, -0.02, 0.05]);
      cyl(ig, 0.004, 0.17, [0, 0.445, 0.085], 'z', 'steel', 'injBody', [0, 0.05, 0], 8); // quill to the rail line
    }
  },
  fuel(g) {
    cyl(g, 0.022, 0.86, [0.02, 0.36, 0.215], 'x', 'forged', 'fRail', [0, 0.15, 0.12]);
    for (const x of [-0.41, 0.45]) cyl(g, 0.026, 0.03, [x, 0.36, 0.215], 'x', 'forged', 'fRail', [0, 0.15, 0.12]);
    box(g, [0.04, 0.025, 0.03], [0.35, 0.36, 0.24], 'black', 'fRail', [0, 0.15, 0.12]);
    for (let i = 0; i < 6; i++) tube(g, [[CX(i), 0.38, 0.215], [CX(i), 0.42, 0.205], [CX(i), 0.445, 0.175]], 0.0045, 'steel', 'fLines', [0, 0.25, 0.05]);
    box(g, [0.12, 0.12, 0.1], [0.47, 0.2, 0.235], 'alu', 'fPump', [0.15, -0.1, 0.1]);
    cyl(g, 0.05, 0.05, [0.47, 0.2, 0.31], 'z', 'alu', 'fPump', [0.15, -0.1, 0.1]);
    tube(g, [[0.47, 0.26, 0.235], [0.47, 0.33, 0.225], [0.45, 0.36, 0.215]], 0.0045, 'steel', 'fLines', [0, 0.25, 0.05]);
  },
  rockers(g, c) {
    cyl(g, 0.011, 1.1, [0, SHAFT_Y, 0], 'x', 'steel', 'rShaft', [0, 0.18, 0], 14);
    for (let i = 0; i < 6; i++) {
      for (const valve of ['intake', 'exhaust'] as const) {
        const s = valve === 'intake' ? 1 : -1;
        const rg = new THREE.Group();
        put(rg, g, [CX(i) + s * 0.022, SHAFT_Y, 0], 'rArms', [s * 0.04, 0.09, s * 0.06]);
        rg.userData.rocker = { cyl: i + 1, valve };
        c.inst.push(rg);
        cyl(rg, 0.017, 0.02, [0, 0, 0], 'x', 'forged', 'rArms', undefined, 20);
        // arm from the hub out to the bridge over the valve pair
        const dx = -s * 0.022, dz = s * 0.04, dy = 0.597 - SHAFT_Y;
        const len = Math.hypot(dx, dz);
        const arm = box(rg, [0.016, 0.014, len], [dx / 2, dy / 2 + 0.004, dz / 2], 'forged', 'rArms');
        arm.rotation.y = Math.atan2(dx, dz);
        arm.rotation.x = Math.atan2(-dy, len) * Math.sign(dz) * -1;
        cyl(rg, 0.005, 0.03, [dx, dy + 0.012, dz], 'y', 'steel', 'rArms', undefined, 8); // adjusting screw
        cyl(rg, 0.008, 0.012, [0, CAM_Y + 0.031 - SHAFT_Y, -s * 0.012], 'x', 'steel', 'rRollers', [0, -0.04, 0], 16);
        box(rg, [0.012, 0.025, 0.012], [0, -0.016, -s * 0.012], 'forged', 'rArms');
      }
      for (const dz of [0.04, -0.04]) {
        const br = box(g, [0.07, 0.01, 0.016], [CX(i), 0.594, dz], 'forged', 'rBridges', [0, 0.04, dz * 2]);
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
    for (const x of BULK) cyl(spin, 0.022, 0.024, [x, 0, 0], 'x', 'steel', 'cShaft', undefined, 22);
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
    gear(spin, 0.11, 0.03, 48, [-0.6, 0, 0], 'forged', 'cGear', [-0.15, 0, 0]);
  },
  valveCover(g) {
    box(g, [1.1, 0.012, 0.3], [0, 0.72, 0], 'alu', 'vcBody', [0, 0.12, 0]);
    for (const s of [1, -1]) box(g, [1.1, 0.17, 0.012], [0, 0.635, s * 0.145], 'alu', 'vcBody', [0, 0.12, 0]);
    for (const s of [1, -1]) box(g, [0.012, 0.17, 0.3], [s * 0.545, 0.635, 0], 'alu', 'vcBody', [0, 0.12, 0]);
    for (let k = 0; k < 5; k++) box(g, [0.9, 0.01, 0.014], [0, 0.73, -0.1 + k * 0.05], 'alu', 'vcBody', [0, 0.12, 0]);
    cyl(g, 0.03, 0.03, [0.3, 0.74, 0.08], 'y', 'yellow', 'vcCap', [0, 0.25, 0]);
    plate(g, [[-0.555, -0.15], [0.555, -0.15], [0.555, 0.15], [-0.555, 0.15]], [], HEAD_TOP, 0.004, 'rubber', 'vcGasket', [0, -0.04, 0]);
  },
  intakeManifold(g) {
    box(g, [1.0, 0.09, 0.09], [0, 0.52, 0.27], 'alu', 'imPlenum', [0, 0, 0.12]);
    for (let i = 0; i < 6; i++) box(g, [0.09, 0.05, 0.07], [CX(i), 0.49, 0.215], 'alu', 'imPlenum', [0, 0, 0.12]);
    cyl(g, 0.055, 0.12, [0.48, 0.6, 0.27], 'y', 'alu', 'imInlet', [0.12, 0.15, 0.12]);
    box(g, [0.13, 0.03, 0.13], [0.48, 0.66, 0.27], 'black', 'imInlet', [0.12, 0.15, 0.12]);
  },
  exhaustManifold(g) {
    for (const [sub, x0, x1, ex] of [['emFront', 0.0, 0.48, 0.12], ['emRear', -0.48, 0.0, -0.12]] as const) {
      cyl(g, 0.042, x1 - x0 - 0.01, [(x0 + x1) / 2, 0.49, -0.255], 'x', 'exh', sub, [ex, 0, -0.1], 24);
      for (let i = 0; i < 6; i++) {
        if (CX(i) > x0 && CX(i) < x1) {
          box(g, [0.075, 0.045, 0.07], [CX(i), 0.49, -0.205], 'exh', sub, [ex, 0, -0.1]);
          box(g, [0.11, 0.065, 0.006], [CX(i), 0.49, -0.171], 'gasket', 'emGasket', [ex, 0, -0.03]);
        }
      }
    }
    cyl(g, 0.045, 0.12, [-0.02, 0.56, -0.27], 'y', 'exh', 'emRear', [-0.12, 0, -0.1], 24);
  },
  turbo(g) {
    const X = -0.02, Y = 0.68, Z = -0.27;
    torus(g, 0.07, 0.04, [X - 0.06, Y, Z], 'x', 'exh', 'tTurbHsg', [-0.2, 0, 0]);
    cyl(g, 0.045, 0.06, [X - 0.06, Y, Z], 'x', 'exh', 'tTurbHsg', [-0.2, 0, 0]);
    cyl(g, 0.04, 0.09, [X - 0.06, Y, Z - 0.1], 'z', 'exh', 'tTurbHsg', [-0.2, 0, 0]);
    cyl(g, 0.036, 0.07, [X + 0.02, Y, Z], 'x', 'dark', 'tCenter');
    torus(g, 0.068, 0.036, [X + 0.1, Y, Z], 'x', 'alu', 'tCompHsg', [0.22, 0, 0]);
    cyl(g, 0.04, 0.12, [X + 0.18, Y, Z], 'x', 'alu', 'tCompHsg', [0.22, 0, 0]);
    // wheels and shaft, hidden inside until the housings come off
    cyl(g, 0.006, 0.2, [X + 0.02, Y, Z], 'x', 'steel', 'tShaft', [-0.08, -0.14, 0], 10);
    const wheel = (x: number, r: number, m: string, sub: string, ex: V) => {
      cyl(g, r * 0.35, 0.03, [x, Y, Z], 'x', m, sub, ex, 16);
      for (let k = 0; k < 11; k++) {
        const b = box(g, [0.026, r, 0.003], [x, Y, Z], m, sub, ex);
        b.rotation.x = (k / 11) * Math.PI * 2;
        b.geometry.translate(0, r / 2, 0);
      }
    };
    wheel(X - 0.06, 0.04, 'forged', 'tShaft', [-0.08, -0.14, 0]);
    wheel(X + 0.1, 0.038, 'alu', 'tCompWheel', [0.1, -0.14, 0]);
  },
  damper(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    cyl(spin, 0.15, 0.055, [0.66, 0, 0], 'x', 'dark', 'dHousing', [0.08, 0, 0], 40);
    cyl(spin, 0.1, 0.05, [0.72, 0, 0], 'x', 'forged', 'dPulley', [0.18, 0, 0], 36);
    for (const x of [0.705, 0.72, 0.735]) torus(spin, 0.1, 0.004, [x, 0, 0], 'x', 'dark', 'dPulley', [0.18, 0, 0]);
    for (let k = 0; k < 6; k++) cyl(spin, 0.008, 0.01, [0.75, Math.cos(k) * 0.05, Math.sin(k) * 0.05], 'x', 'steel', 'dPulley', [0.18, 0, 0], 6);
  },
  waterPump(g) {
    box(g, [0.06, 0.16, 0.16], [0.6, 0.3, -0.04], 'alu', 'wpBody', [0.12, 0, 0]);
    cyl(g, 0.07, 0.03, [0.66, 0.3, -0.04], 'x', 'forged', 'wpBody', [0.2, 0, 0], 32);
    cyl(g, 0.045, 0.012, [0.635, 0.3, -0.04], 'x', 'dark', 'wpBody', [0.3, 0, 0], 12);
    box(g, [0.08, 0.06, 0.08], [0.6, 0.48, 0.06], 'alu', 'wpStat', [0.1, 0.12, 0]);
    cyl(g, 0.03, 0.05, [0.6, 0.53, 0.06], 'y', 'alu', 'wpStat', [0.1, 0.12, 0]);
    cyl(g, 0.022, 0.03, [0.6, 0.47, 0.06], 'y', 'copper', 'wpStat', [0.1, 0.2, 0.1]);
  },
  frontCover(g) {
    box(g, [0.014, 0.44, 0.36], [0.575, 0.17, 0], 'alu', 'fcCover', [0.12, 0, 0]);
    torus(g, 0.045, 0.008, [0.585, 0, 0], 'x', 'rubber', 'fcSeal', [0.2, 0, 0]);
  },
  oilModule(g) {
    box(g, [0.36, 0.13, 0.06], [-0.16, 0.24, 0.215], 'alu', 'omHousing', [0, 0, 0.1]);
    for (const x of [-0.26, -0.08]) {
      cyl(g, 0.052, 0.22, [x, 0.07, 0.23], 'y', 'blue', 'omFilters', [0, -0.15, 0.12], 28);
      cyl(g, 0.045, 0.02, [x, -0.05, 0.23], 'y', 'dark', 'omFilters', [0, -0.15, 0.12], 6);
    }
  },
  flywheel(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    cyl(spin, 0.235, 0.05, [-0.66, 0, 0], 'x', 'forged', 'fwBody', undefined, 48);
    cyl(spin, 0.17, 0.004, [-0.687, 0, 0], 'x', 'steel', 'fwBody', undefined, 48);
    gear(spin, 0.245, 0.03, 90, [-0.66, 0, 0], 'steel', 'fwRing', [-0.12, 0, 0]);
    for (let k = 0; k < 8; k++) cyl(spin, 0.01, 0.01, [-0.688, Math.cos(k * 0.785) * 0.06, Math.sin(k * 0.785) * 0.06], 'x', 'dark', 'fwBody', undefined, 6);
  },
  flywheelHousing(g) {
    cyl(g, 0.29, 0.1, [-0.635, 0, 0], 'x', 'block', 'fhHousing', [-0.25, 0, 0], 48, true, 0.31);
    profileX(g, (sh) => {
      sh.absarc(0, 0, 0.29, 0, Math.PI * 2, false);
      const h = new THREE.Path();
      h.absarc(0, 0, 0.09, 0, Math.PI * 2, true);
      sh.holes.push(h);
    }, 0.014, [-0.59, 0, 0], 'block', 'fhHousing', [-0.25, 0, 0]);
    box(g, [0.04, 0.5, 0.2], [-0.595, 0.4, 0], 'block', 'fhHousing', [-0.25, 0, 0]);
    gear(g, 0.075, 0.03, 34, [-0.575, 0.16, 0.06], 'forged', 'fhGears', [-0.08, 0, 0.12]);
    gear(g, 0.065, 0.03, 30, [-0.575, 0.34, 0.03], 'forged', 'fhGears', [-0.08, 0, 0.12]);
    gear(g, 0.06, 0.03, 28, [-0.575, 0.48, -0.03], 'forged', 'fhGears', [-0.08, 0, 0.12]);
  },
  oilPan(g) {
    const Y0 = -0.05, Y1 = -0.31;
    box(g, [1.12, 0.012, 0.38], [0, Y1, 0], 'pan', 'opPan');
    for (const s of [1, -1]) box(g, [1.12, Y0 - Y1, 0.012], [0, (Y0 + Y1) / 2, s * 0.19], 'pan', 'opPan');
    for (const s of [1, -1]) box(g, [0.012, Y0 - Y1, 0.38], [s * 0.56, (Y0 + Y1) / 2, 0], 'pan', 'opPan');
    for (const s of [1, -1]) box(g, [1.14, 0.01, 0.03], [0, Y0, s * 0.2], 'pan', 'opPan');
    cyl(g, 0.016, 0.03, [0.35, Y1 - 0.015, 0.12], 'y', 'steel', 'opPlug', [0, -0.1, 0], 6);
  },
  oilPump(g) {
    box(g, [0.14, 0.08, 0.12], [0.32, -0.15, 0], 'block', 'pBody', [0, 0.08, 0]);
    cyl(g, 0.03, 0.02, [0.32, -0.15, 0.065], 'z', 'steel', 'pBody', [0, 0.08, 0.1], 16);
    tube(g, [[0.28, -0.19, 0], [0.22, -0.24, 0], [0.12, -0.27, 0]], 0.014, 'steel', 'pPickup', [0, -0.05, 0]);
    cyl(g, 0.05, 0.012, [0.1, -0.285, 0], 'y', 'steel', 'pPickup', [0, -0.05, 0], 24);
  },
  pistons(g, c) {
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.Group();
      put(cg, g, [CX(i), 0, 0]);
      cg.userData.inst = i;
      c.inst.push(cg);
      const pg = new THREE.Group();
      put(pg, cg, [0, R + L, 0]);
      pg.userData.piston = i + 1;
      cyl(pg, 0.0645, 0.11, [0, 0.02, 0], 'y', 'piston', 'pPiston', [0, 0.14, 0], 40);
      cyl(pg, 0.063, 0.02, [0, -0.045, 0], 'y', 'piston', 'pPiston', [0, 0.14, 0], 40);
      cyl(pg, 0.036, 0.004, [0, CH - 0.0005, 0], 'y', 'bowl', 'pPiston', [0, 0.14, 0], 32);
      torus(pg, 0.065, 0.0026, [0, CH - 0.012, 0], 'y', 'steel', 'pRing1', [0, 0.34, 0]);
      torus(pg, 0.065, 0.0026, [0, CH - 0.024, 0], 'y', 'forged', 'pRing2', [0, 0.3, 0]);
      torus(pg, 0.065, 0.0035, [0, CH - 0.038, 0], 'y', 'dark', 'pRing3', [0, 0.26, 0]);
      cyl(pg, 0.02, 0.1, [0, 0, 0], 'x', 'steel', 'pPin', [0.2, 0, 0], 20);
      for (const s of [1, -1]) torus(pg, 0.018, 0.0018, [s * 0.051, 0, 0], 'x', 'steel', 'pPin', [s * 0.3, 0, 0]);
      const rod = new THREE.Group();
      put(rod, cg, [0, R + L, 0]);
      rod.userData.rod = i + 1;
      cyl(rod, 0.03, 0.04, [0, 0, 0], 'x', 'forged', 'pRod', undefined, 24);
      box(rod, [0.03, L - 0.09, 0.024], [0, -L / 2, 0], 'forged', 'pRod');
      box(rod, [0.012, L - 0.1, 0.04], [0, -L / 2, 0], 'forged', 'pRod');
      torus(rod, 0.055, 0.012, [0, -L, 0], 'x', 'forged', 'pRod', undefined, Math.PI);
      const cap = torus(rod, 0.055, 0.012, [0, -L, 0], 'x', 'forged', 'pCap', [0, -0.16, 0], Math.PI);
      cap.rotation.x = Math.PI;
      for (const s of [1, -1]) cyl(rod, 0.006, 0.07, [0, -L - 0.01, s * 0.06], 'y', 'steel', 'pCap', [0, -0.26, 0], 8);
      const sh1 = cyl(rod, 0.046, 0.034, [0, -L, 0], 'x', 'bearing', 'pShells', [0, -0.06, 0], 24, true);
      sh1.material = mat('bearing');
      (sh1.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
  },
  mainCaps(g) {
    for (const x of BULK) {
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
      for (const s of [1, -1]) cyl(g, 0.011, 0.02, [x, -0.112, s * 0.065], 'y', 'dark', 'mcBolts', [0, -0.22, 0], 6);
    }
  },
  crankshaft(g, c) {
    const spin = new THREE.Group();
    put(spin, g, [0, 0, 0]);
    spin.userData.spin = 'crank';
    c.inst.push(spin);
    for (const x of BULK) cyl(spin, 0.05, 0.03, [x, 0, 0], 'x', 'steel', 'ckMain', undefined, 28);
    cyl(spin, 0.035, 0.12, [0.63, 0, 0], 'x', 'steel', 'ckMain', undefined, 20);
    cyl(spin, 0.075, 0.03, [-0.555, 0, 0], 'x', 'forged', 'ckMain', undefined, 32);
    gear(spin, 0.07, 0.025, 30, [-0.52, 0, 0], 'steel', 'ckGear', [-0.15, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const n = i + 1, idx = FIRING.indexOf(n);
      const throwG = new THREE.Group();
      put(throwG, spin, [CX(i), 0, 0]);
      throwG.rotation.x = ((-120 * idx) * Math.PI) / 180;
      cyl(throwG, 0.045, 0.048, [0, R, 0], 'x', 'steel', 'ckPins', undefined, 28);
      for (const s of [1, -1]) {
        profileX(throwG, (sh) => {
          sh.moveTo(-0.052, 0);
          sh.lineTo(-0.045, R);
          sh.absarc(0, R, 0.05, Math.PI, 0, true);
          sh.lineTo(0.052, 0);
          sh.absarc(0, -0.02, 0.105, 0.2, Math.PI - 0.2, true);
        }, 0.026, [s * 0.04, 0, 0], 'forged', s > 0 ? 'ckWeights' : 'ckWeights');
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
      <p>${esc(p.does)}</p>
      <p><span class="k">Made of</span>${esc(p.made)}</p>
      <p><span class="k">Inspect</span>${esc(p.inspect)}</p>
      <p><span class="k">Removal</span>${esc(p.removal)}</p>
      ${why}${whyIn}
      <div class="bar" style="margin-top:8px;flex-wrap:wrap">
        ${block ? '' : c.removed ? `<button id="tdIn" ${ib.length ? 'disabled' : ''}>Install</button>` : `<button id="tdOut" ${canRemove(c) ? '' : 'disabled'}>Remove</button>`}
        <button id="tdIns" class="dark">${S.inspect === p.id ? 'Close inspection' : 'Take it apart on the bench'}</button>
      </div>
      <div class="tdSubs"><div class="lab" style="margin:10px 0 4px">Made up of</div>${p.subs.map((s) => `<button data-sub="${s.id}" class="${S.subSel === s.id ? 'on' : ''}">${esc(s.name)}</button>`).join('')}</div>
      ${sub ? `<div class="tdSub"><b>${esc(sub.name)}</b><p>${esc(sub.does)}</p><p><span class="k">Made of</span>${esc(sub.made)}</p></div>` : ''}`;
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
