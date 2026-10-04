import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ExprRoleSchema,
  SampleClassSchema,
} from "@glane/core-model";
import {
  LIBRARY_MAX_LIMIT,
  ScoreSchema,
  describeCapabilities,
  type BridgeMethod,
  type BridgeMethodMap,
} from "@glane/agent";
import { NoAppConnectedError, type Relay } from "./relay.js";

export const SERVER_INSTRUCTIONS = `Glane est un instrument de field recording : captures → bibliothèque de sons → séquenceur 6 pistes.
Ce connecteur pilote l'onglet Glane ouvert par l'utilisateur (les sons restent sur son appareil).

Pour composer un morceau :
1. glane_status pour vérifier que l'app est ouverte et voir le projet courant.
2. glane_guide une fois par conversation : syntaxe de la partition et tous les paramètres (pistes, master, spaces, clips, automation).
3. glane_library pour connaître les sons (classe, rôle inféré, durée, boucle seamless, BPM, note, brillance, densité de transitoires, LUFS, tags, notes de l'utilisateur).
4. Écrire la partition complète avec glane_write_arrangement (play: true pour l'écouter tout de suite). Elle remplace l'arrangement courant ; un snapshot est pris avant, glane_undo_write revient en arrière.
5. Itérer : glane_get_arrangement relit l'état actuel (y compris les retouches faites à la main), puis réécrire.

Tu n'entends pas le rendu : appuie-toi sur les descripteurs (rôle, note, BPM, boucle, centroïde, densité), privilégie les favoris et les sons bien notés, garde une structure claire (sections), et décris à l'utilisateur ce que tu as construit pour qu'il te guide à l'oreille.`;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): Text => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) },
  ],
});

const fail = (message: string): Text => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: Record<string, boolean>;
};

/**
 * registerTool without its generic inference: the SDK's zod v3/v4 compat
 * types make tsc crawl on nested schemas like the score.
 */
function register<A = Record<string, never>>(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: (args: A) => Promise<Text>,
): void {
  (server.registerTool as unknown as (n: string, c: ToolConfig, h: (a: A) => Promise<Text>) => void).call(
    server,
    name,
    config,
    handler,
  );
}

