/**
 * In-page `/mock-api` — wordings + paginated local sample list for sonic-queue.
 * Re-exports keep existing i18n import paths stable.
 */
export {
  LOCAL_API_PATH_PREFIX,
  WORDINGS_API_PATH_PREFIX,
  getLocalApiServiceUrl,
  getWordingsServiceUrl,
  installLocalApiFetch,
  installWordingsFetch,
} from "../local-api/install.js";
