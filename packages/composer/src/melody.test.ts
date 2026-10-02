import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { MODE_SCALE } from "./harmony.js";
import {
  buildMotif,
  degreeToMidi,
  phraseDegrees,
} from "./melody.js";
import { applyEnsembleRelations, assignEnsemble } from "./ensemble.js";
import { makeRng } from "./rng.js";
import type { ComposeSettings, Section, TrackPart } from "./types.js";

describe("melody degrees", () => {
  it("degreeToMidi uses absolute scale degrees", () => {
    // C ionian degree 0 octave 5 = 60
    assert.equal(degreeToMidi(0, "ionian", 0, 5), 60);
    // degree 4 = G = 67
    assert.equal(degreeToMidi(4, "ionian", 0, 5), 67);
  });

  it("period phrase ends on cadence target", () => {
    const motif = buildMotif(
      makeRng(1),
      "m",
      { steps: 16, onsets: [0, 4, 8, 12], accents: [1, 0.4, 0.7, 0.4] },
      "hook",
    );
    const section: Section = {
      id: "verse#0",
      kind: "verse",
      startBar: 0,
      bars: 8,
      phrase: "period",
      energy: 0.5,
      occurrence: 0,
      region: 0,
    };
    const hits = phraseDegrees(section, motif, 0);
    assert.ok(hits.length > 0);
    assert.equal(hits[hits.length - 1]!.degree, 0);
    assert.equal(hits[hits.length - 1]!.tag, "cadence");
  });

  it("chorus register mean > verse", () => {
    const { score } = compose({
      seed: 21,
      style: "pop",
      targetBars: 48,
      formFamily: "verse-chorus",
      energyShape: "arch",
      energy: 0.6,
      density: 0.5,
      drumsVsTexture: 0.5,
      variation: 0.3,
      life: 0.2,
      space: 0.3,
      swing: 0,
      humanize: 0,
      keyPc: 0,
      mode: "ionian",
      tuningRef: "440",
      targetLufs: -14,
    });
    const lead = score.parts.find((p) => p.role === "lead");
    assert.ok(lead && lead.events.length > 0);
    const tpb = 960 * 4;
    const mean = (kind: string) => {
      const secs = score.sections.filter((s) => s.kind === kind);
      const midis: number[] = [];
      for (const s of secs) {
        const a = s.startBar * tpb;
        const b = (s.startBar + s.bars) * tpb;
        for (const e of lead!.events) {
          if (e.midi != null && e.tick >= a && e.tick < b) midis.push(e.midi);
        }
      }
      if (!midis.length) return null;
      return midis.reduce((x, y) => x + y, 0) / midis.length;
    };
    const v = mean("verse");
    const c = mean("chorus");
    if (v != null && c != null) {
      assert.ok(c > v, `chorus ${c} vs verse ${v}`);
    }
  });
});

describe("ensemble", () => {
  it("assigns primary lead and melodic follower relation", () => {
    const a = assignEnsemble({
      trackRoles: ["kick", "bass", "chord", "lead"],
      style: "techno",
      sectionKind: "chorus",
    });
    assert.equal(a.primaryTrack, 3);
    assert.equal(a.relationByTrack[2], "lock");
  });

  it("respond keeps follower in second half only", () => {
    const sections: Section[] = [
      {
        id: "verse#0",
        kind: "verse",
        startBar: 0,
        bars: 8,
        phrase: "period",
        energy: 0.5,
        occurrence: 0,
        region: 0,
      },
    ];
    const tpb = 960 * 4;
    const lead: TrackPart = {
      trackIndex: 1,
      role: "lead",
      layerTier: 2,
      events: [
        { tick: 0, durTick: 100, midi: 60, vel: 0.8, accent: true },
        { tick: 4 * tpb, durTick: 100, midi: 62, vel: 0.8, accent: true },
      ],
    };
    const chord: TrackPart = {
      trackIndex: 0,
      role: "chord",
      layerTier: 2,
      events: [
        { tick: 100, durTick: 100, midi: 64, vel: 0.5, accent: false },
        { tick: 4 * tpb + 100, durTick: 100, midi: 65, vel: 0.5, accent: false },
      ],
    };
    const out = applyEnsembleRelations({
      parts: [chord, lead],
      sections,
      assign: {
        primaryTrack: 1,
        relationByTrack: ["respond", "independent"],
      },
    });
    const follower = out.find((p) => p.trackIndex === 0)!;
    assert.ok(follower.events.every((e) => e.tick >= 4 * tpb));
  });
});

describe("compose melody", () => {
  it("includes lead + chord parts", () => {
    const settings: ComposeSettings = {
      seed: 9,
      style: "rock",
      targetBars: 32,
      formFamily: "verse-chorus",
      energyShape: "arch",
      energy: 0.55,
      density: 0.5,
      drumsVsTexture: 0.55,
      variation: 0.3,
      life: 0.2,
      space: 0.3,
      swing: 0,
      humanize: 0.1,
      keyPc: 0,
      mode: "ionian",
      tuningRef: "440",
      targetLufs: -14,
    };
    const { score } = compose(settings);
    assert.ok(score.parts.some((p) => p.role === "lead"));
    assert.ok(score.parts.some((p) => p.role === "chord"));
    const lead = score.parts.find((p) => p.role === "lead")!;
    assert.ok(lead.events.some((e) => e.midi != null));
    // Strong beats mostly chord tones of ionian
    const scale = MODE_SCALE.ionian;
    let on = 0;
    let tot = 0;
    for (const e of lead.events) {
      if (!e.accent || e.midi == null) continue;
      tot += 1;
      const pc = ((e.midi % 12) + 12) % 12;
      if (scale.includes(pc)) on += 1;
    }
    if (tot > 0) assert.ok(on / tot >= 0.5);
  });
});
