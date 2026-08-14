import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichFromLabels } from "./enrich.js";
import { ML_TAG } from "./tags.js";

describe("enrichFromLabels", () => {
  it("merges yamnet tags and preserves non-ml tags", () => {
    const r = enrichFromLabels(
      ["field-raw", "peak-norm", "processing:done", "ml:skipped"],
      [
        { label: "Dog", score: 0.8 },
        { label: "Bark", score: 0.5 },
        { label: "Silence", score: 0.05 },
      ],
    );
    assert.ok(r.tags.includes("field-raw"));
    assert.ok(r.tags.includes(ML_TAG.yamnet));
    assert.ok(r.tags.includes(ML_TAG.done));
    assert.ok(!r.tags.includes(ML_TAG.skipped));
    assert.ok(r.tags.includes("yamnet:dog"));
    assert.ok(r.tags.includes("yamnet:bark"));
    assert.equal(r.subclass, "dog");
    assert.equal(r.classHint, "texture");
  });

  it("keeps Demucs markers when re-enriching", () => {
    const r = enrichFromLabels(
      ["ml:demucs", "stem:drums", "processing:done"],
      [{ label: "Drum", score: 0.7 }],
    );
    assert.ok(r.tags.includes("ml:demucs"));
    assert.ok(r.tags.includes("stem:drums"));
  });
});
