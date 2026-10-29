"""The only module that imports upstream watermarks-remover code.

Upstream modules (text_unicode, container_meta, image_meta, common) are flat files;
the caller puts their directory on sys.path before importing this module.
"""

from __future__ import annotations

import io
import re
import zipfile
from difflib import SequenceMatcher
from typing import Any
from xml.sax.saxutils import escape

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


_TABLE_PART = re.compile(r"^xl/tables/[^/]+\.xml$")
_COLUMN_NAME = re.compile(r"""(<tableColumn\b[^>]*?\bname=)(?:"([^"]*)"|'([^']*)')""")
_NOTHING_REMOVED = re.compile(r"^no (?:DOCX|XLSX|PPTX) metadata parts removed$")


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


def _clean_table_columns(data: bytes, normalize_spaces: bool) -> tuple[bytes, int]:
    """Cleans the column names of Excel tables, which upstream leaves alone.

    Upstream cleans the header cells but not `tableColumn name` in xl/tables/*.xml. Excel offers to repair a file
    whose column names differ from its header cells, so the two must be cleaned alike.
    """
    changed = 0

    def fix(match: re.Match[str]) -> str:
        nonlocal changed
        raw = match.group(2) if match.group(2) is not None else match.group(3)
        name = container_meta._decode_xml_entities(raw)  # the decoder upstream uses for the header cells
        cleaned, _ = text_unicode.clean_text(name, normalize_spaces=normalize_spaces)
        if cleaned == name:
            return match.group(0)
        changed += 1
        quoted = escape(cleaned, {'"': "&quot;", "\n": "&#10;", "\r": "&#13;", "\t": "&#9;"})
        return f'{match.group(1)}"{quoted}"'

    with zipfile.ZipFile(io.BytesIO(data)) as zin:
        rewritten: dict[str, bytes] = {}
        for info in zin.infolist():
            if not _TABLE_PART.match(info.filename):
                continue
            try:
                xml = zin.read(info.filename).decode("utf-8")
            except UnicodeDecodeError:
                continue  # not UTF-8: leave the part as it is rather than fail the whole file
            new = _COLUMN_NAME.sub(fix, xml)
            if new != xml:
                rewritten[info.filename] = new.encode("utf-8")
        if not rewritten:
            return data, 0
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                zout.writestr(info, rewritten.get(info.filename) or zin.read(info.filename))
    return out.getvalue(), changed


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
    notes = list(notes)
    if ext == ".xlsx":
        cleaned, columns = _clean_table_columns(cleaned, opts["normalize_spaces"])
        if columns:
            notes.append(f"clean table column names x{columns}")
    # Upstream says "no ... removed" when it did nothing; the page counts every note as a change.
    return {"data": cleaned, "notes": [n for n in notes if not _NOTHING_REMOVED.match(n)]}
