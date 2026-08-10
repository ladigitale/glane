# ADR-0007 — Auth and Tadaaa sister SSO

## Context

Sibling of Tadaaa; Belts uses JWT handoff.

## Decision

Glane JWT (Lexik) for own API in P5. No custom refresh in v1 unless measured need. Tadaaa handoff after Glane auth is stable. Same-origin cookie session only if PWA is served same-site as API.

## Consequences

P0–P4 need no login. Handoff is a separate commit post-P5 auth.
