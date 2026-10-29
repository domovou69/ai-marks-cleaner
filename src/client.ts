import type { FileResult, Options, Request, Response, TextResult } from "./protocol";

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };

export const CANCELLED = "Cancelled";

/**
 * Promise wrapper around the engine worker. A running Python call cannot be interrupted, so `cancel()` ends the
 * worker and starts a fresh one (the runtime reloads from the cache in a few seconds).
 */
export class EngineClient {
  private worker!: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Replaced by `cancel()`; read it again after cancelling. */
  ready!: Promise<void>;

  constructor(private onStatus: (message: string) => void) {
    this.start();
  }

  private start() {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<Response>) => {
        const msg = event.data;
        if (msg.kind === "status") this.onStatus(msg.message);
        else if (msg.kind === "ready") resolve();
        else if (msg.kind === "fatal") reject(new Error(msg.error));
        else {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id);
          if (msg.kind === "error") p.reject(new Error(msg.error));
          else (p.resolve as (v: unknown) => void)(msg.result);
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "Worker failed"));
    });
  }

  /** Drops every request in flight (they reject with CANCELLED) and restarts the engine. */
  cancel() {
    this.worker.terminate();
    const error = new Error(CANCELLED);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.start();
  }

  private call<T>(build: (id: number) => Request, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage(build(id), transfer);
    });
  }

  cleanText(text: string, options: Options): Promise<TextResult> {
    return this.call((id) => ({ id, kind: "text", text, options }));
  }

  cleanFile(name: string, data: ArrayBuffer, options: Options): Promise<FileResult> {
    return this.call((id) => ({ id, kind: "file", name, data, options }), [data]);
  }
}
