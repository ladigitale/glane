import { LIBRARY_MAX_LIMIT, describeCapabilities, type BridgeMethod } from "@glane/agent";
import { agentHandlers } from "./handlers.js";

/**
 * WebMCP (https://github.com/webmachinelearning/webmcp): the read-only subset
 * of the MCP connector tools (apps/mcp/src/tools.ts), registered in-page so a
 * browser agent can read the open tab without the relay. Same handlers as the
 * bridge. No-op when the browser has no `modelContext`.
 */

type ToolResult = { content: { type: "text"; text: string }[] };

type ModelContextTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

type ModelContext = {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => unknown;
};

const text = (value: unknown): ToolResult => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) },
  ],
});

const NO_INPUT = { type: "object", properties: {} };

function viaHandler(method: BridgeMethod) {
  const handler = agentHandlers[method] as (p: unknown) => Promise<unknown>;
  return async (args: Record<string, unknown>) => text(await handler(args ?? {}));
}

const TOOLS: ModelContextTool[] = [
  {
    name: "glane_status",
    title: "Glane status",
    description:
      "Current Glane project (BPM, bars, number of sounds and clips), current route and audio state.",
    inputSchema: NO_INPUT,
    execute: viaHandler("status"),
  },
  {
    name: "glane_guide",
    title: "Score format guide",
    description:
      "Reference of Glane's arrangement score format (tracks, FX, sections, step patterns, automation) and of synthesis / library operations.",
    inputSchema: NO_INPUT,
    execute: async () => text(describeCapabilities()),
  },
  {
    name: "glane_list_projects",
    title: "Projects",
    description: "Lists the user's Glane projects and which one is current.",
    inputSchema: NO_INPUT,
    execute: viaHandler("projects.list"),
  },
  {
    name: "glane_library",
    title: "Sound library",
    description:
      "Sounds of the current project with their descriptors (class, inferred role, duration, loop region, BPM, note, brightness, loudness, rating, tags) as a compact TSV table.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Search in name, capture and tags" },
        tags: { type: "array", items: { type: "string" }, description: "At least one of these tags (substring)" },
        favorite: { type: "boolean" },
        loopable: { type: "boolean" },
        pitched: { type: "boolean", description: "Reliable pitch detected" },
        sort: { type: "string", enum: ["interest", "duration", "name"] },
        limit: { type: "integer", minimum: 1, maximum: LIBRARY_MAX_LIMIT },
        offset: { type: "integer", minimum: 0 },
      },
    },
    execute: viaHandler("library.list"),
  },
  {
    name: "glane_get_arrangement",
    title: "Read the arrangement",
    description:
      "Current arrangement as a score (clips in bars/beats, FX, sends, master, automation), including the user's manual edits.",
    inputSchema: NO_INPUT,
    execute: viaHandler("arrangement.get"),
  },
];

export function registerWebMcpTools(): void {
  const mc =
    (document as unknown as { modelContext?: ModelContext }).modelContext ??
    (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (typeof mc?.registerTool !== "function") return;
  for (const tool of TOOLS) {
    // registerTool may throw or return a rejected promise depending on the implementation.
    void (async () => mc.registerTool({ ...tool, annotations: { readOnlyHint: true } }))().catch(
      (e: unknown) => console.warn("[glane] WebMCP registerTool failed", tool.name, e),
    );
  }
}
