/** Normalize any CSS color to `#rrggbb` for Canvas/WebGL. */
export function resolveCssColor(raw: string, fallback: string): string {
  const v = raw.trim();
  if (!v) return fallback;
  if (typeof document === "undefined") return fallback;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  try {
    ctx.fillStyle = v;
  } catch {
    return fallback;
  }
  return ctx.fillStyle;
}
