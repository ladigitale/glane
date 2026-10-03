/**
 * Score → SequencePlanResult (thin / legacy stub).
 * Live path: `realizeComposerScore` inside `generative.ts` (home samples,
 * spectral seat, stretch/fades). Keep this module for isolated unit probes.
 */
import type {
  AutomationLane,
  MasterPlan,
  Score,
  SpacePlan,
} from "@glane/composer";
import {
  DEFAULT_TRACK_FX,
  PPQ as COMPOSER_PPQ,
  type ExprRole,
  type TrackFx,
} from "@glane/core-model";
import type {
  SequenceClipPlan,
  SequenceEnsembleSummary,
  SequencePlanResult,
  SequenceSampleIn,
  SequenceTrackPlan,
} from "./generative.js";

export type RenderOpts = {
  tracks: Array<{ id: string; index: number }>;
  samples: SequenceSampleIn[];
  ppq: number;
  bpm: number;
  lockPitch?: boolean;
  pitchUpSemitones?: number;
  pitchDownSemitones?: number;
  tuningOffsetCents?: number;
  /** Injected from generative to avoid circular imports. */
  sampleSourceMidi: (s: SequenceSampleIn) => number | null;
  exactPitchSemitones: (
    targetMidi: number,
    sourceMidi: number,
    stretchPitchSemis?: number,
    tuningOffsetCents?: number,
  ) => number;
  resolveExprRole: (s: SequenceSampleIn) => ExprRole;
};

function scoreForRole(
  s: SequenceSampleIn,
  role: ExprRole,
  resolveExprRole: (s: SequenceSampleIn) => ExprRole,
  sampleSourceMidi: (s: SequenceSampleIn) => number | null,
): number {
  const inferred = resolveExprRole(s);
  let score = inferred === role ? 8 : 0;
  if (s.forceRole === role) score += 20;
  if (role === "kick" || role === "snare" || role === "hat" || role === "perc") {
    if (s.class === "percussive" || s.class === "rhythmic") score += 3;
    if ((s.transientDensity ?? 0) > 0.5) score += 2;
  } else {
    if (s.class === "tonal" || s.class === "voice") score += 3;
    if ((s.harmonicity ?? 0) > 0.4) score += 2;
    if (sampleSourceMidi(s) != null) score += 2;
  }
  if (s.favorite) score += 1;
  if ((s.interestScore ?? 0) > 0.5) score += 1;
  if (role === "hat" && s.durationMs < 200) score += 1;
  if (role === "kick" && s.durationMs < 500) score += 1;
  return score;
}

function pickSamplesForRole(
  pool: SequenceSampleIn[],
  role: ExprRole,
  opts: Pick<RenderOpts, "resolveExprRole" | "sampleSourceMidi">,
): SequenceSampleIn[] {
  const ranked = [...pool]
    .map((s) => ({
      s,
      score: scoreForRole(s, role, opts.resolveExprRole, opts.sampleSourceMidi),
    }))
    .filter((x) => x.score > 0 || pool.length < 4)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return pool.slice(0, 2);
  return ranked.slice(0, Math.min(3, ranked.length)).map((x) => x.s);
}

function trackIdFor(
  trackIndex: number,
  tracks: Array<{ id: string; index: number }>,
): string {
  if (tracks.length === 0) return `gen-track-${trackIndex}`;
  const byIndex = tracks.find((t) => t.index === trackIndex);
  if (byIndex) return byIndex.id;
  return tracks[trackIndex % tracks.length]!.id;
}

