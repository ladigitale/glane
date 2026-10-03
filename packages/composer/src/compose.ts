import { PPQ, type ExprRole } from "@glane/core-model";
import {
  applyLayerMatrix,
  buildLayerMatrix,
  defaultTrackRoles,
  trackIndexByRole,
} from "./arrangement.js";
import { planBass } from "./bass.js";
import { planArp, planBed } from "./beds.js";
import { assembleSongDna, buildSongDna } from "./dna.js";
import { planDrums } from "./drums.js";
import { applyEnsembleRelations, assignEnsemble } from "./ensemble.js";
import { fitForm } from "./form.js";
import { compileGestures, planGestures } from "./gestures.js";
import { planHarmony } from "./harmony.js";
import { planMaster } from "./master.js";
import { invertMotif, planMelody } from "./melody.js";
import { planMix } from "./mix.js";
import { buildModRoutes, applyExpressionToParts } from "./modulation.js";
import { makeComposeRng } from "./rng.js";
import { resolveStyleAutos } from "./styles/profiles.js";
import type { ComposeResult, ComposeSettings, Score } from "./types.js";

const BED_ROLES: Array<Extract<ExprRole, "texture" | "loop" | "fx">> = [
  "texture",
  "loop",
  "fx",
];

/**
 * Orchestrate composition layers → Score.
 * Through step 7: form…modulation + gestures + mix + master.
 */
export function compose(settings: ComposeSettings): ComposeResult {
  const rng = makeComposeRng(settings.seed, {
    locks: settings.locks,
    regenSalt: settings.regenSalt,
  });
  const style = settings.style === "auto" ? "ambient" : settings.style;
  const autos = resolveStyleAutos({
    style,
    formFamily: settings.formFamily,
    energyShape: settings.energyShape,
    mode: settings.mode,
    roll: (path) => rng(path),
  });
  const { formFamily, energyShape, mode, profile } = autos;
  const keyPc = settings.keyPc === "auto" ? 0 : settings.keyPc;

  const form = fitForm({
    targetBars: settings.targetBars,
    family: formFamily,
    energyShape,
    energyBias: settings.energy,
    rng,
    path: "form",
  });

  const dna = buildSongDna({
    rng,
    mode,
    density: settings.density,
    sampleGenes: settings.sampleGenes,
    grooveFromSamples: settings.grooveFromSamples,
  });
  const { rhythmGenes, hook, verseMotif, progressions } = dna;
  const harmony = planHarmony({
    sections: form.sections,
    progressions,
    mode,
    keyPc,
    rng,
    path: "harmony",
  });

  const roles =
    settings.trackRoles && settings.trackRoles.length > 0
      ? settings.trackRoles
      : defaultTrackRoles(true);
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
        trackIndex: byRole.bass,
        ppq: PPQ,
        rng,
        style,
        density: settings.density,
        variation: settings.variation,
        hook,
        mode,
        keyPc,
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

  for (const bedRole of BED_ROLES) {
    const ti = byRole[bedRole];
    if (ti == null) continue;
    parts.push(
      planBed({
        role: bedRole,
        sections: form.sections,
        harmony,
        trackIndex: ti,
        ppq: PPQ,
      }),
    );
  }
  if (byRole.arp != null) {
    parts.push(
      planArp({
        sections: form.sections,
        harmony,
        trackIndex: byRole.arp,
        ppq: PPQ,
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
    dna: assembleSongDna({
      settings,
      style,
      keyPc,
      mode,
      profile,
      dna,
      signatureFx: mixPlan.spaces.signature?.kind,
    }),
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
    warnings: [
      ...form.warnings,
      ...masterWarnings,
      ...(dna.warning ? [dna.warning] : []),
    ],
  };

  return { score, resolved };
}
