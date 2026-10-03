import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoParamUnits } from "./automation.js";

describe("send bus automation units", () => {
  it("clamps sendA/sendB to 0…1", () => {
    assert.equal(autoParamUnits("sendA", 0.4), 0.4);
    assert.equal(autoParamUnits("sendB", -1), 0);
    assert.equal(autoParamUnits("sendA", 2), 1);
  });
});
