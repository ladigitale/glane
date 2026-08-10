import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { listenShare, type ListenMeta } from "../listen-share.js";
import { t } from "../i18n/messages.js";
import { glBrandMark } from "../icon.js";
import { APP_NAME } from "@glane/core-model";
import { pathFor } from "../router.js";

@customElement("gl-listen-page")
export class GlListenPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        min-height: 100%;
      }
      .brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
      }
    `,
  ];

  @property({ type: String }) token = "";

  @state() private meta: ListenMeta | null = null;
  @state() private error = false;
  @state() private loading = true;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("token") && this.token) void this.#load();
  }

  async #load(): Promise<void> {
    if (!this.token) return;
    this.loading = true;
    this.error = false;
    const meta = await listenShare.fetchMeta(this.token);
    this.loading = false;
    if (!meta) {
      this.error = true;
      this.meta = null;
      return;
    }
    this.meta = meta;
  }

  override render() {
    const audioSrc = this.meta
      ? listenShare.audioUrl(this.meta.token)
      : null;

    return html`
      <div
        class="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center gap-6 px-6 py-10"
      >
        <div class="brand inline-flex items-center gap-2 text-primary">
          ${glBrandMark({ size: "1.75rem" })}
          <span class="text-2xl">${APP_NAME}</span>
        </div>
        ${this.loading
          ? html`<p>${t("listen.loading")}</p>`
          : this.error || !this.meta
            ? html`<p>${t("listen.missing")}</p>`
            : html`
                <h1 class="font-display text-3xl">${this.meta.title}</h1>
                ${audioSrc
                  ? html`<audio
                      class="w-full"
                      controls
                      preload="metadata"
                      src=${audioSrc}
                    ></audio>`
                  : nothing}
              `}
        <a
          class="text-sm text-neutral-9 underline-offset-2 hover:underline"
          href=${pathFor({ name: "landing" })}
          @click=${(e: Event) => {
            e.preventDefault();
            history.pushState({}, "", pathFor({ name: "landing" }));
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        >
          ${APP_NAME}
        </a>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-listen-page": GlListenPage;
  }
}
