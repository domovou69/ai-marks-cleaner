import { loadPyodide, type PyodideAPI } from "pyodide";
import type { Request, Response } from "./protocol";

const ENGINE_FILES = ["text_unicode.py", "container_meta.py", "image_meta.py", "common.py", "engine.py"];

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: Response, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

async function boot(): Promise<PyodideAPI> {
  const base = import.meta.env.BASE_URL;
  send({ kind: "status", message: "Loading the Python runtime…" });
  const py = await loadPyodide({ indexURL: `${base}pyodide/` });
  send({ kind: "status", message: "Loading the cleaning engine…" });
  py.FS.mkdirTree("/engine");
  for (const file of ENGINE_FILES) {
    const response = await fetch(`${base}engine/${file}`);
    if (!response.ok) throw new Error(`Cannot load ${file} (${response.status})`);
    py.FS.writeFile(`/engine/${file}`, new Uint8Array(await response.arrayBuffer()));
  }
  py.runPython("import sys; sys.path.insert(0, '/engine'); import engine");
  return py;
}

const ready = boot();
ready.then(
  () => send({ kind: "ready" }),
  (e) => send({ kind: "fatal", error: String(e) }),
);

scope.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    const py = await ready;
    const engine = py.pyimport("engine");
    const options = py.toPy(req.options);
    try {
      if (req.kind === "text") {
        const r = engine.clean_text(req.text, options);
        const result = r.toJs({ dict_converter: Object.fromEntries });
        r.destroy();
        send({
          id: req.id,
          kind: "text",
          result: { text: result.text, removed: result.stats.removed_count ?? 0, changes: result.changes },
        });
      } else {
        const r = engine.clean_file(req.name, new Uint8Array(req.data), options);
        const result = r.toJs({ dict_converter: Object.fromEntries });
        r.destroy();
        send({ id: req.id, kind: "file", result: { data: result.data, notes: result.notes } }, [result.data.buffer]);
      }
    } finally {
      options.destroy();
      engine.destroy();
    }
  } catch (e) {
    // Python errors carry a long traceback; the last line is the message.
    const text = String(e).trim().split("\n").pop() ?? String(e);
    send({ id: req.id, kind: "error", error: text });
  }
};