/** Render abstract Score into sequencer clips/tracks. */
export function renderScore(
  score: Score,
  opts: RenderOpts,
): SequencePlanResult {
  const lockPitch = opts.lockPitch === true;
  const tuningOffsetCents = opts.tuningOffsetCents ?? 0;
  const maxUp = opts.pitchUpSemitones ?? 12;
  const maxDown = opts.pitchDownSemitones ?? 12;

  const homeByRole = new Map<ExprRole, SequenceSampleIn[]>();
  for (const part of score.parts) {
    if (!homeByRole.has(part.role)) {
      homeByRole.set(
        part.role,
        pickSamplesForRole(opts.samples, part.role, opts),
      );
    }
  }

  const mixByIndex = new Map(
    score.mix.tracks.map((t) => [t.trackIndex, t]),
  );

  const trackPlans: SequenceTrackPlan[] = [];
  const seenTrack = new Set<string>();
  for (const part of score.parts) {
    const id = trackIdFor(part.trackIndex, opts.tracks);
    if (seenTrack.has(id)) continue;
    seenTrack.add(id);
    const mix = mixByIndex.get(part.trackIndex);
    trackPlans.push({
      trackId: id,
      gainDb: mix?.levelDb ?? 0,
      pan: mix?.pan ?? 0,
      fx: (mix?.insert as TrackFx) ?? { ...DEFAULT_TRACK_FX },
    });
  }
  for (const tr of opts.tracks) {
    if (seenTrack.has(tr.id)) continue;
    trackPlans.push({
      trackId: tr.id,
      gainDb: 0,
      pan: 0,
      fx: { ...DEFAULT_TRACK_FX },
    });
  }

  const clips: SequenceClipPlan[] = [];
  const warnings = [...score.warnings];
  const tickScale = opts.ppq / COMPOSER_PPQ;
  const toProjectTick = (t: number) => Math.max(0, Math.round(t * tickScale));

  for (const part of score.parts) {
    const homes = homeByRole.get(part.role) ?? opts.samples;
    if (homes.length === 0) continue;
    const trackId = trackIdFor(part.trackIndex, opts.tracks);
    const mix = mixByIndex.get(part.trackIndex);

    for (const ev of part.events) {
      const bar = Math.floor(ev.tick / (COMPOSER_PPQ * 4));
      const sample = homes[Math.abs(bar) % homes.length]!;
      let pitchSemitones = 0;
      if (!lockPitch && ev.midi != null) {
        const source = opts.sampleSourceMidi(sample);
        if (source != null) {
          pitchSemitones = opts.exactPitchSemitones(
            ev.midi,
            source,
            0,
            tuningOffsetCents,
          );
          if (pitchSemitones > maxUp || pitchSemitones < -maxDown) {
            let folded = pitchSemitones;
            while (folded > maxUp) folded -= 12;
            while (folded < -maxDown) folded += 12;
            if (folded > maxUp || folded < -maxDown) {
              warnings.push(
                `render: drop note ${part.role}@${ev.tick} (pitch window)`,
              );
              continue;
            }
            pitchSemitones = folded;
          }
        }
      }

      const gainDb =
        (mix?.levelDb ?? 0) +
        (ev.accent ? 0.5 : 0) +
        20 * Math.log10(Math.max(0.05, ev.vel));

      const lengthTick = Math.max(
        Math.floor(opts.ppq / 8),
        toProjectTick(ev.durTick),
      );
      const naturalTick = Math.max(
        Math.floor(opts.ppq / 4),
        Math.round(((sample.durationMs / 1000) * opts.bpm * opts.ppq) / 60),
      );
      const useLen = Math.min(lengthTick, Math.max(naturalTick, lengthTick));
      const stretchMode =
        useLen > naturalTick * 1.15
          ? ("preserve-pitch" as const)
          : ("off" as const);

      clips.push({
        trackId,
        sampleId: sample.id,
        startTick: toProjectTick(ev.tick),
        lengthTick: useLen,
        contentOffsetMs:
          (Math.abs(bar) * 17) % Math.max(1, sample.durationMs * 0.2),
        gainDb: Math.min(6, Math.max(-24, gainDb)),
        loopEnabled: false,
        fadeInMs: part.role === "chord" ? 30 : 2,
        fadeOutMs: part.role === "hat" ? 25 : 45,
        fadeCurve: "equal-power",
        pitchSemitones,
        stretchMode,
        reverse: ev.tag === "riser",
      });
    }
  }

  const primary = score.parts.find((p) => p.role === "lead");
  const ensemble: SequenceEnsembleSummary | undefined = primary
    ? {
        relationMode: "auto",
        relations: score.parts.map((p) => p.relation ?? "independent"),
        primaryLeadTrack: primary.trackIndex,
      }
    : undefined;

  const sends = score.mix.tracks.map((t) => ({
    trackId: trackIdFor(t.trackIndex, opts.tracks),
    a: t.sendA,
    b: t.sendB,
  }));

  const automation: AutomationLane[] = score.automation.map((lane) => ({
    ...lane,
    points: lane.points.map((p) => ({
      ...p,
      tick: toProjectTick(p.tick),
    })),
  }));

  return {
    clips,
    tracks: trackPlans,
    ensemble,
    automation,
    sends,
    spaces: score.mix.spaces as SpacePlan,
    master: score.mix.master as MasterPlan,
    score,
    warnings,
  };
}
