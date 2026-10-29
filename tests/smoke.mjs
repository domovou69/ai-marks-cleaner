// Stage 1 smoke test: run adapter/engine.py in Pyodide (Node) on text and one DOCX / XLSX / PPTX.
import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(root, "upstream/service/scripts");
const py = await loadPyodide();

py.FS.mkdirTree("/engine");
for (const f of ["text_unicode.py", "container_meta.py", "image_meta.py", "common.py"]) {
  py.FS.writeFile(`/engine/${f}`, readFileSync(join(scripts, f)));
}
py.FS.writeFile("/engine/engine.py", readFileSync(join(root, "adapter/engine.py")));
py.runPython("import sys; sys.path.insert(0, '/engine')");

// Fixtures are built in Python so the test needs no zip library.
py.runPython(`
import io, zipfile, engine
ZW = "\\u200b"
CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
CORE = '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>ChatGPT</dc:creator></cp:coreProperties>'
def make(parts):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CT)
        z.writestr("docProps/core.xml", CORE)
        for n, c in parts.items():
            z.writestr(n, c)
    return buf.getvalue()
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
DOCX = make({"word/document.xml": f'<?xml version="1.0"?><w:document {W}><w:body><w:p><w:r><w:t>he{ZW}llo\\u00a0world</w:t></w:r></w:p></w:body></w:document>'})
XLSX = make({"xl/sharedStrings.xml": f'<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>he{ZW}llo</t></si></sst>'})
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
PPTX = make({"ppt/slides/slide1.xml": f'<?xml version="1.0"?><p:sld {A} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:t>he{ZW}llo</a:t></p:sld>'})
`);

// Text: invisible carriers go, NBSP (Russian typography) and Cyrillic stay by default.
const t = py.runPython(`
r = engine.clean_text("при\\u00a0вет he\\u200bllo\\u2060 мир")
(r["text"], r["stats"]["removed_count"], r["changes"])
`).toJs({ dict_converter: Object.fromEntries });
assert.equal(t[0], "при вет hello мир");
assert.equal(t[1], 2);
assert.equal(t[2].length, 2);

const t2 = py.runPython(`engine.clean_text("a\\u00a0b", {"normalize_spaces": True})["text"]`);
assert.equal(t2, "a b");
assert.throws(() => py.runPython(`engine.clean_text("x", {"bogus": True})`), /unknown option/);

// Preview spans: applying them to the input must give the output, on the fast path (deletions only) and the diff path.
const spans = py.runPython(`
def apply(before, changes):
    out, at = [], 0
    for c in changes:
        out += [before[at:c["start"]], c["replacement"]]
        at = c["end"]
    return "".join(out) + before[at:]
cases = [
    ("", ""), ("abc", "abc"), ("\u200b", ""), ("\u200bab\u200b\u200bc\u200b", "abc"),
    ("a\\U000E0041b", "ab"),                       # astral character: spans count code points
    ("a\u00a0b\u200b", "a b"),                  # a replacement: falls back to the diff
]
ok = []
for before, after in cases:
    changes = engine._changes(before, after)
    ok.append(apply(before, changes) == after)
ok
`).toJs();
assert.deepEqual(spans, [true, true, true, true, true, true]);
assert.deepEqual(py.runPython(`engine._changes("a\\U000E0041b", "ab")`).toJs({ dict_converter: Object.fromEntries }), [{ start: 1, end: 2, replacement: "" }]);

// Speed: a long text with a zero-width space after every word must not take seconds.
const slow = py.runPython(`
import time
words = open("/engine/text_unicode.py").read().split()[:3000]
text = " ".join(w + "\u200b" for w in words)
t0 = time.time()
r = engine.clean_text(text)
(time.time() - t0, len(r["changes"]), len(words))
`).toJs();
assert.ok(slow[0] < 1.5, `long text took ${slow[0]} s`);
assert.equal(slow[1], slow[2]);

// Office: ZWSP removed from body, creator metadata dropped, NBSP kept, result is a valid ZIP.
for (const [name, marker] of [["docx", "word/document.xml"], ["xlsx", "xl/sharedStrings.xml"], ["pptx", "ppt/slides/slide1.xml"]]) {
  const out = py.runPython(`
import io, zipfile
r = engine.clean_file("Test.${name.toUpperCase()}", ${name.toUpperCase()})
z = zipfile.ZipFile(io.BytesIO(r["data"]))
assert z.testzip() is None
body = z.read("${marker}").decode()
core = z.read("docProps/core.xml").decode() if "docProps/core.xml" in z.namelist() else ""
(("\\u200b" in body), ("ChatGPT" in core), ("\\u00a0" in body), len(r["notes"]) > 0)
`).toJs();
  assert.deepEqual(out, [false, false, name === "docx", true], `${name}: ${out}`);
  console.log(`ok ${name}`);
}
assert.throws(() => py.runPython(`engine.clean_file("a.pdf", b"")`), /unsupported/);
console.log("ok text");
