/**
 * Style ↔ tempo ↔ length — listening / QA checklist.
 *
 * Style does **not** force project BPM or bars. Profiles expose soft
 * `bpmHint` / `barsHint` (see `generative-styles.ts`). The generate modal
 * shows the range and offers “Apply tempo & length”.
 *
 * Wall-clock duration ≈ `bars × 4 × 60 / bpm` seconds (4/4).
 *
 * Form: `planSongForm` uses richer templates at ≥49 bars (song) and ≥49
 * bars (ambient) so verse/chorus stay long enough for ensemble dialogue.
 */

# Style tempo & bars checklist

## How to test a style

1. Open Sequencer → set **music style** explicitly (not Auto).
2. Check the hint under Style: ideal BPM · bars and min–max window.
3. If mismatch warning → **Apply tempo & length**, then Generate.
4. Listen for form (intro / verse / chorus / bridge) and ensemble (lock / respond).
5. Optional stress: regenerate with BPM or bars **outside** the window and note how arrangement feels.

## Suggested matrix (ideal values)

| Style | BPM | Bars | ~duration @ ideal |
|-------|-----|------|-------------------|
| rock | 120 | 64 | ~128 s (~2.1 min) |
| pop | 118 | 64 | ~130 s |
| reggae | 85 | 64 | ~181 s (~3 min) |
| dub | 75 | 96 | ~307 s (~5 min) |
| hiphop | 92 | 64 | ~167 s |
| triphop | 85 | 96 | ~271 s |
| dnb | 172 | 96 | ~134 s (~2.2 min) |
| breakbeat | 135 | 64 | ~114 s |
| techno | 130 | 64 | ~118 s (~2 min) |
| house | 124 | 64 | ~124 s |
| disco | 120 | 64 | ~128 s |
| funk | 108 | 64 | ~142 s |
| jazz | 120 | 64 | ~128 s |
| blues | 90 | 48 | ~128 s |
| latin | 110 | 64 | ~140 s |
| afrobeat | 115 | 64 | ~133 s |
| classical | 90 | 64 | ~171 s |
| ambient | 70 | 96 | ~329 s (~5.5 min) |
| folk | 100 | 64 | ~154 s |
| metal | 160 | 64 | ~96 s |
| garage | 135 | 64 | ~114 s |
| punk | 170 | 48 | ~68 s |

## What “mismatch” means

- **BPM too low** for a fast style → half-bar call–response feels sluggish; denser motifs drag.
- **BPM too high** for ambient / dub → kinship / sparse form feels frantic.
- **Too few bars** → song form crushed; sections barely audible; alternate-bar dialogue needs ≥4 bars.
- **Too many bars at slow BPM** → long empty stretches unless form is ambient.

## Algo checks (automated)

`generative-style-length.test.ts` asserts:

- Ideal BPM×bars → sensible wall-clock window per style family
- Ideal bars → form has verse + chorus with ≥4 bars on at least one
- Long song (techno ideal) → bridge + ≥2 choruses; ensemble followers not independent

## Out of scope (still free)

- Forcing BPM/bars when style = Auto.
- Changing form from wall-clock minutes (bar-count buckets only).
