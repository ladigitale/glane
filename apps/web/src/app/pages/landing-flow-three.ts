/**
 * Landing backdrop — one creative step at a time with morphing transitions
 * (capture → detect → library → arrange → export). Lazy-loaded; Canvas2D fallback
 * in gl-landing-flow when WebGL is unavailable.
 */
import {
  landingBlendEase,
  landingHandoff,
  landingHandoffMotion,
  landingHandoffOpacity,
  landingPhaseAt,
  landingPhaseClock,
  landingPhaseMotionClock,
  landingPhaseProgress,
  landingPhaseVisibility,
  type LandingFlowPhaseId,
} from "./landing-flow-phases";
import {
  BAR_N,
  PARTICLE_WRAP_X,
  WAVE_SPEED,
  barX,
  createBarTape,
  waveTravel,
  wrapCentered,
} from "./landing-flow-scroll";

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
  // Opacity-only handoff — no scale morph so A-exit matches B-entry motion.
  group.scale.setScalar(1);
  group.position.z = 0;
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

const LIBRARY_N = 16;
const CLIP_N = 12;
const LANE_LEFT = -2.55;
const LANE_RIGHT = 2.55;
const LANE_SPAN = LANE_RIGHT - LANE_LEFT;
/** Soft fade band at lane edges (arrival / exit). */
const CLIP_EDGE_FADE = 0.62;
const ARRANGE_SCROLL = 0.62;
const CAPTURE_PARTICLES = 520;
const AMBIENT_N = 120;

function librarySlot(i: number): { x: number; y: number; z: number; tag: number } {
  const tag = i % 3;
  const rank = Math.floor(i / 3);
  const perCol = Math.ceil(LIBRARY_N / 3);
  return {
    tag,
    x: (tag - 1) * 1.15,
    y: (rank - (perCol - 1) / 2) * 0.36,
    z: 0.06,
  };
}

/** Settled (or mid-sort) pose in the classification bays. */
function libraryLivePose(
  i: number,
  prog: number,
  timeS: number,
): { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number; tag: number } {
  const slot = librarySlot(i);
  const stagger = Math.min(
    1,
    Math.max(0, prog * 1.35 - Math.floor(i / 3) * 0.07 - slot.tag * 0.04),
  );
  const settle = easeOutCubic(stagger);
  const chaosX = Math.sin(i * 2.1 + timeS * 1.2) * 1.4;
  const chaosY = Math.cos(i * 1.6 + timeS * 0.9) * 0.85;
  const chaosZ = Math.sin(i * 0.9 + timeS) * 0.45;
  return {
    tag: slot.tag,
    x: slot.x * settle + chaosX * (1 - settle),
    y: slot.y * settle + chaosY * (1 - settle),
    z: slot.z * settle + chaosZ * (1 - settle),
    rx: (1 - settle) * Math.sin(timeS * 1.4 + i) * 0.9,
    ry: settle * (slot.tag * 0.02) + (1 - settle) * (timeS * 1.1 + i * 0.5),
    rz: (1 - settle) * Math.cos(timeS + i * 0.7) * 0.6,
    s: 0.92 + settle * 0.08,
  };
}

