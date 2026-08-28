import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/form-actions";
import tailwind from "../../css/tailwind";
import { auth } from "../auth.js";
import { accountFormKey, type AccountForm } from "../dp-keys.js";
import { t } from "../i18n/messages.js";
import { glIcon } from "../icon.js";
import { pathFor } from "../router.js";

@customElement("gl-account-page")
export class GlAccountPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        padding: 1rem;
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
        box-sizing: border-box;
      }
    `,
  ];

  @state() private username: string | null = null;
  @state() private busy = false;
  @state() private message: string | null = null;
  @state() private error: string | null = null;

  @subscribe(accountFormKey.username)
  @state()
  formUser = "";

  @subscribe(accountFormKey.password)
  @state()
  formPass = "";

  @handle(accountFormKey.username)
  onUser(v: string): void {
    this.formUser = v ?? "";
  }

  @handle(accountFormKey.password)
  onPass(v: string): void {
    this.formPass = v ?? "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#refresh();
    set(accountFormKey, { username: "", password: "" });
  }

  async #refresh(): Promise<void> {
    const me = await auth.me();
    this.username = me.authenticated ? (me.username ?? null) : null;
  }

  async #login(): Promise<void> {
    this.error = null;
    this.message = null;
    if (!auth.isApiConfigured()) {
      this.error = t("account.needApi");
      return;
    }
    this.busy = true;
    const r = await auth.login(this.formUser.trim(), this.formPass);
    this.busy = false;
    if (!r.ok) {
      this.error = t("account.error");
      return;
    }
    await this.#refresh();
  }

  async #register(): Promise<void> {
    this.error = null;
    this.message = null;
    if (!auth.isApiConfigured()) {
      this.error = t("account.needApi");
      return;
    }
    this.busy = true;
    const r = await auth.register(this.formUser.trim(), this.formPass);
    this.busy = false;
    if (!r.ok) {
      this.error =
        r.error === "registration_disabled"
          ? t("account.registerDisabled")
          : t("account.error");
      return;
    }
    this.message = t("account.registerOk");
    await this.#refresh();
  }

  #logout(): void {
    auth.logout();
    this.username = null;
    this.message = null;
  }

  override render() {
    return html`
      <div class="mx-auto flex max-w-md flex-col gap-4">
        <h1 class="font-display text-2xl">${t("account.title")}</h1>
        ${!auth.isApiConfigured()
          ? html`<sonic-alert status="warning" label="API">${t("account.needApi")}</sonic-alert>`
          : nothing}
        ${this.username
          ? html`
              <p>
                ${t("account.signedInAs")}
                <strong>${this.username}</strong>
              </p>
              <sonic-button
                type="neutral"
                variant="outline"
                @click=${() => this.#logout()}
              >
                ${glIcon("log-out", { slot: "prefix" })}
                ${t("account.logout")}
              </sonic-button>
            `
          : html`
              <div formDataProvider=${accountFormKey.path}>
                <sonic-form-layout>
                  <sonic-input
                    name="username"
                    label=${t("account.username")}
                    autocomplete="username"
                  ></sonic-input>
                  <sonic-input
                    name="password"
                    label=${t("account.password")}
                    type="password"
                    autocomplete="current-password"
                  ></sonic-input>
                </sonic-form-layout>
                <sonic-form-actions>
                  <sonic-button
                    type="primary"
                    ?disabled=${this.busy}
                    ?loading=${this.busy}
                    @click=${() => void this.#login()}
                  >
                    ${t("account.login")}
                  </sonic-button>
                  <sonic-button
                    variant="outline"
                    type="neutral"
                    ?disabled=${this.busy}
                    @click=${() => void this.#register()}
                  >
                    ${t("account.register")}
                  </sonic-button>
                </sonic-form-actions>
              </div>
            `}
        ${this.error
          ? html`<sonic-alert status="error" label="Erreur">${this.error}</sonic-alert>`
          : nothing}
        ${this.message
          ? html`<sonic-alert status="success" label="OK">${this.message}</sonic-alert>`
          : nothing}
        <a
          class="text-sm text-neutral-9 underline-offset-2 hover:underline"
          href=${pathFor({ name: "landing" })}
          @click=${(e: Event) => {
            e.preventDefault();
            history.pushState({}, "", pathFor({ name: "landing" }));
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        >
          ← Glane
        </a>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-account-page": GlAccountPage;
  }
}
