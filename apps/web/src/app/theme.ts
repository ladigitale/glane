/** UI themes via Concorde CSS variables (`--sc-*`). Pack A = Tadaaa dark/nord/matcha. */

export type AppThemeId = "dark" | "nord" | "matcha";

export type AppThemeMeta = {
  id: AppThemeId;
  /** i18n key */
  labelKey: "theme.dark" | "theme.nord" | "theme.matcha";
  dark: boolean;
  /** PWA / meta theme-color */
  themeColor: string;
};

export const APP_THEMES: readonly AppThemeMeta[] = [
  {
    id: "nord",
    labelKey: "theme.nord",
    dark: true,
    themeColor: "#101820",
  },
  {
    id: "dark",
    labelKey: "theme.dark",
    dark: true,
    themeColor: "#0c0d12",
  },
  {
    id: "matcha",
    labelKey: "theme.matcha",
    dark: false,
    themeColor: "#c5bfd4",
  },
] as const;

export const DEFAULT_THEME_ID: AppThemeId = "nord";

const THEME_IDS = new Set<string>(APP_THEMES.map((t) => t.id));

const STORAGE_KEY = "glane.theme";

/** Map legacy ids + validate. */
export function normalizeThemeId(value: unknown): AppThemeId {
  if (
    value === "nuit" ||
    value === "monokai" ||
    value === "dracula" ||
    value === "flare"
  ) {
    return "nord";
  }
  if (value === "jour" || value === "soft") return "matcha";
  if (typeof value === "string" && THEME_IDS.has(value)) {
    return value as AppThemeId;
  }
  return DEFAULT_THEME_ID;
}

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export function themeMeta(id: AppThemeId): AppThemeMeta {
  return APP_THEMES.find((t) => t.id === id) ?? APP_THEMES[0]!;
}

export function applyTheme(id: AppThemeId): void {
  const meta = themeMeta(id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = meta.dark ? "dark" : "light";
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) metaEl.setAttribute("content", meta.themeColor);
}

export function loadThemeId(): AppThemeId {
  try {
    return normalizeThemeId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}
