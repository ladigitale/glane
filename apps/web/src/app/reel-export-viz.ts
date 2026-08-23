/**
 * Reel / Stories visualizer — distinct scenes (WebGL + Canvas2D fallback).
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

export type ReelSceneId =
  | "particles"
  | "geo"
  | "tunnel"
  | "field"
  | "ripple"
  | "bars"
  | "orbit";

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
  "ripple",
  "bars",
  "orbit",
] as const;

export const REEL_SCENE_IDS: readonly ReelSceneId[] = SCENES;

const PARTICLE_COUNT = 3200;
const RING_VERTS = 96;
const FIELD_LINES = 42;
const FIELD_PTS = 72;
const STREAK_COUNT = 96;

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? parseInt(h[0]! + h[0] + h[1]! + h[1] + h[2]! + h[2], 16)
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

  const beat = 3 + rng() * 2.5;
  const n = Math.max(2, Math.ceil(durationS / beat));
  const order: ReelSceneId[] = [];
  let last: ReelSceneId | null = null;
  for (let i = 0; i < n; i++) {
    let pick = pool[Math.floor(rng() * pool.length)]!;
    if (pool.length > 1 && pick === last) {
      pick =
        pool[
          (pool.indexOf(pick) + 1 + Math.floor(rng() * (pool.length - 1))) %
            pool.length
        ]!;
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
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_scene;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = v_uv;
  // Stable center — immersive “inside the field”.
  vec2 focus = vec2(0.5, 0.5);
  vec2 c = uv - focus;
  c.x += 0.012 * sin(uv.y * 5.0 + u_time * 1.2) * u_mid;
  c.y += 0.01 * cos(uv.x * 4.0 - u_time * 0.9) * u_bass;
  float r = length(c * vec2(0.92, 1.05));
  vec3 col = mix(u_top, u_bottom, uv.y);

  if (u_scene < 0.5) {
    col += u_accent * (0.14 + 0.32 * u_energy) * exp(-r * (1.55 + u_high * 0.35));
    float speck = step(0.93, hash(uv * 420.0 + u_time * 3.0));
    col += u_accent * speck * (0.06 + 0.16 * u_high);
  } else if (u_scene < 1.5) {
    vec2 g = abs(fract(c * vec2(9.0 + u_energy * 3.0, 14.0) + u_time * 0.12) - 0.5);
    float grid = 1.0 - smoothstep(0.008, 0.03, min(g.x, g.y));
    col += u_accent * grid * (0.07 + 0.2 * u_energy);
    float tick = step(0.97, hash(floor(c * 36.0) + u_time));
    col += u_accent * tick * 0.14;
  } else if (u_scene < 2.5) {
    float rings = fract(r * (5.5 + u_bass * 3.5) - u_time * (1.2 + u_bass * 1.6));
    float band = smoothstep(0.12, 0.0, abs(rings - 0.5));
    col += u_accent * band * (0.14 + 0.35 * u_energy) * (1.0 - r * 0.3);
    col *= mix(0.25, 1.0, exp(-r * 1.05));
  } else if (u_scene < 3.5) {
    float wave = sin(uv.x * 22.0 + u_time * 2.2 + uv.y * 4.0 + u_high * 3.0) *
      cos(uv.y * 14.0 - u_time * 1.5 + u_mid * 2.5);
    float grit = hash(uv * 180.0 + u_time * 8.0);
    col += u_accent * (0.06 + 0.22 * u_energy) * (0.4 + 0.6 * wave);
    col += u_accent * (grit - 0.5) * 0.07;
  } else if (u_scene < 4.5) {
    float rip = abs(sin(r * (14.0 + u_bass * 12.0) - u_time * (3.6 + u_energy * 3.0)));
    float ring = smoothstep(0.3, 0.0, rip);
    col += u_accent * ring * (0.14 + 0.38 * u_bass) * exp(-r * 0.8);
    col += u_accent * step(0.95, hash(uv * 260.0 + floor(u_time * 12.0))) * 0.1;
  } else {
    float bar = fract(uv.x * 32.0 + sin(u_time * 2.5) * 0.08);
    float mask = smoothstep(0.045, 0.0, abs(bar - 0.5));
    col += u_accent * mask * (0.035 + 0.09 * u_energy);
    col += u_accent * 0.12 * exp(-abs(c.x) * 1.8) * u_energy;
  }

  float vig = smoothstep(1.4, 0.12, r);
  col *= mix(0.3, 1.0, vig);

  // --- 3D forms in background (raymarch — bold) ---
  vec2 p2 = c * vec2(1.2, 1.05);
  vec3 ro = vec3(0.0, 0.0, -2.15 - u_bass * 0.55);
  vec3 rd = normalize(vec3(p2, 1.15));
  float ca = u_time * 0.65;
  float sa = sin(ca);
  float cb = cos(ca);
  rd.xz = mat2(cb, -sa, sa, cb) * rd.xz;
  ro.xz = mat2(cb, -sa, sa, cb) * ro.xz;

  float tRay = 0.0;
  float hit = 0.0;
  float edge = 99.0;
  vec3 hitP = vec3(0.0);
  for (int i = 0; i < 36; i++) {
    vec3 p = ro + rd * tRay;
    float a1 = u_time * (1.1 + u_mid * 0.8);
    float a2 = u_time * 0.75;
    float c1 = cos(a1); float s1 = sin(a1);
    float c2 = cos(a2); float s2 = sin(a2);
    p.xy = mat2(c1, -s1, s1, c1) * p.xy;
    p.yz = mat2(c2, -s2, s2, c2) * p.yz;

    vec3 q = abs(p);
    float octa = (q.x + q.y + q.z - (0.95 + u_energy * 0.35)) * 0.577;
    vec3 bq = abs(p) - vec3(0.72 + u_bass * 0.22);
    float box = length(max(bq, 0.0)) + min(max(bq.x, max(bq.y, bq.z)), 0.0);
    vec3 rp = mod(p + 1.4, 2.8) - 1.4;
    float shard = length(rp) - 0.22;
    float d = min(min(octa, box * 0.8), shard);
    if (u_scene > 1.5 && u_scene < 2.5) d = min(d, length(vec2(length(p.xy) - 0.95, p.z)) - 0.1);
    if (u_scene > 0.5 && u_scene < 1.5) d = box * 0.75;

    edge = min(edge, abs(d));
    if (d < 0.025) {
      hit = 1.0;
      hitP = p;
      break;
    }
    tRay += max(d * 0.85, 0.025);
    if (tRay > 7.0) break;
  }
  if (hit > 0.5) {
    float shade = clamp(1.0 - tRay / 4.5, 0.0, 1.0);
    float rim = pow(1.0 - abs(dot(normalize(hitP), rd)), 1.4);
    // Strong silhouette — readable 3D body in the plate
    col = mix(col, u_accent * (0.55 + 0.45 * shade), 0.45 + 0.35 * u_energy);
    col += u_accent * rim * (0.55 + 0.4 * u_high);
    col += (u_top + u_bottom) * 0.15 * shade;
  } else {
    // Near-miss glow so solids read even when not hit dead-on
    float prox = exp(-edge * 8.0) * (0.2 + u_energy * 0.35);
    col += u_accent * prox;
  }

  float n1 = hash(uv * vec2(1100.0, 1400.0) + u_time * 17.0);
  float n2 = hash(uv * vec2(90.0, 110.0) + floor(u_time * 24.0));
  float n3 = hash(floor(uv * 220.0) + u_time * 9.0);
  float grain = (n1 - 0.5) * 0.065 + (n2 - 0.5) * 0.04 + (n3 - 0.5) * 0.03;
  grain *= 0.8 + u_energy * 0.65 + u_high * 0.45;
  col += grain;
  col += u_accent * step(0.99, n1) * (0.12 + 0.2 * u_high);

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
varying float v_alpha;
varying float v_glow;

float gTmp;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 project3(vec3 p) {
  float z = p.z + 2.6;
  float persp = 1.55 / max(0.35, z);
  return vec3(p.xy * persp, persp);
}

vec3 scenePos3(float scene, float t) {
  float ang = a_seed.x * 6.2832 + t * (0.35 + a_seed.z * 1.1 + u_mid * 0.4);
  float rad = 0.35 + a_seed.y * 1.1;
  float ecc = 0.75 + a_seed.z * 0.45;
  vec3 p;
  gTmp = 0.5;

  if (scene < 0.5) {
    float wob = 1.0 + u_bass * 0.45 * sin(t * 14.0 + a_phase);
    float z = sin(ang * 2.0 + t * 1.2) * 0.7 + a_seed.z * 0.5;
    p = vec3(cos(ang) * ecc, sin(ang) * (1.05 / max(ecc, 0.35)), z) * rad * wob;
    p.xy += vec2(0.03 * sin(t * 0.7), -0.025 * cos(t * 0.55));
    p.yz = rot2(t * 0.4 + u_bass) * p.yz;
    p *= 1.0 + u_energy * 0.15;
  } else if (scene < 1.5) {
    float gx = floor(a_seed.x * 8.0) / 8.0 * 2.0 - 1.0;
    float gy = floor(a_seed.y * 8.0) / 8.0 * 2.0 - 1.0;
    float gz = floor(a_seed.z * 8.0) / 8.0 * 2.0 - 1.0;
    p = vec3(gx, gy, gz) * (0.85 + u_energy * 0.25);
    p.xy = rot2(t * 0.55) * p.xy;
    p.xz = rot2(t * 0.35 + u_mid) * p.xz;
    p.yz = rot2(t * 0.25) * p.yz;
    gTmp = 0.4 + abs(gz) * 0.5;
  } else if (scene < 2.5) {
    float z = fract(a_seed.y + t * (1.05 + u_bass * 1.4));
    float rr = mix(0.08, 1.4, z * z);
    float spin = ang + t * (1.4 + u_mid * 2.2);
    p = vec3(cos(spin) * rr, sin(spin) * rr * 0.95, mix(1.6, -1.4, z));
    gTmp = 1.0 - z;
  } else if (scene < 3.5) {
    float drift = t * (0.12 + a_seed.z * 0.22);
    float yy = fract(a_seed.y + drift * 0.09) * 2.0 - 1.0;
    float xx = fract(a_seed.x + drift * 0.22) * 2.0 - 1.0;
    float zz = sin(xx * 4.0 + yy * 3.0 + t * 1.5) * 0.8;
    p = vec3(xx * 1.1, yy * 1.0, zz);
    p.xz = rot2(t * 0.3) * p.xz;
  } else if (scene < 4.5) {
    float z = fract(a_seed.y + t * (0.35 + u_bass * 0.5));
    float rr = mix(0.1, 1.2, z) * (1.0 + u_bass * 0.3);
    float spin = ang + sin(t * 4.0 + a_phase) * 0.25;
    p = vec3(cos(spin) * rr, sin(spin) * rr, mix(1.2, -1.0, z));
    p.xy = rot2(t * 0.2) * p.xy;
    gTmp = 1.0 - z;
  } else {
    float bx = floor(a_seed.x * 36.0) / 36.0 * 2.0 - 1.0;
    float hh = a_seed.y * (0.5 + u_energy * 1.1);
    float signY = a_seed.z > 0.5 ? 1.0 : -1.0;
    float zz = sin(bx * 6.0 + t * 2.0) * 0.6;
    p = vec3(bx * 1.05, hh * signY * 0.7, zz);
    p.xz = rot2(t * 0.25 + u_bass * 0.5) * p.xz;
  }

  p.x += sin(t * 37.0 + a_phase) * (0.006 + u_high * 0.02);
  p.y += cos(t * 41.0 + a_seed.z * 9.0) * (0.006 + u_high * 0.02);
  return p;
}

void main() {
  vec3 world = scenePos3(u_scene, u_time);
  vec3 pr = project3(world);
  v_glow = gTmp;
  float aspect = u_res.x / u_res.y;
  vec2 p = pr.xy;
  p.x /= aspect;

  float size = mix(1.8, 6.5, a_seed.z * a_seed.z);
  size *= pr.z * (1.1 + u_energy * 0.7 + u_high * 0.9);
  if (a_seed.z > 0.88) size *= 1.0 + u_high * 2.4;
  if (u_scene > 1.5 && u_scene < 2.5) size *= 0.65 + v_glow * 0.8;
  else if (u_scene > 4.5) size *= 0.55 + u_energy * 0.5;
  else if (u_scene > 0.5 && u_scene < 1.5) size *= 0.85;

  v_alpha = mix(0.35, 1.0, a_seed.z) * (0.5 + u_energy * 0.5 + pr.z * 0.3);
  if (u_scene > 0.5 && u_scene < 1.5) v_alpha *= 0.55;
  if (u_scene > 3.5 && u_scene < 4.5) v_alpha *= 0.45;
  gl_PointSize = max(1.0, size);
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
  // Harder grainy speck — less soft bloom.
  float core = smoothstep(0.5, 0.12, d);
  float grit = fract(sin(dot(gl_PointCoord * 40.0, vec2(12.9898, 78.233))) * 43758.5453);
  float soft = core * mix(0.65, 1.0, step(0.35, grit));
  vec3 col = mix(u_color, u_accent, 0.25 + u_high * 0.5 + v_glow * 0.25);
  col += (grit - 0.5) * 0.12;
  gl_FragColor = vec4(col, soft * v_alpha);
}
`;

const RING_VS = `
attribute float a_angle;
uniform vec2 u_res;
uniform float u_radius;
uniform float u_aspectY;
uniform float u_spin;
uniform float u_tilt;
uniform float u_roll;
uniform float u_z;
uniform float u_sides;
uniform float u_ox;
uniform float u_oy;
uniform float u_warp;
void main() {
  float a = a_angle * 6.2831853;
  float sides = max(u_sides, 2.0);
  float seg = 6.2831853 / sides;
  float q = floor(a / seg + 0.5) * seg;
  float mixQ = smoothstep(2.5, 5.0, sides);
  float ang = mix(a, q, mixQ);
  float rad = u_radius * (1.0 + u_warp * sin(ang * 3.0 + u_spin * 2.0));
  // Circle in local XY, then full 3D rotation + perspective.
  vec3 p = vec3(cos(ang) * rad, sin(ang) * rad * u_aspectY, 0.0);
  float cy = cos(u_tilt); float sy = sin(u_tilt);
  float cz = cos(u_spin); float sz = sin(u_spin);
  float cx = cos(u_roll); float sx = sin(u_roll);
  // rot Z (spin) then X (tilt) then Y (roll-ish)
  p.xy = mat2(cz, -sz, sz, cz) * p.xy;
  p.yz = mat2(cy, -sy, sy, cy) * p.yz;
  p.xz = mat2(cx, -sx, sx, cx) * p.xz;
  p.x += u_ox;
  p.y += u_oy;
  p.z += u_z;
  float persp = 1.55 / max(0.35, p.z + 2.6);
  vec2 q2 = p.xy * persp;
  float aspect = u_res.x / u_res.y;
  q2.x /= aspect;
  gl_Position = vec4(q2, 0.0, 1.0);
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

const LINE_VS = `
attribute vec2 a_pos;
uniform vec2 u_res;
void main() {
  vec2 p = a_pos;
  float aspect = u_res.x / u_res.y;
  p.x /= aspect;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const LINE_FS = `
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
void main() {
  gl_FragColor = vec4(u_color, u_alpha);
}
`;

/** Classic post — warp / aberrate / glitch / zoom the whole frame. */
const POST_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const POST_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_scene;
uniform float u_progress;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 barrel(vec2 uv, float amount) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return 0.5 + c * (1.0 + r2 * amount);
}

