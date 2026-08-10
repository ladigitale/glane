# ADR-0017 — Export and publish adapters

## Context

Arrangements need a portable bounce (WAV/MP3) without requiring sync. Artists also want to push takes to independent platforms (SoundCloud, Bandcamp). Bandcamp has no public upload API. The web app runs under COOP/COEP (ADR-0015), so browser→third-party binary uploads often fail CORS/CORP checks.

## Decision

1. **Local bounce first** — `TransportEngine.renderOffline` + client encode (int16 WAV, MP3 via lamejs). Download works offline; no API required.
2. **SoundCloud** — OAuth 2.1 + PKCE on the Glane API; tokens stored on `User`. Track upload is **proxied** same-origin (`POST /api/publish/soundcloud/tracks`) so COEP pages remain able to publish. Direct browser→SoundCloud upload is not used.
3. **Bandcamp** — assisted only: download MP3, copy title, open Bandcamp upload/login. No automated upload.
4. **Adapters** — keep platform glue behind a small front façade (`exportPublish`) and API services so Archive.org / PeerTube / etc. can land later without touching the sequencer UI.
5. **Config** — `SOUNDCLOUD_CLIENT_ID/SECRET/REDIRECT_URI` + `FRONT_URL`. Missing credentials → status `available: false` and assisted SoundCloud link.
6. **Auth** — linking SoundCloud requires a Glane JWT. Bounce/download never does.

## Consequences

- SoundCloud app registration (often approval-gated) is an ops prerequisite.
- Tokens are plaintext on `User` in this POC; encrypt at rest before production.
- Large mixes transit the API once (proxy); raise PHP upload limits if needed.
- Editor/library sample export stays out of scope for this ADR.