/** One MCP server per request (stateless transport), bound to a token. */
export function createGlaneMcpServer(relay: Relay, token: string): McpServer {
  const server = new McpServer(
    { name: "glane", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async function bridge<M extends BridgeMethod>(
    method: M,
    params: BridgeMethodMap[M]["params"],
    timeoutMs?: number,
  ): Promise<{ ok: true; value: BridgeMethodMap[M]["result"] } | { ok: false; res: Text }> {
    try {
      return { ok: true, value: await relay.call(token, method, params, timeoutMs) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, res: fail(e instanceof NoAppConnectedError ? msg : `Erreur Glane : ${msg}`) };
    }
  }

  register(server,
    "glane_status",
    {
      title: "État de Glane",
      description:
        "Vérifie que l'app Glane est ouverte et connectée, et renvoie le projet courant (BPM, mesures, nombre de sons et de clips) et l'état audio.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const r = await bridge("status", {});
      return r.ok ? ok(r.value) : r.res;
    },
  );

  register(server,
    "glane_guide",
    {
      title: "Guide de la partition",
      description:
        "Référence complète du format de partition accepté par glane_write_arrangement : pistes, FX et plages, spaces A/B, master, instances de sons, patterns en pas, automation, exemple. À lire avant la première écriture.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ok(describeCapabilities()),
  );

  register(server,
    "glane_list_projects",
    {
      title: "Projets",
      description: "Liste les projets (bibliothèques) de l'utilisateur et indique le projet courant.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const r = await bridge("projects.list", {});
      return r.ok ? ok(r.value) : r.res;
    },
  );

  register<{ projectId: string }>(server,
    "glane_select_project",
    {
      title: "Changer de projet",
      description: "Fait d'un autre projet le projet courant (bibliothèque et arrangement).",
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ projectId }) => {
      const r = await bridge("projects.select", { projectId });
      return r.ok ? ok(r.value) : r.res;
    },
  );

  register<BridgeMethodMap["library.list"]["params"]>(server,
    "glane_library",
    {
      title: "Bibliothèque de sons",
      description:
        "Sons du projet courant avec leurs descripteurs, en tableau TSV compact (ids courts utilisables tels quels dans la partition). Colonnes : id, name, class, role (rôle inféré pour l'arrangement), ms, loop (région seamless début-fin en ms), bpm, note (? = hauteur peu fiable), pitchConf, harm (harmonicité), centroidHz (brillance), transients (densité), lufs, rating, fav, interest, tags. Le premier appel renvoie aussi un résumé par classe et par rôle.",
      inputSchema: {
        classes: z.array(SampleClassSchema).optional(),
        roles: z.array(ExprRoleSchema).optional(),
        tags: z.array(z.string()).optional().describe("Au moins un de ces tags (sous-chaîne)"),
        text: z.string().optional().describe("Recherche dans le nom, la capture et les tags"),
        favorite: z.boolean().optional(),
        minRating: z.number().int().min(1).max(5).optional(),
        minMs: z.number().min(0).optional(),
        maxMs: z.number().min(0).optional(),
        loopable: z.boolean().optional(),
        pitched: z.boolean().optional().describe("Hauteur détectée de façon fiable"),
        sort: z.enum(["interest", "duration", "name"]).optional(),
        limit: z.number().int().min(1).max(LIBRARY_MAX_LIMIT).optional(),
        offset: z.number().int().min(0).optional(),
        format: z.enum(["table", "json"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("library.list", args);
      if (!r.ok) return r.res;
      const { table, ...meta } = r.value;
      return table != null
        ? { content: [{ type: "text", text: JSON.stringify(meta) }, { type: "text", text: table }] }
        : ok(r.value);
    },
  );

  register(server,
    "glane_get_arrangement",
    {
      title: "Lire l'arrangement",
      description:
        "Relit l'arrangement courant au format partition (clips en mesure/temps, FX, sends, master, automation), y compris les retouches manuelles de l'utilisateur. Sert de base pour une réécriture.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const r = await bridge("arrangement.get", {});
      return r.ok ? ok(r.value) : r.res;
    },
  );

  register<{ score: unknown; play?: boolean; open?: boolean }>(server,
    "glane_write_arrangement",
    {
      title: "Écrire l'arrangement",
      description:
        "Remplace l'arrangement du projet courant par la partition donnée (snapshot automatique avant écriture). Renvoie les erreurs à corriger ou, en cas de succès, les avertissements de mix et des statistiques. Voir glane_guide pour la syntaxe.",
      inputSchema: {
        score: ScoreSchema as unknown as z.ZodTypeAny,
        play: z.boolean().optional().describe("Lancer la lecture depuis le début après écriture"),
        open: z.boolean().optional().describe("Afficher le séquenceur (défaut true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ score, play, open }) => {
      const r = await bridge("arrangement.write", { score, play, open }, 60_000);
      if (!r.ok) return r.res;
      if (!r.value.ok) {
        return fail(
          JSON.stringify({ errors: r.value.errors, warnings: r.value.warnings }, null, 1),
        );
      }
      return ok(r.value);
    },
  );

  register(server,
    "glane_undo_write",
    {
      title: "Annuler la dernière écriture",
      description:
        "Restaure l'arrangement tel qu'il était avant la dernière écriture de l'agent sur ce projet (10 niveaux).",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async () => {
      const r = await bridge("arrangement.undo", {});
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(r.value.note ?? "Rien à annuler.");
    },
  );

  register<{ action: "play" | "stop"; bar?: number }>(server,
    "glane_transport",
    {
      title: "Lecture",
      description: "Lance ou arrête la lecture du séquenceur, éventuellement depuis une mesure.",
      inputSchema: {
        action: z.enum(["play", "stop"]),
        bar: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ action, bar }) => {
      const r = await bridge("transport", { action, bar }, 30_000);
      return r.ok ? ok(r.value) : r.res;
    },
  );

  return server;
}
