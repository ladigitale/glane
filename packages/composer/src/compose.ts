import { PPQ } from "@glane/core-model";
import {
  applyLayerMatrix,
  buildLayerMatrix,
  defaultTrackRoles,
  trackIndexByRole,
} from "./arrangement.js";
import { planBass } from "./bass.js";
import { planDrums } from "./drums.js";
import { applyEnsembleRelations, assignEnsemble } from "./ensemble.js";
import { fitForm, pickEnergyShape, pickFormFamily } from "./form.js";
import { compileGestures, planGestures } from "./gestures.js";
import { defaultProgressions, planHarmony } from "./harmony.js";
import { planMaster } from "./master.js";
import { buildMotif, invertMotif, planMelody } from "./melody.js";
import { planMix } from "./mix.js";
import { buildModRoutes, applyExpressionToParts } from "./modulation.js";
import { generateRhythmGenes } from "./rhythm.js";
import { makeRng } from "./rng.js";
import type { ComposeResult, ComposeSettings, Score } from "./types.js";

/**
 * Orchestrate composition layers → Score.
 * Through step 7: form…modulation + gestures + mix + master.
 */
export function compose(settings: ComposeSettings): ComposeResult {
  const rng = makeRng(settings.seed);
  const style = settings.style === "auto" ? "ambient" : settings.style;
  const formFamily = pickFormFamily(rng, "form/family", settings.formFamily);
  const energyShape = pickEnergyShape(
    rng,
    "form/energyShape",
    settings.energyShape,
  );
  const keyPc = settings.keyPc === "auto" ? 0 : settings.keyPc;
  const mode = settings.mode === "auto" ? "aeolian" : settings.mode;

  const form = fitForm({
    targetBars: settings.targetBars,
    family: formFamily,
    energyShape,
    energyBias: settings.energy,
    rng,
    path: "form",
  });

  const progressions = defaultProgressions(rng, "dna/prog", mode);
  const harmony = planHarmony({
    sections: form.sections,
    progressions,
    mode,
    keyPc,
    rng,
    path: "harmony",
  });

  const rhythmGenes = generateRhythmGenes(rng, "dna/rhythm", settings.density);
  const g0 = rhythmGenes[0] ?? {
    steps: 16,
    onsets: [0, 4, 8, 12],
    accents: [1, 0.4, 0.7, 0.4],
  };
  const g1 = rhythmGenes[1] ?? g0;
  const hook = buildMotif(rng, "dna/hook", g0, "hook");
  const verseMotif = buildMotif(rng, "dna/verse", g1, "verse");

  const roles = defaultTrackRoles(true);
  const byRole = trackIndexByRole(roles);

  let parts = planDrums({
    sections: form.sections,
    rhythmGenes,
    density: settings.density,
    ppq: PPQ,
    trackIndexByRole: byRole,
    path: "drums",
  });

  const kick = parts.find((p) => p.role === "kick");
  if (byRole.bass != null) {
    parts.push(
      planBass({
        sections: form.sections,
        harmony,
        kickEvents: kick?.events ?? [],
        rhythmGenes,
        lockKick: true,
        trackIndex: byRole.bass,
        ppq: PPQ,
      }),
    );
  }

  if (byRole.lead != null) {
    parts.push(
      planMelody({
        sections: form.sections,
        harmony,
        hook,
        verseMotif,
        mode,
        keyPc,
        trackIndex: byRole.lead,
        role: "lead",
        ppq: PPQ,
        path: "melody/lead",
      }),
    );
  }
  if (byRole.chord != null) {
    parts.push(
      planMelody({
        sections: form.sections,
        harmony,
        hook: invertMotif(hook),
        verseMotif,
        mode,
        keyPc,
        trackIndex: byRole.chord,
        role: "chord",
        ppq: PPQ,
        path: "melody/chord",
      }),
    );
  }

  const assign = assignEnsemble({
    trackRoles: roles,
    style,
    sectionKind: form.sections.find((s) => s.kind === "chorus")?.kind ?? "verse",
  });
  parts = applyEnsembleRelations({
    parts,
    sections: form.sections,
    assign,
    ppq: PPQ,
  });

  const layerMatrix = buildLayerMatrix({
    trackRoles: roles,
    sections: form.sections,
    drumsVsTexture: settings.drumsVsTexture,
  });
  parts = applyLayerMatrix(parts, form.sections, layerMatrix, PPQ);

  const modRoutes = buildModRoutes({
    life: settings.life,
    style,
    density: settings.density,
  });
  parts = applyExpressionToParts(
    parts,
    form.sections,
    modRoutes,
    rng,
    PPQ,
  );

  parts = parts.map((p) => ({
    ...p,
    layerTier: Math.min(
      2,
      Math.floor(
        (form.sections.find((_, i) => layerMatrix[p.trackIndex]?.[i])?.energy ??
          0.5) * 3,
      ),
    ),
  }));

  const gestures = planGestures({
    sections: form.sections,
    parts,
    layerMatrix,
    ppq: PPQ,
  });
  const automation = compileGestures({
    gestures,
    parts,
    life: settings.life,
  });

  const mixPlan = planMix({
    parts,
    sections: form.sections,
    style,
    space: settings.space,
  });
  const { master, warnings: masterWarnings } = planMaster({
    tracks: mixPlan.tracks,
    sections: form.sections,
    layerMatrix,
    trackRoles: roles,
    style,
    targetLufs: settings.targetLufs,
    space: settings.space,
  });

  const resolved: ComposeSettings = {
    ...settings,
    style,
    formFamily,
    energyShape,
    keyPc,
    mode,
    targetBars: form.totalBars,
  };

  const score: Score = {
    dna: {
      seed: settings.seed,
      style,
      keyPc,
      mode,
      bpm: 120,
      meter: [4, 4],
      groove: {
        swing: settings.swing,
        feel: "straight",
        humanizeMs: settings.humanize * 20,
      },
      rhythmGenes,
      hook,
      verseMotif,
      progressions,
      signatureFx: mixPlan.spaces.signature?.kind,
      tuningOffsetCents: 0,
    },
    sections: form.sections,
    harmony,
    parts,
    layerMatrix,
    modRoutes,
    gestures,
    automation,
    mix: {
      tracks: mixPlan.tracks,
      spaces: mixPlan.spaces,
      master,
    },
    warnings: [...form.warnings, ...masterWarnings],
  };

  return { score, resolved };
}
