import type { SampleClass } from "@glane/core-model";
import { YAMNET_TAG_PREFIX } from "../tags.js";

/**
 * Keyword → SampleClass for AudioSet / YAMNet labels (lowercase substring match).
 * First match wins; order matters (more specific first).
 */
const KEYWORD_CLASS: ReadonlyArray<{ keys: readonly string[]; cls: SampleClass }> = [
  {
    keys: [
      "speech",
      "conversation",
      "narration",
      "monologue",
      "babbling",
      "whispering",
      "singing",
      "choir",
      "child speech",
      "male speech",
      "female speech",
    ],
    cls: "voice",
  },
  {
    keys: [
      "drum",
      "snare",
      "hi-hat",
      "cymbal",
      "clap",
      "knock",
      "tap",
      "slap",
      "thump",
      "bang",
      "gunshot",
      "explosion",
      "percussion",
      "tambourine",
    ],
    cls: "percussive",
  },
  {
    keys: [
      "guitar",
      "piano",
      "organ",
      "violin",
      "cello",
      "flute",
      "trumpet",
      "saxophone",
      "harmonica",
      "bell",
      "chime",
      "synthesizer",
      "musical instrument",
      "plucked string",
    ],
    cls: "tonal",
  },
  {
    keys: [
      "music",
      "melody",
      "harmonic",
      "orchestra",
      "electronic music",
      "techno",
      "hip hop",
    ],
    cls: "rhythmic",
  },
  {
    keys: [
      "rain",
      "wind",
      "thunder",
      "stream",
      "waterfall",
      "ocean",
      "wave",
      "bird",
      "crow",
      "chirp",
      "insect",
      "cricket",
      "frog",
      "animal",
      "dog",
      "cat",
      "bark",
      "meow",
      "rustle",
      "crackle",
      "fireplace",
    ],
    cls: "texture",
  },
  {
    keys: [
      "noise",
      "static",
      "hiss",
      "hum",
      "buzz",
      "engine",
      "vehicle",
      "traffic",
      "train",
      "aircraft",
      "machinery",
      "power tool",
      "white noise",
      "silence",
    ],
    cls: "noise",
  },
];

/** Slug for tags / subclass: "Dog, bark" → "dog-bark" */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function yamnetTag(label: string): string {
  return `${YAMNET_TAG_PREFIX}${slugifyLabel(label)}`;
}

export function mapLabelToClass(label: string): SampleClass | null {
  const hay = ` ${label.toLowerCase()} `;
  for (const row of KEYWORD_CLASS) {
    for (const key of row.keys) {
      if (hay.includes(key)) return row.cls;
    }
  }
  return null;
}

export function pickClassHint(
  labels: ReadonlyArray<{ label: string; score: number }>,
  minScore = 0.2,
): { class: SampleClass; confidence: number } | null {
  for (const { label, score } of labels) {
    if (score < minScore) continue;
    const cls = mapLabelToClass(label);
    if (cls) return { class: cls, confidence: Math.min(1, score) };
  }
  return null;
}
