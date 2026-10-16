import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/alert";
import "@supersoniks/concorde/switch";
import { ACCESS_PAGE_STYLES } from "../access-layout.js";
import { t } from "../i18n/messages.js";
import { renderFormActions } from "../form-actions.js";
import "../form-stack.js";
import tailwind from "../../css/tailwind";
import { db, ensurePrefs, type UserPrefs } from "../db.js";
import { flushOpLog, getSyncStatus, type SyncStatus } from "../sync.js";
import { prefsFormKey, type PrefsForm } from "../dp-keys.js";

@customElement("gl-sync-page")
export class GlSyncPage extends LitElement {
  static override styles = [tailwind, ACCESS_PAGE_STYLES];

  @state() private prefs: UserPrefs | null = null;
  @state() private sync: SyncStatus | null = null;
  @state() private flushing = false;

  @subscribe(prefsFormKey.syncPolicy)
  @state()
  syncPolicy: PrefsForm["syncPolicy"] = "local_only";

  @subscribe(prefsFormKey.wifiOnly)
  @state()
  wifiOnly: PrefsForm["wifiOnly"] = "1";

  @handle(prefsFormKey.syncPolicy)
  onSync(syncPolicy: PrefsForm["syncPolicy"]): void {
    if (!this.prefs || !syncPolicy) return;
    this.prefs = { ...this.prefs, syncPolicy };
    void db.prefs.put(this.prefs).then(async () => {
      this.sync = await getSyncStatus();
    });
  }

  @handle(prefsFormKey.wifiOnly)
  onWifi(wifiOnly: PrefsForm["wifiOnly"]): void {
    if (!this.prefs) return;
    this.prefs = { ...this.prefs, wifiOnly: wifiOnly === "1" };
    void db.prefs.put(this.prefs).then(async () => {
      this.sync = await getSyncStatus();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#reload();
  }

  async #reload(): Promise<void> {
    this.prefs = await ensurePrefs();
    this.sync = await getSyncStatus();
    set(prefsFormKey, {
      voicePolicy: this.prefs.voicePolicy,
      syncPolicy: this.prefs.syncPolicy,
      wifiOnly: this.prefs.wifiOnly !== false ? "1" : null,
      locale: this.prefs.locale,
    });
  }

  async #flushNow(): Promise<void> {
    this.flushing = true;
    try {
      await flushOpLog();
    } catch {
      /* lastError in status */
    }
    this.sync = await getSyncStatus();
    this.flushing = false;
  }

  override render() {
    return html`
      <div class="access-page" formDataProvider=${prefsFormKey.path}>
        <h1>${t("sync.title")}</h1>
        <p class="access-lede">${t("sync.intro")}</p>

        <gl-form-stack gap="md">
          <gl-form-section label=${t("sync.policy")}>
            <sonic-form-layout>
              <div class="flex flex-wrap gap-2">
                ${(["local_only", "metadata_only", "full"] as const).map(
                  (v) => html`
                    <sonic-button
                      unique
                      name="syncPolicy"
                      value=${v}
                      variant="outline"
                    >
                      ${t(`sync.policy.${v}`)}
                    </sonic-button>
                  `,
                )}
              </div>
              <sonic-switch unique name="wifiOnly" value="1">
                ${t("sync.wifiOnly")}
              </sonic-switch>
            </sonic-form-layout>
          </gl-form-section>

          <gl-form-section label=${t("sync.status")}>
            <div
              class="flex flex-col gap-1.5 rounded-md bg-neutral-100 p-3 font-mono text-[0.8rem]"
            >
              <div>
                ${t("sync.queue")} : ${this.sync?.pending ?? "…"}
                ${t("sync.ops")}
              </div>
              <div>
                ${t("sync.api")} :
                ${this.sync?.apiConfigured
                  ? t("sync.apiOk")
                  : t("sync.apiMissing")}
              </div>
              <div>
                ${t("sync.network")} :
                ${this.sync?.online ? t("sync.online") : t("sync.offline")}
              </div>
              ${this.sync?.lastFlushAt
                ? html`<div>
                    ${t("sync.lastFlush")} : ${this.sync.lastFlushAt}
                  </div>`
                : nothing}
              ${this.sync?.lastError
                ? html`<sonic-alert status="error" label=${t("sync.error")}>
                    ${this.sync.lastError}
                  </sonic-alert>`
                : nothing}
            </div>
          </gl-form-section>
        </gl-form-stack>

        ${renderFormActions({
          primary: {
            label: t("sync.now"),
            type: "primary",
            loading: this.flushing,
            disabled: this.flushing || this.syncPolicy === "local_only",
            onClick: () => void this.#flushNow(),
          },
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-sync-page": GlSyncPage;
  }
}
