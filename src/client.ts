import type { FileResult, Options, Request, Response, TextResult } from "./protocol";

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };

/** Promise wrapper around the engine worker. Only the latest text request matters; older ones are dropped. */
export class EngineClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private pending = new Map<number, Pending>();
  private nextId = 1;
  readonly ready: Promise<void>;

  constructor(onStatus: (message: string) => void) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<Response>) => {
        const msg = event.data;
        if (msg.kind === "status") onStatus(msg.message);
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
      this.worker.onerror = (e) => reject(new Error(e.message || "Worker failed"));
    });
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
