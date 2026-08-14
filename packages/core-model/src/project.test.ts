import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeProject, type Project } from "./schemas.js";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "t",
  bpm: 120,
  timeSignature: [4, 4] as [number, number],
  bars: 16,
  revision: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("normalizeProject", () => {
  it("fills missing preamp and non-finite master", () => {
    const n = normalizeProject({
      ...base,
      masterGainDb: Number.NaN,
    } as Project);
    assert.equal(n.masterGainDb, 0);
    assert.equal(n.preampGainDb, 0);
  });

  it("keeps finite mix values", () => {
    const n = normalizeProject({
      ...base,
      masterGainDb: -3,
      preampGainDb: 2,
    });
    assert.equal(n.masterGainDb, -3);
    assert.equal(n.preampGainDb, 2);
  });
});
