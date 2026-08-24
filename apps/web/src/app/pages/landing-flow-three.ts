/**
 * Landing backdrop — immersive Three.js pipeline story.
 * Lazy-loaded; falls back to Canvas2D in gl-landing-flow when unavailable.
 */
import {
  landingBlendEase,
  landingPhaseAt,
  landingPhaseClock,
  landingPhaseProgress,
  landingPhaseVisibility,
  type LandingFlowPhaseId,
} from "./landing-flow-phases";

export type LandingFlowTheme = {
  primary: string;
  base: string;
  muted: string;
  tags: readonly [string, string, string];
};

export type LandingFlowViz = {
  canvas: HTMLCanvasElement;
  resize(w: number, h: number): void;
  render(timeS: number): void;
  dispose(): void;
};

type ThreeMod = typeof import("three");

function hexToColor(THREE: ThreeMod, hex: string): InstanceType<ThreeMod["Color"]> {
  const h = hex.replace("#", "").trim();
  if (!h) return new THREE.Color(0x04d289);
  const n =
    h.length === 3
      ? parseInt(h[0]! + h[0] + h[1]! + h[1] + h[2]! + h[2], 16)
      : parseInt(h.slice(0, 6), 16);
  return new THREE.Color(Number.isFinite(n) ? n : 0x04d289);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

type OpacityMat = InstanceType<ThreeMod["Material"]> & {
  opacity: number;
  transparent: boolean;
  userData: { baseOpacity?: number };
};

function markBaseOpacity(mat: OpacityMat): void {
  if (mat.userData.baseOpacity === undefined) {
    mat.userData.baseOpacity = mat.opacity;
  }
  mat.transparent = true;
  mat.depthWrite = false;
}

function applyGroupWeight(
  group: InstanceType<ThreeMod["Group"]>,
  weight: number,
): void {
  group.visible = weight > 0.001;
  group.traverse((obj) => {
    const mats =
      "material" in obj && obj.material
        ? Array.isArray(obj.material)
          ? obj.material
          : [obj.material]
        : [];
    for (const raw of mats) {
      const mat = raw as OpacityMat;
      if (mat.userData.baseOpacity === undefined) continue;
      mat.opacity = mat.userData.baseOpacity * weight;
    }
  });
}

function markGroupOpacity(group: InstanceType<ThreeMod["Group"]>): void {
  group.traverse((obj) => {
    const mats =
      "material" in obj && obj.material
        ? Array.isArray(obj.material)
          ? obj.material
          : [obj.material]
        : [];
    for (const raw of mats) {
      markBaseOpacity(raw as OpacityMat);
    }
  });
}

function waveScroll(elapsed: number, speed: number, span: number): number {
  return -(((elapsed * speed) % span) + span) % span;
}

const BAR_N = 72;
const LIBRARY_N = 16;
const CLIP_N = 14;
const CAPTURE_PARTICLES = 520;
const BG_N = 360;

/** Build the landing WebGL visualizer (dynamic three import). */
export async function createLandingFlowThree(
  w: number,
  h: number,
  theme: LandingFlowTheme,
): Promise<LandingFlowViz | null> {
  const THREE = await import("three");

  const canvas = document.createElement("canvas");
  let renderer: InstanceType<ThreeMod["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  renderer.setClearColor(hexToColor(THREE, theme.base), 1);

  const scene = new THREE.Scene();
  const contentRoot = new THREE.Group();
  scene.add(contentRoot);
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.12, 120);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.PointLight(0xffffff, 0.75, 24);
  rim.position.set(-2, 1.5, 4);
  scene.add(rim);

  const primary = hexToColor(THREE, theme.primary);
  const base = hexToColor(THREE, theme.base);
  const muted = hexToColor(THREE, theme.muted);
  const tagCols = theme.tags.map((t) => hexToColor(THREE, t));

  const groups: Record<LandingFlowPhaseId, InstanceType<ThreeMod["Group"]>> = {
    capture: new THREE.Group(),
    detect: new THREE.Group(),
    library: new THREE.Group(),
    arrange: new THREE.Group(),
    export: new THREE.Group(),
  };
  for (const g of Object.values(groups)) contentRoot.add(g);

  // Always-on backdrop — no empty frames between phases.
  const backdrop = new THREE.Group();
  contentRoot.add(backdrop);
  const bgPos = new Float32Array(BG_N * 3);
  const bgSeed = new Float32Array(BG_N);
  for (let i = 0; i < BG_N; i++) {
    bgSeed[i] = Math.random();
    bgPos[i * 3] = (Math.random() - 0.5) * 14;
    bgPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    bgPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPos, 3));
  backdrop.add(
    new THREE.Points(
      bgGeo,
      new THREE.PointsMaterial({
        color: primary,
        size: 0.035,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    ),
  );

  const barSpan = (BAR_N - 1) * 0.11;

  // Persistent background waveform — always visible, never swapped per phase.
  const bgWave = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 1, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.2,
      roughness: 0.55,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
    BAR_N,
  );
  bgWave.position.y = 0;
  bgWave.position.z = -0.35;
  backdrop.add(bgWave);
  for (let i = 0; i < BAR_N; i++) bgWave.setColorAt(i, muted);
  if (bgWave.instanceColor) bgWave.instanceColor.needsUpdate = true;

  // —— capture: inbound sparks ——
  const capPos = new Float32Array(CAPTURE_PARTICLES * 3);
  const capSeed = new Float32Array(CAPTURE_PARTICLES);
  for (let i = 0; i < CAPTURE_PARTICLES; i++) {
    capSeed[i] = Math.random();
    capPos[i * 3] = (Math.random() - 0.5) * 8;
    capPos[i * 3 + 1] = (Math.random() - 0.5) * 2.2;
    capPos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute("position", new THREE.BufferAttribute(capPos, 3));
  const capPts = new THREE.Points(
    capGeo,
    new THREE.PointsMaterial({
      color: primary,
      size: 0.045,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  groups.capture.add(capPts);
  markGroupOpacity(groups.capture);

  // —— detect: scan plane overlay (wave lives in backdrop) ——
  const scanPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 2.8),
    new THREE.MeshBasicMaterial({
      color: primary,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  scanPlane.position.set(-0.15, 0, 0.22);
  scanPlane.renderOrder = 11;
  groups.detect.add(scanPlane);
  const scanGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 3.2),
    new THREE.MeshBasicMaterial({
      color: primary,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  scanGlow.position.set(-0.15, 0, 0.28);
  scanGlow.renderOrder = 10;
  groups.detect.add(scanGlow);
  markGroupOpacity(groups.detect);

  // —— library: gleaned samples on a shelf grid ——
  const libraryMeshes: InstanceType<ThreeMod["Mesh"]>[] = [];
  for (let i = 0; i < LIBRARY_N; i++) {
    const col = tagCols[i % 3]!.clone();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.14),
      new THREE.MeshStandardMaterial({
        color: col,
        metalness: 0.4,
        roughness: 0.35,
        emissive: col,
        emissiveIntensity: 0.08,
      }),
    );
    m.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.44, 0.15),
        new THREE.MeshBasicMaterial({
          color: primary,
          wireframe: true,
          transparent: true,
          opacity: 0.18,
        }),
      ),
    );
    groups.library.add(m);
    libraryMeshes.push(m);
  }
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.06, 1.4),
    new THREE.MeshStandardMaterial({
      color: muted,
      metalness: 0.1,
      roughness: 0.85,
      transparent: true,
      opacity: 0.35,
    }),
  );
  shelf.position.y = -0.72;
  groups.library.add(shelf);
  markGroupOpacity(groups.library);

  // —— arrange: multi-lane timeline ——
  const laneMats = [0, 1, 2, 3].map(
    () =>
      new THREE.MeshStandardMaterial({
        color: muted,
        transparent: true,
        opacity: 0.18,
        metalness: 0.05,
        roughness: 0.9,
      }),
  );
  const lanes = laneMats.map((mat, i) => {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.04, 0.5), mat);
    lane.position.y = 0.72 - i * 0.38;
    groups.arrange.add(lane);
    return lane;
  });
  const clipMeshes: InstanceType<ThreeMod["Mesh"]>[] = [];
  for (let i = 0; i < CLIP_N; i++) {
    const col = tagCols[i % 3]!;
    const clip = new THREE.Mesh(
      new THREE.BoxGeometry(0.55 + (i % 4) * 0.18, 0.28, 0.32),
      new THREE.MeshStandardMaterial({
        color: col,
        metalness: 0.45,
        roughness: 0.32,
        emissive: col,
        emissiveIntensity: 0.12,
      }),
    );
    groups.arrange.add(clip);
    clipMeshes.push(clip);
  }
  const playhead = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, 2.4),
    new THREE.MeshBasicMaterial({
      color: primary,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  playhead.position.set(-2.2, 0.12, 0.42);
  playhead.renderOrder = 14;
  groups.arrange.add(playhead);
  markGroupOpacity(groups.arrange);

  // —— export: share pulse ——
  const exportCore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 1),
    new THREE.MeshStandardMaterial({
      color: primary,
      metalness: 0.55,
      roughness: 0.25,
      emissive: primary,
      emissiveIntensity: 0.35,
    }),
  );
  groups.export.add(exportCore);
  const exportRings: InstanceType<ThreeMod["Mesh"]>[] = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55 + i * 0.12, 0.018, 6, 64),
      new THREE.MeshBasicMaterial({
        color: primary,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    ring.position.z = i * 0.02;
    ring.renderOrder = 20 + i;
    groups.export.add(ring);
    exportRings.push(ring);
  }
  const exportSparks = new THREE.Points(
    capGeo.clone(),
    new THREE.PointsMaterial({
      color: tagCols[1]!,
      size: 0.05,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  );
  groups.export.add(exportSparks);
  markGroupOpacity(groups.export);
  markGroupOpacity(backdrop);

  const barDummy = new THREE.Object3D();
  const tagForBar = (i: number, scroll: number): number => {
    const raw = Math.floor(i * 0.17 + scroll * 0.08);
    return ((raw % 3) + 3) % 3;
  };

  const setWaveBars = (
    mesh: InstanceType<ThreeMod["InstancedMesh"]>,
    timeS: number,
    scroll: number,
    colored: boolean,
    colorMix = 1,
  ) => {
    for (let i = 0; i < BAR_N; i++) {
      const x = (i - BAR_N / 2) * 0.11 + scroll;
      const mag =
        0.1 +
        0.5 *
          Math.abs(
            Math.sin(i * 0.62 + timeS * 4.2) * Math.cos(i * 0.31 + timeS * 2.1),
          ) *
          (0.65 + 0.35 * Math.sin(timeS * 1.4 + i * 0.08));
      const ht = 0.12 + mag * 1.65;
      barDummy.position.set(x, 0, 0);
      barDummy.scale.set(1, ht, 1);
      barDummy.updateMatrix();
      mesh.setMatrixAt(i, barDummy.matrix);
      if (colored && mesh.instanceColor) {
        const tag = tagForBar(i, scroll);
        const past = x < -0.15;
        if (past && colorMix >= 0.98) {
          mesh.setColorAt(i, tagCols[tag]!);
        } else if (past && colorMix > 0.02) {
          const c = muted.clone().lerp(tagCols[tag]!, colorMix);
          mesh.setColorAt(i, c);
        } else {
          mesh.setColorAt(i, muted);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const detectMix = (
    timeS: number,
    phase: ReturnType<typeof landingPhaseAt>,
  ): number => {
    const vis = landingPhaseVisibility(phase).detect;
    if (vis <= 0.001) return 0;
    const prog = landingPhaseProgress(timeS, "detect");
    return vis * Math.min(1, prog * 1.4 + 0.15);
  };

  const driveBackdrop = (timeS: number, phase: ReturnType<typeof landingPhaseAt>) => {
    const scroll = waveScroll(timeS * 0.42, 0.42, barSpan);
    const mix = detectMix(timeS, phase);
    setWaveBars(bgWave, timeS, scroll, mix > 0.02, mix);
    const mat = bgWave.material as InstanceType<ThreeMod["MeshStandardMaterial"]>;
    mat.opacity = 0.28 + mix * 0.18;
  };

  const driveCapture = (timeS: number, _prog: number, _weight = 1) => {
    const arr = capGeo.getAttribute("position") as InstanceType<
      ThreeMod["BufferAttribute"]
    >;
    for (let i = 0; i < CAPTURE_PARTICLES; i++) {
      const s = capSeed[i]!;
      const homeX = (s - 0.5) * 7.8;
      const swirl = s * Math.PI * 2 + timeS * (0.55 + s * 0.28);
      const drift = timeS * (0.028 + s * 0.014);
      let x = homeX - drift + Math.sin(swirl * 0.65 + timeS * 0.35) * 0.42;
      if (x < -4.1) x += 8.2;
      if (x > 4.1) x -= 8.2;
      const y =
        Math.sin(swirl * 1.2 + timeS * 0.55) * (0.32 + s * 0.48) +
        Math.cos(swirl * 0.5 + timeS * 0.9) * 0.24;
      const z = Math.sin(swirl) * (0.22 + s * 0.32);
      arr.setX(i, x);
      arr.setY(i, y);
      arr.setZ(i, z);
    }
    arr.needsUpdate = true;
  };

  const driveDetect = (timeS: number, prog: number, weight = 1) => {
    const x = -0.15 + Math.sin(timeS * 2.8) * 0.04;
    scanPlane.position.x = x;
    scanGlow.position.x = x;
    (
      scanGlow.material as InstanceType<ThreeMod["MeshBasicMaterial"]>
    ).opacity = (0.05 + prog * 0.1) * weight;
  };

  const driveLibrary = (timeS: number, prog: number, _weight = 1) => {
    const settle = easeOutCubic(Math.min(1, prog * 1.05 + 0.08));
    for (let i = 0; i < LIBRARY_N; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const tx = (col - 1.5) * 0.62;
      const ty = 0.1 - row * 0.46;
      const tz = (row % 2) * 0.06 - 0.03;
      const m = libraryMeshes[i]!;
      const fly = 1 - settle;
      m.position.set(
        tx + Math.sin(i * 1.7 + timeS * 0.4) * fly * 0.55,
        ty + fly * (0.75 + (i % 3) * 0.12),
        tz + fly * 0.2,
      );
      m.rotation.y = timeS * 0.25 + i * 0.3;
      m.rotation.x = Math.sin(timeS * 0.8 + i) * 0.06 * (1 - fly);
    }
    shelf.position.y = -0.72 + (1 - settle) * 0.25;
  };

  const driveArrange = (timeS: number, _prog: number, _weight = 1) => {
    const elapsed = landingPhaseClock(timeS, "arrange");
    const headX = -2.2 + ((elapsed * 0.45) % 4.4);
    playhead.position.x = headX;
    for (let i = 0; i < CLIP_N; i++) {
      const lane = i % 4;
      const clip = clipMeshes[i]!;
      const start = -1.9 + (i % 7) * 0.52;
      const len = 0.4 + (i % 3) * 0.18;
      clip.position.set(start + len * 0.5, lanes[lane]!.position.y + 0.08, 0.12);
      clip.scale.x = len / 0.55;
      const active = headX >= start && headX <= start + len;
      const mat = clip.material as InstanceType<ThreeMod["MeshStandardMaterial"]>;
      mat.emissiveIntensity = active ? 0.35 : 0.1;
    }
  };

  const driveExport = (timeS: number, prog: number, weight = 1) => {
    const elapsed = landingPhaseClock(timeS, "export");
    exportCore.rotation.y = timeS * 0.85;
    exportCore.rotation.x = Math.sin(timeS * 0.6) * 0.25;
    exportCore.scale.setScalar(
      0.85 + Math.sin(timeS * 4) * 0.08 + Math.min(1, prog + 0.25) * 0.15,
    );
    const coreMat = exportCore.material as InstanceType<
      ThreeMod["MeshStandardMaterial"]
    >;
    coreMat.emissiveIntensity = 0.35 * weight;
    for (let i = 0; i < exportRings.length; i++) {
      const ring = exportRings[i]!;
      const phase = (elapsed * 0.22 + i * 0.18) % 1;
      ring.scale.setScalar(0.55 + phase * (1.6 + i * 0.22));
      const mat = ring.material as InstanceType<ThreeMod["MeshBasicMaterial"]>;
      mat.opacity = (1 - phase) * 0.45 * weight;
      ring.rotation.x = Math.PI / 2 + i * 0.08;
    }
    const sparkMat = exportSparks.material as InstanceType<
      ThreeMod["PointsMaterial"]
    >;
    sparkMat.opacity = 0.75 * weight;
    const arr = (exportSparks.geometry as InstanceType<
      ThreeMod["BufferGeometry"]
    >).getAttribute("position") as InstanceType<ThreeMod["BufferAttribute"]>;
    for (let i = 0; i < CAPTURE_PARTICLES; i++) {
      const s = capSeed[i]!;
      const a = s * Math.PI * 2 + timeS * (0.6 + s);
      const r = 0.35 + Math.min(1, prog + 0.2) * 2.1 * (0.4 + s * 0.9);
      arr.setX(i, Math.cos(a) * r);
      arr.setY(i, Math.sin(a * 1.3 + timeS) * r * 0.55);
      arr.setZ(i, Math.sin(a) * r * 0.35);
    }
    arr.needsUpdate = true;
  };

  const drivers: Record<
    LandingFlowPhaseId,
    (timeS: number, prog: number, weight: number) => void
  > = {
    capture: driveCapture,
    detect: driveDetect,
    library: driveLibrary,
    arrange: driveArrange,
    export: driveExport,
  };

  const cameraPos = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const cameraFrom = new THREE.Vector3();
  const cameraTo = new THREE.Vector3();
  const lookFrom = new THREE.Vector3();
  const lookTo = new THREE.Vector3();
  let cameraFovTo = 42;

  const cameraTarget = (id: LandingFlowPhaseId, timeS: number) => {
    switch (id) {
      case "capture":
        cameraFrom.set(0.15, 0.45, 5.6);
        lookFrom.set(0.35, 0.05, 0);
        camera.fov = 42;
        break;
      case "detect":
        cameraFrom.set(0, 0.28, 5.2);
        lookFrom.set(-0.15, 0.02, 0);
        camera.fov = 40;
        break;
      case "library":
        cameraFrom.set(
          Math.sin(timeS * 0.18) * 0.35,
          0.95,
          5.4 + Math.cos(timeS * 0.15) * 0.2,
        );
        lookFrom.set(0, -0.05, 0);
        camera.fov = 38;
        break;
      case "arrange":
        cameraFrom.set(0.1, 1.55 + Math.sin(timeS * 0.25) * 0.08, 5.8);
        lookFrom.set(0, 0.08, 0);
        camera.fov = 36;
        break;
      case "export":
        cameraFrom.set(
          Math.cos(timeS * 0.2) * 3.2,
          0.75 + Math.sin(timeS * 0.35) * 0.12,
          Math.sin(timeS * 0.2) * 3.2,
        );
        lookFrom.set(0, 0.02, 0);
        camera.fov = 40;
        break;
    }
  };

  const cameraFor = (
    fromId: LandingFlowPhaseId,
    toId: LandingFlowPhaseId,
    mix: number,
    timeS: number,
  ) => {
    cameraTarget(fromId, timeS);
    cameraTo.copy(cameraFrom);
    lookTo.copy(lookFrom);
    cameraFovTo = camera.fov;
    if (fromId !== toId && mix > 0.001) {
      cameraTarget(toId, timeS);
      const t = landingBlendEase(mix);
      cameraPos.copy(cameraTo).lerp(cameraFrom, t);
      cameraLook.copy(lookTo).lerp(lookFrom, t);
      camera.fov = cameraFovTo + (camera.fov - cameraFovTo) * t;
    } else {
      cameraPos.copy(cameraTo);
      cameraLook.copy(lookTo);
    }
    camera.position.copy(cameraPos);
    camera.lookAt(cameraLook);
    camera.updateProjectionMatrix();
  };

  const fitContent = () => {
    const aspect = cssW / cssH;
    const scale =
      aspect >= 1 ? 1 : Math.min(1, 0.74 + aspect * 0.3);
    contentRoot.scale.setScalar(scale);
    contentRoot.position.y = aspect < 0.72 ? -0.04 : 0;
  };

  let cssW = w;
  let cssH = h;

  const resize = (nw: number, nh: number) => {
    cssW = Math.max(1, nw);
    cssH = Math.max(1, nh);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    fitContent();
  };

  const render = (timeS: number) => {
    const phase = landingPhaseAt(timeS);
    const blendT =
      phase.blend > 0.001 ? landingBlendEase(phase.blend) : 0;
    const weights = landingPhaseVisibility(phase);

    const bgArr = bgGeo.getAttribute("position") as InstanceType<
      ThreeMod["BufferAttribute"]
    >;
    for (let i = 0; i < BG_N; i++) {
      const s = bgSeed[i]!;
      bgArr.setY(i, Math.sin(timeS * 0.35 + s * 8) * 0.35 + (s - 0.5) * 6);
    }
    bgArr.needsUpdate = true;

    driveBackdrop(timeS, phase);

    for (const [id, g] of Object.entries(groups) as [
      LandingFlowPhaseId,
      InstanceType<ThreeMod["Group"]>,
    ][]) {
      applyGroupWeight(g, weights[id] ?? 0);
    }

    for (const id of Object.keys(drivers) as LandingFlowPhaseId[]) {
      const prog = landingPhaseProgress(timeS, id);
      drivers[id]!(timeS, prog, weights[id] ?? 0);
    }

    cameraFor(
      phase.id,
      blendT > 0.001 ? phase.next : phase.id,
      blendT,
      timeS,
    );
    renderer.render(scene, camera);
  };

  const dispose = () => {
    renderer.dispose();
    bgWave.geometry.dispose();
    capGeo.dispose();
    bgGeo.dispose();
    renderer.forceContextLoss?.();
  };

  resize(w, h);
  render(0);
  return { canvas, resize, render, dispose };
}
