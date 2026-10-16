import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@supersoniks/concorde/form-layout";
import tailwind from "../../css/tailwind";
import { ensurePrefs } from "../db.js";
import { glDialog } from "../dialog.js";
import { t, type MessageKey } from "../i18n/messages.js";
import { glIcon } from "../icon.js";
import { renderFormActions } from "../form-actions.js";
import "../form-stack.js";
import {
  agentBridge,
  connectorUrl,
  rotateAgentToken,
  setAgentEnabled,
  type AgentBridgeState,
} from "./bridge.js";

/** Claude connector controls — used on `/connector` (embedded) or standalone. */
@customElement("gl-agent-connector")
export class GlAgentConnector extends LitElement {
  static override styles = [tailwind];

  /** When true, page owns title/lede — no nested card chrome. */
  @property({ type: Boolean, reflect: true }) embedded = false;

  @state() private enabled = false;
  @state() private token: string | null = null;
  @state() private bridge: AgentBridgeState = "off";
  @state() private copied = false;
  #unsub: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsub = agentBridge.subscribe((s) => (this.bridge = s));
    void ensurePrefs().then((p) => {
      this.enabled = p.agentEnabled === true;
      this.token = p.agentToken ?? null;
    });
  }

  override disconnectedCallback(): void {
    this.#unsub?.();
    super.disconnectedCallback();
  }

  async #toggle(): Promise<void> {
    const next = !this.enabled;
    const token = await setAgentEnabled(next);
    this.enabled = next;
    if (token) this.token = token;
  }

  async #rotate(): Promise<void> {
    if (!(await glDialog.confirm(t("agent.rotateConfirm")))) return;
    this.token = await rotateAgentToken();
  }

  async #copy(url: string): Promise<void> {
    await navigator.clipboard.writeText(url);
    this.copied = true;
    setTimeout(() => (this.copied = false), 1500);
  }

  override render() {
    const url = this.enabled && this.token ? connectorUrl(this.token) : null;
    const dot =
      this.bridge === "online"
        ? "bg-success"
        : this.bridge === "connecting"
          ? "bg-warning"
          : "bg-neutral-400";

    const body = html`
      <gl-form-stack gap="md">
        <gl-form-section label=${t("agent.statusLabel")}>
          <div class="flex items-center gap-2 text-sm">
            <span class="inline-block h-2 w-2 shrink-0 rounded-full ${dot}"></span>
            ${t(`agent.state.${this.bridge}` as MessageKey)}
          </div>
        </gl-form-section>
        ${url
          ? html`
              <gl-form-section label=${t("agent.url")}>
                <sonic-form-layout>
                  <code
                    class="block break-all rounded-md bg-neutral-100 px-2 py-1.5 font-mono text-xs"
                    >${url}</code
                  >
                  <p class="m-0 text-xs text-neutral-500">${t("agent.secret")}</p>
                </sonic-form-layout>
              </gl-form-section>
            `
          : nothing}
      </gl-form-stack>
      ${renderFormActions({
        secondary: url
          ? {
              label: html`${glIcon("refresh-cw", {
                slot: "prefix",
                size: "xs",
              })}
              ${t("agent.rotate")}`,
              variant: "outline",
              type: "neutral",
              onClick: () => void this.#rotate(),
            }
          : undefined,
        tertiary: url
          ? {
              label: html`${glIcon(this.copied ? "check" : "copy", {
                slot: "prefix",
                size: "xs",
              })}
              ${this.copied ? t("agent.copied") : t("agent.copy")}`,
              variant: "outline",
              type: "neutral",
              onClick: () => void this.#copy(url),
            }
          : undefined,
        primary: {
          label: html`${glIcon(this.enabled ? "power" : "zap", {
            slot: "prefix",
          })}
          ${this.enabled ? t("agent.disable") : t("agent.enable")}`,
          type: this.enabled ? "neutral" : "primary",
          variant: this.enabled ? "outline" : undefined,
          onClick: () => void this.#toggle(),
        },
      })}
    `;

    if (this.embedded) return body;

    return html`
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="m-0 font-display text-lg">${t("agent.title")}</h2>
          <p class="m-0 text-sm text-neutral-500">${t("agent.intro")}</p>
        </div>
        ${body}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-agent-connector": GlAgentConnector;
  }
}
