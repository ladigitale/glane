/**
 * Reel visualizer — all scenes via Three.js (dynamic import at encode time).
 * Legacy WebGL/Canvas2D remains as fallback if this fails.
 */
import type {
  ReelEnergyFrame,
  ReelPalette,
  ReelSceneId,
  ReelViz,
  ReelVizFrame,
} from "./reel-export-viz";

/** Every reel scene is rendered by Three when available. */
export function isReelThreeScene(_id: string): boolean {
  return true;
}

export function reelNeedsThree(_scenes: readonly string[]): boolean {
  return true;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? parseInt(h[0]! + h[0] + h[1]! + h[1] + h[2]! + h[2], 16)
      : parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type ThreeMod = typeof import("three");
type Mesh = InstanceType<ThreeMod["Mesh"]>;
type Group = InstanceType<ThreeMod["Group"]>;
type Material = InstanceType<ThreeMod["Material"]>;
type Color = InstanceType<ThreeMod["Color"]>;

function disposeObject3D(
  THREE: ThreeMod,
  root: InstanceType<ThreeMod["Object3D"]>,
): void {
  const geos = new Set<InstanceType<ThreeMod["BufferGeometry"]>>();
  const mats = new Set<Material>();
  root.traverse((obj) => {
    const mesh = obj as Mesh & {
      geometry?: InstanceType<ThreeMod["BufferGeometry"]>;
      material?: Material | Material[];
    };
    if (mesh.geometry) geos.add(mesh.geometry);
    const mat = mesh.material;
    if (!mat) return;
    if (Array.isArray(mat)) mat.forEach((m) => mats.add(m));
    else mats.add(mat);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  void THREE;
}

/** Lazy-load three and build the full-scene visualizer. */
export async function createReelThreeViz(
  w: number,
  h: number,
): Promise<ReelViz | null> {
  const THREE = await import("three");

  const glCanvas = document.createElement("canvas");
  glCanvas.width = w;
  glCanvas.height = h;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;

  let renderer: InstanceType<ThreeMod["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  renderer.setSize(w, h, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const root = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.05, 120);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  root.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3.2, 4.5, 2.4);
  root.add(key);
  const rim = new THREE.PointLight(0xffffff, 0.85, 28);
  root.add(rim);
  const fill = new THREE.PointLight(0xffffff, 0.35, 20);
  fill.position.set(1.5, -2.5, -2);
  root.add(fill);

  const waveCol = new THREE.Color(0x8ec8b8);
  const accentCol = new THREE.Color(0xffffff);
  const bgCol = new THREE.Color(0x10161a);

  const matLit = new THREE.MeshStandardMaterial({
    color: waveCol,
    metalness: 0.5,
    roughness: 0.3,
    flatShading: true,
  });
  const matWire = new THREE.MeshBasicMaterial({
    color: accentCol,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
  });
  const matGhost = new THREE.MeshStandardMaterial({
    color: accentCol,
    metalness: 0.2,
    roughness: 0.55,
    transparent: true,
    opacity: 0.22,
    flatShading: true,
  });
  const matPoints = new THREE.PointsMaterial({
    color: waveCol,
    size: 0.06,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const groups: Record<ReelSceneId, Group> = {
    particles: new THREE.Group(),
    geo: new THREE.Group(),
    tunnel: new THREE.Group(),
    field: new THREE.Group(),
    ripple: new THREE.Group(),
    bars: new THREE.Group(),
    orbit: new THREE.Group(),
  };
  for (const g of Object.values(groups)) {
    g.visible = false;
    root.add(g);
  }

  // —— particles ——
  const PARTICLE_N = 2200;
  const particlePos = new Float32Array(PARTICLE_N * 3);
  const particleSeed = new Float32Array(PARTICLE_N);
  for (let i = 0; i < PARTICLE_N; i++) {
    particleSeed[i] = Math.random();
    const u = Math.random();
    const v = Math.random();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    const r = 0.4 + Math.random() * 2.8;
    particlePos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    particlePos[i * 3 + 1] = r * Math.cos(ph) * 0.7;
    particlePos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePos, 3),
  );
  groups.particles.add(new THREE.Points(particleGeo, matPoints));
  const particleCore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.35, 1),
    matLit.clone(),
  );
  groups.particles.add(particleCore);

  // —— geo ——
  const geoSolids: Mesh[] = [];
  const geoKinds = [
    new THREE.TetrahedronGeometry(0.7, 0),
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.OctahedronGeometry(0.75, 0),
    new THREE.DodecahedronGeometry(0.7, 0),
    new THREE.IcosahedronGeometry(0.8, 0),
  ];
  for (let i = 0; i < geoKinds.length; i++) {
    const solid = new THREE.Mesh(geoKinds[i]!, matLit.clone());
    solid.add(new THREE.Mesh(geoKinds[i]!.clone(), matWire.clone()));
    groups.geo.add(solid);
    geoSolids.push(solid);
  }

  // —— tunnel ——
  const tunnelRings: Mesh[] = [];
  for (let i = 0; i < 18; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.4 + (i % 3) * 0.08, 0.04, 8, 48),
      i % 2 === 0 ? matWire.clone() : matLit.clone(),
    );
    groups.tunnel.add(ring);
    tunnelRings.push(ring);
  }
  const tunnelStreaks: Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 2.2),
      matGhost.clone(),
    );
    groups.tunnel.add(bar);
    tunnelStreaks.push(bar);
  }

  // —— field ——
  const FIELD_ROWS = 28;
  const FIELD_COLS = 16;
  const fieldBars: Mesh[] = [];
  for (let r = 0; r < FIELD_ROWS; r++) {
    for (let c = 0; c < FIELD_COLS; c++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 1, 0.04),
        (r + c) % 2 === 0 ? matLit.clone() : matWire.clone(),
      );
      bar.position.set(
        (c - (FIELD_COLS - 1) / 2) * 0.38,
        0,
        (r - (FIELD_ROWS - 1) / 2) * 0.28,
      );
      groups.field.add(bar);
      fieldBars.push(bar);
    }
  }

  // —— ripple ——
  const rippleRings: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5 + i * 0.35, 0.025, 6, 64),
      i % 2 === 0 ? matWire.clone() : matLit.clone(),
    );
    ring.rotation.x = Math.PI / 2;
    groups.ripple.add(ring);
    rippleRings.push(ring);
  }
  const rippleOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    matGhost.clone(),
  );
  groups.ripple.add(rippleOrb);

  // —— bars ——
  const BAR_N = 48;
  const barMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 1, 0.12),
    matLit.clone(),
    BAR_N,
  );
  barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  groups.bars.add(barMesh);
  const barDummy = new THREE.Object3D();
  const barAccent = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.02, 6, 64),
    matWire.clone(),
  );
  barAccent.rotation.x = Math.PI / 2;
  groups.bars.add(barAccent);

  // —— orbit ——
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.85, 0.28, 128, 18),
    matLit.clone(),
  );
  const knotWire = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.92, 0.3, 64, 8),
    matWire.clone(),
  );
  const icosa = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 0),
    matGhost.clone(),
  );
  const satellites: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      i % 2 === 0 ? matLit.clone() : matWire.clone(),
    );
    groups.orbit.add(m);
    satellites.push(m);
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({
      color: bgCol,
      metalness: 0.7,
      roughness: 0.45,
      transparent: true,
      opacity: 0.55,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.55;
  groups.orbit.add(knot, knotWire, icosa, floor);

  const tintMeshes = (wave: Color, accent: Color) => {
    root.traverse((obj) => {
      const m = (obj as Mesh).material;
      if (!m || Array.isArray(m)) return;
      if (m === matLit || m === matWire || m === matGhost || m === matPoints)
        return;
      if (m instanceof THREE.MeshBasicMaterial && m.wireframe) {
        m.color.copy(accent);
      } else if (m instanceof THREE.PointsMaterial) {
        m.color.copy(wave);
      } else if (
        m instanceof THREE.MeshStandardMaterial ||
        m instanceof THREE.MeshBasicMaterial
      ) {
        if (m.transparent && m.opacity < 0.35) m.color.copy(accent);
        else m.color.copy(wave);
      }
    });
  };

  const applyPalette = (palette: ReelPalette) => {
    const [tr, tg, tb] = hexToRgb01(palette.top);
    const [br, bg, bb] = hexToRgb01(palette.bottom);
    bgCol.setRGB((tr + br) * 0.5, (tg + bg) * 0.5, (tb + bb) * 0.5);
    root.background = bgCol;
    waveCol.setRGB(...hexToRgb01(palette.wave));
    accentCol.setRGB(...hexToRgb01(palette.accent));
    key.color.copy(accentCol).lerp(new THREE.Color(1, 1, 1), 0.55);
    rim.color.copy(waveCol);
    fill.color.copy(accentCol);
    matLit.color.copy(waveCol);
    matWire.color.copy(accentCol);
    matGhost.color.copy(accentCol);
    matPoints.color.copy(waveCol);
    (floor.material as InstanceType<ThreeMod["MeshStandardMaterial"]>).color
      .copy(bgCol);
    tintMeshes(waveCol, accentCol);
  };

  const hideAll = () => {
    for (const g of Object.values(groups)) g.visible = false;
  };

  const driveParticles = (timeS: number, e: ReelEnergyFrame) => {
    const pos = particleGeo.getAttribute("position") as InstanceType<
      ThreeMod["BufferAttribute"]
    >;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < PARTICLE_N; i++) {
      const seed = particleSeed[i]!;
      const spin = timeS * (0.35 + seed * 0.8) + seed * 12;
      const r =
        (0.5 + seed * 2.6) *
        (1 + e.bass * 0.35 * Math.sin(timeS * 10 + seed * 9));
      const yOff = Math.sin(timeS * 1.8 + seed * 20) * e.mid * 0.45;
      arr[i * 3] = Math.cos(spin) * r * (0.7 + (seed % 0.3));
      arr[i * 3 + 1] = Math.sin(seed * 14 + timeS) * r * 0.55 + yOff;
      arr[i * 3 + 2] = Math.sin(spin) * r;
    }
    pos.needsUpdate = true;
    matPoints.size = 0.04 + e.high * 0.08 + e.rms * 0.04;
    matPoints.opacity = 0.55 + e.rms * 0.4;
    particleCore.scale.setScalar(0.8 + e.bass * 0.9);
    particleCore.rotation.y = timeS * 0.6;
    particleCore.rotation.x = timeS * 0.35;
  };

  const driveGeo = (timeS: number, e: ReelEnergyFrame) => {
    for (let i = 0; i < geoSolids.length; i++) {
      const s = geoSolids[i]!;
      const a = timeS * (0.4 + i * 0.08) + i * 1.2;
      const r = 1.2 + i * 0.35 + e.bass * 0.4;
      s.position.set(
        Math.cos(a) * r,
        Math.sin(timeS * 0.7 + i) * (0.4 + e.mid * 0.5),
        Math.sin(a) * r,
      );
      s.rotation.x = timeS * (0.5 + i * 0.1);
      s.rotation.y = timeS * (0.7 + i * 0.12);
      s.scale.setScalar(0.55 + e.rms * 0.45 + (i % 3) * 0.08);
    }
  };

  const driveTunnel = (timeS: number, e: ReelEnergyFrame) => {
    const speed = 1.2 + e.bass * 2.2;
    for (let i = 0; i < tunnelRings.length; i++) {
      const ring = tunnelRings[i]!;
      const z = ((i / tunnelRings.length + timeS * speed * 0.15) % 1) * 14 - 2;
      ring.position.set(0, 0, -z);
      ring.scale.setScalar(0.55 + (z / 14) * 1.6 + e.rms * 0.15);
      ring.rotation.z = timeS * 0.4 + i * 0.2;
    }
    for (let i = 0; i < tunnelStreaks.length; i++) {
      const bar = tunnelStreaks[i]!;
      const a = (i / tunnelStreaks.length) * Math.PI * 2 + timeS * 0.3;
      const r = 1.1 + e.high * 0.35;
      bar.position.set(Math.cos(a) * r, Math.sin(a) * r, -4);
      bar.lookAt(0, 0, -8);
    }
  };

  const driveField = (timeS: number, e: ReelEnergyFrame) => {
    let i = 0;
    for (let r = 0; r < FIELD_ROWS; r++) {
      for (let c = 0; c < FIELD_COLS; c++) {
        const bar = fieldBars[i++]!;
        const nx = c / FIELD_COLS;
        const nz = r / FIELD_ROWS;
        const wave =
          Math.sin(nx * 10 + timeS * 2.4 + nz * 4) * (0.35 + e.mid * 0.8) +
          Math.sin(nx * 22 - timeS * 3.5 + r) * e.high * 0.45 +
          e.bass * 0.55 * Math.sin(timeS * 8 + c);
        const ht = 0.35 + Math.abs(wave) * 1.4 + e.rms * 0.4;
        bar.scale.y = ht;
        bar.position.y = ht * 0.5 - 0.2;
      }
    }
  };

  const driveRipple = (timeS: number, e: ReelEnergyFrame) => {
    for (let i = 0; i < rippleRings.length; i++) {
      const ring = rippleRings[i]!;
      const phase = (timeS * (0.7 + e.bass * 0.5) + i * 0.18) % 1;
      const rad = 0.3 + phase * (2.8 + e.rms * 0.8);
      ring.scale.setScalar(rad / (0.5 + i * 0.35));
      const mat = ring.material as InstanceType<ThreeMod["MeshBasicMaterial"]>;
      if ("opacity" in mat) mat.opacity = (1 - phase) * (0.35 + e.rms * 0.45);
      ring.position.y = Math.sin(timeS * 2 + i) * e.mid * 0.15;
    }
    rippleOrb.scale.setScalar(0.7 + e.bass * 1.1);
    rippleOrb.position.y = 0.2 + e.rms * 0.3;
  };

  const driveBars = (
    timeS: number,
    e: ReelEnergyFrame,
    peaks?: Float32Array,
  ) => {
    for (let i = 0; i < BAR_N; i++) {
      let mag: number;
      if (peaks && peaks.length > 0) {
        const pi = Math.min(
          peaks.length - 1,
          Math.floor((i / BAR_N) * peaks.length),
        );
        mag = peaks[pi] ?? 0;
      } else {
        mag =
          0.15 +
          0.7 * Math.abs(Math.sin(i * 0.55 + timeS * 5) * Math.cos(i * 0.25));
      }
      mag *=
        (0.4 + e.rms * 0.85 + e.bass * 0.35) *
        (1 + e.high * 0.25 * Math.sin(timeS * 18 + i));
      const ht = 0.3 + mag * 3.2;
      barDummy.position.set((i - (BAR_N - 1) / 2) * 0.18, ht * 0.5 - 1.2, 0);
      barDummy.scale.set(1, ht, 1);
      barDummy.rotation.y = Math.sin(timeS + i * 0.1) * 0.05;
      barDummy.updateMatrix();
      barMesh.setMatrixAt(i, barDummy.matrix);
    }
    barMesh.instanceMatrix.needsUpdate = true;
    barAccent.scale.setScalar(1 + e.bass * 0.12);
    barAccent.rotation.z = timeS * 0.2;
  };

  const driveOrbit = (timeS: number, e: ReelEnergyFrame) => {
    const pulse = 1 + e.bass * 0.28 + e.rms * 0.12;
    knot.scale.setScalar(pulse);
    knot.rotation.x = timeS * (0.55 + e.mid * 0.4);
    knot.rotation.y = timeS * (0.72 + e.high * 0.55);
    knotWire.scale.setScalar(pulse * 1.02);
    knotWire.rotation.copy(knot.rotation);
    knotWire.rotation.z = -timeS * 0.35;
    (knotWire.material as InstanceType<ThreeMod["MeshBasicMaterial"]>).opacity =
      0.35 + e.high * 0.45;
    icosa.scale.setScalar(1.05 + e.mid * 0.35);
    icosa.rotation.x = -timeS * 0.4;
    icosa.rotation.y = timeS * 0.55;
    (icosa.material as InstanceType<ThreeMod["MeshStandardMaterial"]>).opacity =
      0.12 + e.rms * 0.22;
    for (let i = 0; i < satellites.length; i++) {
      const sat = satellites[i]!;
      const a = timeS * (0.7 + i * 0.11) + i * ((Math.PI * 2) / 6);
      const r = 1.85 + e.bass * 0.55 + Math.sin(timeS * 2 + i) * 0.15;
      const y = Math.sin(timeS * 1.4 + i * 1.7) * (0.55 + e.mid * 0.4);
      sat.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      sat.rotation.x = timeS * (1.2 + i * 0.2);
      sat.rotation.z = timeS * (0.9 + i * 0.15);
      sat.scale.setScalar(0.7 + e.high * 0.8 + (i % 3) * 0.12);
    }
  };

  const placeCamera = (id: ReelSceneId, timeS: number, e: ReelEnergyFrame) => {
    switch (id) {
      case "tunnel":
        camera.fov = 55 + e.rms * 8;
        camera.position.set(
          Math.sin(timeS * 0.4) * 0.15,
          Math.cos(timeS * 0.35) * 0.12,
          3.2,
        );
        camera.lookAt(0, 0, -6);
        break;
      case "field":
        camera.fov = 40 + e.rms * 4;
        camera.position.set(
          Math.sin(timeS * 0.15) * 2.2,
          3.2 + e.bass * 0.4,
          4.5,
        );
        camera.lookAt(0, 0.4, 0);
        break;
      case "bars":
        camera.fov = 38 + e.rms * 5;
        camera.position.set(0, 1.2 + e.bass * 0.3, 5.5);
        camera.lookAt(0, 0.2, 0);
        break;
      case "ripple": {
        camera.fov = 42 + e.mid * 4;
        const a = timeS * 0.25;
        camera.position.set(
          Math.cos(a) * 4.2,
          2.8 + e.bass * 0.5,
          Math.sin(a) * 4.2,
        );
        camera.lookAt(0, 0, 0);
        break;
      }
      case "particles": {
        camera.fov = 45 + e.high * 5;
        const a = timeS * 0.22;
        camera.position.set(
          Math.cos(a) * (3.8 - e.rms * 0.4),
          0.8 + Math.sin(timeS * 0.5) * 0.4,
          Math.sin(a) * (3.8 - e.rms * 0.4),
        );
        camera.lookAt(0, 0, 0);
        break;
      }
      case "geo": {
        camera.fov = 40 + e.rms * 5;
        const a = timeS * 0.3;
        camera.position.set(
          Math.cos(a) * 5,
          1.2 + e.mid * 0.4,
          Math.sin(a) * 5,
        );
        camera.lookAt(0, 0, 0);
        break;
      }
      case "orbit":
      default: {
        const camR = 4.4 + e.bass * 1.1 - e.rms * 0.35;
        const camY = 0.35 + Math.sin(timeS * 0.45) * 0.55 + e.mid * 0.35;
        const camA = timeS * (0.28 + e.high * 0.08);
        camera.fov = 40 + e.rms * 6;
        camera.position.set(
          Math.cos(camA) * camR,
          camY,
          Math.sin(camA) * camR,
        );
        camera.lookAt(0, e.bass * 0.15, 0);
        break;
      }
    }
    camera.updateProjectionMatrix();
  };

  const driveScene = (
    id: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    peaks?: Float32Array,
  ) => {
    switch (id) {
      case "particles":
        driveParticles(timeS, e);
        break;
      case "geo":
        driveGeo(timeS, e);
        break;
      case "tunnel":
        driveTunnel(timeS, e);
        break;
      case "field":
        driveField(timeS, e);
        break;
      case "ripple":
        driveRipple(timeS, e);
        break;
      case "bars":
        driveBars(timeS, e, peaks);
        break;
      case "orbit":
        driveOrbit(timeS, e);
        break;
    }
  };

  const scratchA = document.createElement("canvas");
  scratchA.width = w;
  scratchA.height = h;
  const scratchB = document.createElement("canvas");
  scratchB.width = w;
  scratchB.height = h;
  const sctxA = scratchA.getContext("2d");
  const sctxB = scratchB.getContext("2d");

  const paintGl = (
    id: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    peaks?: Float32Array,
  ) => {
    hideAll();
    groups[id].visible = true;
    driveScene(id, timeS, e, peaks);
    placeCamera(id, timeS, e);
    key.intensity = 0.85 + e.rms * 0.9;
    rim.intensity = 0.45 + e.bass * 1.4;
    rim.position.set(
      Math.cos(timeS * 0.8) * 3.2,
      0.5 + e.bass * 1.2,
      Math.sin(timeS * 0.8) * 3.2,
    );
    renderer.render(root, camera);
  };

  const render = (frame: ReelVizFrame) => {
    const { timeS, energy: e, sceneA, sceneB, mix, palette, peaks } = frame;
    applyPalette(palette);

    if (sceneA === sceneB || mix < 0.02) {
      paintGl(sceneA, timeS, e, peaks);
      outCtx.globalAlpha = 1;
      outCtx.drawImage(glCanvas, 0, 0);
      return;
    }

    if (!sctxA || !sctxB) {
      paintGl(mix < 0.5 ? sceneA : sceneB, timeS, e, peaks);
      outCtx.drawImage(glCanvas, 0, 0);
      return;
    }

    paintGl(sceneA, timeS, e, peaks);
    sctxA.drawImage(glCanvas, 0, 0);
    paintGl(sceneB, timeS, e, peaks);
    sctxB.drawImage(glCanvas, 0, 0);
    outCtx.globalAlpha = 1;
    outCtx.drawImage(scratchA, 0, 0);
    outCtx.globalAlpha = mix;
    outCtx.drawImage(scratchB, 0, 0);
    outCtx.globalAlpha = 1;
  };

  const dispose = () => {
    for (const g of Object.values(groups)) disposeObject3D(THREE, g);
    matLit.dispose();
    matWire.dispose();
    matGhost.dispose();
    matPoints.dispose();
    renderer.dispose();
  };

  return { canvas: outCanvas, render, dispose };
}
