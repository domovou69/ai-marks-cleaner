import { registerSW } from "virtual:pwa-register";
import { EngineClient } from "./client";
import { segments } from "./preview";
import type { FileResult, Options, TextResult } from "./protocol";

const MAX_BYTES = 50 * 1024 * 1024;
const OFFICE = [".docx", ".xlsx", ".pptx"];
const LEGACY = [".doc", ".xls", ".ppt"];
const UNSUPPORTED_OFFICE = [".docm", ".xlsm", ".pptm", ".dotx", ".dotm", ".xltx", ".xltm", ".potx", ".potm"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checkboxes = [...document.querySelectorAll<HTMLInputElement>("input[data-option]")];

const input = $<HTMLTextAreaElement>("input");
const preview = $("preview");
const errorBox = $("error");
const fileErrorBox = $("file-error");

type Source =
  | { kind: "text"; fileName: string | null }
  | { kind: "office"; name: string; bytes: ArrayBuffer };
let source: Source = { kind: "text", fileName: null };
let lastText: TextResult | null = null;
let lastFile: { name: string; result: FileResult } | null = null;
let run = 0; // only the newest run may write to the page

const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
const cleanedName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.cleaned${name.slice(dot)}` : `${name}.cleaned`;
};
const formatSize = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** File problems show under the file chooser; engine problems show in the result pane. */
function showError(message: string | null, box: HTMLElement = errorBox) {
  if (message !== null) (box === errorBox ? fileErrorBox : errorBox).hidden = true;
  box.hidden = message === null;
  box.textContent = message ?? "";
}
const showFileError = (message: string | null) => showError(message, fileErrorBox);

type Pane = "empty" | "text" | "file";
function showPane(pane: Pane) {
  $("empty").hidden = pane !== "empty";
  $("text-result").hidden = pane !== "text";
  $("file-result").hidden = pane !== "file";
  $("verdict").hidden = pane === "empty";
}

/** A coloured banner, so a clean file is as visible as a dirty one. */
function setVerdict(found: boolean, message: string) {
  const v = $("verdict");
  v.className = found ? "verdict found" : "verdict ok";
  v.textContent = `${found ? "Found" : "Clean"} — ${message}`;
}

function options(): Options {
  const o: Record<string, boolean> = {};
  for (const box of checkboxes) o[box.dataset.option as string] = box.checked;
  return o as Options;
}

function syncOptionState() {
  const office = source.kind === "office";
  for (const box of checkboxes) {
    const locked = office && box.dataset.option !== "normalize_spaces";
    box.disabled = locked;
    box.parentElement?.classList.toggle("disabled", locked);
  }
  $("office-note").hidden = !office;
}

function setStatus(message: string, busy: boolean) {
  $("status-text").textContent = message;
  $<HTMLProgressElement>("progress").hidden = !busy;
}

const engine = new EngineClient((m) => setStatus(m, true));
engine.ready.then(
  () => setStatus("Ready. Everything stays on this device.", false),
  (e: Error) => {
    setStatus("The cleaning engine could not start.", false);
    showError(e.message);
  },
);

function renderText(original: string, r: TextResult) {
  lastText = r;
  preview.replaceChildren(
    ...segments(original, r.changes).map((s) => {
      if (!s.removed) return document.createTextNode(s.text);
      const mark = document.createElement("mark");
      mark.textContent = s.text;
      return mark;
    }),
  );
  if (r.changes.length === 0) setVerdict(false, "nothing to remove.");
  else {
    const n = r.changes.length;
    setVerdict(true, `${n} place${n === 1 ? "" : "s"} changed, ${r.removed} character${r.removed === 1 ? "" : "s"} removed.`);
  }
  showPane("text");
}

function renderFile(name: string, before: number, r: FileResult) {
  lastFile = { name, result: r };
  $("file-summary").textContent = `${name}: ${formatSize(before)} → ${formatSize(r.data.byteLength)}.`;
  $("notes").replaceChildren(
    ...r.notes.map((n) => {
      const li = document.createElement("li");
      li.textContent = n;
      return li;
    }),
  );
  if (r.notes.length === 0) setVerdict(false, "nothing to remove.");
  else setVerdict(true, `${r.notes.length} change${r.notes.length === 1 ? "" : "s"} made to the file.`);
  showPane("file");
}

async function process() {
  const mine = ++run;
  showError(null);
  try {
    if (source.kind === "office") {
      const { name, bytes } = source;
      const r = await engine.cleanFile(name, bytes.slice(0), options());
      if (mine === run) renderFile(name, bytes.byteLength, r);
    } else {
      const text = input.value;
      if (text === "") {
        showPane("empty");
        lastText = null;
        return;
      }
      const r = await engine.cleanText(text, options());
      if (mine === run) renderText(text, r);
    }
  } catch (e) {
    if (mine === run) showError((e as Error).message);
  }
}

let timer: number | undefined;
const schedule = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(process, 250);
};

async function loadFile(file: File) {
  showFileError(null);
  showError(null);
  const e = ext(file.name);
  if (file.size > MAX_BYTES) return showFileError(`${file.name} is ${formatSize(file.size)}; the limit is 50 MB.`);
  if (LEGACY.includes(e)) {
    return showFileError(`${e} is the old binary Office format. Save the file as ${e}x in Office and try again.`);
  }
  if (UNSUPPORTED_OFFICE.includes(e)) return showFileError(`${e} (macro and template files) is not supported.`);

  const bytes = await file.arrayBuffer();
  if (OFFICE.includes(e)) {
    source = { kind: "office", name: file.name, bytes };
    $("text-mode").hidden = true;
    $("file-card").hidden = false;
    $("file-name").textContent = file.name;
    $("file-size").textContent = formatSize(file.size);
    syncOptionState();
    return process();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return showFileError(`${file.name} is not a UTF-8 text file or a DOCX / XLSX / PPTX file.`);
  }
  if (text.includes("\u0000")) return showFileError(`${file.name} is not a text file.`);
  input.value = text;
  source = { kind: "text", fileName: file.name };
  return process();
}

function removeFile() {
  source = { kind: "text", fileName: null };
  lastFile = null;
  showFileError(null);
  $("text-mode").hidden = false;
  $("file-card").hidden = true;
  $<HTMLInputElement>("file").value = "";
  syncOptionState();
  return process();
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

input.addEventListener("input", () => {
  showFileError(null);
  schedule();
});
for (const box of checkboxes) box.addEventListener("change", process);
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const picker = e.target as HTMLInputElement;
  const file = picker.files?.[0];
  picker.value = ""; // picking the same file again must fire "change" again
  if (file) void loadFile(file);
});
$("file-remove").addEventListener("click", removeFile);

const zone = $("dropzone");
zone.addEventListener("dragover", (e) => {
  e.preventDefault();
  zone.classList.add("over");
});
zone.addEventListener("dragleave", () => zone.classList.remove("over"));
zone.addEventListener("drop", (e) => {
  e.preventDefault();
  zone.classList.remove("over");
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});

$("copy").addEventListener("click", async () => {
  if (!lastText) return;
  try {
    await navigator.clipboard.writeText(lastText.text);
    $("copy").textContent = "Copied";
    setTimeout(() => ($("copy").textContent = "Copy cleaned text"), 1500);
  } catch {
    showError("The browser blocked copying. Select the text in the input and copy it by hand, or use Download.");
  }
});
$("download-text").addEventListener("click", () => {
  if (!lastText) return;
  const name = source.kind === "text" && source.fileName ? cleanedName(source.fileName) : "cleaned.txt";
  download(lastText.text, name, "text/plain;charset=utf-8");
});
$("download-file").addEventListener("click", () => {
  if (!lastFile) return;
  download(lastFile.result.data, cleanedName(lastFile.name), "application/octet-stream");
});

syncOptionState();
if (import.meta.env.PROD) registerSW({ immediate: true });
