/** True when Space / shortcuts should not steal focus from typing or modals. */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
    return true;
  }
  for (const n of e.composedPath()) {
    if (!(n instanceof Element)) continue;
    const tag = n.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if ((n as HTMLElement).isContentEditable) return true;
    if (tag === "SONIC-MODAL" || tag === "SONIC-POP") return true;
  }
  return false;
}

export function isSpaceKey(e: KeyboardEvent): boolean {
  return e.code === "Space" || e.key === " ";
}
