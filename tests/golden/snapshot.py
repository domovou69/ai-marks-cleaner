"""Golden snapshot of one input file, run inside Pyodide by run.mjs.

A snapshot is what the adapter returns, written so that it is stable between runs and readable in a diff:
- invisible characters are shown as <U+XXXX>;
- XML parts are split into one line per tag;
- timestamps are masked (the Office libraries stamp the current time into every file they write, so the generated
  inputs differ byte for byte between runs; a snapshot never contains those bytes);
- images are described by their structure (PNG chunks, JPEG markers), not by bytes.
"""

from __future__ import annotations

import html
import io
import json
import re
import struct
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

import engine

TEXT_VARIANTS: dict[str, dict[str, bool]] = {
    "default": {},
    "all_switches": {key: True for key in engine.DEFAULT_OPTIONS},
}
OFFICE_VARIANTS: dict[str, dict[str, bool]] = {
    "default": {},
    "normalize_spaces": {"normalize_spaces": True},
}

_TIMESTAMP = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?")
_VARIATION_SELECTORS = range(0xFE00, 0xFE10), range(0xE0100, 0xE01F0)


def visible(text: str) -> str:
    """Shows invisible, control and space-like characters (all but a plain space) as <U+XXXX>."""

    def show(ch: str) -> str:
        hidden = unicodedata.category(ch)[0] in "CZ" or any(ord(ch) in r for r in _VARIATION_SELECTORS)
        return f"<U+{ord(ch):04X}>" if hidden and ch != " " else ch

    return "".join(show(ch) for ch in text)


def _lines(text: str) -> list[str]:
    return [visible(line) for line in text.split("\n")]


def _change(before: str, change: dict[str, Any]) -> str:
    s, e = change["start"], change["end"]
    return f'{s}:{e} "{visible(before[s:e])}" -> "{visible(change["replacement"])}"'


def _png(raw: bytes) -> list[str]:
    chunks, at = [], 8
    while at + 8 <= len(raw):
        (size,) = struct.unpack(">I", raw[at : at + 4])
        kind = raw[at + 4 : at + 8].decode("latin-1")
        keyword = raw[at + 8 : at + 8 + size].split(b"\0")[0].decode("latin-1") if kind in ("tEXt", "iTXt", "zTXt") else ""
        chunks.append(f"{kind}:{keyword}" if keyword else kind)
        at += 12 + size
    return chunks


def _jpeg(raw: bytes) -> list[str]:
    markers, at = [], 2
    while at + 4 <= len(raw) and raw[at] == 0xFF:
        marker = raw[at + 1]
        markers.append(f"FF{marker:02X}")
        if marker == 0xDA:  # start of scan: the rest is image data
            break
        (size,) = struct.unpack(">H", raw[at + 2 : at + 4])
        at += 2 + size
    return markers + [f"vendor strings: {b'OpenAI' in raw or b'DALL-E' in raw}"]


def _describe_binary(name: str, raw: bytes) -> list[str]:
    if raw.startswith(b"\x89PNG"):
        return _png(raw)
    if raw.startswith(b"\xff\xd8"):
        return _jpeg(raw)
    return [f"{len(raw)} bytes"]


def _is_xml(name: str) -> bool:
    return name.endswith((".xml", ".rels"))


def _parts(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def _xml_lines(raw: bytes) -> list[str]:
    text = _TIMESTAMP.sub("{timestamp}", raw.decode("utf-8"))
    return _lines(re.sub(r">(?=<)", ">\n", text))


def _office(name: str, raw: bytes, options: dict[str, bool]) -> tuple[dict[str, Any], bytes]:
    result = engine.clean_file(name, raw, options)
    before, after = _parts(raw), _parts(result["data"])
    changed: dict[str, Any] = {}
    for part, body in after.items():
        if part in before and before[part] == body:
            continue
        if _is_xml(part):
            changed[part] = _xml_lines(body)
        else:
            changed[part] = {"before": _describe_binary(part, before.get(part, b"")), "after": _describe_binary(part, body)}
    snapshot = {
        "notes": result["notes"],
        "parts": list(after),
        "removed": [n for n in before if n not in after],
        "added": [n for n in after if n not in before],
        "changed": changed,
    }
    return snapshot, result["data"]


def _body_text(data: bytes) -> str:
    """Text of all XML parts without tags, character references decoded (formulas and cached values included)."""
    return "".join(html.unescape(re.sub(r"<[^>]+>", "", body.decode("utf-8"))) for n, body in _parts(data).items() if _is_xml(n))


def build(rel: str) -> tuple[str, list[str]]:
    """Returns the snapshot of /in/<rel> as JSON text and a list of problems found by the independent checks."""
    kind, name = rel.split("/")
    with open(f"/in/{rel}", "rb") as f:
        raw = f.read()
    expected_file = Path(f"/in/{rel.rsplit('.', 1)[0]}.expected.json")
    expected: list[str] | None = json.loads(expected_file.read_text("utf-8")) if expected_file.exists() else None
    problems: list[str] = []
    variants: dict[str, Any] = {}
    if kind == "text":
        text = raw.decode("utf-8")
        for label, options in TEXT_VARIANTS.items():
            r = engine.clean_text(text, options)
            variants[label] = {
                "text": _lines(r["text"]),
                "stats": r["stats"],
                "changes": [_change(text, c) for c in r["changes"]],
            }
            if label == "default" and expected is not None and r["text"].replace("\r\n", "\n").rstrip("\n") != "\n".join(expected):
                problems.append("default text differs from the expected paragraphs in the generator")
    else:
        for label, options in OFFICE_VARIANTS.items():
            variants[label], data = _office(name, raw, options)
            if label != "default":
                continue
            again = engine.clean_file(name, data, options)
            if again["notes"] or again["data"] != data:
                problems.append(f"cleaning the result again is not a no-op: {again['notes']}")
            body = _body_text(data)
            problems += [f"text lost: {visible(s)}" for s in expected or [] if s not in body]
    return json.dumps(variants, ensure_ascii=False, indent=1, sort_keys=True) + "\n", problems
