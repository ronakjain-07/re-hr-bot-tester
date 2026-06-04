/**
 * Thin client around OpenAI /v1/chat/completions (native fetch, strict JSON).
 * Ported from testAgent.js callOpenAI — default maxTokens raised 200 → 600 so longer
 * planner JSON (action + value + rationale) is never truncated (a "specs not ending fully" cause).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callOpenAI<T = any>(
  messages: ChatMessage[],
  apiKey: string,
  { model = "gpt-4.1", maxTokens = 600, temperature = 0 }: OpenAIOptions = {}
): Promise<T> {
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  // Retry transient failures (429 / 5xx / network / truncated JSON) with exponential backoff so one
  // blip doesn't abort a whole scenario (a big "NOT SCORED" cause). 3 attempts.
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      lastErr = `request failed: ${(e as Error).message}`;
      continue; // network / timeout → retry
    }

    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      continue; // transient → retry
    }

    const raw = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      lastErr = `response parse error: ${(e as Error).message}`;
      continue;
    }
    if (parsed.error) {
      lastErr = `API: ${parsed.error.message}`;
      // 4xx (bad request) won't fix itself — fail fast unless it's a rate-limit message
      if (!/rate limit|overloaded|temporarily/i.test(String(parsed.error.message || ""))) {
        throw new Error(`OpenAI ${lastErr}`);
      }
      continue;
    }

    const content = String(parsed.choices?.[0]?.message?.content || "").trim();
    const finish = parsed.choices?.[0]?.finish_reason;
    const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      const out = JSON.parse(jsonStr) as T;
      return out;
    } catch (e) {
      // truncated/garbled JSON (often finish_reason "length") → retry
      lastErr = `content not JSON${finish ? ` (finish=${finish})` : ""}: ${(e as Error).message}. Content: ${content.slice(0, 200)}`;
      continue;
    }
  }
  throw new Error(`OpenAI failed after retries — ${lastErr}`);
}
