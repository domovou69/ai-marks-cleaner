# Plan — ai-marks-cleaner

A PWA on GitHub Pages that removes AI provenance marks from pasted text, plain-text files and DOCX / XLSX / PPTX
files. All processing runs in the browser; files never leave the device.

Started 2026-10-29. Related projects: [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain)
(GitHub Pages playground, monthly upstream watch, CI).

## 0. Health check

| Component | Latest release | Deprecation notices | Vendor direction | Verdict |
| --- | --- | --- | --- | --- |
| [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) (engine) | v0.7.0, 2026-09-03; `main` active (2026-10-26) | none found | adds Layer B (LLM) backends; `/clean` now needs one | yellow, 1 year: one maintainer, we call internal functions (`clean_text`, `clean_docx/xlsx/pptx`) that can be renamed. Mitigated by the adapter, the pin and the smoke test |
| Pyodide | 314.0.7, 2026-09-14 | none found | active, CPython-versioned releases | green, 3+ years |
| Vite | 8.3.5, 2026-10-21 | none found | active | green, 3+ years |
| vite-plugin-pwa (Workbox) | 2.0.0, 2026-10-03 | none found | active | green, 2+ years |
| TypeScript | 7.0.2, 2026-10-29 | none found | 7.x is the native (Go) compiler | green; pin 7.0.x, fall back to 5.9 if a tool breaks |
| Playwright | 1.64.1, 2026-10-29 | none found | active | green, 3+ years |
| GitHub Pages + Actions | — | none found | — | green |

Alternative to the yellow engine, only if the adapter breaks beyond a patch: re-implement Layer A (a short character
table) in TypeScript and keep upstream for OOXML only. Not planned.

## Why and what next

- Goal: one page where I paste text or drop an Office file and get it back without invisible Unicode carriers and
  provenance metadata, with a visual diff of what was removed.
- If v1 works on real files: the typography option (backlog 3). Golden snapshots (backlog 1) and the PDF spike (backlog 2, verdict go, [docs/pdf-spike.md](docs/pdf-spike.md)) are done; PDF support is a proposed stage 6.
- If upstream renames its internals: the smoke test fails on the bump PR; fix `adapter/engine.py` or add a patch.

## Constraints

- Host: macOS, Node and `gh` installed; Pyodide tests run in Node (no browser needed); Playwright downloads Chromium
  once (≈150 MB).
- Budget: usage window per day; no paid APIs.
- Public repository: yes (open code is the proof that files stay local; free Pages needs it). No local-only values
  are expected; if any appear they go to `*.local.*` (git-ignored).
- Personal use: no publishing to npm or dev.to, no analytics.

## Kit plugins

| Plugin / skill | What it gives this project | Scope |
| --- | --- | --- |
| `git-guard` | blocks commits to `main` and other branch mistakes | user (on) |
| `project-kit:kickoff`, `project-kit:retro` | this plan; lessons at the end | user (on) |
| `publishing` | not used: no npm / dev.to; the Pages part follows the previous project's `pages.yml` directly | — |

Kit gap (deferred): a recipe for "a wrapper over an upstream engine" (submodule pin to a release tag, adapter,
`patches/`, monthly release watch). Written as a claude-kit PR after stage 3, when the recipe is proven here.

## Lessons from the previous project

From the PR list of xpath-to-class-chain (no deep review, by decision).

