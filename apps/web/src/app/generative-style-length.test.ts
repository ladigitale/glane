import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mulberry32, planSongForm } from "./generative.js";
import { ensemble } from "./generative-ensemble.js";
import {
  MUSIC_STYLE_IDS,
  MUSIC_STYLE_PROFILES,
  approxDurationSec,
  styleSuggestedTempoBars,
} from "./generative-styles.js";

describe("style ideal length vs form / ensemble", () => {
  it("suggested ideals land in a listenable wall-clock window", () => {
    for (const id of MUSIC_STYLE_IDS) {
      const { bpm, bars } = styleSuggestedTempoBars(id);
      const sec = approxDurationSec(bpm, bars);
      // Punk stays shorter; ambient can stretch; others ~1.5–4 min
      if (id === "punk") {
        assert.ok(sec >= 45 && sec <= 150, `${id} ${sec}s`);
      } else if (id === "ambient" || id === "dub" || id === "triphop") {
        assert.ok(sec >= 120 && sec <= 600, `${id} ${sec}s`);
      } else {
        assert.ok(sec >= 90 && sec <= 280, `${id} ${sec}s`);
      }
    }
  });

  it("ideal bar counts give verse/chorus room for dialogue", () => {
    for (const id of ["techno", "jazz", "folk", "dnb", "ambient"] as const) {
      const { bars } = styleSuggestedTempoBars(id);
      const formLean = MUSIC_STYLE_PROFILES[id].formLean;
      const sections = planSongForm(bars, mulberry32(11), {
        formStyle: formLean === "ambient" ? "ambient" : "song",
        formLean,
        energy: 0.6,
        drumsVsTexture: 0.55,
      });
      const total = sections.reduce((s, sec) => s + sec.bars, 0);
      assert.equal(total, bars);
      const verse = sections.filter((s) => s.kind === "verse");
      const chorus = sections.filter((s) => s.kind === "chorus");
      assert.ok(verse.length >= 1, `${id} needs verse`);
      assert.ok(chorus.length >= 1, `${id} needs chorus`);
      // Alternate-bar call–response needs ≥4 bars on a dialogue section
      const dialogue = [...verse, ...chorus];
      assert.ok(
        dialogue.some((s) => s.bars >= 4),
        `${id} needs a ≥4-bar verse/chorus for arrangement`,
      );
      assert.ok(sections.length >= 4, `${id} too few sections`);
    }
  });

  it("long song form keeps followers related at ideal length", () => {
    const { bars } = styleSuggestedTempoBars("techno");
    const rnd = mulberry32(42);
    const plan = ensemble.plan({
      roles: ["kick", "lead", "arp", "bass", "chord"],
      rnd,
      callResponseMode: "auto",
      energy: 0.7,
      sparse: false,
      musicStyle: "techno",
    });
    assert.ok(plan.primaryLeadTrack != null);
    const followers = plan.relationByTrack.filter(
      (r, i) => i !== plan.primaryLeadTrack && r !== "independent",
    );
    assert.ok(followers.length >= 2);
    // Sanity: form at this length is the long-song branch
    assert.ok(bars > 48);
    const sections = planSongForm(bars, mulberry32(3), {
      formStyle: "song",
      energy: 0.7,
    });
    assert.ok(sections.some((s) => s.kind === "bridge"));
    assert.ok(sections.filter((s) => s.kind === "chorus").length >= 2);
  });
});
