import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { RunSummary } from "@hr/shared";
import { SERVER_PORT, WEB_DIST } from "./config";
import { runRoutes } from "./routes/runs";
import { reportRoutes } from "./routes/reports";
import { journeyRoutes } from "./routes/journeys";

const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

app.get("/api/health", async () => {
  const summary: RunSummary = { total: 0, passed: 0, partial: 0, failed: 0, skipped: 0, automation: 0, scored: 0, pct: 0 };
  return { ok: true, version: "2.0.0", summary };
});

await journeyRoutes(app);
await runRoutes(app);
await reportRoutes(app);

// Serve the built React app in production; fall back to a tiny note in dev (Vite serves :5173).
const indexHtml = path.join(WEB_DIST, "index.html");
if (fs.existsSync(indexHtml)) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html");
  });
} else {
  app.get("/", (_req, reply) => {
    reply
      .type("text/html")
      .send(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#15110e;color:#eee;padding:40px">
        <h2 style="color:#ff6b2c">HR Bot Tester — API running on :${SERVER_PORT}</h2>
        <p>The React dashboard isn't built yet. In dev run <code>npm --prefix app run dev</code> and open the Vite URL,
        or build once with <code>npm --prefix app run build</code> and reload here.</p></body>`
      );
  });
}

app
  .listen({ host: "127.0.0.1", port: SERVER_PORT })
  .then(() => console.log(`[hr-tester] server listening on http://127.0.0.1:${SERVER_PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
