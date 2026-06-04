import type { FastifyInstance } from "fastify";
import type { RunEvent, RunMode, DepthTier, RunEnvironment } from "@hr/shared";
import { runRegistry } from "../store/runRegistry";
import { runSuite } from "../engine/runOrchestrator";

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // Start a run (fire-and-forget; progress via the SSE stream).
  app.post("/api/runs", async (req, reply) => {
    const body = (req.body || {}) as {
      mode?: string;
      journeyIds?: unknown;
      specFiles?: unknown;
      depth?: DepthTier;
      maxSpecs?: number;
      dbOverrides?: Record<string, boolean>;
      environment?: string;
      originalRunId?: string;
      originalReportFile?: string;
    };
    const mode: RunMode = body.mode === "manual" ? "manual" : "agentic";
    const environment: RunEnvironment = body.environment === "sandbox" ? "sandbox" : "production";
    const journeyIds = Array.isArray(body.journeyIds) ? body.journeyIds.map(String) : [];
    const specFiles = Array.isArray(body.specFiles) ? body.specFiles.map(String) : [];
    if (!journeyIds.length && !specFiles.length) {
      reply.code(400).send({ error: "journeyIds or specFiles required" });
      return;
    }

    const id = String(Date.now());
    const handle = runRegistry.create(id, mode, journeyIds, body.depth);

    runSuite(handle, {
      mode,
      journeyIds,
      environment,
      depth: body.depth,
      maxSpecs: body.maxSpecs,
      specFiles,
      dbOverrides: body.dbOverrides,
      originalRunId: typeof body.originalRunId === "string" ? body.originalRunId : undefined,
      originalReportFile: typeof body.originalReportFile === "string" ? body.originalReportFile : undefined,
    }).catch((e: unknown) => {
      runRegistry.emit(id, { type: "log", text: `Run crashed: ${(e as Error).message}`, level: "error" });
      runRegistry.finish(id);
    });

    return { runId: id };
  });

  // Live event stream (SSE). Replays the buffered events, then streams new ones.
  app.get("/api/runs/:id/stream", (req, reply) => {
    const { id } = req.params as { id: string };
    const h = runRegistry.get(id);
    if (!h) {
      reply.code(404).send({ error: "no such run" });
      return;
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (e: RunEvent) => raw.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of h.events) send(e);
    if (h.record.done) {
      raw.write("event: end\ndata: {}\n\n");
      raw.end();
      return;
    }

    const onEvent = (e: RunEvent) => send(e);
    const cleanup = () => {
      h.emitter.off("event", onEvent);
      h.emitter.off("end", onEnd);
    };
    const onEnd = () => {
      raw.write("event: end\ndata: {}\n\n");
      raw.end();
      cleanup();
    };
    h.emitter.on("event", onEvent);
    h.emitter.on("end", onEnd);
    req.raw.on("close", cleanup);
  });

  // Cancel a run.
  app.post("/api/runs/:id/stop", async (req) => {
    const { id } = req.params as { id: string };
    const h = runRegistry.get(id);
    if (h) h.abort.abort();
    return { ok: !!h };
  });

  // Acknowledge a DB gate ("Done — DB cleared, continue").
  app.post("/api/runs/:id/db-gate/ack", async (req) => {
    const { id } = req.params as { id: string };
    const h = runRegistry.get(id);
    if (h?.gateResolver) {
      h.gateResolver();
      return { ok: true };
    }
    return { ok: false };
  });
}
