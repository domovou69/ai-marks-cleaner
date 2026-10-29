# Known issues

Backlog of non-urgent findings. Fix-on-touch: an item is fixed together with a change that already edits that code.

| # | Finding | Priority | Real data hits it | Fix when |
| --- | --- | --- | --- | --- |
| 1 | Office bodies honour only `normalize_spaces`; `nfkc`, `aggressive_homoglyphs`, `strip_emoji_glue`, `strip_bidi` apply to text only. Upstream `clean_docx/xlsx/pptx` have no such parameters. | P3 | no (defaults are off, so output matches) | UI greys the switches out for Office files (stage 2). Revisit only if upstream gains the parameters |
| 2 | Upstream `clean_docx/xlsx/pptx` default `normalize_spaces=True` (NBSP becomes a space). The adapter always passes the value explicitly, so the default is ours. | P3 | no | never, unless upstream changes the signature (the smoke test would fail) |
| 3 | Preview positions come from a `difflib` diff of input vs output in `adapter/engine.py`, not from upstream. Its time grows much faster than the text: measured in Pyodide under Node with a zero-width space after every word, 2 100 characters take 0.1 s, 6 900 take 1.5 s, 19 800 take 12 s (a zero-width space after every 10th word: 17 100 characters take 6.5 s); an artificial text with one every third character took 51 s for 2 400. The run can be cancelled from the page. | P3 | yes (long AI text with many marks) | when a real paste feels slow. Idea: the cleaners mostly delete characters, so a linear walk over input and output works when the output is a subsequence of the input, with `difflib` only as the fallback |
| 4 | The page CSP is a `<meta>` tag (GitHub Pages cannot set headers), and a meta CSP does not apply to the engine Worker's own requests. Zero foreign requests is checked by the e2e test instead. | P3 | no | stage 3, as part of the "zero network after load" check |
