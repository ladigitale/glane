import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arpChordSemis,
  composeArpSteps,
  degreeToSemis,
  evalLfo,
  expandArpSteps,
  planArpNotes,
  pickArpLfos,
  sumLfo,
} from "./arp.js";
import { mulberry32 } from "./sample.js";

describe("arpChordSemis", () => {
  it("major R–3–5–8", () => {
    assert.deepEqual(arpChordSemis("major"), [0, 4, 7, 12]);
  });

  it("minor R–b3–5–8", () => {
    assert.deepEqual(arpChordSemis("minor"), [0, 3, 7, 12]);
  });
});

describe("degreeToSemis", () => {
  it("maps scale degrees across octaves", () => {
    const major = [0, 2, 4, 5, 7, 9, 11];
    assert.equal(degreeToSemis(0, major), 0);
    assert.equal(degreeToSemis(2, major), 4);
    assert.equal(degreeToSemis(7, major), 12);
    assert.equal(degreeToSemis(-1, major), -1);
  });
});

describe("expandArpSteps", () => {
  it("up cycles tone indices", () => {
    assert.deepEqual(expandArpSteps("up", 4, 6), [0, 1, 2, 3, 0, 1]);
  });

  it("down cycles descending", () => {
    assert.deepEqual(expandArpSteps("down", 4, 4), [3, 2, 1, 0]);
  });
});

describe("composeArpSteps", () => {
  it("builds multi-bar length in sixteenths", () => {
    const steps = composeArpSteps({
      bars: 4,
      form: "ABAB",
      motifs: [0, 1],
    });
    const total = steps.reduce((s, st) => s + st.sixteenths, 0);
    assert.equal(total, 64);
  });
});

describe("multi-LFO", () => {
  it("evalLfo stays in [-depth, depth]", () => {
    const lfo = {
      target: "cutoff" as const,
      shape: "sine" as const,
      rate: 1,
      depth: 0.5,
      phase: 0,
    };
    for (let i = 0; i <= 20; i++) {
      const v = evalLfo(lfo, i / 20);
      assert.ok(v >= -0.5 - 1e-9 && v <= 0.5 + 1e-9);
    }
  });

  it("sumLfo only sums matching targets", () => {
    const lfos = [
      {
        target: "cutoff" as const,
        shape: "sine" as const,
        rate: 1,
        depth: 1,
        phase: 0,
      },
      {
        target: "gate" as const,
        shape: "sine" as const,
        rate: 1,
        depth: 1,
        phase: 0,
      },
    ];
    assert.equal(sumLfo(lfos, "gate", 0), sumLfo(lfos, "gate", 0));
    assert.notEqual(sumLfo(lfos, "cutoff", 0.25), 0);
  });

  it("pickArpLfos returns 2–3 distinct-ish targets", () => {
    const rnd = mulberry32(42);
    const lfos = pickArpLfos(rnd);
    assert.ok(lfos.length >= 2 && lfos.length <= 3);
    const targets = new Set(lfos.map((l) => l.target));
    assert.ok(targets.size >= 2);
    assert.ok(!lfos.some((l) => l.target === "octave"));
  });
});

describe("planArpNotes", () => {
  it("sequences at least 2 bars with rests allowed", () => {
    const { notes, durationSec, bars } = planArpNotes({
      fundHz: 261.63,
      tonicPc: 0,
      pattern: "sequence",
      bpm: 120,
      bars: 4,
      form: "AABA",
      motifs: [0, 3, 6, 1],
      scaleMode: "major",
      lfos: pickArpLfos(mulberry32(7)),
    });
    assert.equal(bars, 4);
    assert.ok(Math.abs(durationSec - 8) < 1e-6);
    assert.ok(notes.length >= 8);
    assert.ok(notes.every((n) => n.hz > 40 && n.hz < 4000));
    // All note pitch-classes stay in C major
    for (const n of notes) {
      const midi = Math.round(69 + 12 * Math.log2(n.hz / 440));
      const pc = ((midi % 12) + 12) % 12;
      assert.ok([0, 2, 4, 5, 7, 9, 11].includes(pc), `off-scale pc ${pc}`);
    }
    assert.ok(notes.some((n) => n.cutoffMul !== 1 || n.peak < 0.9));
  });

  it("locks exact ET from tonicPc (D major)", () => {
    const { notes } = planArpNotes({
      fundHz: 999, // ignored when tonicPc set
      tonicPc: 2,
      tonicOctave: 4,
      pattern: "sequence",
      bpm: 120,
      bars: 2,
      form: "AAAA",
      motifs: [0],
      scaleMode: "major",
      lfos: [],
    });
    // First note = D4
    const midi0 = Math.round(69 + 12 * Math.log2(notes[0]!.hz / 440));
    assert.equal(midi0, 62);
  });

  it("promotes 1-bar request to 2 bars", () => {
    const { bars } = planArpNotes({
      fundHz: 220,
      pattern: "sequence",
      bpm: 100,
      bars: 1,
      motifs: [2],
    });
    assert.equal(bars, 2);
  });

  it("8-bar phrase duration", () => {
    const { durationSec, bars } = planArpNotes({
      fundHz: 220,
      bpm: 120,
      bars: 8,
      form: "ABCD",
      motifs: [0, 1, 2, 3],
    });
    assert.equal(bars, 8);
    assert.ok(Math.abs(durationSec - 16) < 1e-6);
  });
});
