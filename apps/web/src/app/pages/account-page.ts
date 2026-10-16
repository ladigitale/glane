import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/input";
import "@supersoniks/concorde/alert";
import tailwind from "../../css/tailwind";
import { ACCESS_PAGE_STYLES } from "../access-layout.js";
import { auth } from "../auth.js";
import { accountFormKey } from "../dp-keys.js";
import { t } from "../i18n/messages.js";
import { glIcon } from "../icon.js";
import { renderFormActions } from "../form-actions.js";
import "../form-stack.js";

@customElement("gl-account-page")
export class GlAccountPage extends LitElement {
  static override styles = [tailwind, ACCESS_PAGE_STYLES];

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
      <div class="access-page">
        <h1>${t("account.title")}</h1>
        ${!auth.isApiConfigured()
          ? html`<sonic-alert status="warning" label="API"
              >${t("account.needApi")}</sonic-alert
            >`
          : nothing}
        ${this.username
          ? html`
              <p class="m-0 text-sm">
                ${t("account.signedInAs")}
                <strong>${this.username}</strong>
              </p>
              ${renderFormActions({
                primary: {
                  label: html`${glIcon("log-out", { slot: "prefix" })}
                  ${t("account.logout")}`,
                  type: "neutral",
                  variant: "outline",
                  onClick: () => this.#logout(),
                },
              })}
            `
          : html`
              <div
                class="flex flex-col gap-4"
                formDataProvider=${accountFormKey.path}
              >
                <gl-form-stack gap="md">
                  <gl-form-section label=${t("account.credentials")}>
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
                  </gl-form-section>
                </gl-form-stack>
                ${renderFormActions({
                  secondary: {
                    label: t("account.register"),
                    variant: "outline",
                    type: "neutral",
                    disabled: this.busy,
                    onClick: () => void this.#register(),
                  },
                  primary: {
                    label: t("account.login"),
                    type: "primary",
                    disabled: this.busy,
                    loading: this.busy,
                    onClick: () => void this.#login(),
                  },
                })}
              </div>
            `}
        ${this.error
          ? html`<sonic-alert status="error" label="Erreur"
              >${this.error}</sonic-alert
            >`
          : nothing}
        ${this.message
          ? html`<sonic-alert status="success" label="OK"
              >${this.message}</sonic-alert
            >`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-account-page": GlAccountPage;
  }
}
