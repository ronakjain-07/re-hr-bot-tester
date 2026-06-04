import type { FastifyInstance } from "fastify";
import { AGENT_FLOWS_DIR } from "../config";
import { loadAgentFlowGroups } from "../specs/loader";
import { getBrief, setBrief, hasBrief } from "../llm/journeyBriefs";
import { generateJourneySpecs, saveGeneratedSpecs, specCountForDepth } from "../llm/generateSpecs";
import { DB_DEFAULT_GROUPS } from "../dbgate/dbGate";
import { isAhcGroup } from "../specs/ahcGroups";

export async function journeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/journeys", async () => {
    const groups = loadAgentFlowGroups(AGENT_FLOWS_DIR);
    return groups
      .filter((g) => g.testCases.length > 0)
      .map((g) => ({
        id: g.id,
        name: g.name,
        specCount: g.testCases.length,
        hasBrief: hasBrief(g.id),
        requiresDbDeleteDefault: DB_DEFAULT_GROUPS.has(g.id) || isAhcGroup(g.id),
        tags: [],
      }));
  });

  app.get("/api/journeys/:id/brief", async (req) => {
    const { id } = req.params as { id: string };
    return { brief: getBrief(id) };
  });

  app.put("/api/journeys/:id/brief", async (req) => {
    const { id } = req.params as { id: string };
    const { brief } = (req.body || {}) as { brief?: string };
    const saved = setBrief(id, String(brief || ""));
    return { ok: true, brief: saved };
  });

  app.post("/api/journeys/:id/generate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { instructions?: string; brief?: string; count?: number };
    const count = Math.max(1, Math.min(40, Number(body.count) || specCountForDepth(75)));
    try {
      const specs = await generateJourneySpecs({
        groupId: id,
        count,
        customInstructions: body.instructions,
        briefOverride: body.brief,
      });
      const { written, skipped } = saveGeneratedSpecs(id, specs);
      return { ok: true, generated: specs.length, written: written.length, skipped, files: written };
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });
}
