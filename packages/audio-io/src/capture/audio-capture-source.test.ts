import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureTrackWarnings,
  fieldCaptureAttempts,
} from "./audio-capture-source.js";

describe("fieldCaptureAttempts", () => {
  it("exact_processing_off_before_soft_when_no_device", () => {
    const attempts = fieldCaptureAttempts();
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0]?.echoCancellation, { exact: false });
    assert.deepEqual(attempts[0]?.autoGainControl, { exact: false });
    assert.equal(attempts[0]?.deviceId, undefined);
    assert.equal(attempts[1]?.echoCancellation, false);
    assert.equal(attempts[1]?.autoGainControl, false);
  });

  it("selected_device_is_exact_not_ideal_on_first_attempts", () => {
    const attempts = fieldCaptureAttempts("usb-rec-1");
    assert.equal(attempts.length, 3);
    assert.deepEqual(attempts[0]?.deviceId, { exact: "usb-rec-1" });
    assert.deepEqual(attempts[1]?.deviceId, { exact: "usb-rec-1" });
    assert.deepEqual(attempts[2]?.deviceId, { ideal: "usb-rec-1" });
    assert.equal(attempts[1]?.echoCancellation, false);
    assert.equal(attempts[2]?.echoCancellation, false);
  });

  it("blank_deviceId_omits_device_constraint", () => {
    const attempts = fieldCaptureAttempts("  ");
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.deviceId, undefined);
  });
});

describe("captureTrackWarnings", () => {
  it("silent_when_voice_pipeline_off", () => {
    assert.deepEqual(
      captureTrackWarnings({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }),
      [],
    );
  });

  it("warns_when_agc_still_on", () => {
    const w = captureTrackWarnings({ autoGainControl: true });
    assert.equal(w.length, 1);
    assert.match(w[0]!, /AGC/);
  });

  it("warns_when_selected_device_not_retained", () => {
    const w = captureTrackWarnings(
      { deviceId: "builtin-mic" },
      "usb-rec-1",
    );
    assert.equal(w.length, 1);
    assert.match(w[0]!, /source sélectionnée/);
  });

  it("no_device_warning_when_settings_omit_deviceId", () => {
    assert.deepEqual(captureTrackWarnings({}, "usb-rec-1"), []);
  });
});