/** Live sequencer pose for clip `i` (already scrolling). */
function clipMovingPose(
  i: number,
  scroll: number,
  laneY: number,
): {
  x: number;
  y: number;
  z: number;
  len: number;
  tag: number;
  u: number;
  edgeFade: number;
} {
  const seed = (i * 0.71) % (LANE_SPAN - 0.8);
  const u = (((seed - scroll) % LANE_SPAN) + LANE_SPAN) % LANE_SPAN;
  const gen = Math.floor((scroll + LANE_SPAN - seed) / LANE_SPAN);
  const len = 0.36 + ((i * 3 + gen * 2) % 5) * 0.1;
  const tag = (i + gen) % 3;
  const enter = Math.min(1, Math.max(0, (LANE_SPAN - u) / CLIP_EDGE_FADE));
  const exit = Math.min(1, Math.max(0, u / CLIP_EDGE_FADE));
  return {
    x: LANE_LEFT + u + len * 0.5,
    y: laneY + 0.08,
    z: 0.12,
    len,
    tag,
    u,
    edgeFade: easeOutCubic(enter) * easeOutCubic(exit),
  };
}

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

  // Soft ambient dust only — no persistent waveform (wave lives in detect).
  const ambient = new THREE.Group();
  contentRoot.add(ambient);
  const ambPos = new Float32Array(AMBIENT_N * 3);
  const ambSeed = new Float32Array(AMBIENT_N);
  for (let i = 0; i < AMBIENT_N; i++) {
    ambSeed[i] = Math.random();
    ambPos[i * 3] = (Math.random() - 0.5) * 14;
    ambPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    ambPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
  }
  const ambGeo = new THREE.BufferGeometry();
  ambGeo.setAttribute("position", new THREE.BufferAttribute(ambPos, 3));
  ambient.add(
    new THREE.Points(
      ambGeo,
      new THREE.PointsMaterial({
        color: primary,
        size: 0.028,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    ),
  );

  // —— capture: inbound sparks ——
  const capPos = new Float32Array(CAPTURE_PARTICLES * 3);
  const capSeed = new Float32Array(CAPTURE_PARTICLES);
  for (let i = 0; i < CAPTURE_PARTICLES; i++) {
    capSeed[i] = Math.random();
    capPos[i * 3] = (Math.random() - 0.5) * PARTICLE_WRAP_X;
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

  // —— detect: scrolling sample wave + scan (the “glean” step) ——
  const SCAN_X = -0.15;
  const bgWave = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.24, 1, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.2,
      roughness: 0.55,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    BAR_N,
  );
  bgWave.position.y = 0;
  bgWave.position.z = -0.15;
  groups.detect.add(bgWave);
  for (let i = 0; i < BAR_N; i++) bgWave.setColorAt(i, muted);
  if (bgWave.instanceColor) bgWave.instanceColor.needsUpdate = true;

  const scanPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 2.8),
    new THREE.MeshBasicMaterial({
      color: primary,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  scanPlane.position.set(SCAN_X, 0, 0.22);
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
  scanGlow.position.set(SCAN_X, 0, 0.28);
  scanGlow.renderOrder = 10;
  groups.detect.add(scanGlow);
  markGroupOpacity(groups.detect);

  // —— library: mechanical sort — pieces nest into criteria columns (centered) ——
  const libraryPieces: InstanceType<ThreeMod["Group"]>[] = [];
  for (let c = 0; c < 3; c++) {
    const guide = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 2.35, 0.04),
      new THREE.MeshStandardMaterial({
        color: muted,
        metalness: 0.15,
        roughness: 0.7,
        transparent: true,
        opacity: 0.22,
      }),
    );
    guide.position.set((c - 1) * 1.15, 0, -0.2);
    groups.library.add(guide);
    for (const y of [-1.22, 1.22]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.05, 0.12),
        new THREE.MeshStandardMaterial({
          color: muted,
          metalness: 0.25,
          roughness: 0.55,
          transparent: true,
          opacity: 0.4,
        }),
      );
      rail.position.set((c - 1) * 1.15, y, -0.08);
      groups.library.add(rail);
    }
  }
  for (let i = 0; i < LIBRARY_N; i++) {
    const tag = i % 3;
    const col = tagCols[tag]!.clone();
    const piece = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.28, 0.22),
      new THREE.MeshStandardMaterial({
        color: col,
        metalness: 0.45,
        roughness: 0.32,
        emissive: col,
        emissiveIntensity: 0.1,
      }),
    );
    const tab = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.1),
      new THREE.MeshStandardMaterial({
        color: col,
        metalness: 0.5,
        roughness: 0.28,
        emissive: col,
        emissiveIntensity: 0.12,
      }),
    );
    tab.position.set(0.22, 0, 0);
    const mortise = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.14),
      new THREE.MeshStandardMaterial({
        color: muted,
        metalness: 0.2,
        roughness: 0.6,
        transparent: true,
        opacity: 0.55,
      }),
    );
    mortise.position.set(-0.2, 0, 0);
    piece.add(body, tab, mortise);
    groups.library.add(piece);
    libraryPieces.push(piece);
  }
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

  // —— export: share pulse (thin line rings + opacity) ——
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
      new THREE.TorusGeometry(0.55 + i * 0.12, 0.0018, 8, 128),
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

  const barDummy = new THREE.Object3D();
  const tape = createBarTape();

  const setWaveBars = (
    mesh: InstanceType<ThreeMod["InstancedMesh"]>,
    travel: number,
    colored: boolean,
    colorMix = 1,
  ) => {
    tape.sync(travel);
    for (let i = 0; i < BAR_N; i++) {
      const x = barX(i, travel);
      const mag = tape.heights[i]!;
      const ht = 0.18 + mag * 3.35;
      const z = mag * 0.55;
      barDummy.position.set(x, 0, z);
      barDummy.scale.set(1, ht, 1);
      barDummy.updateMatrix();
      mesh.setMatrixAt(i, barDummy.matrix);
      if (colored && mesh.instanceColor) {
        const tag = tape.tags[i]!;
        const past = x < SCAN_X;
        if (past && tag >= 0 && colorMix >= 0.98) {
          mesh.setColorAt(i, tagCols[tag as 0 | 1 | 2]!);
        } else if (past && tag >= 0 && colorMix > 0.02) {
          const c = muted.clone().lerp(tagCols[tag as 0 | 1 | 2]!, colorMix);
          mesh.setColorAt(i, c);
        } else {
          mesh.setColorAt(i, muted);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const driveCapture = (timeS: number, prog: number, weight = 1) => {
    // Coalesce toward the wave line as we approach detect (morph cue).
    const coalesce = easeOutCubic(Math.min(1, prog * 0.35 + (1 - weight) * 0.9));
    const arr = capGeo.getAttribute("position") as InstanceType<
      ThreeMod["BufferAttribute"]
    >;
    for (let i = 0; i < CAPTURE_PARTICLES; i++) {
      const s = capSeed[i]!;
      const homeX = (s - 0.5) * (PARTICLE_WRAP_X * 0.92);
      const swirl = s * Math.PI * 2 + timeS * (0.55 + s * 0.28);
      const drift = (timeS * (0.028 + s * 0.014)) % PARTICLE_WRAP_X;
      let x = wrapCentered(
        homeX - drift + Math.sin(swirl * 0.65 + timeS * 0.35) * 0.42,
        PARTICLE_WRAP_X,
      );
      let y =
        Math.sin(swirl * 1.2 + timeS * 0.55) * (0.32 + s * 0.48) +
        Math.cos(swirl * 0.5 + timeS * 0.9) * 0.24;
      let z =
        Math.sin(swirl) * (0.55 + s * 0.7) + Math.cos(swirl * 0.7) * 0.25;
      // Pull into a flat sample band → becomes the detect wave.
      y *= 1 - coalesce * 0.92;
      z *= 1 - coalesce * 0.75;
      x = x * (1 - coalesce * 0.15) + SCAN_X * coalesce * 0.15;
      arr.setX(i, x);
      arr.setY(i, y);
      arr.setZ(i, z);
    }
    arr.needsUpdate = true;
  };

  const driveDetect = (timeS: number, prog: number, weight = 1) => {
    // Phase-local clock so each cycle restarts the tape at the same X.
    const travel = waveTravel(landingPhaseClock(timeS, "detect"), WAVE_SPEED);
    const colorMix = Math.min(1, prog * 1.4 + 0.15);
    setWaveBars(bgWave, travel, true, colorMix);
    const waveMat = bgWave.material as InstanceType<
      ThreeMod["MeshStandardMaterial"]
    >;
    waveMat.opacity = (0.42 + colorMix * 0.2) * Math.max(weight, 0.001);

    const x = SCAN_X + Math.sin(timeS * 2.8) * 0.04;
    scanPlane.position.set(x, 0, 0.22);
    scanGlow.position.set(x, 0, 0.28);
    (
      scanGlow.material as InstanceType<ThreeMod["MeshBasicMaterial"]>
    ).opacity = (0.05 + prog * 0.1) * weight;
  };

  const driveLibrary = (timeS: number, prog: number, weight = 1) => {
    // 1:1 handoff — same t as arrange (easeInOutCubic once, shared).
    const scroll = landingPhaseMotionClock(timeS, "arrange") * ARRANGE_SCROLL;
    for (let i = 0; i < LIBRARY_N; i++) {
      const a = libraryLivePose(i, prog, timeS);
      let x = a.x;
      let y = a.y;
      let z = a.z;
      let rx = a.rx;
      let ry = a.ry;
      let rz = a.rz;
      let sx = a.s;
      let sy = a.s;
      let sz = a.s;
      // Non-handoff pieces follow group weight only.
      let fade = weight * (0.55 + Math.min(1, prog) * 0.45);

      if (i < CLIP_N) {
        const b = clipMovingPose(i, scroll, lanes[i % 4]!.position.y);
        const t = landingHandoffMotion(timeS, "library", "arrange", i);
        const o = landingHandoffOpacity(timeS, "library", "arrange", i);
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
        z = a.z + (b.z - a.z) * t;
        rx = a.rx * (1 - t);
        ry = a.ry * (1 - t);
        rz = a.rz * (1 - t);
        sx = a.s + (b.len / 0.55 - a.s) * t;
        sy = a.s + (1 - a.s) * t;
        sz = a.s + (1 - a.s) * t;
        // Fast opacity exit (separate from motion ease).
        fade = (1 - o) * (0.55 + 0.45 * Math.min(1, prog));
      }

      const m = libraryPieces[i]!;
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      m.traverse((obj) => {
        if (!("material" in obj) || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const raw of mats) {
          const mat = raw as OpacityMat;
          mat.opacity = (mat.userData.baseOpacity ?? 1) * fade;
        }
      });
    }
  };

  const driveArrange = (timeS: number, _prog: number, weight = 1) => {
    const handoff = landingHandoff(timeS, "library", "arrange");
    const scroll = landingPhaseMotionClock(timeS, "arrange") * ARRANGE_SCROLL;
    const libProg = landingPhaseProgress(timeS, "library");
    const headX = LANE_LEFT + 0.35 + ((scroll * 0.55) % (LANE_SPAN - 0.7));
    playhead.position.x = headX;
    (
      playhead.material as InstanceType<ThreeMod["MeshBasicMaterial"]>
    ).opacity = (0.25 + handoff * 0.6) * Math.max(weight, handoff);

    for (const lane of lanes) {
      const mat = lane.material as InstanceType<ThreeMod["MeshStandardMaterial"]>;
      mat.opacity = (0.06 + handoff * 0.14) * Math.max(weight, handoff, 0.001);
    }

    for (let i = 0; i < CLIP_N; i++) {
      const clip = clipMeshes[i]!;
      const a = libraryLivePose(i, libProg, timeS);
      const b = clipMovingPose(i, scroll, lanes[i % 4]!.position.y);
      // Identical t / pose lerp as library exit.
      const t = landingHandoffMotion(timeS, "library", "arrange", i);
      const o = landingHandoffOpacity(timeS, "library", "arrange", i);
      clip.position.set(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      );
      clip.scale.set(
        a.s + (b.len / 0.55 - a.s) * t,
        a.s + (1 - a.s) * t,
        a.s + (1 - a.s) * t,
      );
      clip.rotation.set(a.rx * (1 - t), a.ry * (1 - t), a.rz * (1 - t));

      const mat = clip.material as InstanceType<ThreeMod["MeshStandardMaterial"]>;
      const col = tagCols[b.tag as 0 | 1 | 2]!;
      mat.color.copy(col);
      mat.emissive.copy(col);
      const active =
        t > 0.7 && headX >= b.x - b.len * 0.5 && headX <= b.x + b.len * 0.5;
      mat.emissiveIntensity = active ? 0.4 : 0.1 + t * 0.06;
      // Fast opacity entry (mirrors A’s 1 − o).
      mat.opacity = o * b.edgeFade * (0.55 + 0.45 * o);
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
      mat.opacity = (1 - phase) * 0.55 * weight;
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
      arr.setZ(i, Math.sin(a) * r * 0.75);
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
        cameraFrom.set(0.15, 0.2, 5.6);
        lookFrom.set(0.15, 0, 0);
        camera.fov = 42;
        break;
      case "detect":
        cameraFrom.set(0, 0.12, 5.2);
        lookFrom.set(SCAN_X, 0, 0);
        camera.fov = 40;
        break;
      case "library":
        cameraFrom.set(
          Math.sin(timeS * 0.18) * 0.2,
          0.12,
          5.5 + Math.cos(timeS * 0.15) * 0.15,
        );
        lookFrom.set(0, 0, 0);
        camera.fov = 38;
        break;
      case "arrange":
        cameraFrom.set(
          0.05,
          0.55 + Math.sin(timeS * 0.25) * 0.04,
          5.6,
        );
        lookFrom.set(0, 0.05, 0);
        camera.fov = 36;
        break;
      case "export":
        cameraFrom.set(
          Math.cos(timeS * 0.2) * 3.2,
          0.35 + Math.sin(timeS * 0.35) * 0.1,
          Math.sin(timeS * 0.2) * 3.2,
        );
        lookFrom.set(0, 0, 0);
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
    const aspect = cssW / Math.max(1, cssH);
    const scale =
      aspect >= 1 ? 1 : Math.min(1, 0.74 + aspect * 0.3);
    contentRoot.scale.setScalar(scale);
    contentRoot.position.x = 0;
    contentRoot.position.y = aspect < 0.72 ? -0.02 : 0;
  };

  /** Extra Z breathe on the whole stage (kept separate from fitContent resize). */
  const driveContentZ = (timeS: number) => {
    contentRoot.position.z =
      Math.sin(timeS * 0.55) * 0.28 + Math.sin(timeS * 1.1) * 0.1;
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

    const ambArr = ambGeo.getAttribute("position") as InstanceType<
      ThreeMod["BufferAttribute"]
    >;
    for (let i = 0; i < AMBIENT_N; i++) {
      const s = ambSeed[i]!;
      ambArr.setY(i, Math.sin(timeS * 0.35 + s * 8) * 0.35 + (s - 0.5) * 6);
    }
    ambArr.needsUpdate = true;

    driveContentZ(timeS);

    for (const [id, g] of Object.entries(groups) as [
      LandingFlowPhaseId,
      InstanceType<ThreeMod["Group"]>,
    ][]) {
      applyGroupWeight(g, weights[id] ?? 0);
    }

    for (const id of Object.keys(drivers) as LandingFlowPhaseId[]) {
      const prog = landingPhaseProgress(timeS, id);
      const w = weights[id] ?? 0;
      if (w > 0.001 || id === phase.id || id === phase.next) {
        drivers[id]!(timeS, prog, w);
      }
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
    ambGeo.dispose();
    renderer.forceContextLoss?.();
  };

  resize(w, h);
  render(0);
  return { canvas, resize, render, dispose };
}
