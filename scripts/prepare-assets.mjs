// Copies the files the site serves itself (no CDN) into public/: the Pyodide runtime, the four upstream
// engine modules, our adapter, and the license texts that must ship with them. public/{pyodide,engine,licenses}
// are generated and git-ignored.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");
const copy = (from, to) => cpSync(join(root, from), join(out, to));

for (const d of ["pyodide", "engine", "licenses"]) rmSync(join(out, d), { recursive: true, force: true });
for (const d of ["pyodide", "engine", "licenses"]) mkdirSync(join(out, d), { recursive: true });

for (const f of ["pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  copy(`node_modules/pyodide/${f}`, `pyodide/${f}`);
}
for (const f of ["text_unicode.py", "container_meta.py", "image_meta.py", "common.py"]) {
  copy(`upstream/service/scripts/${f}`, `engine/${f}`);
}
copy("adapter/engine.py", "engine/engine.py");
copy("upstream/LICENSE", "engine/LICENSE");
copy("licenses/pyodide-LICENSE", "licenses/pyodide-LICENSE");
copy("THIRD_PARTY_NOTICES.md", "licenses/THIRD_PARTY_NOTICES.md");
