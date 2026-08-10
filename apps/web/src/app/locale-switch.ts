import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import tailwind from "../css/tailwind";
import { db, ensurePrefs } from "./db.js";
import { prefsFormKey, type PrefsForm } from "./dp-keys.js";
import {
  APP_LOCALES,
  localeLabel,
  setLocale,
  tx,
  type AppLocale,
} from "./i18n/index.js";

/**
 * Compact FR / EN switch — landing + chrome.
 * Persists prefs + Concorde `html[lang]` / Sonic storage.
 */
@customElement("gl-locale-switch")
export class GlLocaleSwitch extends LitElement {
  static override styles = [tailwind];

  @property({ type: String }) size: "xs" | "sm" | "md" = "sm";

  @subscribe(prefsFormKey.locale)
  @state()
  locale: PrefsForm["locale"] = "fr";

  async #pick(locale: AppLocale): Promise<void> {
    if (this.locale === locale) return;
    set(prefsFormKey.locale, locale);
    setLocale(locale);
    const prefs = await ensurePrefs();
    prefs.locale = locale;
    await db.prefs.put(prefs);
  }

  override render() {
    return html`
      <div
        class="inline-flex flex-wrap gap-1"
        role="listbox"
        aria-label=${tx("theme.language")}
      >
        ${APP_LOCALES.map(
          (locale) => html`
            <sonic-button
              size=${this.size}
              type=${this.locale === locale ? "primary" : "default"}
              @click=${() => void this.#pick(locale)}
              >${localeLabel(locale)}</sonic-button
            >
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-locale-switch": GlLocaleSwitch;
  }
}
