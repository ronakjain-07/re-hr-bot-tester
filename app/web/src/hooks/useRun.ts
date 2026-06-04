import { useReducer, useRef, useEffect, useCallback } from "react";
import type { RunMode, DepthTier, RunEnvironment } from "@hr/shared";
import { runReducer, initialRunState } from "../state/runReducer";
import { postJSON } from "../api/client";

export interface StartArgs {
  mode: RunMode;
  journeyIds: string[];
  environment?: RunEnvironment;
  depth?: DepthTier;
  maxSpecs?: number;
  dbOverrides?: Record<string, boolean>;
  specFiles?: string[];
  originalRunId?: string;
  originalReportFile?: string;
}

export function useRun() {
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const esRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const openStream = useCallback(
    (runId: string) => {
      closeStream();
      const es = new EventSource(`/api/runs/${runId}/stream`);
      esRef.current = es;
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          dispatch({ type: "event", e });
          if (e.type === "done") setTimeout(closeStream, 0);
        } catch {
          /* ignore */
        }
      };
      es.addEventListener("end", () => closeStream());
      // On server close EventSource would auto-reconnect; we already close on "end"/"done".
    },
    [closeStream]
  );

  const start = useCallback(
    async (args: StartArgs) => {
      dispatch({ type: "reset" });
      const { runId } = await postJSON<{ runId: string }>("/api/runs", args);
      dispatch({ type: "start", runId, mode: args.mode });
      openStream(runId);
    },
    [openStream]
  );

  const stop = useCallback(async () => {
    if (state.runId) await postJSON(`/api/runs/${state.runId}/stop`, {});
  }, [state.runId]);

  const ackGate = useCallback(async () => {
    if (state.runId) await postJSON(`/api/runs/${state.runId}/db-gate/ack`, {});
  }, [state.runId]);

  useEffect(() => () => closeStream(), [closeStream]);

  return { state, start, stop, ackGate };
}
