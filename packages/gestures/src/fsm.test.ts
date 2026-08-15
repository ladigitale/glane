import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GestureFsm } from "./index.ts";

describe("GestureFsm", () => {
  it("resolves tap on quick up", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 10,
      y: 10,
      t: 0,
      target: "clip",
    });
    const s = fsm.push({
      type: "up",
      pointerId: 1,
      x: 12,
      y: 11,
      t: 100,
      target: "clip",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "tap");
  });

  it("resolves longpress", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 10,
      y: 10,
      t: 0,
      target: "clip",
    });
    const s = fsm.push({
      type: "up",
      pointerId: 1,
      x: 10,
      y: 10,
      t: 400,
      target: "clip",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "longpress");
  });

  it("resolves longpress on hold without release", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 10,
      y: 10,
      t: 0,
      target: "clip",
    });
    const s = fsm.push({
      type: "hold",
      pointerId: 1,
      x: 11,
      y: 10,
      t: 400,
      target: "clip",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "longpress");
  });

  it("does not longpress on hold after move", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 0,
      y: 0,
      t: 0,
      target: "clip",
    });
    fsm.push({
      type: "move",
      pointerId: 1,
      x: 20,
      y: 0,
      t: 50,
      target: "clip",
    });
    const s = fsm.push({
      type: "hold",
      pointerId: 1,
      x: 20,
      y: 0,
      t: 400,
      target: "clip",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "move");
  });

  it("resolves move after threshold", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 0,
      y: 0,
      t: 0,
      target: "clip",
    });
    const s = fsm.push({
      type: "move",
      pointerId: 1,
      x: 20,
      y: 0,
      t: 50,
      target: "clip",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "move");
  });

  it("resolves background vertical as zoom", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 0,
      y: 0,
      t: 0,
      target: "background",
    });
    const s = fsm.push({
      type: "move",
      pointerId: 1,
      x: 2,
      y: 30,
      t: 50,
      target: "background",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "zoom");
  });

  it("resolves background horizontal as scroll", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 0,
      y: 0,
      t: 0,
      target: "background",
    });
    const s = fsm.push({
      type: "move",
      pointerId: 1,
      x: 30,
      y: 2,
      t: 50,
      target: "background",
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "scroll");
  });

  it("resolves two-finger as zoom", () => {
    const fsm = new GestureFsm();
    fsm.push({
      type: "down",
      pointerId: 1,
      x: 0,
      y: 0,
      t: 0,
      target: "background",
    });
    const s = fsm.push({
      type: "move",
      pointerId: 1,
      x: 4,
      y: 0,
      t: 30,
      target: "background",
      pointerCount: 2,
    });
    assert.equal(s.status, "resolved");
    if (s.status === "resolved") assert.equal(s.kind, "zoom");
  });
});
