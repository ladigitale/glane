import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLayerMatrix } from "./arrangement.js";
import { compose } from "./compose.js";
import type { ComposeSettings } from "./types.js";

function settings(partial?: Partial<ComposeSettings>): ComposeSettings {
  return {
    seed: 11,
    style: "ambient",
    targetBars: 32,
    formFamily: "verse-chorus",
    energyShape: "arch",
    energy: 0.55,
    density: 0.5,
    drumsVsTexture: 0.45,
    variation: 0.3,
    life: 0.2,
    space: 0.4,
    swing: 0,
    humanize: 0.1,
    keyPc: 0,
    mode: "aeolian",
    tuningRef: "440",
    targetLufs: -14,
    trackRoles: [
      "kick",
      "hat",
      "bass",
      "chord",
      "texture",
      "loop",
    ],
    ...partial,
  };
}

describe("layer matrix intro/outro", () => {
  it("keeps beds + hat on intro; beds + kick on outro", () => {
    const roles = [
      "kick",
      "snare",
      "hat",
      "bass",
      "chord",
      "texture",
    ] as const;
    const sections = [
      {
        id: "i0",
        kind: "intro" as const,
        startBar: 0,
        bars: 4 as const,
        phrase: "loop" as const,
        energy: 0.3,
        occurrence: 0,
        region: 0,
      },
      {
        id: "v0",
        kind: "verse" as const,
        startBar: 4,
        bars: 8 as const,
        phrase: "period" as const,
        energy: 0.5,
        occurrence: 0,
        region: 0,
      },
      {
        id: "o0",
        kind: "outro" as const,
        startBar: 12,
        bars: 4 as const,
        phrase: "loop" as const,
        energy: 0.32,
        occurrence: 0,
        region: 0,
      },
    ];
    const m = buildLayerMatrix({
      trackRoles: [...roles],
      sections,
      drumsVsTexture: 0.5,
    });
    const idx = (r: (typeof roles)[number]) => roles.indexOf(r);
    assert.equal(m[idx("texture")]![0], true);
    assert.equal(m[idx("chord")]![0], true);
    assert.equal(m[idx("hat")]![0], true);
    assert.equal(m[idx("bass")]![0], true); // 4-bar intro
    assert.equal(m[idx("kick")]![0], true); // ≥2 bars
    assert.equal(m[idx("snare")]![0], false);
    assert.equal(m[idx("texture")]![2], true);
    assert.equal(m[idx("kick")]![2], true);
    assert.equal(m[idx("snare")]![2], false);
  });

  it("keeps hat on break; mutes kick/snare", () => {
    const roles = ["kick", "snare", "hat", "bass", "lead"] as const;
    const sections = [
      {
        id: "b0",
        kind: "break" as const,
        startBar: 0,
        bars: 4 as const,
        phrase: "loop" as const,
        energy: 0.5,
        occurrence: 0,
        region: 0,
      },
    ];
    const m = buildLayerMatrix({
      trackRoles: [...roles],
      sections,
      drumsVsTexture: 0.55,
    });
    const idx = (r: (typeof roles)[number]) => roles.indexOf(r);
    assert.equal(m[idx("hat")]![0], true);
    assert.equal(m[idx("kick")]![0], false);
    assert.equal(m[idx("snare")]![0], false);
    assert.equal(m[idx("bass")]![0], true);
    assert.equal(m[idx("lead")]![0], true); // energy 0.5 ≥ lead thr 0.32
  });
});

describe("compose fills beds", () => {
  it("emits texture/loop events covering intro and outro", () => {
    const { score } = compose(settings());
    const texture = score.parts.find((p) => p.role === "texture");
    assert.ok(texture && texture.events.length > 0);
    const intro = score.sections.find((s) => s.kind === "intro");
    const outro = score.sections.find((s) => s.kind === "outro");
    assert.ok(intro && outro);
    const tpb = 960 * 4;
    const inIntro = texture!.events.some(
      (e) =>
        e.tick >= intro!.startBar * tpb &&
        e.tick < (intro!.startBar + intro!.bars) * tpb,
    );
    const inOutro = texture!.events.some(
      (e) =>
        e.tick >= outro!.startBar * tpb &&
        e.tick < (outro!.startBar + outro!.bars) * tpb,
    );
    assert.equal(inIntro, true);
    assert.equal(inOutro, true);
  });
});
