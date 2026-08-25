import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSectionHarmonyTimeline,
  expandChordTimeline,
  pickSectionProgression,
} from "./generative-refs.js";
import {
  bpmSyncStretch,
  chordRunBars,
  clipStretchFactors,
  resampleStretchPitchSemis,
  scaleCompatibleTransposes,
} from "./generative.js";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe("scaleCompatibleTransposes", () => {
  it("does not keep off-scale unison when the pitch window is empty", () => {
    const fromMidi = 61; // C# vs C major
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 0, 0);
    assert.ok(allowed.length > 0);
    assert.ok(!allowed.includes(0));
    for (const s of allowed) {
      const pc = (((Math.round(fromMidi) + s) % 12) + 12) % 12;
      assert.ok(MAJOR.includes(pc));
    }
  });

  it("stays on-scale inside a tight window", () => {
    const fromMidi = 66; // F#
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 1, 1);
    assert.ok(allowed.length > 0);
    assert.ok(!allowed.includes(0));
    for (const s of allowed) {
      const pc = (((Math.round(fromMidi) + s) % 12) + 12) % 12;
      assert.ok(MAJOR.includes(pc));
    }
  });

  it("accounts for resample stretch offset", () => {
    // C4 + stretch ~1 semitone → need transpose -1 to land on C
    const fromMidi = 60;
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 2, 2, 1);
    assert.ok(allowed.includes(-1));
    assert.ok(!allowed.includes(0));
  });

  it("can lock to chord tones only (IV in C = F A C)", () => {
    const chordRels = [5, 9, 0]; // F, A, C
    const fromMidi = 60; // C
    const allowed = scaleCompatibleTransposes(
      fromMidi,
      0,
      MAJOR,
      12,
      12,
      0,
      chordRels,
    );
    assert.ok(allowed.length > 0);
    for (const s of allowed) {
      const pc = (((60 + s) % 12) + 12) % 12;
      assert.ok(chordRels.includes(pc), `pc ${pc} not in IV triad`);
    }
    // E (major third of C) must not appear — was a common "false note" vs IV
    assert.ok(!allowed.some((s) => (((60 + s) % 12) + 12) % 12 === 4));
  });
});

describe("clipStretchFactors / resampleStretchPitchSemis", () => {
  it("keeps fitFactor and artisticFactor distinct under BPM sync", () => {
    // Sample @100 → project @120: lengthFactor = 100/120
    const bpmLf = 100 / 120;
    const natural = 1200;
    // Clip at tempo-matched length → artistic=1, fit=bpmLf
    const synced = clipStretchFactors(natural * bpmLf, natural, bpmLf);
    assert.ok(Math.abs(synced.artisticFactor - 1) < 1e-9);
    assert.ok(Math.abs(synced.fitFactor - bpmLf) < 1e-9);
    // Pitch from resample must use fitFactor (tempo portion), not artistic
    const semis = resampleStretchPitchSemis(synced.fitFactor);
    assert.ok(Math.abs(semis - -12 * Math.log2(bpmLf)) < 1e-9);
    assert.ok(Math.abs(resampleStretchPitchSemis(synced.artisticFactor)) < 1e-9);
  });

  it("artistic stretch beyond BPM sync does not cancel tempo pitch", () => {
    const bpmLf = 0.5; // double-time project vs sample
    const natural = 1000;
    const { fitFactor, artisticFactor } = clipStretchFactors(
      natural * bpmLf * 1.25,
      natural,
      bpmLf,
    );
    assert.ok(Math.abs(artisticFactor - 1.25) < 1e-9);
    assert.ok(Math.abs(fitFactor - bpmLf * 1.25) < 1e-9);
    // Wrong formula (fit / bpmLf) would hide tempo pitch — must not equal artistic alone
    assert.ok(
      Math.abs(resampleStretchPitchSemis(fitFactor)) >
        Math.abs(resampleStretchPitchSemis(artisticFactor)),
    );
  });
});

describe("bpmSyncStretch", () => {
  const sample = {
    id: "s1",
    durationMs: 4000,
    analysisBpm: 100,
    class: "tonal" as const,
    favorite: false,
  };

  it("always preserves pitch when syncing (never resample)", () => {
    const rnd = () => 0.99;
    for (const role of [
      "loop",
      "lead",
      "bass",
      "perc",
      "texture",
      "chord",
    ] as const) {
      const out = bpmSyncStretch(sample, 120, role, rnd, "on");
      assert.ok(out);
      assert.equal(out!.stretchMode, "preserve-pitch");
      assert.ok(Math.abs(out!.lengthFactor - 100 / 120) < 1e-9);
    }
  });

  it("requires analysisBpm metadata", () => {
    const out = bpmSyncStretch(
      { id: "x", durationMs: 1000, class: "noise", favorite: false },
      120,
      "loop",
      () => 0,
      "on",
    );
    assert.equal(out, null);
  });

  it("skips when already near project tempo", () => {
    const out = bpmSyncStretch(
      { ...sample, analysisBpm: 118 },
      120,
      "loop",
      () => 0,
      "on",
    );
    assert.equal(out, null);
  });
});

describe("buildSectionHarmonyTimeline", () => {
  it("reuses the same progression when a section kind returns", () => {
    const rnd = () => 0.1;
    const sections = [
      { kind: "verse" as const, startBar: 0, bars: 4 },
      { kind: "chorus" as const, startBar: 4, bars: 4 },
      { kind: "verse" as const, startBar: 8, bars: 4 },
    ];
    const timeline = buildSectionHarmonyTimeline(
      12,
      sections,
      "pop",
      false,
      rnd,
    );
    assert.equal(timeline.length, 12);
    for (let i = 0; i < 4; i++) {
      assert.equal(timeline[i]!.degree, timeline[8 + i]!.degree);
    }
  });

  it("tiles a bank when bars exceed the progression length", () => {
    const prog = pickSectionProgression("verse", "pop", false, () => 0.2);
    const expanded = expandChordTimeline(prog, 16);
    assert.equal(expanded.length, 16);
    assert.ok(expanded.every((b) => b.degree >= 0 && b.degree <= 6));
  });
});

describe("chordRunBars", () => {
  it("counts consecutive identical chords and stops at a change", () => {
    const timeline = [
      { degree: 0, tones: [0, 2, 4] as const },
      { degree: 0, tones: [0, 2, 4] as const },
      { degree: 4, tones: [0, 2, 4] as const },
      { degree: 4, tones: [0, 2, 4] as const },
    ];
    assert.equal(chordRunBars(timeline, 0, 4), 2);
    assert.equal(chordRunBars(timeline, 2, 4), 2);
    assert.equal(chordRunBars(timeline, 1, 3), 1);
  });

  it("treats voicing changes as a new chord", () => {
    const timeline = [
      { degree: 0, tones: [0, 2, 4] as const },
      { degree: 0, tones: [0, 2, 4, 6] as const },
    ];
    assert.equal(chordRunBars(timeline, 0, 2), 1);
  });
});
