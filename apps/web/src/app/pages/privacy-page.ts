import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import "@supersoniks/concorde/fieldset";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/form-actions";
import { t } from "../i18n/messages.js";
import tailwind from "../../css/tailwind";
import { db, ensurePrefs, type UserPrefs } from "../db.js";
import { flushOpLog, getSyncStatus, type SyncStatus } from "../sync.js";
import { prefsFormKey, type PrefsForm } from "../dp-keys.js";

@customElement("gl-privacy-page")
export class GlPrivacyPage extends LitElement {
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

  @state() private prefs: UserPrefs | null = null;
  @state() private sync: SyncStatus | null = null;
  @state() private flushing = false;

  @subscribe(prefsFormKey.voicePolicy)
  @state()
  voicePolicy: PrefsForm["voicePolicy"] = "exclude";

  @subscribe(prefsFormKey.syncPolicy)
  @state()
  syncPolicy: PrefsForm["syncPolicy"] = "local_only";

  @subscribe(prefsFormKey.wifiOnly)
  @state()
  wifiOnly: PrefsForm["wifiOnly"] = "1";

  @handle(prefsFormKey.voicePolicy)
  onVoice(voicePolicy: PrefsForm["voicePolicy"]): void {
    if (!this.prefs || !voicePolicy) return;
    this.prefs = { ...this.prefs, voicePolicy };
    void db.prefs.put(this.prefs);
  }

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

  override render() {
    return html`
      <div class="box-border max-w-[40rem] p-4">
        <h1 class="font-display">${t("privacy.title")}</h1>
        <p>${t("privacy.body")}</p>

        <div class="mt-4 flex flex-col gap-4" formDataProvider=${prefsFormKey.path}>
          <sonic-fieldset label=${t("privacy.voicePolicy")}>
            <sonic-form-layout>
              <div class="flex flex-wrap gap-2">
                ${(["exclude", "mark_keep_local", "keep"] as const).map(
                  (v) => html`
                    <sonic-button
                      unique
                      name="voicePolicy"
                      value=${v}
                      variant="outline"
                    >
                      ${v}
                    </sonic-button>
                  `,
                )}
              </div>
            </sonic-form-layout>
          </sonic-fieldset>

          <sonic-fieldset label=${t("privacy.sync")}>
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
                      ${v}
                    </sonic-button>
                  `,
                )}
              </div>
              <sonic-switch unique name="wifiOnly" value="1">
                ${t("privacy.wifiOnly")}
              </sonic-switch>
            </sonic-form-layout>
            <div
              class="mt-2 flex flex-col gap-1.5 rounded-lg bg-neutral-100 p-3 font-mono text-[0.8rem]"
            >
              <div>
                ${t("privacy.queue")} : ${this.sync?.pending ?? "…"}
                ${t("privacy.ops")}
              </div>
              <div>
                ${t("privacy.api")} :
                ${this.sync?.apiConfigured
                  ? t("privacy.apiOk")
                  : t("privacy.apiMissing")}
              </div>
              <div>
                ${t("privacy.network")} :
                ${this.sync?.online
                  ? t("privacy.online")
                  : t("privacy.offline")}
              </div>
              ${this.sync?.lastFlushAt
                ? html`<div>
                    ${t("privacy.lastFlush")} : ${this.sync.lastFlushAt}
                  </div>`
                : nothing}
              ${this.sync?.lastError
                ? html`<sonic-alert status="error" label=${t("privacy.error")}>
                    ${this.sync.lastError}
                  </sonic-alert>`
                : nothing}
            </div>
            <sonic-form-actions>
              <sonic-button
                type="primary"
                ?loading=${this.flushing}
                ?disabled=${this.flushing || this.syncPolicy === "local_only"}
                @click=${() => void this.#flushNow()}
              >
                ${t("privacy.syncNow")}
              </sonic-button>
            </sonic-form-actions>
          </sonic-fieldset>
        </div>
      </div>
    `;
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
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-privacy-page": GlPrivacyPage;
  }
}
