/**
 * Defaults + clamp for T2 ML prefs (YAMNet / CLAP / Demucs).
 */
import { DEMUCS_STEMS, type DemucsStemName } from "@glane/audio-ml";
import type { UserPrefs } from "../db.js";

export const ML_DEFAULTS = {
  yamnetMinScore: 0.12 as number,
  yamnetMaxLabels: 5 as number,
  yamnetAutoClass: true,
  clapMinScore: 0.12 as number,
  clapLimit: 12 as number,
  demucsStems: [...DEMUCS_STEMS] as DemucsStemName[],
} as const;

export function clampYamnetMinScore(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return ML_DEFAULTS.yamnetMinScore;
  return Math.min(0.5, Math.max(0.02, v));
}

export function clampYamnetMaxLabels(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return ML_DEFAULTS.yamnetMaxLabels;
  return Math.min(12, Math.max(1, Math.round(v)));
}

export function clampClapMinScore(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return ML_DEFAULTS.clapMinScore;
  return Math.min(0.6, Math.max(0.02, v));
}

export function clampClapLimit(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return ML_DEFAULTS.clapLimit;
  return Math.min(50, Math.max(3, Math.round(v)));
}

export function resolveDemucsStems(
  raw: readonly string[] | undefined,
): DemucsStemName[] {
  if (!raw?.length) return [...ML_DEFAULTS.demucsStems];
  const out = raw.filter((s): s is DemucsStemName =>
    (DEMUCS_STEMS as readonly string[]).includes(s),
  );
  return out.length > 0 ? out : [...ML_DEFAULTS.demucsStems];
}

export function mlOptsFromPrefs(prefs: UserPrefs): {
  yamnetMinScore: number;
  yamnetMaxLabels: number;
  yamnetAutoClass: boolean;
  clapMinScore: number;
  clapLimit: number;
  demucsStems: DemucsStemName[];
} {
  return {
    yamnetMinScore: clampYamnetMinScore(prefs.mlYamnetMinScore),
    yamnetMaxLabels: clampYamnetMaxLabels(prefs.mlYamnetMaxLabels),
    yamnetAutoClass: prefs.mlYamnetAutoClass !== false,
    clapMinScore: clampClapMinScore(prefs.mlClapMinScore),
    clapLimit: clampClapLimit(prefs.mlClapLimit),
    demucsStems: resolveDemucsStems(prefs.mlDemucsStems),
  };
}
