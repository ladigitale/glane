import type { SampleClass } from "./schemas.js";

const CLASS_CODE: Record<SampleClass, string> = {
  percussive: "PER",
  tonal: "TON",
  texture: "TEX",
  noise: "NOI",
  rhythmic: "RHY",
  voice: "VOX",
  unclassified: "UNC",
};

const TIMBRE_WORDS = [
  { word: "brillant", centroidMin: 0.55 },
  { word: "sourd", centroidMax: 0.25 },
  { word: "metallique", flatnessMax: 0.35, centroidMin: 0.4 },
  { word: "boise", flatnessMax: 0.45 },
  { word: "aerien", centroidMin: 0.5, flatnessMin: 0.3 },
  { word: "granuleux", flatnessMin: 0.55 },
  { word: "feutre", centroidMax: 0.35, flatnessMax: 0.4 },
  { word: "souffle", flatnessMin: 0.6 },
] as const;

/** Canonical sortable name: GL0412_007_TEX_hum_--_--_8s2 */
export function canonicalSampleName(opts: {
  sessionShort: string;
  index: number;
  class: SampleClass;
  descriptor?: string;
  note?: string | null;
  bpm?: number | null;
  durationMs: number;
}): string {
  const idx = String(opts.index).padStart(3, "0");
  const cls = CLASS_CODE[opts.class];
  const desc = (opts.descriptor ?? "hum").replace(/\s+/g, "-").slice(0, 24);
  const note = opts.note && opts.note.length > 0 ? opts.note : "--";
  const bpm = opts.bpm != null ? String(Math.round(opts.bpm)) : "--";
  const sec = (opts.durationMs / 1000).toFixed(1).replace(".", "s");
  return `${opts.sessionShort}_${idx}_${cls}_${desc}_${note}_${bpm}_${sec}`;
}

export function readableTimbre(opts: {
  centroidNorm?: number;
  flatness?: number;
}): string {
  const c = opts.centroidNorm ?? 0.4;
  const f = opts.flatness ?? 0.4;
  for (const rule of TIMBRE_WORDS) {
    if ("centroidMin" in rule && rule.centroidMin != null && c < rule.centroidMin)
      continue;
    if ("centroidMax" in rule && rule.centroidMax != null && c > rule.centroidMax)
      continue;
    if ("flatnessMin" in rule && rule.flatnessMin != null && f < rule.flatnessMin)
      continue;
    if ("flatnessMax" in rule && rule.flatnessMax != null && f > rule.flatnessMax)
      continue;
    return rule.word;
  }
  return "neutre";
}

export function sessionShortCode(sessionId: string, startedAt: string): string {
  const d = new Date(startedAt);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const tail = sessionId.replace(/-/g, "").slice(0, 2).toUpperCase();
  return `GL${mm}${dd}${tail}`;
}
