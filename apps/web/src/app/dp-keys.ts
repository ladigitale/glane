import { DataProviderKey } from "@supersoniks/concorde/dataProviderKey";
import type { SampleClass } from "@glane/core-model";
import type { UserPrefs } from "./db.js";

/**
 * Form roots used as `formDataProvider` must be a single PublisherManager id
 * (no `.`). FormCheckable does `PublisherManager.get(formDataProvider)` with the
 * full string; `set` / `@subscribe` / `@handle` split on `.` and would otherwise
 * bind a different tree (e.g. root `gl` + nested `editorForm`).
 */

/** Project picker in the app header. */
export const projectPickKey = new DataProviderKey<{ projectId: string }>(
  "gl.projectPick",
);

/** Command palette filter. */
export const paletteKey = new DataProviderKey<{ q: string }>("glPalette");

/** Privacy / prefs form (synced to IndexedDB via @handle). */
export type PrefsForm = {
  voicePolicy: UserPrefs["voicePolicy"];
  syncPolicy: UserPrefs["syncPolicy"];
  /** FormCheckable unique switch: `"1"` when on, `null` when off. */
  wifiOnly: "1" | null;
  locale: UserPrefs["locale"];
};

export const prefsFormKey = new DataProviderKey<PrefsForm>("glPrefsForm");

/** Library toolbar filters (also `dataFilterProvider` for sonic-queue). */
export type LibraryFilters = {
  classFilter: SampleClass | "all";
  sessionFilter: string;
  /** Exact tag matches (OR); empty = all. */
  tagFilter: string[];
  q: string;
  /**
   * `"1"` when a CLAP ordered list is active (`setSampleListOrder`).
   * Sent as query param so sonic-queue refreshes; API reads module order.
   */
  semantic: "" | "1";
};

export const libraryFiltersKey = new DataProviderKey<LibraryFilters>(
  "glLibraryFilters",
);

/** sonic-queue publisher — `lastFetchedData.total` = filtered count. */
export type LibraryQueueDp = {
  resultCount?: number;
  lastFetchedData?: {
    total?: number;
    meta?: { total?: number };
  };
};

export const libraryQueueKey = new DataProviderKey<LibraryQueueDp>(
  "glLibraryQueue",
);

/** Capture session feed filter for sonic-queue. */
export type CaptureFeedFilters = {
  projectId: string;
  sessionId: string;
  /** Bump to refresh the queue after a new extraction (API ignores). */
  bump: string;
};

export const captureFeedKey = new DataProviderKey<CaptureFeedFilters>(
  "glCaptureFeed",
);

export type CaptureQueueDp = {
  resultCount?: number;
  lastFetchedData?: {
    total?: number;
    meta?: { total?: number };
  };
};

export const captureQueueKey = new DataProviderKey<CaptureQueueDp>(
  "glCaptureQueue",
);

/** Capture session naming + toggles. */
export type CaptureForm = {
  captureName: string;
  autoGain: "1" | null;
};

export const captureFormKey = new DataProviderKey<CaptureForm>("glCaptureForm");

/** Editor rename. */
export type EditorForm = {
  name: string;
};

export const editorFormKey = new DataProviderKey<EditorForm>("glEditorForm");

/** Sequencer export panel. */
export type ExportForm = {
  title: string;
  sharing: "private" | "public";
  /** Reel bichromy — background. */
  reelBg: string;
  /** Reel bichromy — accent / waveform. */
  reelAccent: string;
  /** Reel visual scenes to include (FormCheckable multi). */
  reelScenes: string[];
};

export const exportFormKey = new DataProviderKey<ExportForm>("glExportForm");

/** Account login / register. */
export type AccountForm = {
  username: string;
  password: string;
};

export const accountFormKey = new DataProviderKey<AccountForm>("glAccountForm");

/** Synth generator — mode / coherence / qty (FormCheckable). */
export type SynthForm = {
  mode: "variations" | "family" | "song";
  freeFmRatios: "1" | null;
  coherence: "parametric" | "musical";
  globalQty: string;
  openCardId: string;
};

export const synthFormKey = new DataProviderKey<SynthForm>("glSynthForm");

/** Synth open role — engines + machine toggles (FormCheckable). */
export type SynthRoleForm = {
  engines: string[];
  engineUi: "1" | null;
  quantity: string;
  randomness: string;
};

export const synthRoleFormKey = new DataProviderKey<SynthRoleForm>(
  "glSynthRoleForm",
);

/** Synth validate — selected draft indices (FormCheckable multi). */
export type SynthValidateForm = {
  selected: string[];
};

export const synthValidateFormKey = new DataProviderKey<SynthValidateForm>(
  "glSynthValidateForm",
);

/** Sequencer sample drawer filters. */
export type SeqDrawerForm = {
  filter: SampleClass | "all" | "favorite";
};

export const seqDrawerKey = new DataProviderKey<SeqDrawerForm>("glSeqDrawer");
