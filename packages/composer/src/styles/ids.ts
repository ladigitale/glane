/** Canonical music-style identifiers (shared by composer + web UI). */
export type MusicStyleId =
  | "rock"
  | "pop"
  | "reggae"
  | "dub"
  | "hiphop"
  | "triphop"
  | "dnb"
  | "breakbeat"
  | "techno"
  | "house"
  | "disco"
  | "funk"
  | "jazz"
  | "blues"
  | "latin"
  | "afrobeat"
  | "classical"
  | "ambient"
  | "folk"
  | "metal"
  | "garage"
  | "punk";

export const MUSIC_STYLE_IDS: readonly MusicStyleId[] = [
  "rock",
  "pop",
  "reggae",
  "dub",
  "hiphop",
  "triphop",
  "dnb",
  "breakbeat",
  "techno",
  "house",
  "disco",
  "funk",
  "jazz",
  "blues",
  "latin",
  "afrobeat",
  "classical",
  "ambient",
  "folk",
  "metal",
  "garage",
  "punk",
] as const;

export type GenMusicStyleChoice = "auto" | MusicStyleId;
