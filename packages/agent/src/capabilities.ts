import {
  COMPRESS_RATIO_MAX,
  COMPRESS_THRESHOLD_DB_MIN,
  ECHO_DELAY_BEATS_MAX,
  ECHO_DELAY_BEATS_MIN,
  TRACK_ATTACK_MS_MAX,
  TRACK_DECAY_MS_MAX,
  TRACK_HP_HZ_MAX,
  TRACK_HP_HZ_MIN,
  TRACK_LP_HZ_MAX,
  TRACK_LP_HZ_MIN,
  TRACK_RELEASE_MS_MAX,
} from "@glane/core-model";
import { AGENT_MAX_BARS, AGENT_MAX_TRACKS } from "./score.js";

/**
 * Reference sheet handed to the agent: every parameter it can set on tracks,
 * master, spaces and clip instances, with ranges and the score syntax.
 */
export function describeCapabilities(): string {
  return `# Glane — partition d'arrangement (agent)

Un appel \`glane_write_arrangement\` REMPLACE l'arrangement courant du projet actif
(snapshot automatique avant écriture, \`glane_undo_write\` pour revenir en arrière).
Positions : \`bar\` à partir de 1, \`beat\` à partir de 1 (temps = noire, décimales ok : 2.5 = croche après le 2).

## Racine
- \`bpm\` 20–300, \`timeSignature\` [n, d] (défaut [4,4]), \`bars\` 1–${AGENT_MAX_BARS}, \`title\` optionnel
- \`tracks\` : 1 à ${AGENT_MAX_TRACKS} pistes (l'ordre = index 0…${AGENT_MAX_TRACKS - 1}). Une piste joue un clip à la fois en pratique : les chevauchements deviennent des crossfades.
- \`master\` : \`gainDb\` (-60…12), \`preampGainDb\` (-24…24, appliqué à toutes les pistes avant FX), \`fx\` : jusqu'à 2 inserts en série (mêmes types que les pistes, sans filtres ni ADSR)
- \`spaces\` : \`A\` et \`B\`, deux bus d'effet partagés (typiquement reverb et echo), alimentés par \`sendA\`/\`sendB\` des pistes. Un send vers un space de type none ne fait rien.
- \`sections\` : [{kind, bar, bars, energy 0–1}] — kind ∈ intro, verse, prechorus, chorus, bridge, break, build, drop, outro (bandeau de forme dans la timeline)
- \`automation\` : [{target, points:[{bar, beat?, value, curve? step|lin|exp|s}]}]

## Piste
\`name\`, \`gainDb\` (-60…12), \`pan\` (-1…1), \`mute\`, \`sendA\`/\`sendB\` (0–1, post-fader), \`fx\` (un insert + filtres + ADSR), \`clips\`, \`patterns\`.

### fx (tous les champs optionnels, le reste prend les valeurs par défaut)
- \`type\` : none | eq | echo | reverb | chorus | tremolo | vibrato | compressor
- eq : \`low\`, \`mid\`, \`high\` gains linéaires 0–2 (1 = neutre)
- echo : \`mix\` 0–1, \`delayBeats\` ${ECHO_DELAY_BEATS_MIN}–${ECHO_DELAY_BEATS_MAX} (1 = noire, 0.75 = croche pointée), \`feedback\` 0–0.9, \`damping\` 0–1 (1 = sombre)
- reverb : \`mix\` 0–1, \`decay\` 0–1 (taille), \`damping\` 0–1
- chorus : \`mix\`, \`rateHz\` 0.1–12, \`depth\` 0–1
- tremolo / vibrato : \`rateHz\` 0.1–12, \`depth\` 0–1
- compressor : \`thresholdDb\` ${COMPRESS_THRESHOLD_DB_MIN}–0, \`ratio\` 1–${COMPRESS_RATIO_MAX}, \`mix\` = make-up 0–1 (→ 0–12 dB)
- filtres (pistes seulement, cumulables avec l'insert) : \`hpHz\` ${TRACK_HP_HZ_MIN}–${TRACK_HP_HZ_MAX} (${TRACK_HP_HZ_MIN} = coupé), \`lpHz\` ${TRACK_LP_HZ_MIN}–${TRACK_LP_HZ_MAX} (${TRACK_LP_HZ_MAX} = coupé)
- ADSR par clip (pistes seulement) : \`attackMs\` 0–${TRACK_ATTACK_MS_MAX}, \`decayMs\` 0–${TRACK_DECAY_MS_MAX}, \`sustain\` 0–1, \`releaseMs\` 0–${TRACK_RELEASE_MS_MAX}

## Instance de son (clip)
\`{ sample, bar, beat?, beats? | ms?, offsetMs?, loop?, loopMs?, gainDb?, fadeInMs?, fadeOutMs?, fadeCurve?, pitch?, stretch?, reverse? }\`
- \`sample\` : id ou préfixe unique (les ids courts de \`glane_library\` conviennent)
- longueur : \`beats\` ou \`ms\` ; sans les deux = longueur naturelle du son (obligatoire si \`loop\`)
- \`loop\` : répète le son ; sans \`offsetMs\`/\`loopMs\`, utilise la région de boucle seamless détectée (colonne loop de la bibliothèque)
- \`pitch\` : demi-tons -24…24 (rééchantillonnage)
- \`stretch\` : off (vitesse native) | copy (répète le son brut jusqu'à la longueur) | preserve-pitch (étire tout le son à la longueur du clip sans changer la hauteur) | resample (étire en changeant la hauteur)
- fades : 5 ms par défaut, \`fadeCurve\` linear | equal-power | exponential | s-curve ; les chevauchements sur une piste génèrent leurs crossfades
- \`gainDb\` -60…12

## Pattern (séquence en pas, pour éviter de lister chaque coup)
\`{ sample: id | [id, …], fromBar, toBar?, steps, stepBeats?, hitBeats?, ghostDb?, pitch?: n | [n, …], skipBars?, + champs d'instance }\`
- \`steps\` : \`X\` coup, \`x\` coup fantôme (\`ghostDb\`, défaut -6), \`.\` ou \`-\` silence ; \`|\` et espaces ignorés. La chaîne boucle de fromBar jusqu'à la fin de toBar (inclus).
- \`stepBeats\` défaut 0.25 (double-croche). Plusieurs samples ou pitches = rotation à chaque coup.
- longueur d'un coup : \`hitBeats\`, sinon jusqu'au coup suivant, plafonnée à la longueur du son.

## Automation — cibles jouées par le moteur
- \`{scope:"track", trackIndex, param}\` : \`gainDb\` (décalage en dB par rapport au fader de la piste : 0 = inchangé, -12 = plus bas), \`pan\` (-1…1), \`hpHz\` (20…18000), \`lpHz\` (200…20000), \`sendA\` / \`sendB\` (0…1)
- \`{scope:"master", param:"gainDb"}\` : gain master absolu en dB (fondus d'entrée / de sortie du morceau)
- Les autres cibles du schéma (fx*, ADSR, bus A/B, master hpHz/lpHz/fx/width) sont acceptées mais pas encore jouées.
- Courbes : step (palier), lin, exp, s. Un point avant le début de la rampe fixe la valeur de départ.

## Repères de mix
- Sons de bibliothèque normalisés : partir de 0 dB par clip et doser à la piste (-6…-12 dB pour les textures, ghost notes à -6…-10).
- Les one-shots percussifs longs bénéficient d'un ADSR court (release 60–200 ms) ou de \`hitBeats\`.
- Graves : une seule source tonale grave à la fois ; hpHz 120–250 sur les textures pour dégager le bas.
- Réverbe partagée en space A plutôt qu'en insert sur chaque piste.

## Exemple
\`\`\`json
{
  "title": "Pluie sur tôle", "bpm": 92, "bars": 16,
  "spaces": { "A": { "type": "reverb", "decay": 0.7, "mix": 1 }, "B": { "type": "echo", "delayBeats": 0.75, "feedback": 0.4, "mix": 1 } },
  "sections": [{ "kind": "intro", "bar": 1, "bars": 4, "energy": 0.3 }, { "kind": "verse", "bar": 5, "bars": 12, "energy": 0.6 }],
  "tracks": [
    { "name": "Lit", "gainDb": -8, "fx": { "hpHz": 180 }, "sendA": 0.3,
      "clips": [{ "sample": "3f2a9c1e", "bar": 1, "beats": 64, "loop": true, "fadeInMs": 2000, "fadeOutMs": 3000 }] },
    { "name": "Kick", "patterns": [{ "sample": "a81b77d0", "fromBar": 5, "toBar": 16, "steps": "X...|....|X...|...." }] },
    { "name": "Tick", "gainDb": -4, "pan": 0.3, "sendB": 0.25,
      "patterns": [{ "sample": ["c0de1234", "c0de9876"], "fromBar": 5, "toBar": 16, "steps": "..x.X..x", "stepBeats": 0.5, "skipBars": [12] }] }
  ],
  "automation": [
    { "target": { "scope": "track", "trackIndex": 0, "param": "lpHz" }, "points": [{ "bar": 1, "value": 800 }, { "bar": 5, "value": 20000, "curve": "exp" }] },
    { "target": { "scope": "master", "param": "gainDb" }, "points": [{ "bar": 15, "value": 0 }, { "bar": 16, "beat": 4, "value": -40 }] }
  ]
}
\`\`\`
`;
}
