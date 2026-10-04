import {
  AutomationLaneSchema,
  DEFAULT_TRACK_FX,
  PPQ,
  normalizeMasterFx,
  normalizeTrackFx,
  type AutomationLane,
  type Clip,
  type FadeCurve,
  type FormSection,
  type StretchMode,
  type TrackFx,
} from "@glane/core-model";
import {
  AGENT_MAX_TRACKS,
  ScoreSchema,
  type FxPatch,
  type Score,
  type ScoreClip,
  type ScorePattern,
} from "./score.js";

/** What the compiler needs to know about a library sample. */
export type LibrarySampleRef = {
  id: string;
  durationMs: number;
  loopStartMs?: number;
  loopEndMs?: number;
};

export type CompileContext = {
  samples: readonly LibrarySampleRef[];
  ppq?: number;
};

export type CompiledTrack = {
  index: number;
  name: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  fx: TrackFx;
  sendA: number;
  sendB: number;
};

/** A clip ready for the DB, minus ids and the concrete track id. */
export type CompiledClip = Omit<Clip, "id" | "trackId" | "sampleVersionId"> & {
  trackIndex: number;
  sampleId: string;
};

export type CompiledArrangement = {
  project: {
    title?: string;
    bpm: number;
    timeSignature: [number, number];
    bars: number;
    masterGainDb: number;
    preampGainDb: number;
    masterFx: [TrackFx, TrackFx];
    spaces: { A: TrackFx; B: TrackFx };
    automation?: AutomationLane[];
    formSections?: FormSection[];
  };
  /** Always AGENT_MAX_TRACKS entries; unused tracks are reset and empty. */
  tracks: CompiledTrack[];
  clips: CompiledClip[];
  warnings: string[];
  stats: {
    clips: number;
    clipsPerTrack: number[];
    samplesUsed: number;
    durationSec: number;
  };
};

export type CompileResult =
  | { ok: true; value: CompiledArrangement }
  | { ok: false; errors: string[]; warnings: string[] };

/** Automation params the transport engine actually plays (ADR-0023). */
export const PLAYED_AUTOMATION: Record<string, readonly string[]> = {
  track: ["gainDb", "pan", "hpHz", "lpHz", "sendA", "sendB"],
  master: ["gainDb"],
  bus: [],
};

export const DEFAULT_CLIP_FADE_MS = 5;
export const DEFAULT_CLIP_FADE_CURVE: FadeCurve = "equal-power";
const DEFAULT_GHOST_DB = -6;
const DEFAULT_STEP_BEATS = 0.25;

/** Format zod issues as `path: message` lines an agent can act on. */
export function formatIssues(
  issues: readonly { path: (string | number)[]; message: string }[],
): string[] {
  return issues.map((i) => {
    const path = i.path
      .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
      .join("")
      .replace(/^\./, "");
    return path ? `${path}: ${i.message}` : i.message;
  });
}

export function mergeFx(patch: FxPatch | undefined): TrackFx {
  return normalizeTrackFx({ ...DEFAULT_TRACK_FX, ...(patch ?? {}) });
}

export function mergeMasterFx(patch: FxPatch | undefined): TrackFx {
  return normalizeMasterFx({ ...DEFAULT_TRACK_FX, ...(patch ?? {}) });
}

/** Resolve full ids or unique (case-insensitive) prefixes. */
export function createSampleResolver(samples: readonly LibrarySampleRef[]) {
  const byId = new Map<string, LibrarySampleRef>();
  for (const s of samples) byId.set(s.id.toLowerCase(), s);
  const ids = [...byId.keys()];
  const cache = new Map<string, LibrarySampleRef | string>();
  return (ref: string): LibrarySampleRef | string => {
    const key = ref.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    let out: LibrarySampleRef | string;
    const exact = byId.get(key);
    if (exact) out = exact;
    else {
      const matches = ids.filter((id) => id.startsWith(key));
      if (matches.length === 1) out = byId.get(matches[0]!)!;
      else if (matches.length === 0) out = `son inconnu « ${ref} »`;
      else out = `préfixe ambigu « ${ref} » (${matches.length} sons)`;
    }
    cache.set(key, out);
    return out;
  };
}

