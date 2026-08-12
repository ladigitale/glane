import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cosineSimilarity } from "./similarity.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  });

  it("returns 0 for orthogonal vectors", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  });
});