void main() {
  // FBO texture is Y-flipped relative to canvas.
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 c = uv - 0.5;

  // --- Zoom pulse (bass) ---
  float zoom = 1.0 - u_bass * 0.22 - u_energy * 0.1 * sin(u_time * 9.0);
  uv = 0.5 + c * zoom;
  c = uv - 0.5;

  // --- Barrel / fisheye ---
  float barrelAmt = 0.14 + u_mid * 0.22 + (u_scene > 1.5 && u_scene < 2.5 ? 0.18 : 0.0);
  uv = barrel(uv, barrelAmt);
  c = uv - 0.5;

  // --- Ripple / wave warp ---
  float warp = 0.01 + u_high * 0.028 + u_energy * 0.016;
  uv.x += sin(uv.y * 22.0 + u_time * 3.4) * warp;
  uv.y += cos(uv.x * 18.0 - u_time * 2.6) * warp * 0.85;
  uv += vec2(
    sin(u_time * 1.3 + uv.y * 6.0),
    cos(u_time * 1.1 + uv.x * 5.0)
  ) * (0.01 + u_bass * 0.025);

  // --- Camera shake ---
  float shake = u_energy * 0.018 + u_bass * 0.012;
  uv += vec2(
    sin(u_time * 47.0) * shake,
    cos(u_time * 41.0) * shake * 0.9
  );

  // --- Block glitch (highs) ---
  float gy = floor(uv.y * (14.0 + u_high * 10.0));
  float gChance = 0.82 - u_high * 0.18;
  float glitch = step(gChance, hash(vec2(gy, floor(u_time * 11.0))));
  uv.x += glitch * (hash(vec2(gy * 3.1, u_time)) - 0.5) * (0.1 + u_high * 0.16);

  // --- Horizontal tear ---
  float tear = step(0.96 - u_energy * 0.06, hash(vec2(floor(u_time * 6.0), 2.7)));
  uv.x += tear * sin(uv.y * 40.0 + u_time * 20.0) * 0.07;

  // --- Kaleido hint on geo ---
  if (u_scene > 0.5 && u_scene < 1.5) {
    vec2 kc = uv - 0.5;
    float ang = atan(kc.y, kc.x);
    float rad = length(kc);
    float seg = 6.2831853 / 6.0;
    ang = mod(ang, seg);
    ang = abs(ang - seg * 0.5);
    uv = 0.5 + vec2(cos(ang), sin(ang)) * rad;
  }

  // Clamp soft — avoid hard edge sampling
  uv = clamp(uv, 0.001, 0.999);

  // --- Chromatic aberration ---
  float aber = 0.006 + u_high * 0.028 + u_energy * 0.014;
  vec2 dir = length(c) > 1e-4 ? normalize(c) : vec2(1.0, 0.0);
  vec2 dir2 = vec2(dir.x * 0.85 - dir.y * 0.2, dir.y * 0.85 + dir.x * 0.2);
  float cr = texture2D(u_tex, uv + dir2 * aber).r;
  float cg = texture2D(u_tex, uv).g;
  float cb = texture2D(u_tex, uv - dir2 * aber).b;
  vec3 col = vec3(cr, cg, cb);

  // --- Cheap bloom (4-tap) ---
  float bloomAmt = 0.22 + u_energy * 0.4;
  vec2 px = 2.5 / u_res;
  vec3 bloom =
    texture2D(u_tex, uv + vec2(px.x, 0.0)).rgb +
    texture2D(u_tex, uv - vec2(px.x, 0.0)).rgb +
    texture2D(u_tex, uv + vec2(0.0, px.y)).rgb +
    texture2D(u_tex, uv - vec2(0.0, px.y)).rgb;
  col = mix(col, max(col, bloom * 0.28), bloomAmt);

  // --- Scanlines ---
  float scan = 0.88 + 0.12 * sin(uv.y * u_res.y * 3.14159);
  col *= scan;

  // --- CRT roll / brightness flicker ---
  float flicker = 1.0 + (hash(vec2(floor(u_time * 24.0), 0.5)) - 0.5) * 0.04 * u_energy;
  col *= flicker;

  // --- Progress sweep veil ---
  float sweep = smoothstep(0.0, 0.02, uv.x - u_progress) *
    (1.0 - smoothstep(0.0, 0.08, uv.x - u_progress));
  col += vec3(0.08, 0.12, 0.1) * sweep * (0.15 + u_energy * 0.2);

  // Edge vignette after warp
  float vig = smoothstep(1.15, 0.2, length(uv - 0.5) * 1.35);
  col *= mix(0.55, 1.0, vig);

  // --- Color inversions (hard + frequent) ---
  // Periodic full-frame invert (~every 2s, holds ~0.35s)
  float cycle = fract(u_time * 0.48);
  float invHold = smoothstep(0.0, 0.04, cycle) * (1.0 - smoothstep(0.18, 0.28, cycle));
  // Bass-triggered strob
  float invBass = smoothstep(0.2, 0.55, u_bass) * (0.55 + 0.45 * sin(u_time * 14.0));
  // Horizontal invert bands sweeping
  float invBand = step(0.0, sin(uv.y * 16.0 - u_time * 8.0)) *
    (0.35 + 0.55 * smoothstep(0.15, 0.5, u_high + u_energy * 0.5));
  // Center vs edge invert split
  float invRadial = step(0.32 + u_bass * 0.1, length(uv - 0.5)) *
    (0.4 + 0.5 * step(0.0, sin(u_time * 2.2)));
  float invAmt = max(max(invHold * 0.95, invBass), max(invBand, invRadial));
  vec3 invCol = 1.0 - col;
  float chPick = hash(vec2(floor(u_time * 2.5), 1.7));
  if (chPick > 0.66) invCol = vec3(1.0 - col.r, col.g, 1.0 - col.b);
  else if (chPick > 0.33) invCol = vec3(col.r, 1.0 - col.g, col.b);
  col = mix(col, invCol, clamp(invAmt, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
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
    case "ripple":
      return 4;
    case "bars":
      return 5;
    case "orbit":
      // Drawn by Three.js path — map to particles if GL ever sees it.
      return 0;
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
  /** Optional live waveform peaks for bars scene (0…1). */
  peaks?: Float32Array;
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
  const lineProg = link(gl, LINE_VS, LINE_FS);
  const postProg = link(gl, POST_VS, POST_FS);
  if (!bgProg || !ptProg || !ringProg || !lineProg || !postProg) return null;

  // Offscreen target for post-processing.
  const sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  const sceneFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    sceneTex,
    0,
  );
  const fboOk =
    gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!fboOk) {
    gl.deleteFramebuffer(sceneFbo);
    gl.deleteTexture(sceneTex);
    gl.deleteProgram(postProg);
    // Continue without post — still usable.
  }

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

  const lineData = new Float32Array(
    Math.max(FIELD_LINES * FIELD_PTS, STREAK_COUNT * 2) * 2,
  );
  const lineBuf = gl.createBuffer();

  const streakSeeds = Array.from({ length: STREAK_COUNT }, () => ({
    ang: Math.random() * Math.PI * 2,
    len: 0.25 + Math.random() * 0.9,
    speed: 0.7 + Math.random() * 1.8,
  }));

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
    bass: gl.getUniformLocation(bgProg, "u_bass"),
    mid: gl.getUniformLocation(bgProg, "u_mid"),
    high: gl.getUniformLocation(bgProg, "u_high"),
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
    color: gl.getUniformLocation(ptProg, "u_color"),
    accent: gl.getUniformLocation(ptProg, "u_accent"),
  };

  const ringLoc = {
    angle: gl.getAttribLocation(ringProg, "a_angle"),
    res: gl.getUniformLocation(ringProg, "u_res"),
    radius: gl.getUniformLocation(ringProg, "u_radius"),
    aspectY: gl.getUniformLocation(ringProg, "u_aspectY"),
    spin: gl.getUniformLocation(ringProg, "u_spin"),
    tilt: gl.getUniformLocation(ringProg, "u_tilt"),
    roll: gl.getUniformLocation(ringProg, "u_roll"),
    z: gl.getUniformLocation(ringProg, "u_z"),
    sides: gl.getUniformLocation(ringProg, "u_sides"),
    ox: gl.getUniformLocation(ringProg, "u_ox"),
    oy: gl.getUniformLocation(ringProg, "u_oy"),
    warp: gl.getUniformLocation(ringProg, "u_warp"),
    color: gl.getUniformLocation(ringProg, "u_color"),
    alpha: gl.getUniformLocation(ringProg, "u_alpha"),
  };

  const lineLoc = {
    pos: gl.getAttribLocation(lineProg, "a_pos"),
    res: gl.getUniformLocation(lineProg, "u_res"),
    color: gl.getUniformLocation(lineProg, "u_color"),
    alpha: gl.getUniformLocation(lineProg, "u_alpha"),
  };

  const postLoc = fboOk
    ? {
        pos: gl.getAttribLocation(postProg, "a_pos"),
        tex: gl.getUniformLocation(postProg, "u_tex"),
        res: gl.getUniformLocation(postProg, "u_res"),
        time: gl.getUniformLocation(postProg, "u_time"),
        energy: gl.getUniformLocation(postProg, "u_energy"),
        bass: gl.getUniformLocation(postProg, "u_bass"),
        mid: gl.getUniformLocation(postProg, "u_mid"),
        high: gl.getUniformLocation(postProg, "u_high"),
        scene: gl.getUniformLocation(postProg, "u_scene"),
        progress: gl.getUniformLocation(postProg, "u_progress"),
      }
    : null;

  const drawBg = (
    scene: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    top: [number, number, number],
    bottom: [number, number, number],
    accent: [number, number, number],
  ) => {
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
    gl.uniform1f(bgLoc.bass, e.bass);
    gl.uniform1f(bgLoc.mid, e.mid);
    gl.uniform1f(bgLoc.high, e.high);
    gl.uniform1f(bgLoc.scene, sceneCode(scene));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  };

  const drawParticles = (
    scene: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    const count =
      scene === "geo"
        ? Math.floor(PARTICLE_COUNT * 0.45)
        : scene === "ripple"
          ? Math.floor(PARTICLE_COUNT * 0.4)
          : scene === "bars"
            ? Math.floor(PARTICLE_COUNT * 0.55)
            : PARTICLE_COUNT;
    gl.useProgram(ptProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
    gl.enableVertexAttribArray(ptLoc.seed);
    gl.vertexAttribPointer(ptLoc.seed, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
    gl.enableVertexAttribArray(ptLoc.phase);
    gl.vertexAttribPointer(ptLoc.phase, 1, gl.FLOAT, false, 0, 0);
    gl.uniform2f(ptLoc.res, w, h);
    gl.uniform1f(ptLoc.time, timeS);
    gl.uniform1f(ptLoc.energy, e.rms * weight);
    gl.uniform1f(ptLoc.bass, e.bass);
    gl.uniform1f(ptLoc.mid, e.mid);
    gl.uniform1f(ptLoc.high, e.high);
    gl.uniform1f(ptLoc.scene, sceneCode(scene));
    gl.uniform3fv(ptLoc.color, wave);
    gl.uniform3fv(ptLoc.accent, accent);
    gl.drawArrays(gl.POINTS, 0, count);
  };

  const drawRings = (
    scene: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    gl.useProgram(ringProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
    gl.enableVertexAttribArray(ringLoc.angle);
    gl.vertexAttribPointer(ringLoc.angle, 1, gl.FLOAT, false, 0, 0);
    gl.uniform2f(ringLoc.res, w, h);

    const rings =
      scene === "tunnel"
        ? 12
        : scene === "geo"
          ? 8
          : scene === "ripple"
            ? 11
            : scene === "particles"
              ? 5
              : scene === "bars"
                ? 0
                : 3;

    const ox0 = 0.02 * Math.sin(timeS * 0.55);
    const oy0 = 0.015 * Math.cos(timeS * 0.45);

    for (let i = 0; i < rings; i++) {
      const t = i / Math.max(1, rings - 1);
      let radius: number;
      let spin: number;
      let sides: number;
      let alpha: number;
      let aspectY: number;
      let warp: number;
      let tilt: number;
      let roll: number;
      let zDepth: number;
      const ox = ox0;
      const oy = oy0;

      if (scene === "tunnel") {
        const z = (t + timeS * (0.55 + e.bass * 0.7)) % 1;
        radius = 0.35 + (1 - z) * 0.55;
        spin = timeS * (0.6 + e.mid * 0.4) * (i % 2 === 0 ? 1 : -1);
        sides = 64;
        aspectY = 1.0;
        warp = 0.03 + e.high * 0.06;
        tilt = 0.15 * Math.sin(timeS * 0.8 + i);
        roll = timeS * 0.2;
        zDepth = -1.2 + z * 2.6;
        alpha = (1 - z) * 0.75 * weight * (0.45 + e.rms);
      } else if (scene === "geo") {
        radius =
          (0.45 + t * 0.7) *
          (1 + e.bass * 0.35 * Math.sin(timeS * 10 + i * 1.7));
        spin = timeS * (0.75 + i * 0.15) * (i % 2 === 0 ? 1 : -1);
        sides = 3 + ((i * 3 + Math.floor(timeS * 0.5)) % 6);
        aspectY = 1.0;
        warp = 0.06 + e.mid * 0.1;
        tilt = timeS * (0.65 + i * 0.08) + i;
        roll = timeS * 0.5 * (i % 2 === 0 ? 1 : -1);
        zDepth = Math.sin(timeS * 0.9 + i) * 0.85;
        alpha = (0.45 + e.mid * 0.4) * weight * (1 - t * 0.15);
      } else if (scene === "ripple") {
        const z = (t + timeS * (0.9 + e.bass * 0.6)) % 1;
        radius = 0.25 + (1 - z) * 0.7;
        spin = Math.sin(timeS * 2.5 + i) * 0.2;
        sides = 48;
        aspectY = 1.0;
        warp = 0.05 + e.bass * 0.08;
        tilt = 0.35 * Math.sin(timeS * 1.1 + i * 0.4);
        roll = timeS * 0.15;
        zDepth = -0.8 + z * 1.8;
        alpha = (1 - z) * 0.45 * weight * (0.4 + e.bass);
      } else if (scene === "particles") {
        radius = (0.4 + t * 0.45) * (1 + e.rms * 0.2);
        spin = timeS * (0.5 + e.high * 0.3) * (i % 2 === 0 ? 1 : -1.3);
        sides = 28 + (i % 5);
        aspectY = 1.0;
        warp = 0.06 + e.high * 0.08;
        tilt = timeS * 0.35 + i * 0.4;
        roll = timeS * 0.25;
        zDepth = Math.cos(timeS * 0.6 + i) * 0.7;
        alpha = 0.16 * weight * (0.45 + e.high);
      } else {
        radius = (0.4 + t * 0.35) * (1 + e.rms * 0.1);
        spin = timeS * 0.25;
        sides = 5;
        aspectY = 1.0;
        warp = 0.08;
        tilt = timeS * 0.4;
        roll = timeS * 0.2;
        zDepth = Math.sin(timeS + i) * 0.4;
        alpha = 0.12 * weight;
      }
      gl.uniform1f(ringLoc.aspectY, aspectY);
      gl.uniform1f(ringLoc.radius, radius);
      gl.uniform1f(ringLoc.spin, spin);
      gl.uniform1f(ringLoc.tilt, tilt);
      gl.uniform1f(ringLoc.roll, roll);
      gl.uniform1f(ringLoc.z, zDepth);
      gl.uniform1f(ringLoc.sides, sides);
      gl.uniform1f(ringLoc.ox, ox);
      gl.uniform1f(ringLoc.oy, oy);
      gl.uniform1f(ringLoc.warp, warp);
      gl.uniform3fv(ringLoc.color, i % 2 === 0 ? accent : wave);
      gl.uniform1f(ringLoc.alpha, Math.min(0.75, alpha));
      gl.drawArrays(gl.LINE_LOOP, 0, RING_VERTS);
    }
  };

  const project3js = (x: number, y: number, z: number): [number, number] => {
    const persp = 1.55 / Math.max(0.35, z + 2.6);
    const aspect = w / h;
    return [(x * persp) / aspect, y * persp];
  };

  const rot3 = (
    p: [number, number, number],
    ax: number,
    ay: number,
    az: number,
  ): [number, number, number] => {
    let [x, y, z] = p;
    const cz = Math.cos(az);
    const sz = Math.sin(az);
    let nx = x * cz - y * sz;
    let ny = x * sz + y * cz;
    x = nx;
    y = ny;
    const cy = Math.cos(ay);
    const sy = Math.sin(ay);
    nx = x * cy + z * sy;
    let nz = -x * sy + z * cy;
    x = nx;
    z = nz;
    const cx = Math.cos(ax);
    const sx = Math.sin(ax);
    ny = y * cx - z * sx;
    nz = y * sx + z * cx;
    return [x, ny, nz];
  };

  /** Wireframe cubes / octahedra projected in 3D. */
  const drawWireSolids3d = (
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
    scene: ReelSceneId,
  ) => {
    if (weight < 0.02) return;
    if (scene !== "geo" && scene !== "particles" && scene !== "tunnel") return;
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    const solids = scene === "geo" ? 7 : 5;
    let o = 0;
    let segments = 0;
    const pushEdge = (
      a: [number, number, number],
      b: [number, number, number],
    ) => {
      const pa = project3js(a[0], a[1], a[2]);
      const pb = project3js(b[0], b[1], b[2]);
      lineData[o++] = pa[0];
      lineData[o++] = pa[1];
      lineData[o++] = pb[0];
      lineData[o++] = pb[1];
      segments++;
    };
    for (let s = 0; s < solids; s++) {
      const scale = (0.55 + s * 0.18) * (1 + e.bass * 0.35 + e.rms * 0.2);
      const ax = timeS * (0.85 + s * 0.1) + s;
      const ay = timeS * (0.6 + s * 0.08);
      const az = timeS * (0.45 + e.mid * 0.35) * (s % 2 === 0 ? 1 : -1);
      if (scene === "geo" || s % 2 === 0) {
        const corners: Array<[number, number, number]> = [];
        for (let i = 0; i < 8; i++) {
          const c: [number, number, number] = [
            (i & 1 ? 1 : -1) * scale,
            (i & 2 ? 1 : -1) * scale,
            (i & 4 ? 1 : -1) * scale,
          ];
          corners.push(rot3(c, ax, ay, az));
        }
        const edges: Array<[number, number]> = [
          [0, 1],
          [1, 3],
          [3, 2],
          [2, 0],
          [4, 5],
          [5, 7],
          [7, 6],
          [6, 4],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7],
        ];
        for (const [ia, ib] of edges) {
          pushEdge(corners[ia]!, corners[ib]!);
        }
      } else {
        // octahedron
        const verts: Array<[number, number, number]> = (
          [
            [0, scale * 1.2, 0],
            [0, -scale * 1.2, 0],
            [scale, 0, 0],
            [-scale, 0, 0],
            [0, 0, scale],
            [0, 0, -scale],
          ] as Array<[number, number, number]>
        ).map((v) => rot3(v, ax, ay, az));
        const edges: Array<[number, number]> = [
          [0, 2],
          [0, 3],
          [0, 4],
          [0, 5],
          [1, 2],
          [1, 3],
          [1, 4],
          [1, 5],
          [2, 4],
          [4, 3],
          [3, 5],
          [5, 2],
        ];
        for (const [ia, ib] of edges) {
          pushEdge(verts[ia]!, verts[ib]!);
        }
      }
    }
    if (segments === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(lineLoc.color, accent);
    gl.uniform1f(lineLoc.alpha, (0.55 + e.rms * 0.4) * weight);
    gl.drawArrays(gl.LINES, 0, segments * 2);
    gl.uniform3fv(lineLoc.color, wave);
    gl.uniform1f(lineLoc.alpha, (0.35 + e.high * 0.35) * weight);
    gl.drawArrays(gl.LINES, 0, segments * 2);
  };

  const drawFieldLines = (
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    const driftX = 0.02 * Math.sin(timeS * 0.7);
    const driftY = 0.015 * Math.cos(timeS * 0.55);
    let o = 0;
    for (let L = 0; L < FIELD_LINES; L++) {
      const baseY = (L / (FIELD_LINES - 1)) * 2.4 - 1.2 + driftY;
      for (let p = 0; p < FIELD_PTS; p++) {
        const u = p / (FIELD_PTS - 1);
        const x = u * 2.3 - 1.15 + driftX;
        const y =
          baseY +
          Math.sin(x * 7.5 + timeS * 2.4 + L * 0.55) * (0.06 + e.mid * 0.16) +
          Math.sin(x * 17.0 - timeS * 3.6 + L * 1.3) *
            (0.025 + e.high * 0.12) +
          Math.sin(x * 31.0 + timeS * 8.0 + L) * e.high * 0.035 +
          e.bass * 0.09 * Math.sin(timeS * 9 + L * 0.7);
        lineData[o++] = x;
        lineData[o++] = y;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    for (let L = 0; L < FIELD_LINES; L++) {
      gl.uniform3fv(lineLoc.color, L % 2 === 0 ? accent : wave);
      gl.uniform1f(
        lineLoc.alpha,
        (0.14 + e.rms * 0.35 + e.high * 0.15) *
          weight *
          (0.55 + (L % 5) * 0.08),
      );
      gl.drawArrays(gl.LINE_STRIP, L * FIELD_PTS, FIELD_PTS);
    }
  };

  const drawTunnelStreaks = (
    timeS: number,
    e: ReelEnergyFrame,
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    const ox = 0.02 * Math.sin(timeS * 0.7);
    const oy = 0.015 * Math.cos(timeS * 0.55);
    let o = 0;
    for (let i = 0; i < STREAK_COUNT; i++) {
      const s = streakSeeds[i]!;
      const ang =
        s.ang +
        timeS * (0.35 + e.mid * 0.4) * (i % 2 === 0 ? 1 : -1) +
        Math.sin(timeS * 3 + i) * 0.08;
      const rush = (timeS * s.speed * (1.4 + e.bass) + i * 0.07) % 1;
      const r0 = 0.02 + rush * 0.1;
      const r1 = r0 + s.len * (0.55 + e.rms * 0.65 + e.high * 0.25);
      const squash = 1.08 + 0.1 * Math.sin(timeS + i * 0.2);
      lineData[o++] = Math.cos(ang) * r0 + ox;
      lineData[o++] = Math.sin(ang) * r0 * squash + oy;
      lineData[o++] = Math.cos(ang) * r1 + ox;
      lineData[o++] = Math.sin(ang) * r1 * squash + oy;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(lineLoc.color, accent);
    gl.uniform1f(lineLoc.alpha, (0.12 + e.high * 0.55) * weight);
    gl.drawArrays(gl.LINES, 0, STREAK_COUNT * 2);
  };

  const drawBars = (
    timeS: number,
    e: ReelEnergyFrame,
    peaks: Float32Array | undefined,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    const cols = 56;
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    const tilt = 0.015 * Math.sin(timeS * 1.1);
    let o = 0;
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols;
      const x = u * 1.95 - 0.975 + tilt * (u - 0.5) * 2;
      let mag: number;
      if (peaks && peaks.length > 0) {
        const pi = Math.min(
          peaks.length - 1,
          Math.floor(u * peaks.length),
        );
        const pj = Math.min(peaks.length - 1, pi + 1);
        mag = ((peaks[pi] ?? 0) + (peaks[pj] ?? 0)) * 0.5;
      } else {
        mag =
          0.2 +
          0.6 *
            Math.abs(
              Math.sin(i * 0.7 + timeS * 5.5) *
                Math.cos(i * 0.31 - timeS * 2.8),
            );
      }
      const flutter = 1 + e.high * 0.35 * Math.sin(timeS * 22 + i * 1.7);
      mag *= (0.5 + e.rms * 0.9 + e.bass * 0.4) * flutter;
      const y0 = 0;
      lineData[o++] = x;
      lineData[o++] = y0 - mag * 1.15;
      lineData[o++] = x;
      lineData[o++] = y0 + mag * 1.15;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < cols; i++) {
      gl.uniform3fv(lineLoc.color, i % 3 === 0 ? accent : wave);
      gl.uniform1f(
        lineLoc.alpha,
        (0.28 + e.rms * 0.4 + (i % 5 === 0 ? 0.15 : 0)) * weight,
      );
      gl.drawArrays(gl.LINES, i * 2, 2);
    }
  };

  const drawDebris = (
    timeS: number,
    e: ReelEnergyFrame,
    accent: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02) return;
    const n = 64;
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const seed = i * 1.6180339887;
      const life = (timeS * (0.9 + (i % 5) * 0.25) + seed) % 1;
      const ang = seed * 4.2 + Math.sin(timeS * 0.6 + i) * 0.4;
      const dist = 0.15 + life * (1.1 + e.rms * 0.35);
      const len = 0.01 + e.high * 0.04 + (i % 3) * 0.008;
      const x0 = Math.cos(ang) * dist + 0.08 * Math.sin(timeS * 1.1);
      const y0 =
        Math.sin(ang) * dist * 1.45 - 0.06 * Math.cos(timeS * 0.9);
      const x1 = x0 + Math.cos(ang + 0.5) * len;
      const y1 = y0 + Math.sin(ang + 0.5) * len * 1.3;
      lineData[o++] = x0;
      lineData[o++] = y0;
      lineData[o++] = x1;
      lineData[o++] = y1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(lineLoc.color, accent);
    gl.uniform1f(
      lineLoc.alpha,
      (0.08 + e.high * 0.35 + e.rms * 0.12) * weight,
    );
    gl.drawArrays(gl.LINES, 0, n * 2);
  };

  const drawConstellation = (
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    weight: number,
  ) => {
    if (weight < 0.02 || e.rms < 0.08) return;
    const nodes = 28;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < nodes; i++) {
      const seed = seeds[i * 37] ?? Math.random();
      const seedY = seeds[i * 37 + 1] ?? Math.random();
      const seedZ = seeds[i * 37 + 2] ?? Math.random();
      const ang = seed * Math.PI * 2 + timeS * (0.4 + seedZ);
      const rad = 0.25 + seedY * 1.05;
      const ecc = 0.85 + seedZ * 0.3;
      pts.push([
        Math.cos(ang) * rad * ecc + Math.sin(timeS * 30 + i) * e.high * 0.015,
        Math.sin(ang) * rad * (1.1 / ecc) +
          Math.cos(timeS * 33 + i) * e.high * 0.015,
      ]);
    }
    gl.useProgram(lineProg);
    gl.uniform2f(lineLoc.res, w, h);
    let o = 0;
    let links = 0;
    for (let i = 0; i < nodes; i++) {
      for (let j = i + 1; j < nodes; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.085 && d2 > 0.004) {
          lineData[o++] = a[0];
          lineData[o++] = a[1];
          lineData[o++] = b[0];
          lineData[o++] = b[1];
          links++;
          if (links >= 48) break;
        }
      }
      if (links >= 48) break;
    }
    if (links === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lineLoc.pos);
    gl.vertexAttribPointer(lineLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(lineLoc.color, wave);
    gl.uniform1f(lineLoc.alpha, (0.08 + e.mid * 0.25) * weight);
    gl.drawArrays(gl.LINES, 0, links * 2);
  };

  const paintScene = (
    scene: ReelSceneId,
    timeS: number,
    e: ReelEnergyFrame,
    wave: [number, number, number],
    accent: [number, number, number],
    weight: number,
    peaks?: Float32Array,
  ) => {
    if (weight < 0.02) return;
    // Three.js path — skip custom WebGL paint.
    if (scene === "orbit") return;
    // Motion ghost — slightly earlier frame, thinner.
    const ghostT = Math.max(0, timeS - (0.045 + e.high * 0.03));
    drawRings(scene, ghostT, e, wave, accent, weight * 0.28);
    drawRings(scene, timeS, e, wave, accent, weight);
    drawWireSolids3d(timeS, e, wave, accent, weight, scene);
    if (scene === "tunnel") {
      drawTunnelStreaks(ghostT, e, accent, weight * 0.35);
      drawTunnelStreaks(timeS, e, accent, weight);
    }
    if (scene === "field") {
      drawFieldLines(ghostT, e, wave, accent, weight * 0.3);
      drawFieldLines(timeS, e, wave, accent, weight);
    }
    if (scene === "bars") {
      drawBars(ghostT, e, peaks, wave, accent, weight * 0.25);
      drawBars(timeS, e, peaks, wave, accent, weight);
    }
    if (scene === "particles") {
      drawConstellation(timeS, e, wave, weight);
    }
    drawDebris(timeS, e, accent, weight * (scene === "geo" ? 0.6 : 1));
    const ptW = scene === "bars" && weight >= 0.85 ? weight * 0.35 : weight;
    drawParticles(scene, ghostT, e, wave, accent, ptW * 0.4);
    drawParticles(scene, timeS, e, wave, accent, ptW);
  };

  const render = (frame: ReelVizFrame) => {
    const { timeS, progress, energy: e, sceneA, sceneB, mix, palette, peaks } =
      frame;
    const top = hexToRgb01(palette.top);
    const bottom = hexToRgb01(palette.bottom);
    const accent = hexToRgb01(palette.accent);
    const wave = hexToRgb01(palette.wave);
    const bgScene = mix < 0.5 ? sceneA : sceneB;

    const drawScene = () => {
      gl.viewport(0, 0, w, h);
      drawBg(bgScene, timeS, e, top, bottom, accent);
      paintScene(sceneA, timeS, e, wave, accent, 1 - mix, peaks);
      if (mix > 0.02) paintScene(sceneB, timeS, e, wave, accent, mix, peaks);
    };

    if (fboOk && sceneFbo && sceneTex && postLoc) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawScene();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, w, h);
      gl.useProgram(postProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(postLoc.tex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(postLoc.pos);
      gl.vertexAttribPointer(postLoc.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(postLoc.res, w, h);
      gl.uniform1f(postLoc.time, timeS);
      gl.uniform1f(postLoc.energy, e.rms);
      gl.uniform1f(postLoc.bass, e.bass);
      gl.uniform1f(postLoc.mid, e.mid);
      gl.uniform1f(postLoc.high, e.high);
      gl.uniform1f(postLoc.scene, sceneCode(bgScene));
      gl.uniform1f(postLoc.progress, progress);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else {
      drawScene();
    }
  };

  const dispose = () => {
    gl.deleteBuffer(quad);
    gl.deleteBuffer(seedBuf);
    gl.deleteBuffer(phaseBuf);
    gl.deleteBuffer(angleBuf);
    gl.deleteBuffer(lineBuf);
    gl.deleteProgram(bgProg);
    gl.deleteProgram(ptProg);
    gl.deleteProgram(ringProg);
    gl.deleteProgram(lineProg);
    if (fboOk) {
      gl.deleteProgram(postProg);
      gl.deleteFramebuffer(sceneFbo);
      gl.deleteTexture(sceneTex);
    }
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  };

  return { canvas, render, dispose };
}

/** Fine film grain / dust overlay for the final Canvas2D composite. */
export function drawReelFilmGrain(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    timeS: number;
    energy: ReelEnergyFrame;
    palette: ReelPalette;
  },
): void {
  const { w, h, timeS, energy: e, palette } = opts;
  const frame = Math.floor(timeS * 30);
  const dens = 0.55 + e.rms * 0.45 + e.high * 0.35;
  const n = Math.floor(((w * h) / 1100) * dens);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const hx = Math.sin((i + 1) * 12.9898 + frame * 0.17) * 43758.5453;
    const hy = Math.cos((i + 3) * 78.233 + frame * 0.11) * 24634.841;
    const x = (hx - Math.floor(hx)) * w;
    const y = (hy - Math.floor(hy)) * h;
    const hot = i % 29 === 0;
    const scratch = i % 71 === 0;
    if (scratch) {
      ctx.globalAlpha = (0.06 + e.high * 0.1) * dens;
      ctx.strokeStyle = palette.wave;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + e.rms * 18, y + (i % 2 === 0 ? 1 : -1));
      ctx.stroke();
    } else {
      ctx.globalAlpha = (hot ? 0.45 : 0.12) * dens;
      ctx.fillStyle = hot ? palette.accent : palette.text;
      const s = hot ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }
  }
  // Soft vignette noise band
  ctx.globalAlpha = 0.04 + e.bass * 0.05;
  ctx.fillStyle = palette.accent;
  for (let i = 0; i < 12; i++) {
    const y = ((frame * 13 + i * 97) % h);
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
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

function polyPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  spin: number,
  aspectY = 1.1,
): void {
  ctx.beginPath();
  for (let s = 0; s <= sides; s++) {
    const a = (s / sides) * Math.PI * 2 + spin;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * aspectY;
    if (s === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Full Canvas2D scene paint (fallback when WebGL is unavailable). */
export function paintReelScene2d(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    timeS: number;
    energy: ReelEnergyFrame;
    sceneA: ReelSceneId;
    sceneB: ReelSceneId;
    mix: number;
    palette: ReelPalette;
    peaks?: Float32Array;
  },
): void {
  const { w, h, timeS, energy: e, sceneA, sceneB, mix, palette, peaks } = opts;
  const cx = w / 2;
  const cy = h / 2;

  // Lightweight Canvas2D “post”: zoom pulse + shake when WebGL is absent.
  ctx.save();
  const zoom = 1 + e.bass * 0.06 + e.rms * 0.03 * Math.sin(timeS * 9);
  const shakeX = Math.sin(timeS * 47) * e.rms * 4;
  const shakeY = Math.cos(timeS * 41) * e.rms * 3.5;
  ctx.translate(cx + shakeX, cy + shakeY);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  const sprinkleGrain = (amount: number) => {
    const n = Math.floor((w * h) / 900);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const x = (Math.sin(i * 12.9898 + timeS * 17.1) * 0.5 + 0.5) * w;
      const y = (Math.cos(i * 78.233 + timeS * 9.3) * 0.5 + 0.5) * h;
      const hot = (i * 17) % 23 === 0;
      ctx.globalAlpha = amount * (hot ? 0.55 : 0.18) * (0.6 + e.high * 0.5);
      ctx.fillStyle = hot ? palette.accent : palette.wave;
      ctx.fillRect(x, y, hot ? 2 : 1, hot ? 2 : 1);
    }
    ctx.restore();
  };

  const fillBg = (scene: ReelSceneId) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, palette.top);
    grad.addColorStop(1, palette.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (scene === "geo") {
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = 0.08 + e.rms * 0.12;
      ctx.lineWidth = 1;
      const stepX = w / 14;
      const stepY = h / 22;
      const skew = Math.sin(timeS * 0.6) * 8;
      for (let x = 0; x <= w; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(x + skew, 0);
        ctx.lineTo(x - skew, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + Math.sin(timeS + y * 0.01) * 4);
        ctx.stroke();
      }
    } else if (scene === "tunnel") {
      const g = ctx.createRadialGradient(cx, cy, 12, cx, cy, h * 0.6);
      g.addColorStop(0, palette.accent);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.1 + e.bass * 0.22;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (scene === "field") {
      ctx.globalAlpha = 0.05 + e.mid * 0.08;
      ctx.fillStyle = palette.accent;
      for (let i = 0; i < 10; i++) {
        const y = h * (0.18 + i * 0.07) + Math.sin(timeS * 2 + i) * 6;
        ctx.fillRect(0, y, w, 1 + e.rms * 3);
      }
    }
    ctx.globalAlpha = 1;
    sprinkleGrain(0.7 + e.rms * 0.5);
  };

  const paint = (scene: ReelSceneId, weight: number) => {
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalAlpha = weight;

    if (scene === "particles") {
      for (let i = 0; i < 220; i++) {
        const seed = i * 1.618;
        const ang = seed + timeS * (0.8 + (i % 11) * 0.08);
        const ecc = 0.55 + (i % 7) * 0.12;
        const rad =
          (70 + (i % 18) * 38) *
          (1 + e.bass * 0.35 * Math.sin(timeS * 12 + i));
        const x =
          cx +
          Math.cos(ang) * rad * ecc +
          Math.sin(timeS * 37 + i) * e.high * 5;
        const y =
          cy +
          Math.sin(ang) * rad * (1.15 / ecc) +
          Math.cos(timeS * 41 + i) * e.high * 5;
        const r = i % 17 === 0 ? 2.5 + e.high * 3 : 0.8 + (i % 3) * 0.4;
        ctx.fillStyle = i % 2 === 0 ? palette.wave : palette.accent;
        ctx.globalAlpha = weight * (0.2 + e.rms * 0.4 + (i % 17 === 0 ? 0.25 : 0));
        ctx.fillRect(x, y, r, r);
      }
      ctx.strokeStyle = palette.wave;
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const r = (120 + i * 70) * (1 + e.rms * 0.15);
        ctx.globalAlpha = weight * 0.14;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          r * (0.95 + (i % 3) * 0.08),
          r * (1.05 + Math.sin(timeS + i) * 0.08),
          timeS * 0.3 * (i % 2 === 0 ? 1 : -1),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    } else if (scene === "geo") {
      ctx.lineWidth = 1.25;
      for (let i = 0; i < 8; i++) {
        const sides = 3 + ((i * 3 + Math.floor(timeS * 0.4)) % 6);
        const r =
          (90 + i * 70) * (1 + e.bass * 0.3 * Math.sin(timeS * 9 + i));
        const spin = timeS * (0.5 + i * 0.1) * (i % 2 === 0 ? 1 : -1);
        const aspect = 1.0 + 0.12 * Math.sin(timeS * 0.9 + i);
        ctx.strokeStyle = i % 2 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = weight * (0.28 + e.mid * 0.35);
        polyPath(ctx, cx, cy, r, sides, spin, aspect);
        ctx.stroke();
      }
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = weight * (0.08 + e.rms * 0.15);
      polyPath(ctx, cx, cy, 70 + e.rms * 50, 3, timeS * 0.8, 1.2);
      ctx.fill();
    } else if (scene === "tunnel") {
      for (let i = 0; i < 14; i++) {
        const z = (i / 14 + timeS * (0.55 + e.bass * 0.55)) % 1;
        const r = 30 + z * z * (Math.min(w, h) * 0.58);
        const alpha = (1 - z) * weight * (0.25 + e.rms * 0.35);
        const squash = 0.92 + 0.08 * Math.sin(timeS * 1.4 + i);
        ctx.strokeStyle = i % 2 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1 + (1 - z) * 2.5;
        ctx.strokeRect(
          cx - r * squash,
          cy - r * squash,
          r * squash * 2,
          r * squash * 2,
        );
      }
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 + timeS * 0.45;
        const r0 = 20;
        const r1 = 70 + e.rms * 280;
        ctx.globalAlpha = weight * (0.1 + e.high * 0.35);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 1.35);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 1.35);
        ctx.stroke();
      }
    } else if (scene === "field") {
      ctx.lineWidth = 1;
      for (let L = 0; L < 36; L++) {
        const baseY = h * 0.2 + L * ((h * 0.5) / 36);
        ctx.strokeStyle = L % 2 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = weight * (0.18 + e.rms * 0.35);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const nx = x / w;
          const y =
            baseY +
            Math.sin(nx * 14 + timeS * 2.6 + L * 0.5) * (12 + e.mid * 32) +
            Math.sin(nx * 34 - timeS * 4.2 + L) * (5 + e.high * 18) +
            Math.sin(nx * 60 + timeS * 9 + L) * e.high * 6 +
            e.bass * 16 * Math.sin(timeS * 8 + L);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (scene === "ripple") {
      for (let i = 0; i < 16; i++) {
        const z = (i / 16 + timeS * (0.85 + e.bass * 0.5)) % 1;
        const r = 30 + z * (Math.min(w, h) * 0.5) * (1 + e.bass * 0.2);
        const aspect = 1.05 + 0.45 * Math.sin(timeS * 1.8 + i);
        ctx.strokeStyle = i % 2 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = (1 - z) * weight * (0.3 + e.rms * 0.35);
        ctx.lineWidth = 1 + (1 - z) * 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * aspect, timeS * 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = weight * (0.1 + e.bass * 0.2);
      ctx.beginPath();
      ctx.arc(cx, cy, 18 + e.rms * 36, 0, Math.PI * 2);
      ctx.fill();
    } else if (scene === "bars") {
      const cols = 64;
      const pad = w * 0.08;
      const drawW = w - pad * 2;
      const barW = drawW / cols;
      const midY = cy;
      for (let i = 0; i < cols; i++) {
        let mag: number;
        if (peaks && peaks.length > 0) {
          const pi = Math.min(
            peaks.length - 1,
            Math.floor((i / cols) * peaks.length),
          );
          mag = peaks[pi] ?? 0;
        } else {
          mag =
            0.15 +
            0.7 *
              Math.abs(Math.sin(i * 0.65 + timeS * 5) * Math.cos(i * 0.3));
        }
        mag *=
          (0.45 + e.rms * 0.8 + e.bass * 0.35) *
          (1 + e.high * 0.3 * Math.sin(timeS * 20 + i));
        const barH = mag * h * 0.3;
        const x = pad + i * barW + Math.sin(timeS * 2 + i * 0.2) * 1.5;
        ctx.fillStyle = i % 3 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = weight * (0.35 + e.rms * 0.4);
        ctx.fillRect(x, midY - barH, Math.max(1, barW * 0.45), barH * 2);
      }
    } else if (scene === "orbit") {
      // Fallback when Three.js is unavailable — faux 3D solids.
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const spin = timeS * (0.6 + i * 0.12) * (i % 2 === 0 ? 1 : -1);
        const r =
          (100 + i * 55) * (1 + e.bass * 0.25 * Math.sin(timeS * 8 + i));
        ctx.strokeStyle = i % 2 === 0 ? palette.accent : palette.wave;
        ctx.globalAlpha = weight * (0.3 + e.rms * 0.35);
        polyPath(ctx, cx, cy, r, 3 + (i % 4), spin, 1.15 + e.mid * 0.2);
        ctx.stroke();
      }
      ctx.fillStyle = palette.wave;
      ctx.globalAlpha = weight * (0.12 + e.bass * 0.2);
      polyPath(ctx, cx, cy, 55 + e.rms * 40, 6, timeS * 0.9, 1);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = timeS * 0.8 + (i / 6) * Math.PI * 2;
        const rad = 160 + e.bass * 50;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad * 0.7;
        ctx.fillStyle = palette.accent;
        ctx.globalAlpha = weight * (0.35 + e.high * 0.4);
        ctx.beginPath();
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x + 8, y);
        ctx.lineTo(x, y + 10);
        ctx.lineTo(x - 8, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  };

  fillBg(mix < 0.5 ? sceneA : sceneB);
  paint(sceneA, 1 - mix);
  if (mix > 0.02) paint(sceneB, mix);
  sprinkleGrain(0.45 + e.high * 0.4);
  ctx.globalAlpha = 1;
  ctx.restore();
}
