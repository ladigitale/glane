import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { ensurePrefs } from "../db.js";
import { glDialog } from "../dialog.js";
import { t, type MessageKey } from "../i18n/messages.js";
import { glIcon } from "../icon.js";
import {
  agentBridge,
  connectorUrl,
  rotateAgentToken,
  setAgentEnabled,
  type AgentBridgeState,
} from "./bridge.js";

/** Account section: enable the Claude connector and show its URL. */
@customElement("gl-agent-connector")
export class GlAgentConnector extends LitElement {
  static override styles = [tailwind];

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
    return html`
      <section class="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
        <h2 class="font-display text-lg">${t("agent.title")}</h2>
        <p class="text-sm text-neutral-500">${t("agent.intro")}</p>
        <div class="flex items-center gap-2 text-sm">
          <span class="inline-block h-2 w-2 rounded-full ${dot}"></span>
          ${t(`agent.state.${this.bridge}` as MessageKey)}
        </div>
        <div>
          <sonic-button
            type=${this.enabled ? "neutral" : "primary"}
            variant=${this.enabled ? "outline" : "default"}
            @click=${() => void this.#toggle()}
          >
            ${glIcon(this.enabled ? "power" : "zap", { slot: "prefix" })}
            ${this.enabled ? t("agent.disable") : t("agent.enable")}
          </sonic-button>
        </div>
        ${url
          ? html`
              <label class="text-sm text-neutral-500">${t("agent.url")}</label>
              <code
                class="block break-all rounded bg-neutral-100 px-2 py-1.5 font-mono text-xs"
                >${url}</code
              >
              <div class="flex flex-wrap gap-2">
                <sonic-button size="sm" @click=${() => void this.#copy(url)}>
                  ${glIcon(this.copied ? "check" : "copy", { slot: "prefix" })}
                  ${this.copied ? t("agent.copied") : t("agent.copy")}
                </sonic-button>
                <sonic-button
                  size="sm"
                  type="neutral"
                  variant="outline"
                  @click=${() => void this.#rotate()}
                >
                  ${glIcon("refresh-cw", { slot: "prefix" })} ${t("agent.rotate")}
                </sonic-button>
              </div>
              <p class="text-xs text-neutral-500">${t("agent.secret")}</p>
            `
          : nothing}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-agent-connector": GlAgentConnector;
  }
}
