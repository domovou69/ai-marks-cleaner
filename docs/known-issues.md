# Known issues

Backlog of non-urgent findings. Fix-on-touch: an item is fixed together with a change that already edits that code.

| # | Finding | Priority | Real data hits it | Fix when |
| --- | --- | --- | --- | --- |
| 1 | Office bodies honour only `normalize_spaces`; `nfkc`, `aggressive_homoglyphs`, `strip_emoji_glue`, `strip_bidi` apply to text only. Upstream `clean_docx/xlsx/pptx` have no such parameters. | P3 | no (defaults are off, so output matches) | UI greys the switches out for Office files (stage 2). Revisit only if upstream gains the parameters |
| 2 | Upstream `clean_docx/xlsx/pptx` default `normalize_spaces=True` (NBSP becomes a space). The adapter always passes the value explicitly, so the default is ours. | P3 | no | never, unless upstream changes the signature (the smoke test would fail) |
| 3 | Preview positions come from the adapter, not from upstream. When the cleaning only deletes characters (the default case) they are found in one pass, fast. When it also replaces characters (`normalize_spaces`, `nfkc`, `aggressive_homoglyphs`) they come from a `difflib` diff, whose time grows much faster than the text: with a zero-width space after every word 2 100 characters took 0.1 s, 6 900 took 1.5 s, 19 800 took 12 s. The run can be cancelled from the page. | P3 | rarely (long text with many marks and one of those options on) | when a real paste with such an option feels slow. Idea: align replaced characters one to one when input and output have equal length after the deletions |
| 5 | `scripts/prepare-assets.mjs` does not apply `patches/*.patch` yet; the patches check only proves they apply. The first patch would pass CI and still not reach the bundle. | P2 | no (`patches/` does not exist yet) | with the first patch: apply the patches to the copied upstream files in `prepare-assets.mjs` |
| 6 | Pages deploys run smoke and e2e again after the same tests passed on the PR (≈3–5 min per deploy). | P3 | yes, every merge | if the wait annoys: drop the tests from `pages.yml` (CI on the PR is the gate) |
