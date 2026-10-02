---
name: glane-arranger
description: >-
  Glane sequence generator: inter-voice arrangement (lock, call–response,
  rhythmic kinship). Use when editing @glane/composer ensemble/melody,
  generative.ts, generative-ensemble, or callResponse options.
---

# glane-arranger

Encode **ensemble relations** between melodic roles — never leave 2+ melodic tracks on independent RNG motifs.

## Canonical implementation (hierarchical composer)

| Piece | Path |
|-------|------|
| Assign + apply | [`packages/composer/src/ensemble.ts`](packages/composer/src/ensemble.ts) — `assignEnsemble`, `applyEnsembleRelations` |
| Melody phrases | [`packages/composer/src/melody.ts`](packages/composer/src/melody.ts) — absolute scale degrees, sentence/period/loop |
| Types | `VoiceRelation` in [`packages/composer/src/types.ts`](packages/composer/src/types.ts) |

Legacy apps/web [`generative-ensemble.ts`](apps/web/src/app/generative-ensemble.ts) re-exports `VoiceRelation` and remains until `planSequence` is fully wired to `compose()`.

## When

Touching `@glane/composer` ensemble/melody, [`generative.ts`](apps/web/src/app/generative.ts), [`generative-ensemble.ts`](apps/web/src/app/generative-ensemble.ts), [`generative-refs.ts`](apps/web/src/app/generative-refs.ts), or `callResponse` UI/state.

## VoiceRelation

| Relation | Meaning |
|----------|---------|
| `independent` | Primary call voice only (or lonely melodic track) |
| `lock` | Same onset skeleton; degrees unison / 3rd / 6th |
| `respond` | Call half-phrase; follower answers on the other half |
| `kinship` | Share accent skeleton; follower may ornament elsewhere |

## Principles (must live in algos)

1. **One primary** melodic voice (`lead` → else `arp` → else `chord`).
2. **Support vs lead**: `bass` / `chord` = accents + chord tones; `lead` = phrase; `arp` = locked ostinato or antiphonal — never a second independent lead.
3. **Lock / unison**: shared onsets (or accent subset); pitch offset 0 / +2 / +5 scale degrees.
4. **Call–response**: dense on first half-phrase; B answers on the second half. Kit may still use half-bar shift.
5. **Rhythmic kinship**: follower keeps primary accents; free notes only between.
6. **Section bias**: chorus/prechorus/drop → lock; verse → respond/kinship; bridge/break → kinship.
7. **Style families**: electronic → lock; jazz/folk → respond; ambient → kinship; groove → respond.
8. **Absolute degrees**: melody uses scale degrees vs tonic (not chord-relative), octave fixed per phrase.
9. **Tempo / length**: style `bpmHint` / `barsHint` are soft UX+QA only. See `docs/guides/style-tempo-bars-checklist.md`.

## Anti-patterns

- Per-track independent motif RNG when ≥2 of `lead|arp|chord`.
- Global `callResponseShift` alone as “dialogue” between melodies.
- Two dense leads overlapping the same half-phrase.
- Chord-relative melody degrees (legacy `pickPitchSemitones` path).

## Checklist

- [ ] `assignEnsemble` after roles
- [ ] Followers get `lock` | `respond` | `kinship` (not all `independent`)
- [ ] Shared onsets / half-phrase split from primary
- [ ] Tests cover lock ⊆ skeleton and respond half-phrase split
