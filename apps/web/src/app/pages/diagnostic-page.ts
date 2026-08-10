import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { estimateStorage } from "@glane/audio-io";
import tailwind from "../../css/tailwind";
import { t } from "../i18n/messages.js";
import { getSyncStatus, type SyncStatus } from "../sync.js";
import { db } from "../db.js";

@customElement("gl-diagnostic-page")
export class GlDiagnosticPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
        box-sizing: border-box;
      }
    `,
  ];

  @state() private usage = 0;
  @state() private quota = 0;
  @state() private sync: SyncStatus | null = null;
  @state() private counts = { sessions: 0, samples: 0, clips: 0, ops: 0 };

  override connectedCallback(): void {
    super.connectedCallback();
    void estimateStorage().then((e) => {
      this.usage = e.usage;
      this.quota = e.quota;
    });
    void getSyncStatus().then((s) => (this.sync = s));
    void Promise.all([
      db.sessions.count(),
      db.samples.count(),
      db.clips.count(),
      db.ops.count(),
    ]).then(([sessions, samples, clips, ops]) => {
      this.counts = { sessions, samples, clips, ops };
    });
  }

  #yn(ok: boolean) {
    return html`<sonic-badge type=${ok ? "success" : "warning"} size="sm"
      >${ok ? "yes" : "no"}</sonic-badge
    >`;
  }

  override render() {
    const isolated =
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const sab = typeof SharedArrayBuffer !== "undefined";
    const opfs = typeof navigator.storage?.getDirectory === "function";
    return html`
      <div
        class="box-border max-w-full overflow-x-hidden p-4 font-mono text-[0.85rem]"
      >
        <h1 class="font-display">${t("nav.diagnostic")}</h1>
        <dl
          class="grid grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-x-4 gap-y-1.5 max-[480px]:grid-cols-1 max-[480px]:gap-y-0.5"
        >
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            crossOriginIsolated
          </dt>
          <dd>${this.#yn(isolated)}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            SharedArrayBuffer
          </dt>
          <dd>
            ${sab
              ? this.#yn(true)
              : html`<sonic-badge type="warning" size="sm"
                  >no (fallback Transferable)</sonic-badge
                >`}
          </dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            OPFS
          </dt>
          <dd>${this.#yn(opfs)}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            Wake Lock
          </dt>
          <dd>${this.#yn(Boolean(navigator.wakeLock))}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            storage usage
          </dt>
          <dd>${formatBytes(this.usage)} / ${formatBytes(this.quota)}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            sessions / samples
          </dt>
          <dd>${this.counts.sessions} / ${this.counts.samples}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            clips / ops
          </dt>
          <dd>${this.counts.clips} / ${this.counts.ops}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            sync policy
          </dt>
          <dd>${this.sync?.policy ?? "…"}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            sync pending
          </dt>
          <dd>
            <sonic-badge
              type=${(this.sync?.pending ?? 0) > 0 ? "info" : "neutral"}
              size="sm"
              >${this.sync?.pending ?? "…"}</sonic-badge
            >
          </dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            sync API
          </dt>
          <dd>
            ${this.sync?.apiConfigured
              ? html`<sonic-badge type="success" size="sm">configured</sonic-badge>`
              : html`<sonic-badge type="warning" size="sm"
                  >missing VITE_API_BASE_URL</sonic-badge
                >`}
          </dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            online
          </dt>
          <dd>${this.#yn(Boolean(this.sync?.online))}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            wifiOnly
          </dt>
          <dd>${this.#yn(Boolean(this.sync?.wifiOnly))}</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            budget capture CPU
          </dt>
          <dd>≤ 25% d'un cœur (cible)</dd>
          <dt class="text-neutral-500 max-[480px]:mt-2.5 max-[480px]:first:mt-0">
            budget frame UI
          </dt>
          <dd>16.7 ms (timeline ≤ 8 ms)</dd>
        </dl>
        <div class="mt-4 flex flex-col gap-2">
          ${this.sync?.lastError
            ? html`<sonic-alert status="error" label="Dernière erreur sync"
                >${this.sync.lastError}</sonic-alert
              >`
            : nothing}
          ${!isolated || !sab
            ? html`<sonic-alert status="warning" label="Isolation"
                >Sans COOP/COEP, SharedArrayBuffer peut être indisponible — fallback
                Transferable.</sonic-alert
              >`
            : nothing}
        </div>
      </div>
    `;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-diagnostic-page": GlDiagnosticPage;
  }
}
