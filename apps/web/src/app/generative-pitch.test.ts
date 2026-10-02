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
  exactPitchSemitones,
  hzToMidi,
  isMelodicPitchReliable,
  resampleStretchPitchSemis,
  resolveTuningOffsetCents,
  scaleCompatibleTransposes,
  snapChordRelativeDegree,
  soundingMidi,
} from "./generative.js";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function targetPc(fromMidi: number, semis: number, stretch = 0, tuningCents = 0): number {
  const sounding = soundingMidi(fromMidi, semis, stretch);
  const target = Math.round(sounding - tuningCents / 100);
  return ((target % 12) + 12) % 12;
}

describe("snapChordRelativeDegree", () => {
  it("snaps accents to triad / octave", () => {
    assert.equal(snapChordRelativeDegree(1, true), 0);
    assert.equal(snapChordRelativeDegree(3, true), 2);
    assert.equal(snapChordRelativeDegree(6, true), 7);
  });
});

describe("pickSectionProgression harmony", () => {
  it("adds default triad voicings and lengthens short verse cycles", () => {
    const rnd = () => 0.1;
    // Force pop bank path
    const verse = pickSectionProgression("verse", "pop", false, rnd);
    assert.ok(verse.every((e) => (e.tones?.length ?? 0) >= 2));
    const totalBars = verse.reduce((s, e) => s + (e.bars ?? 1), 0);
    assert.ok(totalBars >= 4);
  });

  it("cadences chorus toward tonic", () => {
    let sawTonicEnd = false;
    for (let i = 0; i < 20; i++) {
      const rnd = () => (i * 0.05) % 1;
      const chorus = pickSectionProgression("chorus", "pop", false, rnd);
      const last = chorus[chorus.length - 1];
      if (last?.degree === 0) sawTonicEnd = true;
      assert.ok(last?.tones && last.tones.length >= 2);
    }
    assert.ok(sawTonicEnd);
  });
});

describe("scaleCompatibleTransposes", () => {
  it("does not keep off-scale unison when the pitch window is empty", () => {
    const fromMidi = 61; // C# vs C major
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 0, 0);
    assert.ok(allowed.length > 0);
    assert.ok(!allowed.some((s) => Math.abs(s) < 1e-9));
    for (const s of allowed) {
      assert.ok(MAJOR.includes(targetPc(fromMidi, s)));
    }
  });

  it("stays on-scale inside a tight window", () => {
    const fromMidi = 66; // F#
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 1, 1);
    assert.ok(allowed.length > 0);
    assert.ok(!allowed.some((s) => Math.abs(s) < 1e-9));
    for (const s of allowed) {
      assert.ok(MAJOR.includes(targetPc(fromMidi, s)));
    }
  });

  it("accounts for resample stretch offset", () => {
    // C4 + stretch ~1 semitone → need transpose -1 to land on C
    const fromMidi = 60;
    const allowed = scaleCompatibleTransposes(fromMidi, 0, MAJOR, 2, 2, 1);
    assert.ok(allowed.some((s) => Math.abs(s - -1) < 1e-9));
    assert.ok(!allowed.some((s) => Math.abs(s) < 1e-9));
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
      const pc = targetPc(fromMidi, s);
      assert.ok(chordRels.includes(pc), `pc ${pc} not in IV triad`);
    }
    // E (major third of C) must not appear — was a common "false note" vs IV
    assert.ok(!allowed.some((s) => targetPc(fromMidi, s) === 4));
  });
});

describe("justesse §5bis", () => {
  it("retunes 443 Hz A4 to 440 Hz within 1 cent", () => {
    const source = hzToMidi(443);
    const semis = exactPitchSemitones(69, source);
    const sounding = soundingMidi(source, semis);
    const hz = 440 * 2 ** ((sounding - 69) / 12);
    assert.ok(Math.abs(hz - 440) / 440 < 0.0006); // < 1 cent
  });

  it("452 Hz (~A4+47¢) never flips class when targeting A vs A#", () => {
    const source = hzToMidi(452);
    const toA = exactPitchSemitones(69, source);
    const toAs = exactPitchSemitones(70, source);
    assert.ok(Math.abs(soundingMidi(source, toA) - 69) < 1e-9);
    assert.ok(Math.abs(soundingMidi(source, toAs) - 70) < 1e-9);
    // Old Math.round(source) path could snap ~69.47→69 and muddy A#; exact path is stable.
    assert.ok(Math.abs(toA - toAs + 1) < 1e-9);
    const allowed = scaleCompatibleTransposes(source, 9, MAJOR, 12, 12);
    assert.ok(allowed.some((s) => Math.abs(s - toA) < 1e-6));
    // A# is not in A-major — must not appear via rounding accident
    assert.ok(!allowed.some((s) => Math.abs(s - toAs) < 1e-6));
  });

  it("compensates resample stretch ×1.5 exactly", () => {
    const source = 69;
    const fit = 1.5;
    const stretch = resampleStretchPitchSemis(fit);
    const semis = exactPitchSemitones(69, source, stretch);
    assert.ok(Math.abs(soundingMidi(source, semis, stretch) - 69) < 1e-9);
  });

  it("library tuning +30¢ keeps all notes at +30¢ ±1¢", () => {
    const tuning = 30;
    const source = hzToMidi(440 * 2 ** (30 / 1200)); // A4 at +30¢
    const semis = exactPitchSemitones(69, source, 0, tuning);
    const sounding = soundingMidi(source, semis);
    assert.ok(Math.abs(sounding - (69 + 0.3)) < 0.01);
  });

  it("resolveTuningOffsetCents auto uses library when coherent", () => {
    const samples = [0, 1, 2].map((i) => ({
      id: `s${i}`,
      durationMs: 1000,
      class: "tonal" as const,
      favorite: false,
      pitchHz: 440 * 2 ** (30 / 1200),
      pitchConfidence: 0.9,
      pitchDriftCents: 5,
      harmonicity: 0.8,
    }));
    const off = resolveTuningOffsetCents("auto", samples);
    assert.ok(Math.abs(off - 30) < 2);
    assert.equal(resolveTuningOffsetCents("440", samples), 0);
  });

  it("rejects high-drift samples as melodic", () => {
    assert.equal(
      isMelodicPitchReliable({
        id: "x",
        durationMs: 500,
        class: "tonal",
        favorite: false,
        pitchHz: 440,
        pitchConfidence: 0.9,
        pitchDriftCents: 60,
      }),
      false,
    );
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
