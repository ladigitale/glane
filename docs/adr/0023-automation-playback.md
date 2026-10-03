# ADR-0023 — Automation playback (minimal)

## Context

`@glane/composer` emits `AutomationLane[]` (gestures, LFO). The transport had no way to play them; Life / builds stayed silent over time.

## Decision

1. **core-model** — optional `Project.automation` (`AutomationLaneSchema`), normalized on load.
2. **audio-engine** — `TransportEngine.setAutomation` schedules track `gainDb` (offset), `hpHz`, `lpHz`, `pan`, `sendA`/`sendB`, and master `gainDb` (absolute) via AudioParam ramps in the same lookahead loop as clips.
3. **Send buses** — `setSendSpaces` + per-track `sendA`/`sendB` post-fader into shared returns (composer `SpacePlan`).
4. **Still out of scope** — clip-level pan/lp, UI automation lanes, limiter stage.

## Consequences

Generate stores lanes + spaces on the project; play/seek re-arms ramps and send returns.
