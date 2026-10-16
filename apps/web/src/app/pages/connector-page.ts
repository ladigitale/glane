import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ACCESS_PAGE_STYLES } from "../access-layout.js";
import { t } from "../i18n/messages.js";
import tailwind from "../../css/tailwind";
import "../agent/agent-connector.js";

@customElement("gl-connector-page")
export class GlConnectorPage extends LitElement {
  static override styles = [tailwind, ACCESS_PAGE_STYLES];

  override render() {
    return html`
      <div class="access-page">
        <h1>${t("nav.connector")}</h1>
        <p class="access-lede">${t("agent.intro")}</p>
        <gl-agent-connector embedded></gl-agent-connector>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-connector-page": GlConnectorPage;
  }
}
