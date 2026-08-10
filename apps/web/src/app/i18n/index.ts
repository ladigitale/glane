export {
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  getAppLocale,
  initAppLocale,
  isAppLocale,
  localeLabel,
  normalizeAppLocale,
  resolveBrowserLocale,
  setAppLocale,
  type AppLocale,
} from "./locale.js";
export {
  MESSAGES,
  resolveWordings,
  setLocale,
  t,
  tf,
  tx,
  type Locale,
  type MessageKey,
  type WordingCatalog,
} from "./messages.js";
export {
  WORDINGS_API_PATH_PREFIX,
  getWordingsServiceUrl,
  installWordingsFetch,
} from "./wordings-fetch.js";
