#!/usr/bin/env node
/**
 * lamejs@1.2.1 ships modular sources missing requires (MPEGMode / Lame / BitStream).
 * Vite ESM then throws ReferenceError: MPEGMode is not defined.
 * @see https://github.com/zhuker/lamejs/issues/86
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let root;
try {
  root = dirname(require.resolve("lamejs/package.json"));
} catch {
  process.exit(0);
}

/** @type {{ file: string; needle: string; insert: string }[]} */
const patches = [
  {
    file: "src/js/Lame.js",
    needle: "var Encoder = require('./Encoder.js');\n\nfunction Lame()",
    insert:
      "var Encoder = require('./Encoder.js');\nvar MPEGMode = require('./MPEGMode.js');\n\nfunction Lame()",
  },
  {
    file: "src/js/Encoder.js",
    needle:
      "var III_psy_ratio = require('./III_psy_ratio.js');\n\n    var FFTOFFSET",
    insert:
      "var III_psy_ratio = require('./III_psy_ratio.js');\n    var MPEGMode = require('./MPEGMode.js');\n\n    var FFTOFFSET",
  },
  {
    file: "src/js/PsyModel.js",
    needle: 'var Encoder = require("./Encoder.js");\n\nfunction PsyModel()',
    insert:
      'var Encoder = require("./Encoder.js");\nvar MPEGMode = require("./MPEGMode.js");\n\nfunction PsyModel()',
  },
  {
    file: "src/js/BitStream.js",
    needle:
      "var LameInternalFlags = require('./LameInternalFlags.js');\n\nBitStream.EQ",
    insert:
      "var LameInternalFlags = require('./LameInternalFlags.js');\nvar Lame = require('./Lame.js');\n\nBitStream.EQ",
  },
  {
    file: "src/js/Presets.js",
    needle: "var assert = common.assert;\n\nfunction Presets()",
    insert:
      "var assert = common.assert;\nvar Lame = require('./Lame.js');\n\nfunction Presets()",
  },
  {
    file: "src/js/QuantizePVT.js",
    needle: "function QuantizePVT() {\n\n    var tak = null;",
    insert:
      "var BitStream = require('./BitStream.js');\n\nfunction QuantizePVT() {\n\n    var tak = null;",
  },
];

let changed = 0;
for (const p of patches) {
  const path = join(root, p.file);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, "utf8");
  if (src.includes(p.insert) || !src.includes(p.needle)) continue;
  writeFileSync(path, src.replace(p.needle, p.insert));
  changed++;
}

if (changed > 0) {
  console.log(`patched lamejs (${changed} file(s)) for Vite MPEGMode fix`);
}
