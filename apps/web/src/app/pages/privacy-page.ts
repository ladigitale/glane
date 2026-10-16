import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import "@supersoniks/concorde/form-layout";
import { ACCESS_PAGE_STYLES } from "../access-layout.js";
import { t } from "../i18n/messages.js";
import "../form-stack.js";
import tailwind from "../../css/tailwind";
import { db, ensurePrefs, type UserPrefs } from "../db.js";
import { prefsFormKey, type PrefsForm } from "../dp-keys.js";

@customElement("gl-privacy-page")
export class GlPrivacyPage extends LitElement {
  static override styles = [tailwind, ACCESS_PAGE_STYLES];

  @state() private prefs: UserPrefs | null = null;

  @subscribe(prefsFormKey.voicePolicy)
  @state()
  voicePolicy: PrefsForm["voicePolicy"] = "exclude";

  @handle(prefsFormKey.voicePolicy)
  onVoice(voicePolicy: PrefsForm["voicePolicy"]): void {
    if (!this.prefs || !voicePolicy) return;
    this.prefs = { ...this.prefs, voicePolicy };
    void db.prefs.put(this.prefs);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#reload();
  }

  async #reload(): Promise<void> {
    this.prefs = await ensurePrefs();
    set(prefsFormKey, {
      voicePolicy: this.prefs.voicePolicy,
      syncPolicy: this.prefs.syncPolicy,
      wifiOnly: this.prefs.wifiOnly !== false ? "1" : null,
      locale: this.prefs.locale,
    });
  }

  override render() {
    return html`
      <div class="access-page" formDataProvider=${prefsFormKey.path}>
        <h1>${t("privacy.title")}</h1>
        <p class="access-lede">${t("privacy.body")}</p>

        <gl-form-stack gap="md">
          <gl-form-section
            label=${t("privacy.voicePolicy")}
            description=${t("privacy.voiceHint")}
          >
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
                      ${t(`privacy.voice.${v}`)}
                    </sonic-button>
                  `,
                )}
              </div>
            </sonic-form-layout>
          </gl-form-section>
        </gl-form-stack>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-privacy-page": GlPrivacyPage;
  }
}
