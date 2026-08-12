import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankByVector } from "./rank.js";

describe("rankByVector", () => {
  it("orders by similarity", () => {
    const q = [1, 0, 0];
    const ranked = rankByVector(q, [
      { id: "a", vector: [0.9, 0.1, 0] },
      { id: "b", vector: [0, 1, 0] },
      { id: "c", vector: [1, 0, 0] },
    ]);
    assert.equal(ranked[0]?.id, "c");
    assert.equal(ranked[1]?.id, "a");
    assert.equal(ranked[2]?.id, "b");
  });

  it("filters minScore", () => {
    const ranked = rankByVector([1, 0], [{ id: "x", vector: [0, 1] }], {
      minScore: 0.5,
    });
    assert.equal(ranked.length, 0);
  });
});
