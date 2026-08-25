import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensemble,
  extractSharedOnsets,
  type EnsembleHit,
} from "./generative-ensemble.js";
import { mulberry32 } from "./generative.js";

describe("planEnsemble", () => {
  it("does not leave arp independent when callResponse is on with lead+arp", () => {
    const rnd = mulberry32(42);
    const plan = ensemble.plan({
      roles: ["kick", "lead", "arp", "bass"],
      rnd,
      callResponseMode: "on",
      energy: 0.6,
      sparse: false,
      musicStyle: "pop",
    });
    const arpIdx = 2;
    assert.notEqual(plan.relationByTrack[arpIdx], "independent");
    assert.equal(plan.primaryLeadTrack, 1);
    assert.ok(plan.leadCell && plan.leadCell.length > 0);
    assert.ok(plan.responseCell && plan.responseCell.length > 0);
    assert.ok(plan.sharedOnsets.length > 0);
    assert.equal(plan.styleProfile.family, "popRock");
  });

  it("assigns lock or kinship to bass/chord followers", () => {
    const rnd = mulberry32(7);
    const plan = ensemble.plan({
      roles: ["lead", "bass", "chord"],
      rnd,
      callResponseMode: "off",
      energy: 0.5,
      sparse: false,
      musicStyle: "folk",
    });
    assert.equal(plan.relationByTrack[0], "independent");
    for (const i of [1, 2]) {
      const r = plan.relationByTrack[i]!;
      assert.ok(r === "lock" || r === "kinship" || r === "respond");
    }
  });

  it("electronic style favors lock over respond on auto", () => {
    let locks = 0;
    for (let seed = 0; seed < 30; seed++) {
      const rnd = mulberry32(seed);
      const plan = ensemble.plan({
        roles: ["lead", "arp", "bass"],
        rnd,
        callResponseMode: "off",
        energy: 0.7,
        sparse: false,
        musicStyle: "techno",
      });
      if (plan.relationByTrack.some((r) => r === "lock")) locks += 1;
    }
    assert.ok(locks > 15);
  });
});

describe("applyLock", () => {
  it("keeps follower onsets on the shared skeleton", () => {
    const cell = [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
      { degree: 4, sixteenths: 4, accent: true },
      { degree: 0, sixteenths: 4 },
    ] as const;
    const shared = extractSharedOnsets(cell);
    const ppq = 96;
    const beatsPerBar = 4;
    const ticksPer16 = ppq / 4;
    // Scatter hits: some on skeleton, some off
    const hits: EnsembleHit[] = [
      { tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 },
      { tickInBar: Math.round(2 * ticksPer16), gainDb: -1, accent: false },
      { tickInBar: Math.round(4 * ticksPer16), gainDb: -1, accent: false },
      { tickInBar: Math.round(8 * ticksPer16), gainDb: 0, accent: true },
      { tickInBar: Math.round(10 * ticksPer16), gainDb: -2, accent: false },
    ];
    const locked = ensemble.applyLock(hits, shared, beatsPerBar, ppq);
    const tol = Math.max(2, Math.floor(ppq / 8));
    const skeleton = shared.map((s) => Math.round(s * ticksPer16));
    for (const h of locked) {
      const ok = skeleton.some((t) => Math.abs(h.tickInBar - t) <= tol);
      assert.ok(ok, `tick ${h.tickInBar} not near skeleton ${skeleton}`);
    }
  });

  it("injects melodyDegree so lock offsets apply to bass/chord motifs", () => {
    const shared = [0, 8];
    const hits: EnsembleHit[] = [
      { tickInBar: 0, gainDb: 0, accent: true },
      { tickInBar: 192, gainDb: -1, accent: true },
    ];
    const locked = ensemble.applyLock(hits, shared, 4, 96, 2);
    assert.ok(locked.length > 0);
    for (const h of locked) {
      assert.equal(h.melodyDegree, 2);
    }
  });
});

describe("applyRespond", () => {
  it("places response density on the second half-bar", () => {
    const response = [
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 0, sixteenths: 4, accent: true },
    ] as const;
    const ppq = 96;
    const beatsPerBar = 4;
    const half = Math.floor((beatsPerBar * ppq) / 2);
    const hits = ensemble.applyRespond(response, beatsPerBar, ppq);
    assert.ok(hits.length > 0);
    const firstHalf = hits.filter((h) => h.tickInBar < half).length;
    const secondHalf = hits.filter((h) => h.tickInBar >= half).length;
    assert.equal(firstHalf, 0);
    assert.ok(secondHalf > 0);
  });

  it("places full-bar response for alternate-bar verse dialogue", () => {
    const response = [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
    ] as const;
    const hits = ensemble.applyRespondFullBar(response, 4, 96);
    assert.ok(hits.some((h) => h.tickInBar === 0));
    assert.ok(hits.every((h) => h.tickInBar < 384));
  });
});

describe("resolveSectionRelation", () => {
  it("biases chorus kinship toward lock for electronic", () => {
    const profile = ensemble.ensembleProfileForStyle("techno");
    const rnd = mulberry32(99);
    let locks = 0;
    for (let i = 0; i < 40; i++) {
      const r = ensemble.resolveSectionRelation(
        "kinship",
        "chorus",
        "arp",
        rnd,
        profile,
      );
      if (r === "lock") locks += 1;
    }
    assert.ok(locks > 15);
  });

  it("softens bridge lock to kinship", () => {
    const profile = ensemble.ensembleProfileForStyle("pop");
    assert.equal(
      ensemble.resolveSectionRelation(
        "lock",
        "bridge",
        "bass",
        () => 0.5,
        profile,
      ),
      "kinship",
    );
  });

  it("jazz uses alternate bars in chorus", () => {
    const profile = ensemble.ensembleProfileForStyle("jazz");
    assert.equal(
      ensemble.respondPlacementMode("chorus", profile),
      "alternateBars",
    );
    assert.equal(
      ensemble.respondPlacementMode("prechorus", profile),
      "halfBar",
    );
  });
});

describe("shouldCoupleArp", () => {
  it("skips kinship coupling for jazz", () => {
    const profile = ensemble.ensembleProfileForStyle("jazz");
    assert.equal(ensemble.shouldCoupleArp("lock", profile), true);
    assert.equal(ensemble.shouldCoupleArp("kinship", profile), false);
  });
});

describe("melodyCellToArpCell", () => {
  it("keeps rhythm and snaps degrees to chord tones", () => {
    const cell = [
      { degree: 1, sixteenths: 4, accent: true },
      { degree: 5, sixteenths: 4 },
    ] as const;
    const arp = ensemble.melodyCellToArpCell(cell);
    assert.equal(arp.length, 2);
    assert.equal(arp[0]!.sixteenths, 4);
    assert.ok([0, 2, 4, 6, 7].includes(arp[0]!.degree!));
  });
});

describe("lockDegreeOffset", () => {
  it("keeps bass on root", () => {
    assert.equal(ensemble.lockDegreeOffset("bass", () => 0.9), 0);
  });
});
