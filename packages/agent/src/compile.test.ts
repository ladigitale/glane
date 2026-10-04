import { test } from "node:test";
import assert from "node:assert/strict";
import { PPQ } from "@glane/core-model";
import { compileScore, createSampleResolver } from "./compile.js";

const KICK = "aaaaaaaa-1111-4111-8111-000000000001";
const HAT = "bbbbbbbb-2222-4222-8222-000000000002";
const HAT2 = "bbbbbbbc-2222-4222-8222-000000000003";
const PAD = "cccccccc-3333-4333-8333-000000000004";

const samples = [
  { id: KICK, durationMs: 400 },
  { id: HAT, durationMs: 120 },
  { id: HAT2, durationMs: 90 },
  { id: PAD, durationMs: 6000, loopStartMs: 500, loopEndMs: 4500 },
];

test("resolver accepts unique prefixes and reports ambiguity", () => {
  const r = createSampleResolver(samples);
  assert.equal((r("aaaaaaaa") as { id: string }).id, KICK);
  assert.match(r("bbbbbbb") as string, /ambigu/);
  assert.match(r("zzzzzzzz") as string, /inconnu/);
});

test("clip positions, natural length and track defaults", () => {
  const res = compileScore(
    {
      bpm: 120,
      bars: 4,
      tracks: [{ name: "Kick", clips: [{ sample: "aaaaaaaa", bar: 2, beat: 3 }] }],
    },
    { samples },
  );
  assert.ok(res.ok, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.tracks.length, 6);
  assert.equal(v.tracks[0]!.name, "Kick");
  assert.equal(v.tracks[3]!.name, "Piste 4");
  const c = v.clips[0]!;
  assert.equal(c.startTick, (4 + 2) * PPQ);
  // 400 ms @ 120 bpm = 0.8 beat
  assert.equal(c.lengthTick, Math.round(0.8 * PPQ));
  assert.equal(c.fadeInMs, 5);
  assert.equal(v.stats.durationSec, 8);
});

test("loop without offset uses the seamless loop region", () => {
  const res = compileScore(
    {
      bpm: 90,
      bars: 8,
      tracks: [{ clips: [{ sample: "cccccccc", bar: 1, beats: 32, loop: true }] }],
    },
    { samples },
  );
  assert.ok(res.ok);
  const c = res.value.clips[0]!;
  assert.equal(c.loopEnabled, true);
  assert.equal(c.contentOffsetMs, 500);
  assert.equal(c.loopLengthMs, 4000);
});

test("loop clip needs an explicit length", () => {
  const res = compileScore(
    { bpm: 90, bars: 8, tracks: [{ clips: [{ sample: "cccccccc", bar: 1, loop: true }] }] },
    { samples },
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors[0]!, /beats ou ms/);
});

test("patterns expand steps, ghosts, skipBars and round-robin", () => {
  const res = compileScore(
    {
      bpm: 120,
      bars: 4,
      tracks: [
        {
          patterns: [
            {
              sample: ["bbbbbbbb-2222", "bbbbbbbc"],
              fromBar: 1,
              toBar: 3,
              steps: "X.x. | X... | .... | ....",
              skipBars: [2],
              pitch: [0, 7],
            },
          ],
        },
      ],
    },
    { samples },
  );
  assert.ok(res.ok, JSON.stringify(res));
  const clips = res.value.clips;
  // 3 hits per bar (X, x, X) × bars 1 and 3
  assert.equal(clips.length, 6);
  assert.deepEqual(
    clips.map((c) => c.startTick / PPQ),
    [0, 0.5, 1, 8, 8.5, 9],
  );
  assert.equal(clips[1]!.gainDb, -6);
  assert.equal(clips[0]!.sampleId, HAT);
  assert.equal(clips[1]!.sampleId, HAT2);
  assert.equal(clips[1]!.pitchSemitones, 7);
  // Hat (120 ms = 0.24 beat) is shorter than the gap → natural length
  assert.equal(clips[0]!.lengthTick, Math.round(0.24 * PPQ));
});

