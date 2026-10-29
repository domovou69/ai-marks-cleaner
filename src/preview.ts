import type { Change } from "./protocol";

export type Segment = { text: string; removed: boolean };

// Characters that render as nothing (or as a blank), so a red box needs a visible label.
const INVISIBLE = /^[\p{Cf}\p{Cc}\p{Z}\p{Co}\p{Cn}]$/u;

const label = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0;
  return INVISIBLE.test(ch) ? `U+${cp.toString(16).toUpperCase().padStart(4, "0")}` : ch;
};

/**
 * Splits `text` into plain and removed segments. Change positions come from Python, so they count code points,
 * not UTF-16 units; astral characters (tag characters, emoji) would shift every later mark otherwise.
 */
export function segments(text: string, changes: Change[]): Segment[] {
  const chars = Array.from(text);
  const out: Segment[] = [];
  let at = 0;
  for (const c of changes) {
    if (c.start > at) out.push({ text: chars.slice(at, c.start).join(""), removed: false });
    out.push({ text: chars.slice(c.start, c.end).map(label).join(" "), removed: true });
    if (c.replacement) out.push({ text: c.replacement, removed: false });
    at = c.end;
  }
  if (at < chars.length) out.push({ text: chars.slice(at).join(""), removed: false });
  return out;
}
