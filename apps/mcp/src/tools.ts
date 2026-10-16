import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ExprRoleSchema,
  SampleClassSchema,
} from "@glane/core-model";
import {
  BakeFxSchema,
  LIBRARY_MAX_LIMIT,
  LibraryUpdateFieldsSchema,
  SampleListSchema,
  ScoreSchema,
  SynthConfigSchema,
  describeCapabilities,
  type BridgeMethod,
  type BridgeMethodMap,
} from "@glane/agent";
import { NoAppConnectedError, type Relay } from "./relay.js";

export const SERVER_INSTRUCTIONS = `Glane est un instrument de field recording : captures → synthèse optionnelle → bibliothèque → séquenceur 6 pistes.
Ce connecteur pilote l'onglet Glane ouvert par l'utilisateur (les sons restent sur son appareil).

Parcours typique :
1. glane_status — app ouverte, projet courant.
2. glane_guide une fois — synth, biblio, FX bake, syntaxe de partition.
3. Optionnel : glane_synth_generate pour créer des sons (config → génération → save biblio en one-shot).
4. glane_library pour lister les sons ; glane_library_update / delete / duplicate / crop pour les muter ; glane_bake_fx pour baker un insert sur un son.
5. glane_write_arrangement (play: true) pour composer ; glane_undo_write pour annuler ; glane_get_arrangement pour relire.

Tu n'entends pas le rendu : appuie-toi sur les descripteurs, privilégie favoris et notes, structure claire (sections), et décris ce que tu as construit pour que l'utilisateur te guide à l'oreille.`;

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

  register<BridgeMethodMap["synth.generate"]["params"]>(server,
    "glane_synth_generate",
    {
      title: "Synthèse → bibliothèque",
      description:
        "Configure, génère et enregistre des sons synthétiques dans la bibliothèque du projet (one-shot, pas de brouillon). Voir glane_guide section Synthèse. Timeout long (rendu OfflineAudioContext).",
      inputSchema: {
        mode: SynthConfigSchema.shape.mode,
        intention: SynthConfigSchema.shape.intention,
        coherence: SynthConfigSchema.shape.coherence,
        tonicPc: SynthConfigSchema.shape.tonicPc,
        scaleMode: SynthConfigSchema.shape.scaleMode,
        bpm: SynthConfigSchema.shape.bpm,
        freeFmRatios: SynthConfigSchema.shape.freeFmRatios,
        seed: SynthConfigSchema.shape.seed,
        cards: SynthConfigSchema.shape.cards,
        open: SynthConfigSchema.shape.open,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("synth.generate", args, 180_000);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
    },
  );

  register<BridgeMethodMap["library.update"]["params"]>(server,
    "glane_library_update",
    {
      title: "Modifier des sons",
      description:
        "Met à jour favori, note (1–5 ou null), nom, rôle générateur forcé, tags (add/remove) sur un ou plusieurs sons (ids courts ok).",
      inputSchema: {
        samples: LibraryUpdateFieldsSchema.shape.samples,
        favorite: LibraryUpdateFieldsSchema.shape.favorite,
        rating: LibraryUpdateFieldsSchema.shape.rating,
        name: LibraryUpdateFieldsSchema.shape.name,
        forceRole: LibraryUpdateFieldsSchema.shape.forceRole,
        addTags: LibraryUpdateFieldsSchema.shape.addTags,
        removeTags: LibraryUpdateFieldsSchema.shape.removeTags,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("library.update", args);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
    },
  );

  register<BridgeMethodMap["library.delete"]["params"]>(server,
    "glane_library_delete",
    {
      title: "Supprimer des sons",
      description: "Supprime des sons de la bibliothèque (et leurs clips associés).",
      inputSchema: { samples: SampleListSchema.shape.samples },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("library.delete", args);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
    },
  );

  register<BridgeMethodMap["library.duplicate"]["params"]>(server,
    "glane_library_duplicate",
    {
      title: "Dupliquer des sons",
      description: "Duplique des sons dans le projet courant (nouvelle copie PCM + nom « (copie) »).",
      inputSchema: { samples: SampleListSchema.shape.samples },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("library.duplicate", args);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
    },
  );

  register<BridgeMethodMap["library.crop"]["params"]>(server,
    "glane_library_crop",
    {
      title: "Auto-crop des sons",
      description: "Recadre attaques tardives et queues silencieuses (même logique que l'UI).",
      inputSchema: { samples: SampleListSchema.shape.samples },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("library.crop", args, 60_000);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
    },
  );

  register<BridgeMethodMap["sample.bake_fx"]["params"]>(server,
    "glane_bake_fx",
    {
      title: "Baker FX sur un son",
      description:
        "Applique un insert FX (même schéma que les pistes) sur tout le PCM d'un son et le réenregistre. Voir glane_guide section fx.",
      inputSchema: {
        sample: BakeFxSchema.shape.sample,
        fx: BakeFxSchema.shape.fx as unknown as z.ZodTypeAny,
        bpm: BakeFxSchema.shape.bpm,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = await bridge("sample.bake_fx", args, 60_000);
      if (!r.ok) return r.res;
      return r.value.ok ? ok(r.value) : fail(JSON.stringify({ errors: r.value.errors }, null, 1));
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
