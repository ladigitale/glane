/**
 * WebGL visualizer for Reel export — particles, geometry, tunnel, point field.
 * Scenes are planned per encode (seeded RNG) so two exports differ.
 */

export type ReelPalette = {
  top: string;
  bottom: string;
  wave: string;
  waveDim: string;
  text: string;
  accent: string;
};

export type ReelSceneId = "particles" | "geo" | "tunnel" | "field";

export type ReelSceneSegment = {
  id: ReelSceneId;
  start: number;
  end: number;
};

export type ReelEnergyFrame = {
  rms: number;
  bass: number;
  mid: number;
  high: number;
};

const SCENES: readonly ReelSceneId[] = [
  "particles",
  "geo",
  "tunnel",
  "field",
] as const;

export const REEL_SCENE_IDS: readonly ReelSceneId[] = SCENES;

const PARTICLE_COUNT = 1400;
const RING_VERTS = 64;

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? parseInt(h[0]! + h[0] + h[1] + h[1] + h[2] + h[2], 16)
      : parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Mulberry32 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planScenes(
  durationS: number,
  rng: () => number,
  allowed?: readonly ReelSceneId[],
): ReelSceneSegment[] {
  const pool = (
    allowed && allowed.length > 0 ? [...allowed] : [...SCENES]
  ).filter((id): id is ReelSceneId =>
    (SCENES as readonly string[]).includes(id),
  );
  if (pool.length === 0) {
    return [{ id: "particles", start: 0, end: durationS }];
  }
  if (pool.length === 1) {
    return [{ id: pool[0]!, start: 0, end: durationS }];
  }

  // ~4–7 s per beat so switches are obvious on a 30 s reel.
  const beat = 4 + rng() * 3;
  const n = Math.max(2, Math.ceil(durationS / beat));
  const order: ReelSceneId[] = [];
  let last: ReelSceneId | null = null;
  for (let i = 0; i < n; i++) {
    let pick = pool[Math.floor(rng() * pool.length)]!;
    if (pool.length > 1 && pick === last) {
      pick = pool[(pool.indexOf(pick) + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length]!;
    }
    order.push(pick);
    last = pick;
  }
  const weights = order.map(() => 0.75 + rng());
  const sum = weights.reduce((a, b) => a + b, 0);
  const segs: ReelSceneSegment[] = [];
  let t = 0;
  for (let i = 0; i < order.length; i++) {
    const span =
      i === order.length - 1 ? durationS - t : (weights[i]! / sum) * durationS;
    segs.push({ id: order[i]!, start: t, end: t + Math.max(0.01, span) });
    t += span;
  }
  return segs;
}

export function scenesAt(
  segs: ReelSceneSegment[],
  timeS: number,
): { a: ReelSceneId; b: ReelSceneId; mix: number } {
  if (segs.length === 0) {
    return { a: "particles", b: "particles", mix: 0 };
  }
  let i = 0;
  for (; i < segs.length; i++) {
    if (timeS < segs[i]!.end) break;
  }
  i = Math.min(i, segs.length - 1);
  const cur = segs[i]!;
  const next = segs[i + 1];
  const xfade = Math.min(0.85, (cur.end - cur.start) * 0.22);
  if (!next || timeS < cur.end - xfade) {
    return { a: cur.id, b: cur.id, mix: 0 };
  }
  const mix = (timeS - (cur.end - xfade)) / xfade;
  return { a: cur.id, b: next.id, mix: Math.min(1, Math.max(0, mix)) };
}

/** Precompute energy envelopes at ~fps for the clip. */
export function buildEnergySeries(
  buf: AudioBuffer,
  fps: number,
): ReelEnergyFrame[] {
  const n = Math.max(1, Math.ceil(buf.duration * fps));
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const out: ReelEnergyFrame[] = new Array(n);
  const win = Math.max(64, Math.floor(buf.sampleRate / fps));
  for (let i = 0; i < n; i++) {
    const start = Math.min(buf.length - 1, Math.floor((i / n) * buf.length));
    const end = Math.min(buf.length, start + win);
    let sum = 0;
    let bassAcc = 0;
    let highAcc = 0;
    let lp = 0;
    for (let j = start; j < end; j++) {
      const s0 = ch0[j] ?? 0;
      const s1 = ch1 ? (ch1[j] ?? 0) : s0;
      const s = (s0 + s1) * 0.5;
      sum += s * s;
      lp = lp * 0.92 + s * 0.08;
      bassAcc += lp * lp;
      const hp = s - lp;
      highAcc += hp * hp;
    }
    const count = Math.max(1, end - start);
    const rms = Math.sqrt(sum / count);
    const bass = Math.sqrt(bassAcc / count);
    const high = Math.sqrt(highAcc / count);
    const mid = Math.max(0, rms - bass * 0.55);
    out[i] = {
      rms: Math.min(1, rms * 3.2),
      bass: Math.min(1, bass * 4.5),
      mid: Math.min(1, mid * 3.5),
      high: Math.min(1, high * 5.5),
    };
  }
  let maxR = 0.001;
  for (const f of out) {
    if (f.rms > maxR) maxR = f.rms;
  }
  for (const f of out) {
    f.rms /= maxR;
    f.bass = Math.min(1, f.bass / maxR);
    f.mid = Math.min(1, f.mid / maxR);
    f.high = Math.min(1, f.high / maxR);
  }
  return out;
}

export function energyAt(
  series: ReelEnergyFrame[],
  progress: number,
): ReelEnergyFrame {
  if (series.length === 0) {
    return { rms: 0, bass: 0, mid: 0, high: 0 };
  }
  const i = Math.min(
    series.length - 1,
    Math.max(0, Math.floor(progress * series.length)),
  );
  return series[i]!;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(
  gl: WebGLRenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

const BG_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const BG_FS = `
precision mediump float;
varying vec2 v_uv;
uniform vec3 u_top;
uniform vec3 u_bottom;
uniform vec3 u_accent;
uniform float u_time;
uniform float u_energy;
uniform float u_scene;
void main() {
  vec2 uv = v_uv;
  vec3 col = mix(u_top, u_bottom, uv.y);
  vec2 c = uv - vec2(0.5, 0.42);
  float r = length(c * vec2(1.0, 0.72));
  col += u_accent * (0.12 + 0.18 * u_energy) * exp(-r * 3.2);
  float tunnel = step(1.5, u_scene) * (1.0 - step(2.5, u_scene));
  col += u_accent * tunnel * 0.06 * (1.0 - r);
  float vig = smoothstep(1.15, 0.35, r);
  col *= mix(0.55, 1.0, vig);
  float n = fract(sin(dot(uv * 800.0 + u_time, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}
`;

const PT_VS = `
attribute vec3 a_seed;
attribute float a_phase;
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_scene;
uniform float u_mix;
uniform float u_sceneB;
varying float v_alpha;
varying float v_glow;

float gTmp;

vec2 scenePos(float scene, float t) {
  float ang = a_seed.x * 6.2832 + t * (0.15 + a_seed.z * 0.55);
  float rad = 0.15 + a_seed.y * 0.85;
  vec2 p;
  gTmp = 0.5;

  if (scene < 0.5) {
    float wob = 1.0 + u_bass * 0.35 * sin(t * 11.0 + a_phase);
    p = vec2(cos(ang), sin(ang) * 1.55) * rad * wob;
    p.y += sin(t * 2.2 + a_phase) * 0.07 * u_mid;
    p *= 1.0 + u_energy * 0.12;
  } else if (scene < 1.5) {
    float gx = floor(a_seed.x * 9.0) / 9.0 * 2.0 - 1.0;
    float gy = floor(a_seed.y * 14.0) / 14.0 * 2.0 - 1.0;
    float pulse = 1.0 + u_energy * 0.32 * sin(t * 7.0 + gx * 4.0 + gy * 3.0);
    p = vec2(gx, gy * 1.6) * 0.78 * pulse;
    p += vec2(sin(t * 5.0 + a_phase), cos(t * 6.0 + a_phase)) * u_high * 0.07;
  } else if (scene < 2.5) {
    float z = fract(a_seed.y + t * (0.55 + u_bass * 0.75));
    float rr = mix(0.04, 1.45, z * z);
    float spin = ang + t * (0.7 + u_mid * 1.2);
    p = vec2(cos(spin), sin(spin) * 1.55) * rr;
    gTmp = 1.0 - z;
  } else {
    float drift = t * (0.05 + a_seed.z * 0.08);
    p = vec2(
      fract(a_seed.x + drift * 0.12) * 2.0 - 1.0,
      fract(a_seed.y + sin(a_seed.x * 20.0) * 0.02 + drift * 0.05) * 2.0 - 1.0
    );
    p.y *= 1.55;
    p *= 0.92 + u_energy * 0.05;
  }
  return p;
}

void main() {
  vec2 pa = scenePos(u_scene, u_time);
  float glowA = gTmp;
  vec2 pb = scenePos(u_sceneB, u_time);
  float glowB = gTmp;
  vec2 p = mix(pa, pb, u_mix);
  v_glow = mix(glowA, glowB, u_mix);

  float aspect = u_res.x / u_res.y;
  p.x /= aspect;

  float size = mix(2.5, 7.5, a_seed.z);
  size *= 1.0 + u_energy * 0.9 + u_high * 0.5;
  float tunnelW = step(1.5, mix(u_scene, u_sceneB, u_mix)) *
    (1.0 - step(2.5, mix(u_scene, u_sceneB, u_mix)));
  size *= mix(1.0, 0.7 + v_glow, tunnelW);

  v_alpha = mix(0.25, 0.95, a_seed.z) * (0.55 + u_energy * 0.45);
  gl_PointSize = size;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const PT_FS = `
precision mediump float;
uniform vec3 u_color;
uniform vec3 u_accent;
uniform float u_high;
varying float v_alpha;
varying float v_glow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.08, d);
  vec3 col = mix(u_color, u_accent, 0.35 + u_high * 0.4 + v_glow * 0.2);
  gl_FragColor = vec4(col, soft * v_alpha);
}
`;

const RING_VS = `
attribute float a_angle;
uniform vec2 u_res;
uniform float u_radius;
uniform float u_aspectY;
uniform float u_spin;
uniform float u_sides;
void main() {
  float a = a_angle * 6.2831853;
  float sides = max(u_sides, 2.0);
  float seg = 6.2831853 / sides;
  float q = floor(a / seg + 0.5) * seg;
  float mixQ = smoothstep(2.5, 5.0, sides);
  float ang = mix(a, q, mixQ) + u_spin;
  vec2 p = vec2(cos(ang), sin(ang) * u_aspectY) * u_radius;
  float aspect = u_res.x / u_res.y;
  p.x /= aspect;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const RING_FS = `
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
void main() {
  gl_FragColor = vec4(u_color, u_alpha);
}
`;

function sceneCode(id: ReelSceneId): number {
  switch (id) {
    case "particles":
      return 0;
    case "geo":
      return 1;
    case "tunnel":
      return 2;
    case "field":
      return 3;
  }
}

export type ReelVizFrame = {
  timeS: number;
  progress: number;
  energy: ReelEnergyFrame;
  sceneA: ReelSceneId;
  sceneB: ReelSceneId;
  mix: number;
  palette: ReelPalette;
};

export type ReelViz = {
  canvas: HTMLCanvasElement;
  render: (frame: ReelVizFrame) => void;
  dispose: () => void;
};

export function createReelViz(w: number, h: number): ReelViz | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;

  const bgProg = link(gl, BG_VS, BG_FS);
  const ptProg = link(gl, PT_VS, PT_FS);
  const ringProg = link(gl, RING_VS, RING_FS);
  if (!bgProg || !ptProg || !ringProg) return null;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const seeds = new Float32Array(PARTICLE_COUNT * 3);
  const phases = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
  }
  const seedBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const phaseBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
  gl.bufferData(gl.ARRAY_BUFFER, phases, gl.STATIC_DRAW);

  const angles = new Float32Array(RING_VERTS + 1);
  for (let i = 0; i <= RING_VERTS; i++) angles[i] = i / RING_VERTS;
  const angleBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
  gl.bufferData(gl.ARRAY_BUFFER, angles, gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.viewport(0, 0, w, h);

  const bgLoc = {
    pos: gl.getAttribLocation(bgProg, "a_pos"),
    top: gl.getUniformLocation(bgProg, "u_top"),
    bottom: gl.getUniformLocation(bgProg, "u_bottom"),
    accent: gl.getUniformLocation(bgProg, "u_accent"),
    time: gl.getUniformLocation(bgProg, "u_time"),
    energy: gl.getUniformLocation(bgProg, "u_energy"),
    scene: gl.getUniformLocation(bgProg, "u_scene"),
  };

  const ptLoc = {
    seed: gl.getAttribLocation(ptProg, "a_seed"),
    phase: gl.getAttribLocation(ptProg, "a_phase"),
    res: gl.getUniformLocation(ptProg, "u_res"),
    time: gl.getUniformLocation(ptProg, "u_time"),
    energy: gl.getUniformLocation(ptProg, "u_energy"),
    bass: gl.getUniformLocation(ptProg, "u_bass"),
    mid: gl.getUniformLocation(ptProg, "u_mid"),
    high: gl.getUniformLocation(ptProg, "u_high"),
    scene: gl.getUniformLocation(ptProg, "u_scene"),
    sceneB: gl.getUniformLocation(ptProg, "u_sceneB"),
    mix: gl.getUniformLocation(ptProg, "u_mix"),
    color: gl.getUniformLocation(ptProg, "u_color"),
    accent: gl.getUniformLocation(ptProg, "u_accent"),
  };

  const ringLoc = {
    angle: gl.getAttribLocation(ringProg, "a_angle"),
    res: gl.getUniformLocation(ringProg, "u_res"),
    radius: gl.getUniformLocation(ringProg, "u_radius"),
    aspectY: gl.getUniformLocation(ringProg, "u_aspectY"),
    spin: gl.getUniformLocation(ringProg, "u_spin"),
    sides: gl.getUniformLocation(ringProg, "u_sides"),
    color: gl.getUniformLocation(ringProg, "u_color"),
    alpha: gl.getUniformLocation(ringProg, "u_alpha"),
  };

  const render = (frame: ReelVizFrame) => {
    const { timeS, energy: e, sceneA, sceneB, mix, palette } = frame;
    const top = hexToRgb01(palette.top);
    const bottom = hexToRgb01(palette.bottom);
    const accent = hexToRgb01(palette.accent);
    const wave = hexToRgb01(palette.wave);

    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(bgProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(bgLoc.pos);
    gl.vertexAttribPointer(bgLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(bgLoc.top, top);
    gl.uniform3fv(bgLoc.bottom, bottom);
    gl.uniform3fv(bgLoc.accent, accent);
    gl.uniform1f(bgLoc.time, timeS);
    gl.uniform1f(bgLoc.energy, e.rms);
    gl.uniform1f(bgLoc.scene, sceneCode(sceneA));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const paintRings = (scene: ReelSceneId, weight: number) => {
      if (weight < 0.02) return;
      gl.useProgram(ringProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
      gl.enableVertexAttribArray(ringLoc.angle);
      gl.vertexAttribPointer(ringLoc.angle, 1, gl.FLOAT, false, 0, 0);
      gl.uniform2f(ringLoc.res, w, h);
      gl.uniform1f(ringLoc.aspectY, 1.55);

      const rings =
        scene === "tunnel"
          ? 7
          : scene === "geo"
            ? 5
            : scene === "particles"
              ? 3
              : 2;

      for (let i = 0; i < rings; i++) {
        const t = i / Math.max(1, rings - 1);
        let radius: number;
        let spin: number;
        let sides: number;
        let alpha: number;
        if (scene === "tunnel") {
          const z = (t + timeS * (0.25 + e.bass * 0.4)) % 1;
          radius = 0.08 + z * (0.95 + e.rms * 0.2);
          spin = timeS * 0.3 * (i % 2 === 0 ? 1 : -1);
          sides = 48;
          alpha = (1 - z) * 0.55 * weight * (0.4 + e.rms);
        } else if (scene === "geo") {
          radius =
            (0.22 + t * 0.55) *
            (1 + e.bass * 0.2 * Math.sin(timeS * 7 + i));
          spin = timeS * (0.15 + i * 0.05) * (i % 2 === 0 ? 1 : -1);
          sides = 3 + ((i * 2) % 5);
          alpha = (0.35 + e.mid * 0.4) * weight * (1 - t * 0.3);
        } else if (scene === "particles") {
          radius = (0.35 + t * 0.4) * (1 + e.rms * 0.15);
          spin = timeS * 0.2;
          sides = 32;
          alpha = 0.22 * weight * (0.5 + e.high);
        } else {
          radius = (0.4 + t * 0.25) * (1 + e.rms * 0.08);
          spin = timeS * 0.08;
          sides = 4;
          alpha = 0.18 * weight;
        }
        gl.uniform1f(ringLoc.radius, radius);
        gl.uniform1f(ringLoc.spin, spin);
        gl.uniform1f(ringLoc.sides, sides);
        gl.uniform3fv(ringLoc.color, i % 2 === 0 ? accent : wave);
        gl.uniform1f(ringLoc.alpha, Math.min(0.85, alpha));
        gl.drawArrays(gl.LINE_LOOP, 0, RING_VERTS);
      }
    };

    paintRings(sceneA, 1 - mix);
    paintRings(sceneB, mix);

    gl.useProgram(ptProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
    gl.enableVertexAttribArray(ptLoc.seed);
    gl.vertexAttribPointer(ptLoc.seed, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
    gl.enableVertexAttribArray(ptLoc.phase);
    gl.vertexAttribPointer(ptLoc.phase, 1, gl.FLOAT, false, 0, 0);
    gl.uniform2f(ptLoc.res, w, h);
    gl.uniform1f(ptLoc.time, timeS);
    gl.uniform1f(ptLoc.energy, e.rms);
    gl.uniform1f(ptLoc.bass, e.bass);
    gl.uniform1f(ptLoc.mid, e.mid);
    gl.uniform1f(ptLoc.high, e.high);
    gl.uniform1f(ptLoc.scene, sceneCode(sceneA));
    gl.uniform1f(ptLoc.sceneB, sceneCode(sceneB));
    gl.uniform1f(ptLoc.mix, mix);
    gl.uniform3fv(ptLoc.color, wave);
    gl.uniform3fv(ptLoc.accent, accent);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
  };

  const dispose = () => {
    gl.deleteBuffer(quad);
    gl.deleteBuffer(seedBuf);
    gl.deleteBuffer(phaseBuf);
    gl.deleteBuffer(angleBuf);
    gl.deleteProgram(bgProg);
    gl.deleteProgram(ptProg);
    gl.deleteProgram(ringProg);
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  };

  return { canvas, render, dispose };
}

/** Brand mark paths (matches glBrandMark / public/icons/glane.svg). */
export function drawBrandMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const s = size / 32;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  const paths = [
    "M7 26h3V14.5H7z",
    "M8.5 8.2L11.2 11.6 8.5 14.2 5.8 11.6z",
    "M14.5 26h3V11H14.5z",
    "M16 3.8L19 7.8 16 10.6 13 7.8z",
    "M22 26h3V16.5H22z",
    "M23.5 10.2L26 13.4 23.5 15.8 21 13.4z",
  ];
  for (const d of paths) {
    ctx.fill(new Path2D(d));
  }
  ctx.restore();
}
