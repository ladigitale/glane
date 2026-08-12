import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapLabelToClass,
  pickClassHint,
  slugifyLabel,
  yamnetTag,
} from "./map.js";

describe("yamnet map", () => {
  it("slugifies labels", () => {
    assert.equal(slugifyLabel("Dog, bark"), "dog-bark");
    assert.equal(yamnetTag("Speech"), "yamnet:speech");
  });

  it("maps speech and percussion", () => {
    assert.equal(mapLabelToClass("Speech"), "voice");
    assert.equal(mapLabelToClass("Knock"), "percussive");
    assert.equal(mapLabelToClass("Rain"), "texture");
    assert.equal(mapLabelToClass("Traffic noise"), "noise");
  });

  it("picks class hint from ranked labels", () => {
    const hint = pickClassHint([
      { label: "Silence", score: 0.4 },
      { label: "Dog", score: 0.35 },
    ]);
    assert.ok(hint);
    assert.equal(hint!.class, "noise");
  });
});
