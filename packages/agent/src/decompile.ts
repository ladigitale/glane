import {
  DEFAULT_TRACK_FX,
  PPQ,
  TRACK_HP_HZ_OPEN,
  TRACK_LP_HZ_OPEN,
  normalizeProject,
  normalizeTrack,
  type Clip,
  type Project,
  type Track,
  type TrackFx,
} from "@glane/core-model";
import { DEFAULT_CLIP_FADE_CURVE, DEFAULT_CLIP_FADE_MS } from "./compile.js";
import type { FxPatch, Score, ScoreClip, ScoreTrack } from "./score.js";

const round = (n: number, step = 1000) => Math.round(n * step) / step;

/** Only the fields that differ from defaults (keeps read-backs compact). */
export function fxDiff(fx: TrackFx, base: TrackFx = DEFAULT_TRACK_FX): FxPatch | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fx)) {
    const b = (base as Record<string, unknown>)[k];
    if (typeof v === "number" && typeof b === "number") {
      if (Math.abs(v - b) > 1e-6) out[k] = round(v);
    } else if (v !== b) out[k] = v;
  }
  if (out.hpHz === TRACK_HP_HZ_OPEN) delete out.hpHz;
  if (out.lpHz === TRACK_LP_HZ_OPEN) delete out.lpHz;
  return Object.keys(out).length > 0 ? (out as FxPatch) : undefined;
}

export type DecompileOptions = {
  /** Short display id for a sample (default: first 8 chars). */
  sampleRef?: (sampleId: string) => string;
  ppq?: number;
};

/** Current arrangement → agent score (clips only; patterns are not re-derived). */
export function decompileArrangement(
  rawProject: Project,
  rawTracks: readonly Track[],
  clips: readonly Clip[],
  opts: DecompileOptions = {},
): Score {
  const ppq = opts.ppq ?? PPQ;
  const ref = opts.sampleRef ?? ((id: string) => id.slice(0, 8));
  const project = normalizeProject(rawProject);
  const tracks = [...rawTracks].map(normalizeTrack).sort((a, b) => a.index - b.index);
  const bpb = project.timeSignature[0];

  const toPos = (tick: number) => {
    const beats = tick / ppq;
    const bar = Math.floor(beats / bpb) + 1;
    const beat = round(beats - (bar - 1) * bpb + 1);
    return beat === 1 ? { bar } : { bar, beat };
  };

  const lastUsed = tracks.reduce(
    (acc, t, i) =>
      clips.some((c) => c.trackId === t.id) || fxDiff(t.fx) || t.gainDb !== 0
        ? i
        : acc,
    -1,
  );

  const scoreTracks: ScoreTrack[] = tracks.slice(0, Math.max(1, lastUsed + 1)).map((t) => {
    const own = clips
      .filter((c) => c.trackId === t.id && c.sampleId)
      .sort((a, b) => a.startTick - b.startTick);
    const out: ScoreTrack = { name: t.name };
    if (t.gainDb !== 0) out.gainDb = round(t.gainDb, 10);
    if (t.pan !== 0) out.pan = round(t.pan, 100);
    if (t.mute) out.mute = true;
    const fx = fxDiff(t.fx);
    if (fx) out.fx = fx;
    if (t.sendA) out.sendA = round(t.sendA, 100);
    if (t.sendB) out.sendB = round(t.sendB, 100);
    if (own.length > 0) {
      out.clips = own.map((c) => {
        const sc: ScoreClip = {
          sample: ref(c.sampleId!),
          ...toPos(c.startTick),
          beats: round(c.lengthTick / ppq),
        };
        if (c.contentOffsetMs) sc.offsetMs = Math.round(c.contentOffsetMs);
        if (c.loopEnabled) {
          sc.loop = true;
          if (c.loopLengthMs) sc.loopMs = Math.round(c.loopLengthMs);
        }
        if (c.gainDb) sc.gainDb = round(c.gainDb, 10);
        if (c.fadeInMs !== DEFAULT_CLIP_FADE_MS) sc.fadeInMs = Math.round(c.fadeInMs);
        if (c.fadeOutMs !== DEFAULT_CLIP_FADE_MS) sc.fadeOutMs = Math.round(c.fadeOutMs);
        if (c.fadeCurve !== DEFAULT_CLIP_FADE_CURVE) sc.fadeCurve = c.fadeCurve;
        if (c.pitchSemitones) sc.pitch = round(c.pitchSemitones, 100);
        if (c.stretchMode !== "off") sc.stretch = c.stretchMode;
        if (c.reverse) sc.reverse = true;
        return sc;
      });
    }
    return out;
  });

  const score: Score = {
    title: project.title,
    bpm: project.bpm,
    timeSignature: project.timeSignature,
    bars: project.bars,
    tracks: scoreTracks,
  };
  const masterFx = (project.masterFx ?? []).map((f) => fxDiff(f) ?? {});
  const hasMasterFx = masterFx.some((f) => Object.keys(f).length > 0);
  if (project.masterGainDb || project.preampGainDb || hasMasterFx) {
    score.master = {
      ...(project.masterGainDb ? { gainDb: round(project.masterGainDb, 10) } : {}),
      ...(project.preampGainDb ? { preampGainDb: round(project.preampGainDb, 10) } : {}),
      ...(hasMasterFx ? { fx: masterFx } : {}),
    };
  }
  if (project.spaces) {
    const A = fxDiff(project.spaces.A);
    const B = fxDiff(project.spaces.B);
    if (A || B) score.spaces = { ...(A ? { A } : {}), ...(B ? { B } : {}) };
  }
  if (project.formSections?.length) {
    score.sections = project.formSections.map((s) => ({
      kind: s.kind,
      bar: s.startBar + 1,
      bars: s.bars,
      energy: round(s.energy, 100),
    }));
  }
  if (project.automation?.length) {
    score.automation = project.automation.map((lane) => ({
      target: lane.target,
      points: lane.points.map((p) => ({
        ...toPos(p.tick),
        value: round(p.value),
        ...(p.curve !== "lin" ? { curve: p.curve } : {}),
      })),
    }));
  }
  return score;
}
