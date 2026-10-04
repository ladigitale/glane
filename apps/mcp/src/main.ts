import { createGlaneRelayServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.AGENT_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const { http } = createGlaneRelayServer({
  allowedOrigins,
  log: (m) => console.log(`[glane-mcp] ${m}`),
});

http.listen(port, () => {
  console.log(
    `[glane-mcp] listening on :${port} (origins: ${allowedOrigins.join(", ") || "any"})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => http.close(() => process.exit(0)));
}
