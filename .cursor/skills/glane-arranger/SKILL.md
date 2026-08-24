---
name: glane-arranger
description: >-
  Glane sequence generator: inter-voice arrangement (lock, call–response,
  rhythmic kinship). Use when editing generative.ts, generative-ensemble,
  generative-refs, or callResponse options.
---

# glane-arranger

Encode **ensemble relations** between melodic roles — never leave 2+ melodic tracks on independent RNG motifs.

## When

Touching [`apps/web/src/app/generative.ts`](apps/web/src/app/generative.ts), [`generative-ensemble.ts`](apps/web/src/app/generative-ensemble.ts), [`generative-refs.ts`](apps/web/src/app/generative-refs.ts), or `callResponse` UI/state.

## VoiceRelation

| Relation | Meaning |
|----------|---------|
| `independent` | Primary call voice only (or lonely melodic track) |
| `lock` | Same onset skeleton; degrees unison / 3rd / 6th |
| `respond` | Call half-bar (or odd bars); response cell on the other half |
| `kinship` | Share accent skeleton; follower may ornament elsewhere |

Type + planners: `ensemble.plan` / `applyLock` / `applyRespond` / `applyKinship` in `generative-ensemble.ts`.

## Principles (must live in algos)

1. **One primary** melodic voice (`lead` → else `arp` → else `chord`).
2. **Support vs lead**: `bass` / `chord` = accents + chord tones; `lead` = phrase; `arp` = locked ostinato or antiphonal — never a second independent lead.
3. **Lock / unison**: shared onsets (or accent subset); pitch offset 0 / +2 / +5 scale degrees.
4. **Call–response**: A dense on first half-bar (chorus) or on even bars (verse); B answers with `responseCell`. Kit may still use half-bar shift.
5. **Rhythmic kinship**: follower keeps primary accents; free notes only between.
6. **Section bias**: `resolveSectionRelation` — chorus/prechorus → lock; verse → respond/kinship + alternate bars; bridge/intro/outro → lighter kinship.
7. **Coupled arp**: `melodyCellToArpCell(leadCell)` when follower is lock/kinship — same rhythm, chord-tone degrees.
8. **Role lock offset**: `lockDegreeOffset` — bass 0, chord 2|4 (jazz 4|6), arp 0.
9. **Style families**: `ensembleProfileForStyle(musicStyle)` — electronic → lock; jazz/folk → respond + alternate bars; ambient → kinship; groove → call–response.

## Anti-patterns

- Per-track `pickMelodyCell` / `pickArpCell` with no `EnsemblePlan` when ≥2 of `lead|arp|chord|bass`.
- Global `callResponseShift` alone as “dialogue” between melodies.
- Two dense leads overlapping the same half-bar.

## Checklist

- [ ] `planEnsemble` after role assign
- [ ] Followers get `lock` | `respond` | `kinship` (not all `independent`)
- [ ] Shared onsets from primary cell
- [ ] Tests cover lock ⊆ skeleton and respond half-bar split
