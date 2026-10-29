# Known issues

Backlog of non-urgent findings. Fix-on-touch: an item is fixed together with a change that already edits that code.

| # | Finding | Priority | Real data hits it | Fix when |
| --- | --- | --- | --- | --- |
| 1 | Office bodies honour only `normalize_spaces`; `nfkc`, `aggressive_homoglyphs`, `strip_emoji_glue`, `strip_bidi` apply to text only. Upstream `clean_docx/xlsx/pptx` have no such parameters. | P3 | no (defaults are off, so output matches) | when the UI exposes the switches for files (stage 2): grey them out for Office files or send a patch upstream |
| 2 | Upstream `clean_docx/xlsx/pptx` default `normalize_spaces=True` (NBSP becomes a space). The adapter always passes the value explicitly, so the default is ours. | P3 | no | never, unless upstream changes the signature (the smoke test would fail) |
| 3 | Preview positions come from a `difflib` diff of input vs output, not from upstream. Quadratic on very large pasted text. | P4 | no (limit is 50 MB files, pasted text is small) | if a real paste feels slow |
