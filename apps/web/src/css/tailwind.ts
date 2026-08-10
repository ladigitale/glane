import { css, unsafeCSS } from "lit";
import tailwindImport from "./tailwind.css?inline";

/** Tailwind utilities for Lit shadow roots (inject via `static styles = [tailwind, …]`). */
const tailwind = css`
  ${unsafeCSS(tailwindImport)}
`;

export default tailwind;
