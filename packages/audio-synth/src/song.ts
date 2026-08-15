import { createRoleCard, type SynthRoleCard } from "./roles.js";
import type { SynthRoleId } from "./types.js";

/** High-level song-kit intention → proposed role list. */
export type SongIntention =
  | "minimal"
  | "full"
  | "drums"
  | "bassPad"
  | "ambient";

export const SONG_INTENTIONS: readonly SongIntention[] = [
  "minimal",
  "full",
  "drums",
  "bassPad",
  "ambient",
] as const;

const INTENTION_ROLES: Record<SongIntention, readonly SynthRoleId[]> = {
  minimal: ["kick", "hat", "bass"],
  full: ["kick", "snare", "hat", "bass", "pad", "fx"],
  drums: ["kick", "snare", "hat", "perc"],
  bassPad: ["bass", "pad", "fx"],
  ambient: ["pad", "texture", "fx", "lead"],
};

/** Default quantity per role for a song kit (smaller than Family). */
export function songQuantityForRole(role: SynthRoleId): number {
  if (role === "kick" || role === "snare" || role === "hat") return 4;
  if (role === "perc" || role === "fx") return 3;
  return 3;
}

/** Propose role cards from an intention (user can still edit). */
export function proposeSongCards(
  intention: SongIntention,
  quantityScale = 1,
): SynthRoleCard[] {
  const roles = INTENTION_ROLES[intention] ?? INTENTION_ROLES.full;
  return roles.map((role) => {
    const q = Math.min(
      40,
      Math.max(1, Math.round(songQuantityForRole(role) * quantityScale)),
    );
    const card = createRoleCard(role, { quantity: q });
    // Song kits: slightly tighter than raw Family for coherence headroom
    card.randomness = Math.min(0.7, card.randomness * 0.85);
    return card;
  });
}

export function defaultSongCards(): SynthRoleCard[] {
  return proposeSongCards("full");
}
