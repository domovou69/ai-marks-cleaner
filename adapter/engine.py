"""The only module that imports upstream watermarks-remover code.

Upstream modules (text_unicode, container_meta, image_meta, common) are flat files;
the caller puts their directory on sys.path before importing this module.
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any

import container_meta
import text_unicode

# Invisible carriers are always removed by upstream; these switches only cover
# options that can change legitimate text, so they are off unless asked for.
DEFAULT_OPTIONS: dict[str, bool] = {
    "normalize_spaces": False,
    "nfkc": False,
    "aggressive_homoglyphs": False,
    "strip_emoji_glue": False,
    "strip_bidi": False,
}

OFFICE_CLEANERS = {
    ".docx": container_meta.clean_docx,
    ".xlsx": container_meta.clean_xlsx,
    ".pptx": container_meta.clean_pptx,
}


def _options(options: dict[str, Any] | None) -> dict[str, bool]:
    merged = dict(DEFAULT_OPTIONS)
    for key, value in (options or {}).items():
        if key not in DEFAULT_OPTIONS:
            raise ValueError(f"unknown option: {key}")
        merged[key] = bool(value)
    return merged


def _deletions(before: str, after: str) -> list[dict[str, Any]] | None:
    """Removed spans when `after` is `before` with characters deleted, else None. One pass, linear time."""
    spans: list[dict[str, Any]] = []
    start = None
    j = 0
    for i, ch in enumerate(before):
        if j < len(after) and ch == after[j]:
            j += 1
            if start is not None:
                spans.append({"start": start, "end": i, "replacement": ""})
                start = None
        elif start is None:
            start = i
    if start is not None:
        spans.append({"start": start, "end": len(before), "replacement": ""})
    return spans if j == len(after) else None


def _changes(before: str, after: str) -> list[dict[str, Any]]:
    """Spans of `before` that were removed or replaced, for the preview."""
    deleted = _deletions(before, after)
    if deleted is not None:
        return deleted
    # Replacements (normalize_spaces, nfkc, homoglyphs): a general diff, slow on long texts with many changes.
    return [
        {"start": i1, "end": i2, "replacement": after[j1:j2]}
        for op, i1, i2, j1, j2 in SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
        if op != "equal"
    ]


def clean_text(text: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    cleaned, stats = text_unicode.clean_text(text, **_options(options))
    return {"text": cleaned, "stats": stats, "changes": _changes(text, cleaned)}


def clean_file(name: str, data: bytes, options: dict[str, Any] | None = None) -> dict[str, Any]:
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    cleaner = OFFICE_CLEANERS.get(ext)
    if cleaner is None:
        raise ValueError(f"unsupported file type: {ext or name}")
    # Upstream's Office cleaner only understands normalize_spaces; the other
    # Layer A switches do not reach document bodies (see docs/known-issues.md).
    opts = _options(options)
    cleaned, notes = cleaner(bytes(data), normalize_spaces=opts["normalize_spaces"])
    return {"data": cleaned, "notes": list(notes)}