| # | What it did | What it cost | Here |
| --- | --- | --- | --- |
| 1 | Edge-case fixes after release, one PR each (#64–#83) | ≈20 PRs plus three refactors to support them | Scope rule: only silently wrong output or a crash on real input is fixed now; the rest goes to `docs/known-issues.md` from stage 1 |
| 2 | CI ran on `push` and `pull_request` (#58) | double jobs on every commit | `push` only on `main`, PRs via `pull_request`, from the first workflow |
| 3 | Stacked PRs (#30 → #31, #32 on #31) | a change did not reach `main` | every PR targets `main` |
| 4 | Monthly upstream watch added late (#53) | separate plan PR and phase | the release watch is part of stage 3 |
| 5 | Playground (#60) then a fix (#61) | one fix PR | e2e test on the built site in the same stage as the UI |

## Scope

- In (v1):
  - Pasted text and plain-text files (`.txt`, `.md`, `.csv`, other UTF-8 text): Layer A.
  - DOCX / XLSX / PPTX: document properties, customXml, plus Layer A in body text. Add-in (webextension) parts are not removed: upstream has no code for it (known-issues #9).
  - Text preview: the cleaned text with removed / replaced characters marked in red, before copy or download.
  - Office files: cleaned file to download plus a report of what was removed.
  - Size limit 50 MB per file; one file at a time.
- Out: `.doc/.xls/.ppt` (rejected with a message), macro and template variants, images, audio, video, Layer B
  (statistical watermarks), batch processing.
- Backlog after v1, in this order: (1) golden snapshots for text / DOCX / XLSX / PPTX (done in stage 5) (fixed inputs: Russian text with
  a no-break space, astral characters, invisible characters; expected output kept in the repository, a difference
  fails the test and shows the diff; the inputs and expected text already exist in `tests/real-check/make-files.py`); wanted before the first upstream bump PR is merged, since that is when quiet
  behaviour changes start to matter; (2) PDF feasibility spike in Pyodide with a go / no-go note (done: go, own cleaner on pypdf; `docs/pdf-spike.md`); (3) visible
  typography cleanup (dashes, quotes) as an option, off by default, not based on upstream `humanize_pass.py`.

## Architecture

- `upstream/`: git submodule pinned to the latest upstream release tag; never edited in place.
- `adapter/engine.py`: the only file that knows upstream internals: `clean_text(str, options) -> dict`,
  `clean_file(name, bytes, options) -> dict` (result, notes, positions of changes for the preview).
- `patches/*.patch`: own fixes applied at build; a patch that does not apply fails CI.
- Build copies only the needed upstream `.py` files and `upstream/LICENSE` into the bundle.
- Frontend: TypeScript + Vite + vite-plugin-pwa; Pyodide in a Web Worker; Pyodide assets self-hosted (no CDN).
- Privacy: meta CSP `default-src 'self'`, `connect-src 'self'`; no analytics; output via `textContent` only.
- Layer A defaults: always remove invisible carriers (zero-width, word joiner, BOM, tag characters). Off by default,
  each a switch with a one-line explanation: `normalize_spaces` (NBSP and U+202F are correct typography in Russian),
  `nfkc`, `aggressive_homoglyphs` (could turn Cyrillic letters into Latin), `strip_emoji_glue`, `strip_bidi`.

## Stages

Times are wall clock; "window" is the share of one 5-hour usage window the stage costs (background runs and downloads
cost little window but take wall time). Each stage needs a "yes" before it starts.

| # | Stage | Output | Wall time | Window | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | Kickoff | PLAN.md, CLAUDE.md, public repo, plan PR | ≈15 min | ≈6 % | done |
| 1 | Engine in Node | submodule at v0.7.0, `adapter/engine.py`, Pyodide smoke test in Node (text + one DOCX / XLSX / PPTX), defaults as above, `docs/known-issues.md` | ≈45 min | ≈15 % | done |
| 2 | MVP PWA | Vite + TS app, worker, self-hosted Pyodide, paste / upload / download, red-marked preview, report, About with credits, CSP, offline service worker, Pages deploy workflow, one Playwright e2e on the build | ≈1.5 h | ≈30 % | done |
| 3 | CI, tests and release watch (cheaper path chosen 2026-10-29) | CI on PRs (smoke, e2e: offline, zero network after load including the worker, valid ZIP), patches check, monthly workflow that opens a PR when upstream has a new release tag. Golden snapshots moved to the backlog | ≈1 h | ≈20 % | done |
| 4 | Real-file check | generated files with every kind of mark (`tests/real-check/`) through the deployed page; one fix PR, rest in `docs/known-issues.md` #7–#17 | ≈50 min | ≈15 % | done (PR #12, #13) |
| 5 | Golden snapshots | `tests/golden/`: the stage 4 inputs go through `adapter/engine.py` in Pyodide; text, report notes, part list and changed XML parts are kept in `tests/golden/expected/`; a difference fails with a diff; wired into CI and `pages.yml` | ≈50 min | ≈15 % | done |
| 6 | PDF support (proposed, not started; needs a "yes") | `adapter/pdf.py` on pypdf, wheel and license in the bundle, UI accepts `.pdf`, fixtures, golden snapshots, smoke and e2e cases; details in `docs/pdf-spike.md`. Image pass is an optional +≈40 min | ≈1.5 h | ≈25 % | proposed |
| | Total (stages 0–5) | | ≈4 h over 3–4 sessions | ≈80 % of one window | |

Cheaper path, taken for stage 3: no golden snapshots (smoke + e2e only; a bump PR then shows breakage but not quiet
behaviour changes). The snapshots were added afterwards, in stage 5. Further saving: skip stage 4 (≈−10 % of a window).

Optional, not planned: LibreOffice headless check that cleaned files open without a repair prompt.

## Decisions

| Date | Decision | Why | By |
| --- | --- | --- | --- |
| 2026-10-29 | Engine: upstream watermarks-remover via Pyodide, no re-implementation | upstream fixes with a tag bump | user |
| 2026-10-29 | Public repository | proof that files stay local; free Pages | user |
| 2026-10-29 | Root LICENSE MIT under my name; upstream LICENSE kept next to its code in repo and bundle; THIRD_PARTY_NOTICES.md | MIT notice requirement | user |
| 2026-10-29 | Upstream sync: own workflow, every 30 days, releases only (not Dependabot, which follows branch tips) | unreleased commits are not wanted | user |
| 2026-10-29 | Layer A risky options off by default, shown as switches | texts are Russian, English, Belarusian, Ukrainian, Lithuanian; NBSP and Cyrillic must survive | proposed and accepted |
| 2026-10-29 | Text preview with removed places marked in red; Office files get a report | a visual diff is faster to check than a list | user |
| 2026-10-29 | Inputs: DOCX / XLSX / PPTX, pasted text, plain-text files; 50 MB limit | personal use | user |
| 2026-10-29 | No `publishing` plugin; site at domovou69.github.io/ai-marks-cleaner | personal use only | user |
| 2026-10-29 | Kit skill for upstream wrappers deferred until after stage 3 | write the recipe from a working example | user |
| 2026-10-29 | Stage 3 on the cheaper path: golden snapshots moved to the backlog (first item, before the first upstream bump is merged) | saves ≈10 % of a window; smoke + e2e already catch breakage | user |
| 2026-10-29 | CI runs on `pull_request` only (and `workflow_dispatch`), not on `push` to `main` | a run takes 3–5 min; a bug on `main` is still caught by the tests in `pages.yml` before deploy | user |
| 2026-10-29 | Stage 4 on generated files (the user has no sample files); one "full" and one "clean" file per type, no large-file or limit checks | covers every mark type and the legitimate Russian text without redundancy; large files cost tokens | user |
| 2026-10-29 | Release watch runs monthly (cron `0 6 1 * *`), not every exact 30 days; it dispatches CI on the bump branch | cron has no "every 30 days"; PRs opened with the default token do not start `pull_request` workflows | proposed |
| 2026-10-29 | Golden snapshots compare normalised slices (timestamps masked, XML one tag per line, images by structure), not bytes | the Office libraries stamp the current time: two generator runs give different DOCX / XLSX / PPTX bytes (only the text inputs are identical) | user |
| 2026-10-29 | PDF spike: go, but with our own cleaner on pypdf, not the upstream PDF path; hidden text (render mode 3, white) is reported, not removed; encrypted PDFs are rejected | upstream relies on exiftool, qpdf and Ghostscript and in Pyodide leaves Info, attachments and text untouched; render mode 3 is the OCR layer of scanned files | proposed (spike result), stage 6 awaits the user |

## Risks and limits

- Upstream renames internals: caught by the Node smoke test on the bump PR.
- Upstream adds an import Pyodide cannot load (e.g. a native module): same smoke test; fix by a stub in the adapter.
- Pyodide size (≈10 MB) on first load: cached by the service worker afterwards; the page shows load progress.
- 50 MB files in browser memory: Pyodide copies bytes in and out (≈3×); not checked in stage 4 (known-issues #17).

## Open questions

- None.
