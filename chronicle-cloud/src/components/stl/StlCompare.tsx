// Side-by-side 3D comparison of two models in ONE canvas: two viewports, one camera, one set of
// controls, so the views can never drift apart. Flat shading shows facets honestly; fragile areas can be
// tinted (amber: thinner than the minimum wall; red: thinner than one printer pixel).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ModelView { soup: Float32Array; flags?: Uint8Array | null; label: string }

const BASE = new THREE.Color('#c9bfa8');
const THIN = new THREE.Color('#e0a43a');
const TOO_THIN = new THREE.Color('#c8463b');

function meshFor(v: ModelView, highlight: boolean, wireframe: boolean): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v.soup, 3));
  g.computeVertexNormals();
  const nt = v.soup.length / 9;
  const colors = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    const f = highlight && v.flags ? v.flags[t] ?? 0 : 0;
    const c = f === 2 ? TOO_THIN : f === 1 ? THIN : BASE;
    for (let k = 0; k < 3; k++) { colors[t * 9 + k * 3] = c.r; colors[t * 9 + k * 3 + 1] = c.g; colors[t * 9 + k * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.05, wireframe }));
}

function sceneFor(mesh: THREE.Mesh | null): THREE.Scene {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x5a5048, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1, -1.5, 2);
  s.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-2, 1, 0.5);
  s.add(rim);
  if (mesh) s.add(mesh);
  return s;
}

export function StlCompare({ left, right, highlight, wireframe }: { left: ModelView; right: ModelView | null; highlight: boolean; wireframe: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setScissorTest(true);
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', right ? `3D view: ${left.label} and ${right.label}, side by side. Drag to turn, pinch or scroll to zoom.` : `3D view: ${left.label}. Drag to turn, pinch or scroll to zoom.`);
    renderer.domElement.setAttribute('role', 'img');
    const ml = meshFor(left, highlight, wireframe);
    const mr = right ? meshFor(right, highlight, wireframe) : null;
    const sl = sceneFor(ml), sr = sceneFor(mr);
    const box = new THREE.Box3().setFromObject(ml);
    if (mr) box.union(new THREE.Box3().setFromObject(mr));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const camera = new THREE.PerspectiveCamera(35, 1, sphere.radius / 100, sphere.radius * 100);
    camera.up.set(0, 0, 1); // STL models are Z-up
    camera.position.copy(sphere.center).add(new THREE.Vector3(0, -sphere.radius * 3.2, sphere.radius * 0.9));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(sphere.center);
    controls.enableDamping = false;
    const stacked = () => el.clientWidth < 640;
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const views = mr ? (stacked() ? [[0, h / 2, w, h / 2, sl], [0, 0, w, h / 2, sr]] : [[0, 0, w / 2, h, sl], [w / 2, 0, w / 2, h, sr]]) : [[0, 0, w, h, sl]];
      for (const [x, y, vw, vh, scene] of views as [number, number, number, number, THREE.Scene][]) {
        renderer.setViewport(x, y, vw, vh);
        renderer.setScissor(x, y, vw, vh);
        renderer.setClearColor(0x1d1a17);
        camera.aspect = vw / vh;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      }
    };
    const resize = () => { renderer.setSize(el.clientWidth, el.clientHeight, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; draw(); };
    controls.update();
    controls.addEventListener('change', draw);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      for (const m of [ml, mr]) { if (m) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [left, right, highlight, wireframe]);
  return (
    <div className="stl-compare">
      <div className="stl-compare-labels" aria-hidden="true"><span>{left.label}</span>{right && <span>{right.label}</span>}</div>
      <div ref={host} className={right ? 'stl-canvas stl-canvas-pair' : 'stl-canvas'} />
    </div>
  );
}
