/**
 * In-memory registry of active/recent runs. Bounded event + log buffers (health: no unbounded
 * growth on long runs); old runs are evicted. Each run has an EventEmitter the SSE route subscribes to.
 */

import { EventEmitter } from "node:events";
import type { RunEvent, RunRecord, RunMode, DepthTier } from "@hr/shared";

const MAX_BUFFERED_EVENTS = 5000; // replay buffer cap per run
const MAX_RUNS_RETAINED = 30; // evict oldest finished runs beyond this

export interface RunHandle {
  id: string;
  record: RunRecord;
  emitter: EventEmitter;
  /** Bounded replay buffer so a late SSE subscriber can catch up. */
  events: RunEvent[];
  abort: AbortController;
  /** Set while the run is paused at a DB gate; calling it resumes the run. */
  gateResolver: (() => void) | null;
}

class RunRegistry {
  private runs = new Map<string, RunHandle>();

  create(id: string, mode: RunMode, journeyIds: string[], depth?: DepthTier): RunHandle {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    const handle: RunHandle = {
      id,
      record: {
        id,
        mode,
        depth,
        journeyIds,
        startedAtMs: Date.now(),
        done: false,
        paused: false,
        failedSpecs: [],
        dbGatePending: null,
      },
      emitter,
      events: [],
      abort: new AbortController(),
      gateResolver: null,
    };
    this.runs.set(id, handle);
    this.evict();
    return handle;
  }

  get(id: string): RunHandle | undefined {
    return this.runs.get(id);
  }

  list(): RunRecord[] {
    return [...this.runs.values()].map((h) => h.record);
  }

  /** Append to the bounded buffer and notify subscribers. */
  emit(id: string, event: RunEvent): void {
    const h = this.runs.get(id);
    if (!h) return;
    h.events.push(event);
    if (h.events.length > MAX_BUFFERED_EVENTS) {
      h.events.splice(0, h.events.length - MAX_BUFFERED_EVENTS);
    }
    h.emitter.emit("event", event);
  }

  finish(id: string): void {
    const h = this.runs.get(id);
    if (!h) return;
    h.record.done = true;
    h.emitter.emit("end");
  }

  private evict(): void {
    const finished = [...this.runs.values()].filter((h) => h.record.done);
    if (this.runs.size <= MAX_RUNS_RETAINED) return;
    finished
      .sort((a, b) => a.record.startedAtMs - b.record.startedAtMs)
      .slice(0, this.runs.size - MAX_RUNS_RETAINED)
      .forEach((h) => this.runs.delete(h.id));
  }
}

export const runRegistry = new RunRegistry();