test("errors are aggregated with paths", () => {
  const res = compileScore(
    {
      bpm: 120,
      bars: 4,
      tracks: [
        { clips: [{ sample: "nope-nope", bar: 1 }, { sample: "aaaaaaaa", bar: 1, beat: 5 }] },
      ],
    },
    { samples },
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.errors.length, 2);
    assert.match(res.errors[0]!, /^tracks\[0\]\.clips\[0\]/);
    assert.match(res.errors[1]!, /beat 5 hors mesure/);
  }
});

test("schema errors name the field", () => {
  const res = compileScore(
    { bpm: 120, bars: 4, tracks: [{ fx: { type: "reverb", decay: 3 } }] },
    { samples },
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("\n"), /tracks\[0\]\.fx\.decay/);
});

test("clips past the end are truncated or dropped with warnings", () => {
  const res = compileScore(
    {
      bpm: 120,
      bars: 2,
      tracks: [
        {
          clips: [
            { sample: "cccccccc", bar: 2, beats: 8, loop: true },
            { sample: "aaaaaaaa", bar: 3 },
          ],
        },
      ],
    },
    { samples },
  );
  assert.ok(res.ok);
  assert.equal(res.value.clips.length, 1);
  assert.equal(res.value.clips[0]!.lengthTick, 4 * PPQ);
  assert.ok(res.value.warnings.some((w) => /tronqué/.test(w)));
  assert.ok(res.value.warnings.some((w) => /ignoré/.test(w)));
});

test("fx patches merge onto defaults; sends warn without a space", () => {
  const res = compileScore(
    {
      bpm: 100,
      bars: 4,
      tracks: [
        {
          fx: { type: "echo", delayBeats: 0.75 },
          sendA: 0.4,
          clips: [{ sample: "aaaaaaaa", bar: 1 }],
        },
      ],
    },
    { samples },
  );
  assert.ok(res.ok);
  const fx = res.value.tracks[0]!.fx;
  assert.equal(fx.type, "echo");
  assert.equal(fx.delayBeats, 0.75);
  assert.equal(fx.feedback, 0.35);
  assert.ok(res.value.warnings.some((w) => /spaces\.A/.test(w)));
});

test("automation compiles to ticks and checks track index", () => {
  const ok = compileScore(
    {
      bpm: 120,
      bars: 4,
      tracks: [{ clips: [{ sample: "aaaaaaaa", bar: 1 }] }],
      automation: [
        {
          target: { scope: "track", trackIndex: 0, param: "lpHz" },
          points: [{ bar: 3, value: 20000 }, { bar: 1, value: 400, curve: "exp" }],
        },
      ],
    },
    { samples },
  );
  assert.ok(ok.ok);
  const lane = ok.value.project.automation![0]!;
  assert.deepEqual(lane.points.map((p) => p.tick), [0, 8 * PPQ]);

  const bad = compileScore(
    {
      bpm: 120,
      bars: 4,
      tracks: [{}],
      automation: [
        { target: { scope: "track", trackIndex: 2, param: "pan" }, points: [{ bar: 1, value: 0 }] },
      ],
    },
    { samples },
  );
  assert.equal(bad.ok, false);
});

test("the example in the agent guide compiles", async () => {
  const { describeCapabilities } = await import("./capabilities.js");
  const doc = describeCapabilities();
  const json = /```json\n([\s\S]+?)\n```/.exec(doc)![1]!;
  const ids = ["3f2a9c1e", "a81b77d0", "c0de1234", "c0de9876"];
  const res = compileScore(JSON.parse(json), {
    samples: ids.map((p, i) => ({
      id: `${p}-0000-4000-8000-00000000000${i}`,
      durationMs: 3000,
      loopStartMs: 200,
      loopEndMs: 2800,
    })),
  });
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.value.warnings, []);
});
