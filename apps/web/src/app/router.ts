export type Route =
  | { name: "landing" }
  | { name: "capture" }
  | { name: "library" }
  | { name: "sample"; id: string }
  | { name: "synth" }
  | { name: "project"; id?: string }
  | { name: "privacy" }
  | { name: "diagnostic" }
  | { name: "session"; id: string }
  | { name: "account" }
  | { name: "listen"; token: string };

export function parsePath(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "landing" };
  if (p === "/capture") return { name: "capture" };
  if (p === "/library") return { name: "library" };
  if (p === "/privacy") return { name: "privacy" };
  if (p === "/diagnostic") return { name: "diagnostic" };
  if (p === "/account") return { name: "account" };
  let m = /^\/listen\/([^/]+)$/.exec(p);
  if (m?.[1]) return { name: "listen", token: m[1] };
  m = /^\/sample\/([^/]+)$/.exec(p);
  if (m?.[1]) return { name: "sample", id: m[1] };
  if (p === "/synth" || p.startsWith("/synth/")) return { name: "synth" };
  m = /^\/session\/([^/]+)$/.exec(p);
  if (m?.[1]) return { name: "session", id: m[1] };
  m = /^\/project(?:\/([^/]+))?$/.exec(p);
  if (m) return { name: "project", id: m[1] };
  return { name: "landing" };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case "landing":
      return "/";
    case "capture":
      return "/capture";
    case "library":
      return "/library";
    case "privacy":
      return "/privacy";
    case "diagnostic":
      return "/diagnostic";
    case "account":
      return "/account";
    case "listen":
      return `/listen/${route.token}`;
    case "sample":
      return `/sample/${route.id}`;
    case "synth":
      return "/synth";
    case "session":
      return `/session/${route.id}`;
    case "project":
      return route.id ? `/project/${route.id}` : "/project";
  }
}

export function navigate(route: Route): void {
  const path = pathFor(route);
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
