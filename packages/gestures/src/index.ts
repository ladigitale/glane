export type GestureKind =
  | "move"
  | "trim"
  | "slip"
  | "scroll"
  | "zoom"
  | "longpress"
  | "tap"
  | "cancel";

export type GestureState =
  | { status: "idle" }
  | {
      status: "pending";
      pointerId: number;
      x0: number;
      y0: number;
      t0: number;
      target: "clip" | "handle" | "background" | "ruler";
    }
  | {
      status: "resolved";
      kind: GestureKind;
      pointerId: number;
      x: number;
      y: number;
    };

export type PointerSample = {
  /** `hold` = timer tick while pointer still down (longpress without release). */
  type: "down" | "move" | "up" | "cancel" | "hold";
  pointerId: number;
  x: number;
  y: number;
  t: number;
  target: "clip" | "handle" | "background" | "ruler";
  pointerCount?: number;
};

export const MOVE_THRESHOLD_PX = 8;
export const LONGPRESS_MS = 350;

/**
 * Sequencer / editor pointer FSM (spec §11.5).
 * idle → pending → resolved(kind)
 */
export class GestureFsm {
  state: GestureState = { status: "idle" };

  reset(): void {
    this.state = { status: "idle" };
  }

  push(ev: PointerSample): GestureState {
    if (ev.type === "cancel") {
      this.state = {
        status: "resolved",
        kind: "cancel",
        pointerId: ev.pointerId,
        x: ev.x,
        y: ev.y,
      };
      return this.state;
    }

    if (this.state.status === "idle" && ev.type === "down") {
      this.state = {
        status: "pending",
        pointerId: ev.pointerId,
        x0: ev.x,
        y0: ev.y,
        t0: ev.t,
        target: ev.target,
      };
      return this.state;
    }

    if (this.state.status === "pending" && ev.pointerId === this.state.pointerId) {
      const dx = ev.x - this.state.x0;
      const dy = ev.y - this.state.y0;
      const dist = Math.hypot(dx, dy);
      const dt = ev.t - this.state.t0;

      // Second finger → pinch zoom (call sites track distance; FSM only locks kind).
      if ((ev.pointerCount ?? 1) >= 2) {
        this.state = {
          status: "resolved",
          kind: "zoom",
          pointerId: ev.pointerId,
          x: ev.x,
          y: ev.y,
        };
        return this.state;
      }

      if (ev.type === "move" && dist >= MOVE_THRESHOLD_PX) {
        let kind: GestureKind = "scroll";
        if (this.state.target === "clip") kind = "move";
        if (this.state.target === "handle") kind = "trim";
        // AudioRoom: empty lane — horizontal pan, vertical zoom.
        if (this.state.target === "background" || this.state.target === "ruler") {
          kind = Math.abs(dx) > Math.abs(dy) ? "scroll" : "zoom";
        }
        this.state = {
          status: "resolved",
          kind,
          pointerId: ev.pointerId,
          x: ev.x,
          y: ev.y,
        };
        return this.state;
      }

      // Hold still long enough → longpress before release (timer or late move).
      if (
        (ev.type === "hold" || ev.type === "move") &&
        dt >= LONGPRESS_MS &&
        dist < MOVE_THRESHOLD_PX
      ) {
        this.state = {
          status: "resolved",
          kind: "longpress",
          pointerId: ev.pointerId,
          x: ev.x,
          y: ev.y,
        };
        return this.state;
      }

      if (ev.type === "up") {
        const kind: GestureKind =
          dt >= LONGPRESS_MS && dist < MOVE_THRESHOLD_PX
            ? "longpress"
            : "tap";
        this.state = {
          status: "resolved",
          kind,
          pointerId: ev.pointerId,
          x: ev.x,
          y: ev.y,
        };
        return this.state;
      }
    }

    if (this.state.status === "resolved" && ev.type === "up") {
      this.state = { status: "idle" };
    }

    return this.state;
  }
}

export * from "./snap.js";
export * from "./zoom.js";
