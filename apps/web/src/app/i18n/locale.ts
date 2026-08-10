/** App locales — French default, English optional (Tadaaa-style Concorde contract). */

export const APP_LOCALES = ["fr", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "fr";

/**
 * Concorde language key (`HTML.getLanguage` prefers this over `html[lang]`).
 * Written when the user picks a language (or prefs apply a stored choice).
 */
export const SONIC_LANGUAGE_STORAGE_KEY = "SonicSelectedLanguage";

/** Marks that `SonicSelectedLanguage` was set by the user / prefs (not bare boot). */
export const LOCALE_EXPLICIT_STORAGE_KEY = "glane.locale.explicit";

export function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

/** Normalize `en-US` / `fr-FR` → `en` / `fr`; unknown → French. */
export function normalizeAppLocale(raw: string | null | undefined): AppLocale {
  if (!raw) return DEFAULT_APP_LOCALE;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isAppLocale(primary) ? primary : DEFAULT_APP_LOCALE;
}

/**
 * Best available app locale from the browser preference list.
 * Walks `navigator.languages` then `navigator.language`; first match wins.
 */
export function resolveBrowserLocale(
  languages: readonly string[] = readNavigatorLanguages(),
): AppLocale {
  for (const raw of languages) {
    if (!raw) continue;
    const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    if (isAppLocale(primary)) return primary;
  }
  return DEFAULT_APP_LOCALE;
}

function readNavigatorLanguages(): string[] {
  try {
    if (typeof navigator === "undefined") return [];
    const list = navigator.languages?.length
      ? [...navigator.languages]
      : [];
    if (navigator.language) list.push(navigator.language);
    return list;
  } catch {
    return [];
  }
}

function hasExplicitLocalePreference(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readExplicitLocale(): AppLocale | null {
  if (!hasExplicitLocalePreference()) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(SONIC_LANGUAGE_STORAGE_KEY);
    if (!stored) return null;
    return normalizeAppLocale(stored);
  } catch {
    return null;
  }
}

/** Explicit user / prefs choice if any, else browser → available locale. */
export function getAppLocale(): AppLocale {
  return readExplicitLocale() ?? resolveBrowserLocale();
}

type LitHost = Element & { requestUpdate?: () => void; shadowRoot?: ShadowRoot | null };

/** Re-render Glane Lit trees that still use sync `t()` / `tx()`. */
function notifyLocaleChange(root: ParentNode = document): void {
  root.querySelectorAll("*").forEach((node) => {
    const el = node as LitHost;
    if (typeof el.requestUpdate === "function") el.requestUpdate();
    if (el.shadowRoot) notifyLocaleChange(el.shadowRoot);
  });
}

/**
 * Persist locale for Concorde wording (`Accept-Language` + `html[lang]` observer).
 * Call on voluntary user choice or when applying stored prefs.
 */
export function setAppLocale(locale: AppLocale): void {
  const next = normalizeAppLocale(locale);
  try {
    localStorage.setItem(SONIC_LANGUAGE_STORAGE_KEY, next);
    localStorage.setItem(LOCALE_EXPLICIT_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
    notifyLocaleChange();
  }
}

/**
 * Apply locale at boot: stored user choice if present, otherwise browser mapping.
 * Does not persist the browser pick until prefs / user choice.
 */
export function initAppLocale(): AppLocale {
  const explicit = readExplicitLocale();
  if (explicit) {
    document.documentElement.lang = explicit;
    return explicit;
  }

  try {
    if (typeof localStorage !== "undefined") {
      const legacy = localStorage.getItem(SONIC_LANGUAGE_STORAGE_KEY);
      if (legacy && isAppLocale(normalizeAppLocale(legacy))) {
        /* Prefs will re-apply; keep html lang for Concorde until then. */
        document.documentElement.lang = normalizeAppLocale(legacy);
        return normalizeAppLocale(legacy);
      }
      localStorage.removeItem(SONIC_LANGUAGE_STORAGE_KEY);
      localStorage.removeItem(LOCALE_EXPLICIT_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }

  const locale = resolveBrowserLocale();
  document.documentElement.lang = locale;
  return locale;
}

export function localeLabel(locale: AppLocale): string {
  return locale === "fr" ? "Français" : "English";
}
