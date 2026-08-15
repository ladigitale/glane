/** Handoff arrangement → synth song kit (sessionStorage). */

export const SYNTH_HANDOFF_KEY = "glane:synth-handoff";

export type SynthHandoff = {
  mode: "song";
  bpm?: number;
  tonicPc?: number;
  /** major | minor — musical coherence scale. */
  scaleMode?: "major" | "minor";
  intention?: string;
};

export function stashSynthHandoff(h: SynthHandoff): void {
  try {
    sessionStorage.setItem(SYNTH_HANDOFF_KEY, JSON.stringify(h));
  } catch {
    /* private mode */
  }
}

export function takeSynthHandoff(): SynthHandoff | null {
  try {
    const raw = sessionStorage.getItem(SYNTH_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SYNTH_HANDOFF_KEY);
    const o = JSON.parse(raw) as SynthHandoff;
    if (o?.mode !== "song") return null;
    return o;
  } catch {
    return null;
  }
}
