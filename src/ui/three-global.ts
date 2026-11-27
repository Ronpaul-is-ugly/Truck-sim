// The UI was written against the r128 global build (THREE.OrbitControls, THREE.GLTFLoader).
// Same version from npm, exposed the same way.
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const THREE = { ...THREE_NS, OrbitControls, GLTFLoader };
(window as unknown as { THREE: typeof THREE }).THREE = THREE;
export default THREE;