class WarningBag {
  #counts = new Map<string, number>();
  add(msg: string): void {
    this.#counts.set(msg, (this.#counts.get(msg) ?? 0) + 1);
  }
  list(): string[] {
    return [...this.#counts].map(([m, n]) => (n > 1 ? `${m} (×${n})` : m));
  }
}

export function compileScore(input: unknown, ctx: CompileContext): CompileResult {
  const parsed = ScoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: formatIssues(parsed.error.issues), warnings: [] };
  }
  return compileParsedScore(parsed.data, ctx);
}

export function compileParsedScore(score: Score, ctx: CompileContext): CompileResult {
  const ppq = ctx.ppq ?? PPQ;
  const errors: string[] = [];
  const warn = new WarningBag();
  const resolve = createSampleResolver(ctx.samples);

  const ts: [number, number] = score.timeSignature ?? [4, 4];
  const bpb = ts[0];
  const bpm = score.bpm;
  const barTicks = bpb * ppq;
  const songEnd = score.bars * barTicks;

  const msToTicks = (ms: number) => Math.round(((ms / 1000) * bpm * ppq) / 60);
  const ticksToMs = (ticks: number) => (ticks / ppq) * (60_000 / bpm);

  const posTick = (where: string, bar: number, beat = 1): number | null => {
    if (beat >= bpb + 1) {
      errors.push(`${where}: beat ${beat} hors mesure (1 ≤ beat < ${bpb + 1})`);
      return null;
    }
    return Math.round(((bar - 1) * bpb + (beat - 1)) * ppq);
  };

  const clips: CompiledClip[] = [];
  const used = new Set<string>();

  const pushClip = (
    where: string,
    trackIndex: number,
    sample: LibrarySampleRef,
    startTick: number,
    lengthTick: number,
    opts: {
      offsetMs?: number;
      loop?: boolean;
      loopMs?: number;
      gainDb?: number;
      fadeInMs?: number;
      fadeOutMs?: number;
      fadeCurve?: FadeCurve;
      pitch?: number;
      stretch?: StretchMode;
      reverse?: boolean;
    },
  ) => {
    if (startTick >= songEnd) {
      warn.add(`${where}: clip après la fin du morceau, ignoré`);
      return;
    }
    let len = Math.max(1, Math.round(lengthTick));
    if (startTick + len > songEnd) {
      len = songEnd - startTick;
      warn.add(`${where}: clip tronqué à la fin du morceau`);
    }
    const loopRegion =
      sample.loopStartMs != null &&
      sample.loopEndMs != null &&
      sample.loopEndMs > sample.loopStartMs
        ? { start: sample.loopStartMs, len: sample.loopEndMs - sample.loopStartMs }
        : null;
    const loop = opts.loop === true;
    let offsetMs = opts.offsetMs ?? 0;
    let loopLengthMs: number | undefined;
    if (loop) {
      if (opts.loopMs != null) loopLengthMs = opts.loopMs;
      else if (opts.offsetMs == null && loopRegion) {
        offsetMs = loopRegion.start;
        loopLengthMs = loopRegion.len;
      } else loopLengthMs = sample.durationMs - offsetMs;
    }
    if (offsetMs >= sample.durationMs) {
      errors.push(
        `${where}: offsetMs ${offsetMs} ≥ durée du son (${Math.round(sample.durationMs)} ms)`,
      );
      return;
    }
    const stretch = opts.stretch ?? "off";
    if (
      !loop &&
      stretch === "off" &&
      ticksToMs(len) > sample.durationMs - offsetMs + 50
    ) {
      warn.add(
        `${where}: clip plus long que le son sans loop ni stretch (silence en fin de clip)`,
      );
    }
    used.add(sample.id);
    clips.push({
      trackIndex,
      sampleId: sample.id,
      startTick,
      lengthTick: len,
      contentOffsetMs: offsetMs,
      loopEnabled: loop,
      ...(loopLengthMs != null ? { loopLengthMs } : {}),
      gainDb: opts.gainDb ?? 0,
      fadeInMs: opts.fadeInMs ?? DEFAULT_CLIP_FADE_MS,
      fadeOutMs: opts.fadeOutMs ?? DEFAULT_CLIP_FADE_MS,
      fadeCurve: opts.fadeCurve ?? DEFAULT_CLIP_FADE_CURVE,
      pitchSemitones: opts.pitch ?? 0,
      stretchMode: stretch,
      reverse: opts.reverse === true,
    });
  };

  const sampleOrError = (where: string, ref: string): LibrarySampleRef | null => {
    const r = resolve(ref);
    if (typeof r === "string") {
      errors.push(`${where}: ${r}`);
      return null;
    }
    return r;
  };

  const compileClip = (where: string, ti: number, c: ScoreClip) => {
    const sample = sampleOrError(where, c.sample);
    const start = posTick(where, c.bar, c.beat);
    if (!sample || start == null) return;
    let len: number;
    if (c.beats != null) len = c.beats * ppq;
    else if (c.ms != null) len = msToTicks(c.ms);
    else if (c.loop) {
      errors.push(`${where}: un clip en loop doit préciser beats ou ms`);
      return;
    } else len = msToTicks(sample.durationMs - (c.offsetMs ?? 0));
    pushClip(where, ti, sample, start, len, c);
  };

  const compilePattern = (where: string, ti: number, p: ScorePattern) => {
    const refs = Array.isArray(p.sample) ? p.sample : [p.sample];
    const samples = refs.map((r, i) =>
      sampleOrError(refs.length > 1 ? `${where}.sample[${i}]` : `${where}.sample`, r),
    );
    if (samples.some((s) => s == null)) return;
    const toBar = p.toBar ?? p.fromBar;
    if (toBar < p.fromBar) {
      errors.push(`${where}: toBar < fromBar`);
      return;
    }
    const steps = p.steps.replace(/[| ]/g, "");
    if (steps.length === 0) {
      errors.push(`${where}: steps vide`);
      return;
    }
    const stepTicks = (p.stepBeats ?? DEFAULT_STEP_BEATS) * ppq;
    const start = (p.fromBar - 1) * barTicks;
    const end = Math.min(songEnd, toBar * barTicks);
    if (start >= songEnd) {
      warn.add(`${where}: pattern après la fin du morceau, ignoré`);
      return;
    }
    const skip = new Set(p.skipBars ?? []);
    const hits: { tick: number; ghost: boolean }[] = [];
    for (let k = 0; ; k++) {
      const tick = Math.round(start + k * stepTicks);
      if (tick >= end) break;
      const ch = steps[k % steps.length]!;
      if (ch !== "X" && ch !== "x") continue;
      if (skip.has(Math.floor(tick / barTicks) + 1)) continue;
      hits.push({ tick, ghost: ch === "x" });
    }
    if (hits.length === 0) {
      warn.add(`${where}: pattern sans aucun coup`);
      return;
    }
    const pitches =
      p.pitch == null ? [0] : Array.isArray(p.pitch) ? p.pitch : [p.pitch];
    hits.forEach((h, i) => {
      const sample = samples[i % samples.length]!;
      const natural = msToTicks(sample.durationMs - (p.offsetMs ?? 0));
      const untilNext = (hits[i + 1]?.tick ?? end) - h.tick;
      const len =
        p.hitBeats != null
          ? p.hitBeats * ppq
          : p.stretch && p.stretch !== "off"
            ? untilNext
            : Math.min(natural, untilNext);
      pushClip(where, ti, sample, h.tick, len, {
        ...p,
        gainDb: (p.gainDb ?? 0) + (h.ghost ? (p.ghostDb ?? DEFAULT_GHOST_DB) : 0),
        pitch: pitches[i % pitches.length]!,
        loop: false,
      });
    });
  };

  const tracks: CompiledTrack[] = [];
  for (let ti = 0; ti < AGENT_MAX_TRACKS; ti++) {
    const t = score.tracks[ti];
    tracks.push({
      index: ti,
      name: t?.name?.trim() || `Piste ${ti + 1}`,
      gainDb: t?.gainDb ?? 0,
      pan: t?.pan ?? 0,
      mute: t?.mute ?? false,
      fx: mergeFx(t?.fx),
      sendA: t?.sendA ?? 0,
      sendB: t?.sendB ?? 0,
    });
    if (!t) continue;
    t.clips?.forEach((c, ci) => compileClip(`tracks[${ti}].clips[${ci}]`, ti, c));
    t.patterns?.forEach((p, pi) =>
      compilePattern(`tracks[${ti}].patterns[${pi}]`, ti, p),
    );
  }

  const spaces = {
    A: mergeMasterFx(score.spaces?.A),
    B: mergeMasterFx(score.spaces?.B),
  };
  tracks.forEach((t) => {
    if (t.sendA > 0 && spaces.A.type === "none") {
      warn.add(`tracks[${t.index}]: sendA > 0 mais spaces.A n'a pas d'effet (type none)`);
    }
    if (t.sendB > 0 && spaces.B.type === "none") {
      warn.add(`tracks[${t.index}]: sendB > 0 mais spaces.B n'a pas d'effet (type none)`);
    }
  });

  const automation: AutomationLane[] = [];
  score.automation?.forEach((lane, li) => {
    const where = `automation[${li}]`;
    if (
      lane.target.scope === "track" &&
      lane.target.trackIndex >= score.tracks.length
    ) {
      errors.push(`${where}: trackIndex ${lane.target.trackIndex} sans piste correspondante`);
      return;
    }
    if (!PLAYED_AUTOMATION[lane.target.scope]?.includes(lane.target.param)) {
      warn.add(
        `${where}: ${lane.target.scope}.${lane.target.param} est enregistré mais pas encore joué par le moteur`,
      );
    }
    const points = [];
    for (const [pi, pt] of lane.points.entries()) {
      const tick = posTick(`${where}.points[${pi}]`, pt.bar, pt.beat);
      if (tick == null) continue;
      points.push({ tick, value: pt.value, curve: pt.curve ?? "lin" });
    }
    points.sort((a, b) => a.tick - b.tick);
    const ok = AutomationLaneSchema.safeParse({ target: lane.target, points });
    if (ok.success) automation.push(ok.data);
  });

  const formSections: FormSection[] = (score.sections ?? []).map((s, i) => ({
    id: `s${i + 1}`,
    kind: s.kind,
    startBar: s.bar - 1,
    bars: s.bars,
    energy: s.energy ?? 0.5,
  }));

  checkOverlaps(clips, warn);

  if (errors.length > 0) {
    return { ok: false, errors, warnings: warn.list() };
  }

  const clipsPerTrack = tracks.map(
    (t) => clips.filter((c) => c.trackIndex === t.index).length,
  );
  score.tracks.forEach((_, i) => {
    if (clipsPerTrack[i] === 0) warn.add(`tracks[${i}]: piste sans aucun clip`);
  });
  if (clips.length === 0) warn.add("aucun clip : l'arrangement sera silencieux");

  return {
    ok: true,
    value: {
      project: {
        ...(score.title ? { title: score.title } : {}),
        bpm,
        timeSignature: ts,
        bars: score.bars,
        masterGainDb: score.master?.gainDb ?? 0,
        preampGainDb: score.master?.preampGainDb ?? 0,
        masterFx: [
          mergeMasterFx(score.master?.fx?.[0]),
          mergeMasterFx(score.master?.fx?.[1]),
        ],
        spaces,
        ...(automation.length > 0 ? { automation } : {}),
        ...(formSections.length > 0 ? { formSections } : {}),
      },
      tracks,
      clips: clips.sort((a, b) => a.trackIndex - b.trackIndex || a.startTick - b.startTick),
      warnings: warn.list(),
      stats: {
        clips: clips.length,
        clipsPerTrack,
        samplesUsed: used.size,
        durationSec: Math.round((ticksToMs(songEnd) / 1000) * 10) / 10,
      },
    },
  };
}

/** Same-track overlaps get crossfades in the app; warn when they exceed half a clip. */
function checkOverlaps(clips: CompiledClip[], warn: WarningBag): void {
  const byTrack = new Map<number, CompiledClip[]>();
  for (const c of clips) {
    const list = byTrack.get(c.trackIndex) ?? [];
    list.push(c);
    byTrack.set(c.trackIndex, list);
  }
  for (const [ti, list] of byTrack) {
    list.sort((a, b) => a.startTick - b.startTick);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      const overlap = prev.startTick + prev.lengthTick - cur.startTick;
      if (overlap <= 0) continue;
      const shorter = Math.min(prev.lengthTick, cur.lengthTick);
      if (overlap > shorter / 2) {
        warn.add(
          `tracks[${ti}]: clips qui se chevauchent sur plus de 50 % (crossfade long ; une piste est monophonique en pratique)`,
        );
      }
    }
  }
}
