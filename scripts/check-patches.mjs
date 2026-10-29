// Applies patches/*.patch, in name order, to a clean copy of the pinned upstream tree. A patch that does not apply
// fails the check, so an upstream bump that breaks one of our fixes fails CI. With no patches/ folder it passes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "patches");
const patches = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".patch")).sort() : [];

if (patches.length === 0) {
  console.log("patches: none, nothing to check");
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "upstream-"));
try {
  const archive = execFileSync("git", ["-C", join(root, "upstream"), "archive", "HEAD"], { maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", work], { input: archive });
  let failed = false;
  for (const p of patches) {
    try {
      execFileSync("git", ["apply", "--verbose", join(dir, p)], { cwd: work, stdio: "pipe" });
      console.log(`patches: ${p} applies`);
    } catch (e) {
      failed = true;
      console.error(`patches: ${p} does NOT apply\n${e.stderr}`);
    }
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
