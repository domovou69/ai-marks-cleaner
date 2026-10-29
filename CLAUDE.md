# Project rules

A browser-only PWA that removes AI provenance marks from text and Office files, wrapping the upstream
watermarks-remover engine through Pyodide. The plan and the status of each stage are in [PLAN.md](PLAN.md).

## Skills in use

- `project-kit:kickoff` / `project-kit:retro` — plan at the start, lessons at the end.

## Parameters

- Upstream: `guillaumemeyer/watermarks-remover`, submodule `upstream/`, pinned to a release tag (v0.7.0 at start).
- Site: https://domovou69.github.io/ai-marks-cleaner/ (Pages deploys from Actions after a merge to `main`).
- Pinned versions (Pyodide, Vite, vite-plugin-pwa, TypeScript, Playwright) live in `package.json` / lock file.

## Project rules

- `upstream/` is never edited in place. Own fixes go to `patches/*.patch`; fixes worth sharing go upstream as PRs.
- `adapter/engine.py` is the only file that imports upstream modules.
- Never copy upstream optional backends with other licenses (CtrlRegen, reverse-SynthID) or upstream `server.py`
  `/clean` (needs a Layer B backend).
- Every third-party file in the bundle ships with its license; new components get a row in THIRD_PARTY_NOTICES.md.
- No network requests at runtime: no CDN, no analytics, CSP `connect-src 'self'`. User data is shown with
  `textContent`, never `innerHTML`.
- Layer A options that change legitimate text (NBSP, NFKC, homoglyphs, emoji glue, bidi) stay off by default.
- Backlog of non-urgent findings: `docs/known-issues.md`.

## Commands

- Set up: `git submodule update --init && npm install`
- Smoke test (Pyodide in Node): `npm run test:smoke`
- Golden snapshots (needs `pip install -r tests/real-check/requirements.txt`): `npm run test:golden`; after an intended
  change `UPDATE_GOLDEN=1 npm run test:golden` and review the diff of `tests/golden/expected/`
