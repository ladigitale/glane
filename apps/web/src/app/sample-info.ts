import {
  CLASS_COLORS,
  type Sample,
  type SampleAnalysis,
  type SampleClass,
  type Session,
} from "@glane/core-model";
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { db } from "./db.js";
import { t, tf } from "./i18n/messages.js";
import { getAppLocale } from "./i18n/locale.js";
import { SAMPLE_PROCESSED_EVENT } from "./process-queue.js";
import { SAMPLE_ML_EVENT } from "./ml/enrich-queue.js";
import { SAMPLE_CLAP_EVENT } from "./ml/clap-queue.js";
import { SAMPLE_STEMS_EVENT } from "./ml/demucs-queue.js";
import { clapFeatureFromAnalysis } from "./ml/clap-runtime.js";
import {
  parseStemFromTags,
  type YamnetLabelScore,
} from "./generative-cues.js";

@customElement("gl-sample-info")
export class GlSampleInfo extends LitElement {
  static override styles = [tailwind];

  @property({ type: String }) sampleId = "";
  @property({ type: Boolean }) visible = false;

  @state() private sample: Sample | null = null;
  @state() private analysis: SampleAnalysis | null = null;
  @state() private session: Session | null = null;
  @state() private parentName: string | null = null;

  #loadGen = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(SAMPLE_PROCESSED_EVENT, this.#onData);
    window.addEventListener(SAMPLE_ML_EVENT, this.#onData);
    window.addEventListener(SAMPLE_CLAP_EVENT, this.#onData);
    window.addEventListener(SAMPLE_STEMS_EVENT, this.#onData);
  }

  override disconnectedCallback(): void {
    window.removeEventListener(SAMPLE_PROCESSED_EVENT, this.#onData);
    window.removeEventListener(SAMPLE_ML_EVENT, this.#onData);
    window.removeEventListener(SAMPLE_CLAP_EVENT, this.#onData);
    window.removeEventListener(SAMPLE_STEMS_EVENT, this.#onData);
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    if (
      this.visible &&
      this.sampleId &&
      (changed.has("sampleId") || changed.has("visible"))
    ) {
      void this.#load();
    }
  }

  #onData = (ev: Event): void => {
    if (!this.visible || !this.sampleId) return;
    const id = (ev as CustomEvent<{ sampleId?: string }>).detail?.sampleId;
    if (id && id !== this.sampleId) return;
    void this.#load();
  };

  #onHide = (): void => {
    this.dispatchEvent(new Event("hide", { bubbles: true, composed: true }));
  };

  async #load(): Promise<void> {
    const gen = ++this.#loadGen;
    const id = this.sampleId;
    if (!id) {
      this.sample = null;
      this.analysis = null;
      this.session = null;
      this.parentName = null;
      return;
    }
    const [sample, analysis] = await Promise.all([
      db.samples.get(id),
      db.analyses.get(id),
    ]);
    if (gen !== this.#loadGen) return;
    this.sample = sample ?? null;
    this.analysis = analysis ?? null;
    let session: Session | null = null;
    let parentName: string | null = null;
    if (sample?.sessionId) {
      session = (await db.sessions.get(sample.sessionId)) ?? null;
    }
    if (sample?.parentSampleId) {
      const parent = await db.samples.get(sample.parentSampleId);
      parentName = parent?.userName ?? parent?.name ?? sample.parentSampleId;
    }
    if (gen !== this.#loadGen) return;
    this.session = session;
    this.parentName = parentName;
  }

  override render() {
    return html`
      <sonic-modal
        align="left"
        maxWidth="28rem"
        .visible=${this.visible}
        @hide=${this.#onHide}
      >
        <sonic-modal-title>${t("sample.infoTitle")}</sonic-modal-title>
        <sonic-modal-content>
          ${this.sample ? this.#body(this.sample) : this.#empty()}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #empty() {
    return html`<p class="text-sm text-neutral-500">${t("sample.missing")}</p>`;
  }

  #body(s: Sample) {
    const a = this.analysis;
    const sess = this.session;
    const features = (a?.features ?? {}) as Record<string, unknown>;
    const clap = clapFeatureFromAnalysis(features);
    const yamnet = yamnetRows(features);
    const stem = parseStemFromTags(s.tags);
    const scores = sortedScores(s.classScores);
    const extraFeat = Object.keys(features).filter(
      (k) => k !== "yamnet" && k !== "clap",
    );

    return html`
      <div class="flex flex-col gap-3">
        ${this.#identity(s, sess, stem)}
        ${this.#classBlock(scores)}
        ${this.#tags(s.tags ?? [])}
        ${this.#loopBlock(s)}
        ${this.#analysisBlock(a)}
        ${this.#mlBlock(yamnet, clap, extraFeat)}
      </div>
    `;
  }

  #identity(s: Sample, sess: Session | null, stem: string | undefined) {
    const title = s.userName ?? s.name;
    const capture =
      s.captureName?.trim() || sess?.title?.trim() || null;
    return html`
      <div class="flex items-start gap-2">
        <span
          class="mt-0.5 h-8 w-2 shrink-0 rounded-sm"
          style="background:${CLASS_COLORS[s.class]}"
          aria-hidden="true"
        ></span>
        <div class="min-w-0 flex-1">
          <p class="m-0 text-base font-medium">${title}</p>
          ${s.userName && s.userName !== s.name
            ? html`<p class="m-0 font-mono text-xs text-neutral-500">${s.name}</p>`
            : nothing}
        </div>
        ${s.favorite
          ? html`<sonic-badge type="warning" size="sm">${t("sample.favorite")}</sonic-badge>`
          : nothing}
      </div>
      <dl class=${dlClass}>
        ${row(t("sample.class"), s.class)}
        ${row(t("sample.subclass"), s.subclass)}
        ${row(t("sample.duration"), formatDuration(s.durationMs))}
        ${row(t("sample.confidence"), pct(s.confidence))}
        ${row(t("sample.interest"), pct(s.interestScore))}
        ${row(t("sample.role"), s.forceRole)}
        ${row(t("sample.stem"), stem)}
        ${row(t("sample.rating"), s.rating != null ? `${s.rating} / 5` : null)}
        ${row(t("sample.capture"), capture)}
        ${row(t("sample.created"), formatDate(s.createdAt))}
        ${row(t("sample.updated"), formatDate(s.updatedAt))}
        ${row(t("sample.origin"), s.originVersion)}
        ${row(t("sample.parent"), this.parentName)}
        ${s.sourceOffsetMs
          ? row(t("sample.offset"), `${s.sourceOffsetMs} ms`)
          : nothing}
        ${sess?.geoTag
          ? row(
              t("sample.geo"),
              `${sess.geoTag.lat.toFixed(4)}, ${sess.geoTag.lon.toFixed(4)}`,
            )
          : nothing}
        ${row(t("sample.id"), html`<span class="break-all">${s.id}</span>`)}
      </dl>
    `;
  }

  #classBlock(scores: Array<[string, number]>) {
    if (!scores.length) return nothing;
    return html`
      <sonic-divider label=${t("sample.sectionScores")} align="left" size="sm"></sonic-divider>
      <div class="flex flex-col gap-1.5">
        ${scores.map(
          ([cls, v]) => html`
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 shrink-0 rounded-sm"
                style="background:${classColor(cls)}"
              ></span>
              <span class="w-[6.5rem] shrink-0 truncate text-xs">${cls}</span>
              ${bar(v)}
              <span class="w-8 shrink-0 text-right font-mono text-xs text-neutral-500"
                >${Math.round(v * 100)}</span
              >
            </div>
          `,
        )}
      </div>
    `;
  }

  #tags(tags: string[]) {
    if (!tags.length) return nothing;
    return html`
      <sonic-divider label=${t("sample.sectionTags")} align="left" size="sm"></sonic-divider>
      <div class="flex flex-wrap gap-1">
        ${tags.map(
          (tag) => html`<sonic-badge type="neutral" variant="outline" size="sm">${tag}</sonic-badge>`,
        )}
      </div>
    `;
  }

  #loopBlock(s: Sample) {
    const has =
      s.loopProposed ||
      s.loopScore != null ||
      s.loopStartMs != null ||
      s.loopEndMs != null;
    if (!has) return nothing;
    const range =
      s.loopStartMs != null && s.loopEndMs != null
        ? `${Math.round(s.loopStartMs)}–${Math.round(s.loopEndMs)} ms`
        : null;
    return html`
      <sonic-divider label=${t("sample.sectionLoop")} align="left" size="sm"></sonic-divider>
      <dl class=${dlClass}>
        ${row(t("sample.loopProposed"), s.loopProposed ? t("sample.yes") : t("sample.no"))}
        ${row(t("sample.loopScore"), pct(s.loopScore))}
        ${row(t("sample.loopRange"), range)}
        ${row(
          t("sample.loopXfade"),
          s.loopXfadeMs != null ? `${Math.round(s.loopXfadeMs)} ms` : null,
        )}
      </dl>
    `;
  }

  #analysisBlock(a: SampleAnalysis | null) {
    if (!a) {
      return html`
        <sonic-divider label=${t("sample.sectionAnalysis")} align="left" size="sm"></sonic-divider>
        <p class="m-0 text-sm text-neutral-500">${t("sample.emptyAnalysis")}</p>
      `;
    }
    const hasScalar =
      a.lufs != null ||
      a.peakDbtp != null ||
      a.centroidHz != null ||
      a.bpm != null ||
      a.pitchHz != null ||
      a.noteName ||
      a.harmonicity != null ||
      a.transientDensity != null ||
      a.loopScore != null;
    if (!hasScalar) return nothing;
    return html`
      <sonic-divider label=${t("sample.sectionAnalysis")} align="left" size="sm"></sonic-divider>
      <dl class=${dlClass}>
        ${row(t("sample.lufs"), num(a.lufs, 1))}
        ${row(t("sample.peak"), num(a.peakDbtp, 1))}
        ${row(t("sample.centroid"), hz(a.centroidHz))}
        ${row(t("sample.bpm"), a.bpm != null && Number.isFinite(a.bpm) ? String(Math.round(a.bpm)) : null)}
        ${row(t("sample.pitch"), hz(a.pitchHz))}
        ${row(t("sample.note"), a.noteName)}
        ${row(t("sample.harmonicity"), pct(a.harmonicity))}
        ${row(t("sample.transient"), pct(a.transientDensity))}
        ${row(t("sample.analysisLoop"), pct(a.loopScore))}
      </dl>
    `;
  }

  #mlBlock(
    yamnet: YamnetLabelScore[],
    clap: { model: string; dims: number } | null,
    extraFeat: string[],
  ) {
    return html`
      <sonic-divider label=${t("sample.sectionMl")} align="left" size="sm"></sonic-divider>
      ${yamnet.length
        ? html`
            <p class="m-0 text-xs text-neutral-500">${t("sample.yamnet")}</p>
            <div class="flex flex-col gap-1.5">
              ${yamnet.map(
                (row) => html`
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-xs">${row.label}</span>
                    ${bar(row.score)}
                    <span class="w-8 shrink-0 text-right font-mono text-xs text-neutral-500"
                      >${Math.round(row.score * 100)}</span
                    >
                  </div>
                `,
              )}
            </div>
          `
        : html`<p class="m-0 text-sm text-neutral-500">${t("sample.yamnetNone")}</p>`}
      <p class="m-0 text-sm">
        <span class="text-neutral-500">${t("sample.clap")} · </span>
        ${clap
          ? tf("sample.clapReady", { dims: clap.dims, model: clap.model })
          : t("sample.clapMissing")}
      </p>
      ${extraFeat.length
        ? html`<p class="m-0 font-mono text-xs text-neutral-500">
            ${t("sample.extraFeatures")}: ${extraFeat.join(", ")}
          </p>`
        : nothing}
    `;
  }
}

const dlClass =
  "m-0 grid grid-cols-[minmax(6.5rem,9rem)_1fr] items-baseline gap-x-3 gap-y-1 text-sm";

function row(label: string, value: unknown): TemplateResult | typeof nothing {
  if (value == null || value === "") return nothing;
  return html`
    <dt class="text-neutral-500">${label}</dt>
    <dd class="m-0 min-w-0">${value}</dd>
  `;
}

function bar(v: number) {
  const pctW = Math.max(0, Math.min(100, Math.round(v * 100)));
  return html`
    <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-200">
      <div
        class="h-full rounded-full bg-primary"
        style="width:${pctW}%"
      ></div>
    </div>
  `;
}

function pct(v: number | undefined | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${Math.round(v * 100)} %`;
}

function num(v: number | undefined | null, digits: number): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v.toFixed(digits);
}

function hz(v: number | undefined | null): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s (${ms} ms)`;
  return `${ms} ms`;
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const loc = getAppLocale() === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleString(loc, { dateStyle: "short", timeStyle: "medium" });
}

function classColor(cls: string): string {
  return cls in CLASS_COLORS
    ? CLASS_COLORS[cls as SampleClass]
    : CLASS_COLORS.unclassified;
}

function sortedScores(
  scores: Record<string, number> | undefined,
): Array<[string, number]> {
  if (!scores) return [];
  return Object.entries(scores)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1]);
}

function yamnetRows(features: Record<string, unknown>): YamnetLabelScore[] {
  const raw = features.yamnet;
  if (!Array.isArray(raw)) return [];
  const out: YamnetLabelScore[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const label = (row as YamnetLabelScore).label;
    const score = (row as YamnetLabelScore).score;
    if (typeof label !== "string" || !label) continue;
    out.push({
      label,
      score: typeof score === "number" && Number.isFinite(score) ? score : 0,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-sample-info": GlSampleInfo;
  }
}
