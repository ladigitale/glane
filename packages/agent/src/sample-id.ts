/**
 * Resolve full sample ids or unique (case-insensitive) prefixes —
 * same rules as createSampleResolver in compile.ts, for id-only lists.
 */

export type ResolveSampleIdsResult =
  | { ok: true; ids: string[] }
  | { ok: false; errors: string[] };

/** Resolve each ref to a full id from `knownIds`. */
export function resolveSampleIds(
  refs: readonly string[],
  knownIds: readonly string[],
): ResolveSampleIdsResult {
  const byId = new Map<string, string>();
  for (const id of knownIds) byId.set(id.toLowerCase(), id);
  const keys = [...byId.keys()];
  const out: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const raw of refs) {
    const key = raw.trim().toLowerCase();
    if (!key) {
      errors.push("référence vide");
      continue;
    }
    const exact = byId.get(key);
    let resolved: string | undefined;
    if (exact) resolved = exact;
    else {
      const matches = keys.filter((id) => id.startsWith(key));
      if (matches.length === 1) resolved = byId.get(matches[0]!)!;
      else if (matches.length === 0) errors.push(`son inconnu « ${raw} »`);
      else errors.push(`préfixe ambigu « ${raw} » (${matches.length} sons)`);
    }
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, ids: out };
}
