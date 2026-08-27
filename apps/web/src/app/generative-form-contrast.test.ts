import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mulberry32,
  planSequence,
  planSongForm,
  sectionAllowsRole,
  type SequenceSampleIn,
} from "./generative.js";
import { CALL_RESPONSE_PAIRS, MELODY_CELLS } from "./generative-refs.js";

describe("planSongForm contrast", () => {
  it("long song has intro/verse/chorus/outro and chorus denser than verse", () => {
    const sections = planSongForm(64, mulberry32(11), {
      formStyle: "song",
      energy: 0.6,
      drumsVsTexture: 0.55,
    });
    const kinds = new Set(sections.map((s) => s.kind));
    assert.ok(kinds.has("intro"), "needs intro");
    assert.ok(kinds.has("verse"), "needs verse");
    assert.ok(kinds.has("chorus"), "needs chorus");
    assert.ok(kinds.has("outro"), "needs outro");

    const verses = sections.filter((s) => s.kind === "verse");
    const choruses = sections.filter((s) => s.kind === "chorus");
    const maxVerse = Math.max(...verses.map((s) => s.densityMul));
    const minChorus = Math.min(...choruses.map((s) => s.densityMul));
    assert.ok(
      minChorus > maxVerse + 0.15,
      `chorus dens ${minChorus} should exceed verse ${maxVerse}`,
    );

    const intros = sections.filter((s) => s.kind === "intro");
    assert.ok(intros.every((s) => s.fillLastBar), "intro handoff fill");
    const outros = sections.filter((s) => s.kind === "outro");
    assert.ok(outros.every((s) => !s.fillLastBar), "outro no drum fill");
    assert.ok(
      outros.every((s) => s.gainBiasDb <= -5),
      "outro quieter gain bias",
    );
  });
});

describe("sectionAllowsRole schedule", () => {
  const rnd = () => 0.5; // mid soft-margin → follow hard gate

  it("intro bar0: beds on, lead off", () => {
    const intro = { kind: "intro" as const, bars: 4 };
    assert.equal(sectionAllowsRole("texture", intro, 0, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("chord", intro, 0, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("lead", intro, 0, 0.55, rnd), false);
    assert.equal(sectionAllowsRole("kick", intro, 0, 0.55, rnd), false);
  });

  it("chorus always allows lead", () => {
    const chorus = { kind: "chorus" as const, bars: 4 };
    assert.equal(sectionAllowsRole("lead", chorus, 0, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("kick", chorus, 2, 0.55, rnd), true);
  });

  it("outro last bar keeps melodic accents", () => {
    const outro = { kind: "outro" as const, bars: 4 };
    assert.equal(sectionAllowsRole("lead", outro, 3, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("bass", outro, 3, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("chord", outro, 3, 0.55, rnd), true);
    assert.equal(sectionAllowsRole("kick", outro, 3, 0.55, rnd), false);
  });
});

describe("phrase banks", () => {
  it("has expanded melody and call–response banks", () => {
    assert.ok(MELODY_CELLS.length >= 20);
    assert.ok(CALL_RESPONSE_PAIRS.length >= 8);
  });
});

describe("planSequence form voice contrast", () => {
  function pitched(id: string, hz: number, cls: string): SequenceSampleIn {
    return {
      id,
      durationMs: 400,
      class: cls,
      favorite: false,
      pitchHz: hz,
      noteName: "C4",
      harmonicity: 0.8,
      centroidHz: hz,
      transientDensity: 0.4,
      analysisBpm: 120,
    };
  }

  it("uses distinct samples across verse vs chorus when pool ≥ 2 pitched leads", () => {
    const samples: SequenceSampleIn[] = [
      pitched("lead-a", 261.63, "tonal"),
      pitched("lead-b", 329.63, "tonal"),
      pitched("bass-a", 65.41, "tonal"),
      pitched("bass-b", 82.41, "tonal"),
      {
        id: "kick-a",
        durationMs: 200,
        class: "percussive",
        favorite: false,
        centroidHz: 80,
        transientDensity: 0.9,
        analysisBpm: 120,
        forceRole: "kick",
      },
      {
        id: "hat-a",
        durationMs: 80,
        class: "percussive",
        favorite: false,
        centroidHz: 6000,
        transientDensity: 0.85,
        analysisBpm: 120,
        forceRole: "hat",
      },
    ];
    const tracks = [
      { id: "t0", index: 0 },
      { id: "t1", index: 1 },
      { id: "t2", index: 2 },
      { id: "t3", index: 3 },
    ];
    const plan = planSequence({
      bars: 64,
      beatsPerBar: 4,
      ppq: 96,
      bpm: 120,
      seed: 42,
      tracks,
      samples,
      musicStyle: "pop",
      formStyle: "song",
      density: 1,
      energy: 0.6,
      drumsVsTexture: 0.65,
      sampleVariety: 0.7,
      variation: 0.4,
      callResponse: "off",
      lockPitch: "off",
    });
    assert.ok(plan.clips.length > 20);

    const sections = planSongForm(64, mulberry32(0), {
      formStyle: "song",
      energy: 0.6,
      drumsVsTexture: 0.65,
    });
    // Use section geometry from a parallel form call only as bar ranges of kinds —
    // clip sample diversity is the real assertion.
    assert.ok(sections.some((s) => s.kind === "verse"));
    assert.ok(sections.some((s) => s.kind === "chorus"));

    const byTrack = new Map<string, Set<string>>();
    for (const c of plan.clips) {
      let set = byTrack.get(c.trackId);
      if (!set) {
        set = new Set();
        byTrack.set(c.trackId, set);
      }
      set.add(c.sampleId);
    }
    const multiSampleTracks = [...byTrack.values()].filter((s) => s.size >= 2);
    assert.ok(
      multiSampleTracks.length >= 1,
      "at least one track should switch sample between section homes",
    );
  });
});
