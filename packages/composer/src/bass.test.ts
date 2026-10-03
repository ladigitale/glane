import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bassLeadChance, planBass } from "./bass.js";
import { makeRng } from "./rng.js";
import type { ChordSlot, Motif, NoteEvent, RhythmGene, Section } from "./types.js";

function sections(): Section[] {
  return [
    {
      id: "v1",
      kind: "verse",
      startBar: 0,
      bars: 4,
      phrase: "sentence",
      energy: 0.55,
      occurrence: 0,
      region: 0,
    },
    {
      id: "c1",
      kind: "chorus",
      startBar: 4,
      bars: 4,
      phrase: "period",
      energy: 0.75,
      occurrence: 0,
      region: 1,
    },
  ];
}

function harmony(): ChordSlot[] {
  return [
    {
      bar: 0,
      beat: 0,
      durBeats: 8,
      degree: 1,
      quality: "min",
      tonesPc: [0, 3, 7],
      voicingMidi: [48, 51, 55],
      function: "T",
    },
    {
      bar: 2,
      beat: 0,
      durBeats: 8,
      degree: 4,
      quality: "min",
      tonesPc: [5, 8, 0],
      voicingMidi: [53, 56, 60],
      function: "SD",
    },
    {
      bar: 4,
      beat: 0,
      durBeats: 8,
      degree: 1,
      quality: "min",
      tonesPc: [0, 3, 7],
      voicingMidi: [48, 51, 55],
      function: "T",
    },
    {
      bar: 6,
      beat: 0,
      durBeats: 8,
      degree: 5,
      quality: "7",
      tonesPc: [7, 11, 2, 5],
      voicingMidi: [43, 47, 50, 53],
      function: "D",
    },
  ];
}

function kicks(ppq = 960): NoteEvent[] {
  const tpb = ppq * 4;
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < 8; bar++) {
    out.push({
      tick: bar * tpb,
      durTick: ppq / 2,
      midi: 36,
      vel: 0.9,
      accent: true,
    });
    out.push({
      tick: bar * tpb + ppq * 2,
      durTick: ppq / 2,
      midi: 36,
      vel: 0.7,
      accent: false,
    });
  }
  return out;
}

const genes: RhythmGene[] = [
  { steps: 16, onsets: [0, 8], accents: [1, 0.6] },
  { steps: 16, onsets: [0, 4, 8, 12, 14], accents: [1, 0.3, 0.7, 0.3, 0.2] },
];

describe("planBass", () => {
  it("is deterministic for same seed", () => {
    const opts = {
      sections: sections(),
      harmony: harmony(),
      kickEvents: kicks(),
      rhythmGenes: genes,
      trackIndex: 1,
      style: "funk" as const,
      density: 0.9,
      variation: 0.6,
    };
    const a = planBass({ ...opts, rng: makeRng(11) });
    const b = planBass({ ...opts, rng: makeRng(11) });
    assert.deepEqual(
      a.events.map((e) => [e.tick, e.midi, e.vel]),
      b.events.map((e) => [e.tick, e.midi, e.vel]),
    );
  });

  it("lockKick=true stays on kick grid; unlocked funk denser + more PCs", () => {
    const kickEvents = kicks();
    const locked = planBass({
      sections: sections(),
      harmony: harmony(),
      kickEvents,
      rhythmGenes: genes,
      trackIndex: 1,
      lockKick: true,
      style: "funk",
      density: 0.4,
      variation: 0.1,
      rng: makeRng(3),
    });
    const free = planBass({
      sections: sections(),
      harmony: harmony(),
      kickEvents,
      rhythmGenes: genes,
      trackIndex: 1,
      lockKick: false,
      style: "funk",
      density: 0.95,
      variation: 0.8,
      rng: makeRng(3),
    });
    const kickTicks = new Set(kickEvents.map((k) => k.tick));
    assert.ok(locked.events.every((e) => kickTicks.has(e.tick)));
    assert.ok(free.events.length > locked.events.length);
    const midis = new Set(free.events.map((e) => e.midi % 12));
    assert.ok(midis.size >= 2, "expect pitch-class variety beyond a single root");
  });

  it("jazz yields more unique midis than metal lock", () => {
    const base = {
      sections: sections(),
      harmony: harmony(),
      kickEvents: kicks(),
      rhythmGenes: genes,
      trackIndex: 1,
      density: 0.85,
      variation: 0.7,
      rng: makeRng(21),
    };
    const jazz = planBass({ ...base, style: "jazz" });
    const metal = planBass({ ...base, style: "metal", lockKick: true });
    const jazzMidis = new Set(jazz.events.map((e) => e.midi));
    const metalMidis = new Set(metal.events.map((e) => e.midi));
    assert.ok(jazzMidis.size >= metalMidis.size);
    assert.ok(jazz.events.length >= metal.events.length);
  });

  it("bassLeadChance prefers bridge/break on melodic styles", () => {
    assert.ok(bassLeadChance("bridge", "jazz") > bassLeadChance("chorus", "jazz"));
    assert.ok(bassLeadChance("break", "funk") > bassLeadChance("break", "metal"));
    assert.equal(bassLeadChance("chorus", "pop"), 0);
  });

  it("lead section tags variation and uses hook contour pcs", () => {
    const hook: Motif = {
      rhythm: {
        steps: 16,
        onsets: [0, 4, 8, 12],
        accents: [1, 0.4, 0.7, 0.4],
      },
      contour: [0, 2, 4, 2],
      lengthBeats: 4,
    };
    const bridgeSections: Section[] = [
      {
        id: "br",
        kind: "bridge",
        startBar: 0,
        bars: 4,
        phrase: "sentence",
        energy: 0.5,
        occurrence: 0,
        region: 0,
      },
    ];
    // Force lead: rng always low
    const part = planBass({
      sections: bridgeSections,
      harmony: harmony(),
      kickEvents: kicks(),
      rhythmGenes: genes,
      trackIndex: 1,
      style: "jazz",
      variation: 1,
      hook,
      mode: "dorian",
      keyPc: 0,
      rng: () => 0.01,
    });
    assert.ok(part.events.some((e) => e.tag === "variation"));
    const pcs = new Set(part.events.map((e) => e.midi % 12));
    assert.ok(pcs.size >= 2);
  });
});
