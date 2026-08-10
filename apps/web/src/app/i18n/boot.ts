/** Side-effect boot: install before `gl-app` upgrades (import order). */
import { initAppLocale, installWordingsFetch } from "./index.js";

installWordingsFetch();
initAppLocale();
