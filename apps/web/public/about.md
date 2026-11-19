# About Glane

Glane is a web instrument for capturing, segmenting and arranging ambient sounds. Its name comes from *glaner* — to glean: you walk, record the field, keep the fragments worth keeping, and turn them into music.

## What it does

- **Capture** live (microphone) or from files; Glane isolates interesting fragments.
- **Library** of your own sounds with on-device analysis (sound classes and tags, pitch, loudness, loops, stem separation).
- **Synth** to invent textures and motifs from your references.
- **Arrange** on a 6-track sequencer with FX, then export or share an unlisted listen link.
- **Claude connector** (MCP) so an AI agent can compose from your library in the open tab.

## Principles

- **Local-first** — audio, analyses and arrangements stay in your browser (IndexedDB / OPFS) until you export or publish.
- **No marketplace** — nothing is listed publicly; listen links are unlisted.
- **Open source** — MIT license, © 2026 ladigitale.

## Who

Glane is published by **ladigitale** and developed in the open: <https://github.com/ladigitale/glane>. It is hosted alongside its sister app Tadaaa on `tadaaa.space`.

## Built with

Lit web components and `@supersoniks/concorde` for the interface, Web Audio for the engine, in-browser ML (YAMNet tags, Demucs stems, CLAP search), and a Symfony / API Platform API for accounts and listen links.

See also: [Contact](https://glane.tadaaa.space/contact.md) · [Privacy](https://glane.tadaaa.space/privacy.md) · [Pricing](https://glane.tadaaa.space/pricing.md)
