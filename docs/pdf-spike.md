# PDF spike (backlog 2)

Question: can the page clean a PDF in the browser, in Pyodide, with no network?

**Verdict: GO, with our own cleaner on [pypdf](https://github.com/py-pdf/pypdf), not with the upstream PDF path.**
Estimated implementation stage: ≈1.5 h wall, ≈25 % of one 5-hour window (≈2.2 h, ≈35 % with the image pass).

Spike date 2026-10-29. Pyodide 314.0.7 (Python 3.14) in Node, upstream v0.7.0, pypdf 6.21.4. Test files were
generated (no real AI-made PDFs available), see "What was tested".

## What upstream does for PDF

`container_meta.clean_pdf` (called from `clean_container`) is a wrapper around external programs: `exiftool -all=`
(Info and XMP), `qpdf --linearize` (drops the freed objects), Ghostscript `pdfwrite` (metadata inside embedded
images). None of them exists in Pyodide. Without them it falls back to `_blank_xmp_packets`: XMP packets are
overwritten with spaces, byte offsets kept, nothing else is touched.

Run in Pyodide on the generated files, the upstream path gave:

| Mark | Removed by upstream in Pyodide |
| --- | --- |
| XMP packet (document and page) | yes, blanked (it scans raw bytes, so a Flate-compressed XMP stream would be missed; not tested) |
| Info dictionary (`Author` ChatGPT, `Creator`, custom key) | **no** |
| Embedded files (`/EmbeddedFiles`, `FileAttachment` annotations) | **no** |
| Annotation author (`/T`) and text | **no** |
| Zero-width characters in page text | **no** (upstream has no PDF text path) |
| Hidden text (render mode 3, white) | no, and not reported |

Its result says `changed: True` (the XMP was blanked) and carries the warning "metadata inside embedded images left
in place; install ghostscript". It also lists `pdf-structured:ai:OpenAI` among the post-clean findings, so the
leftover is visible to a caller that reads them, but the file still names `ChatGPT` and `OpenAI`. A page that
shows "changed" as success would hand back a mostly unclean file, so the adapter should replace this path, not wrap it.

## What a pypdf cleaner removes

Prototype, ≈150 lines, run in Pyodide (not committed; the design is below).

| Mark | Removed | How |
| --- | --- | --- |
| Info dictionary | yes | drop `/Info` from the trailer |
| XMP, document and page level | yes | drop `/Metadata` from the catalog and from each page |
| Embedded files | yes | drop `/Names/EmbeddedFiles`, `/AF`, `FileAttachment` annotations |
| Annotation author | yes | blank `/T` |
| Old revisions (incremental updates) | yes | full rewrite: the output has one revision, old Info and XMP bytes are gone |
| Zero-width / BOM / soft hyphen in page text | yes, when the font has a `/ToUnicode` map | drop the glyph codes that map to a carrier in `Tj` / `TJ` strings; the page renders pixel-identical |
| Hidden text (render mode 3, white fill) | **report only** | render mode 3 is also the OCR layer of every scanned PDF; stripping it would break search |
| Metadata inside images (EXIF, C2PA in JPEG `APP11`) | **not tested** | see "Open" |

Leftover check: the cleaned file was searched for every mark (raw bytes, every decoded stream, every object); none
was found. Text extracted before and after is equal apart from the carriers. Page count, outlines and the other
catalog keys survive. A Quick Look (PDFKit) render of the cleaned file is pixel-identical to the original.

### Design notes (pitfalls found, so the stage does not rediscover them)

- Edit the **reader's** object graph first, then `PdfWriter(clone_from=reader)`: the writer copies only what is
  reachable, so freed objects never reach the output. Deleting from the writer (`writer._info = None`,
  `del root[...]`, `compress_identical_objects`) left the orphaned attachment and XMP objects in the file.
- `reader.pages[i]` returns a copy: edits do not reach the clone. Walk `/Pages` → `/Kids` and edit the page
  dictionaries in place.
- Replace page text with `page.replace_contents(ContentStream)`; setting a new `/Contents` object leaves the old
  stream, with the carriers, in the file.
- Only parse content streams for pages that have a font mapping some code to a carrier (precheck on `/ToUnicode`).
  Parsing costs ≈20 ms per text page: 215 pages took 4.3 s with the parse, 66 ms without it. Hidden-text detection
  needs the parse, so it is either an option or limited to pages that pass the precheck.

## Does it run in Pyodide

| Item | Result |
| --- | --- |
| pypdf in Pyodide | pure Python, no native part; the wheel is put on `sys.path` (zipimport), no micropip, no network |
| Added to the bundle | pypdf wheel 410 KB (≈4 % of the ≈10 MB Pyodide payload); loaded only when a PDF is chosen |
| Import time | ≈0.6 s cold (Node, Apple silicon) |
| Time, 37 KB / 1 MB / 5 MB / 37 MB PDF | 15 ms / 53 ms / 125 ms / 234 ms (images dominate; they are copied, not decoded) |
| Time, 263 KB text PDF, 215 pages | 4.3 s with hidden-text detection, 66 ms without it |
| Memory, 37 MB PDF | peak RSS ≈580 MB for the whole Node process (≈200 MB before the file); Pyodide heap 193 MB. ≈10× the file, in line with Office files (known-issues #17) |
| Output size | +1–2 KB (objects are written uncompressed; no linearization) |
| Encrypted PDF | needs `cryptography` (+ `cffi`, `pycparser`, `six`, ≈2.4 MB) for AES. Not worth it: reject with a clear message |
| Licenses | pypdf is BSD-3-Clause: ship its license, add a THIRD_PARTY_NOTICES row |

Upstream's own PDF code (`container_meta.py`) already imports in Pyodide (it did for DOCX / XLSX / PPTX); only its
external programs are missing.

## What was tested

- Generated with reportlab + pypdf: three files of 38 KB, 1 MB, 5 MB and one of 37 MB, each with Info, document and
  page XMP, a name-tree attachment, a `FileAttachment` annotation, a zero-width space inside visible text, a
  render-mode-3 run and a white-on-white run; plus a copy with an incremental update and an outline.
- Generated with Chromium's PDF printer (Skia, Type0 fonts with `/ToUnicode`): 2 pages and 215 pages. Chromium
  drops zero-width spaces before they reach the font, so these files show only that Info is removed and that
  structure and text survive.
- Checks: leftover search (raw and decoded), text equality, page count, catalog keys, pixel diff of a Quick Look render.

## Open (not tested, decide at the stage)

1. **Images.** C2PA / EXIF inside an embedded JPEG (`APP1`, `APP11`) and `/Metadata` streams on image or form
   XObjects. This is the likely place of real AI provenance in a PDF with pictures. Feasible in pure Python without
   recompression (drop the `APPn` segments of the raw DCT stream; upstream's `_iter_jpeg_segments` shows the walk), but not
   tried. ≈+40 min. PNG / JPEG 2000 / Flate-coded images would be left as is and said so in the report.
2. **Type0 fonts with a carrier.** The 2-byte code path is written but only run on a unit-sized case; no real file
   with a zero-width glyph in a Type0 font was available. A PDF made by Word or LibreOffice should be tried first.
3. **Files from real producers.** Word, Acrobat and Google Docs PDFs use object streams and cross-reference
   streams; pypdf reads them, but the spike had none. The cleaned file was not opened in Acrobat / Preview as a
   user (Quick Look only).
4. **Digital signatures.** A signed PDF is rewritten, so the signature becomes invalid. Say so in the report, or refuse.
5. **Forms, tagged PDF, JavaScript.** Cloned as they are; not checked individually.

## Proposed stage (after "yes")

Not part of this PR. Order of work:

1. `adapter/pdf.py`: the pypdf cleaner above, called from `engine.clean_file` for `.pdf`; notes in the same shape as the
   Office ones. `engine.py` stays the only file that imports upstream.
2. Bundle: copy the pypdf wheel and its license in `prepare-assets.mjs`; lazy-load on first PDF; THIRD_PARTY_NOTICES row.
3. UI: accept `.pdf`; report lists what was removed and what was only seen (hidden text, signature, images left);
   message for encrypted and damaged files (shares the text of known-issues #12).
4. Tests: PDF fixtures in `tests/real-check/make-files.py` (adds reportlab to `requirements.txt`), a leftover
   checker, golden snapshots (normalised: object numbers and dates masked), smoke case, one e2e file.
5. Optional second step: the image pass (Open 1).

Risk: pypdf is one more upstream that can change (the spike met two surprises in its API); pin the version and let the
golden test catch changes, as for watermarks-remover.
