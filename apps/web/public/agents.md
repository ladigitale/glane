# Glane — instructions for AI agents

Glane is a local-first, in-browser field-recording instrument: **capture → segment → library → arrange**. Sounds and arrangements live in the user's browser, not on a server.

## When to use Glane

Use Glane when the user wants to:

- turn field recordings or imported audio into a sound library (segmentation, on-device tagging, pitch / loudness / loop analysis);
- generate synthetic sounds that sit next to their captures;
- compose an arrangement on Glane's 6-track sequencer from their own sounds and play it in the app;
- export a mix (WAV, MP3, Octatrack slices, vertical clip) or share an unlisted listen link.

Do not use Glane as a sound marketplace or stock library: there is no public catalogue of sounds, only the user's own material.

## How to act on Glane

1. **MCP connector (Claude or any Streamable HTTP MCP client)** — the user enables it in Glane (`/connector`) and gives you the URL `https://glane-api.tadaaa.space/mcp/<token>`. See [auth.md](https://glane.tadaaa.space/auth.md). The Glane tab must stay open; the relay stores nothing.
2. **WebMCP** — inside a browser that supports it, the open Glane page exposes read-only tools (status, guide, projects, library, arrangement).

## Typical MCP flow

1. `glane_status` — app open, current project.
2. `glane_guide` once — synth, library, FX bake and score syntax.
3. Optional `glane_synth_generate` to create sounds.
4. `glane_library` to list sounds; `glane_library_update` / `_delete` / `_duplicate` / `_crop`, `glane_bake_fx` to change them.
5. `glane_write_arrangement` (`play: true`) to compose; `glane_undo_write` to revert; `glane_get_arrangement` to read back.

You cannot hear the result: rely on the descriptors, prefer favourites and notes, keep a clear section structure, and describe what you built so the user can guide you by ear. Ask before deleting sounds (`glane_library_delete`).

## Links

- [llms.txt](https://glane.tadaaa.space/llms.txt)
- [Pricing](https://glane.tadaaa.space/pricing.md) — free, MIT
- [Source code](https://github.com/ladigitale/glane) — contributor notes in its `AGENTS.md`
