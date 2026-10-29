// Golden snapshots: fixed inputs go through adapter/engine.py in Pyodide (as in smoke.mjs) and the result is compared
// with the files in tests/golden/expected/. A difference fails the test and prints a diff.
//
// Inputs come from tests/real-check/make-files.py, which needs the Python libraries in its requirements.txt
// (PYTHON=/path/to/python overrides python3). Their bytes change on every run (the libraries write the current
// time), so snapshot.py compares normalised slices, never raw bytes.
//
// Intended change of behaviour (upstream bump, adapter fix): UPDATE_GOLDEN=1 npm run test:golden, then review the diff.
import { loadPyodide } from "pyodide";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const expectedDir = join(root, "tests/golden/expected");
const update = process.env.UPDATE_GOLDEN === "1";
const python = process.env.PYTHON ?? "python3";

const inputs = [
  "text/ru-mixed.txt",
  "text/ru-mixed-paste.txt",
  ...["docx", "xlsx", "pptx"].flatMap((ext) => ["full", "clean"].map((kind) => `office/${kind}-${ext}.${ext}`)),
];

const work = mkdtempSync(join(tmpdir(), "golden-"));
try {
  const gen = spawnSync(python, ["-I", join(root, "tests/real-check/make-files.py"), work], { encoding: "utf8" });
  if (gen.status !== 0) {
    throw new Error(`Input generator failed (${python}); install tests/real-check/requirements.txt first:\n${gen.stderr || gen.error}`);
  }

  const py = await loadPyodide();
  py.FS.mkdirTree("/engine");
  const scripts = join(root, "upstream/service/scripts");
  for (const f of ["text_unicode.py", "container_meta.py", "image_meta.py", "common.py"]) {
    py.FS.writeFile(`/engine/${f}`, readFileSync(join(scripts, f)));
  }
  py.FS.writeFile("/engine/engine.py", readFileSync(join(root, "adapter/engine.py")));
  py.FS.writeFile("/engine/snapshot.py", readFileSync(join(root, "tests/golden/snapshot.py")));
  py.runPython("import sys; sys.path.insert(0, '/engine')");
  const build = py.runPython("import snapshot; snapshot.build");
  // The generator's output (inputs and the *.expected.json lists) is copied into Pyodide's file system.
  for (const dir of ["text", "office"]) {
    py.FS.mkdirTree(`/in/${dir}`);
    for (const f of readdirSync(join(work, dir))) py.FS.writeFile(`/in/${dir}/${f}`, readFileSync(join(work, dir, f)));
  }

  const failures = [];
  const writes = [];
  const seen = new Set();
  for (const rel of inputs) {
    const label = rel.replace(/\.[^.]+$/, "").replace("/", "-");
    seen.add(`${label}.json`);
    const [actual, problems] = build(rel).toJs();
    for (const p of problems) failures.push(`${label}: ${p}`);

    const file = join(expectedDir, `${label}.json`);
    if (update) {
      writes.push([file, actual]);
    } else if (!existsSync(file)) {
      failures.push(`${label}: no expected file; run UPDATE_GOLDEN=1 npm run test:golden`);
    } else if (readFileSync(file, "utf8") !== actual) {
      const got = join(work, `${label}.actual.json`);
      writeFileSync(got, actual);
      const diff = spawnSync("diff", ["-u", "--label", `expected/${label}.json`, "--label", `actual/${label}.json`, file, got], { encoding: "utf8" });
      failures.push(`${label}: output differs from tests/golden/expected/${label}.json\n${diff.stdout}`);
    } else {
      console.log(`ok ${label}`);
    }
  }
  for (const f of readdirSync(expectedDir)) {
    if (!seen.has(f) && !update) failures.push(`${f}: expected file without an input; delete it`);
  }

  // A run with any failure writes nothing: a snapshot that fails the independent checks must not become the new truth.
  if (update && !failures.length) {
    for (const [file, text] of writes) writeFileSync(file, text);
    for (const f of readdirSync(expectedDir)) if (!seen.has(f)) rmSync(join(expectedDir, f));
    console.log(`updated ${seen.size} files in tests/golden/expected; review the diff before committing`);
  }
  if (failures.length) {
    console.error(`\n${failures.join("\n\n")}\n\n${failures.length} golden failure(s).${update ? "" : " If the change is intended: UPDATE_GOLDEN=1 npm run test:golden and review the diff."}`);
    process.exitCode = 1; // not process.exit(): the finally block below removes the temp directory
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
