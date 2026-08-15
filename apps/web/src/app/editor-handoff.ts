/** Handoff arrangement → sample editor (sessionStorage). */

export const EDITOR_HANDOFF_KEY = "glane:editor-handoff";

export type EditorHandoff = {
  from: "project";
  projectId: string;
};

export function stashEditorHandoff(h: EditorHandoff): void {
  try {
    sessionStorage.setItem(EDITOR_HANDOFF_KEY, JSON.stringify(h));
  } catch {
    /* private mode */
  }
}

export function peekEditorHandoff(): EditorHandoff | null {
  try {
    const raw = sessionStorage.getItem(EDITOR_HANDOFF_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as EditorHandoff;
    if (o?.from !== "project" || typeof o.projectId !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

export function takeEditorHandoff(): EditorHandoff | null {
  const h = peekEditorHandoff();
  try {
    sessionStorage.removeItem(EDITOR_HANDOFF_KEY);
  } catch {
    /* private mode */
  }
  return h;
}

export function clearEditorHandoff(): void {
  try {
    sessionStorage.removeItem(EDITOR_HANDOFF_KEY);
  } catch {
    /* private mode */
  }
}
