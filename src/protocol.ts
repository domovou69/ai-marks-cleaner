export type Options = {
  normalize_spaces: boolean;
  nfkc: boolean;
  aggressive_homoglyphs: boolean;
  strip_emoji_glue: boolean;
  strip_bidi: boolean;
};

/** A span of the input, in code points, that the engine removed or replaced. */
export type Change = { start: number; end: number; replacement: string };

export type TextResult = { text: string; removed: number; changes: Change[] };
export type FileResult = { data: Uint8Array<ArrayBuffer>; notes: string[] };

export type Request =
  | { id: number; kind: "text"; text: string; options: Options }
  | { id: number; kind: "file"; name: string; data: ArrayBuffer; options: Options };

export type Response =
  | { kind: "status"; message: string }
  | { kind: "ready" }
  | { kind: "fatal"; error: string }
  | { id: number; kind: "text"; result: TextResult }
  | { id: number; kind: "file"; result: FileResult }
  | { id: number; kind: "error"; error: string };
