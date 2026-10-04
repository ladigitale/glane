import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACK_FX, type Clip, type Project, type Track } from "@glane/core-model";
import { compileScore } from "./compile.js";
import { decompileArrangement } from "./decompile.js";

const KICK = "aaaaaaaa-1111-4111-8111-000000000001";
const PAD = "cccccccc-3333-4333-8333-000000000004";
const samples = [
  { id: KICK, durationMs: 400 },
  { id: PAD, durationMs: 6000, loopStartMs: 500, loopEndMs: 4500 },
];

test("compile → DB rows → decompile round-trips the musical content", () => {
  const score = {
    title: "Test",
    bpm: 96,
    bars: 8,
    spaces: { A: { type: "reverb", decay: 0.7 } },
    tracks: [
      {
        name: "Lit",
        gainDb: -8,
        sendA: 0.3,
        clips: [{ sample: "cccccccc", bar: 1, beats: 32, loop: true }],
      },
      { name: "Kick", patterns: [{ sample: "aaaaaaaa", fromBar: 1, toBar: 2, steps: "X..." }] },
    ],
  };
  const res = compileScore(score, { samples });
  assert.ok(res.ok);
  const v = res.value;
  const now = new Date().toISOString();
  const project: Project = {
    id: "00000000-0000-4000-8000-000000000000",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    title: "Test",
    ...v.project,
  };
  const tracks: Track[] = v.tracks.map((t) => ({
    id: `00000000-0000-4000-8000-00000000001${t.index}`,
    projectId: project.id,
    index: t.index,
    name: t.name,
    gainDb: t.gainDb,
    pan: t.pan,
    mute: t.mute,
    solo: false,
    heightPx: 56,
    fx: t.fx,
    sendA: t.sendA,
    sendB: t.sendB,
  }));
  const clips: Clip[] = v.clips.map((c, i) => {
    const { trackIndex, ...rest } = c;
    return {
      ...rest,
      id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
      sampleVersionId: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`,
      trackId: tracks[trackIndex]!.id,
    };
  });

  const back = decompileArrangement(project, tracks, clips);
  assert.equal(back.tracks.length, 2);
  assert.equal(back.tracks[0]!.gainDb, -8);
  assert.deepEqual(back.spaces?.A, { type: "reverb", decay: 0.7 });
  assert.equal(back.tracks[1]!.clips!.length, 8);
  assert.deepEqual(back.tracks[1]!.clips![1], { sample: "aaaaaaaa", bar: 1, beat: 2, beats: 0.64 });
  assert.equal(back.tracks[0]!.clips![0]!.loop, true);

  // The read-back is itself a valid score.
  const again = compileScore(back, { samples });
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.value.clips.length, v.clips.length);
  assert.equal(DEFAULT_TRACK_FX.type, "none");
});
