import { db } from "./db.js";
import type { MessageKey } from "./i18n/messages.js";
import { projectWorkspace } from "./project-workspace.js";
import type { Route } from "./router.js";

/** Chrome / landing sections gated by workspace content. */
export type GlSection = "capture" | "library" | "synth" | "project";

export type Readiness = {
  projectId: string | null;
  sampleCount: number;
};

export async function loadReadiness(projectId?: string): Promise<Readiness> {
  const id =
    projectId ?? (await projectWorkspace.ensure())?.id ?? null;
  if (!id) return { projectId: null, sampleCount: 0 };
  const sampleCount = await db.samples
    .where("projectId")
    .equals(id)
    .filter((s) => !s.deletedAt)
    .count();
  return { projectId: id, sampleCount };
}

export function sectionReady(section: GlSection, r: Readiness): boolean {
  if (!r.projectId) return false;
  if (section === "capture" || section === "synth") return true;
  return r.sampleCount > 0;
}

export function blockReasonKey(
  section: GlSection,
  r: Readiness,
): MessageKey | null {
  if (sectionReady(section, r)) return null;
  if (!r.projectId) return "gate.needProject";
  return "gate.needSamples";
}

export function fallbackRoute(section: GlSection, r: Readiness): Route {
  if (!r.projectId) return { name: "landing" };
  return { name: "workspace" };
}

export function routeSection(route: Route): GlSection | null {
  switch (route.name) {
    case "capture":
    case "session":
      return "capture";
    case "library":
    case "sample":
      return "library";
    case "synth":
      return "synth";
    case "project":
      return "project";
    default:
      return null;
  }
}

export function routeReady(route: Route, r: Readiness): boolean {
  const section = routeSection(route);
  if (!section) return true;
  return sectionReady(section, r);
}

export function sectionRoute(section: GlSection, projectId: string): Route {
  switch (section) {
    case "capture":
      return { name: "capture" };
    case "library":
      return { name: "library" };
    case "synth":
      return { name: "synth" };
    case "project":
      return { name: "project", id: projectId };
  }
}
