import { registerSW } from "virtual:pwa-register";
import { CANCELLED, EngineClient } from "./client";
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

// The text and the file sections are independent: each has its own source, result and run counter.
type Section = "text" | "file";
let textFileName: string | null = null; // set when a plain-text file was opened into the text section
let lastText: TextResult | null = null;
let officeFile: { name: string; bytes: ArrayBuffer } | null = null;
let lastFile: { name: string; result: FileResult } | null = null;
let textRun = 0; // only the newest run of a section may write to the page
let fileRun = 0;

const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
const cleanedName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.cleaned${name.slice(dot)}` : `${name}.cleaned`;
};
const formatSize = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** File problems show under the chooser; text problems use the status line. */
function setError(id: "text-error" | "file-error", message: string | null) {
  if (id === "text-error") return setStatus("text", message === null ? null : { state: "error", message });
  const box = $(id);
  box.hidden = message === null;
  box.textContent = message ?? "";
}

/**
 * Writes the status next to the "Result" title and colours the result box through data-state. The header row has a
 * fixed height and the box a fixed border width, so nothing moves when a result appears. Null clears both.
 */
function setStatus(section: Section, status: { state: "ok" | "found" | "error"; message: string } | null) {
  stopBusy(section);
  const line = $(`${section}-status`);
  line.className = status ? `status ${status.state}` : "status";
  line.textContent = status?.message ?? "";
  line.title = status?.message ?? "";
  const box = $(section === "text" ? "preview" : "file-result");
  if (status && status.state !== "error") box.dataset.state = status.state;
  else delete box.dataset.state;
}

// ---- Busy state -----------------------------------------------------------------------------------------------
// A run that takes longer than SPINNER_DELAY shows a spinner and the elapsed time in the Result header, dims the old
// result and disables its buttons. Shorter runs stay instant, without flicker.
const SPINNER_DELAY = 300;
const ACTION_BUTTONS: Record<Section, string[]> = { text: ["copy", "download-text"], file: ["download-file"] };
type Busy = { start: number; delay: number; tick?: number };
const busy: Record<Section, Busy | null> = { text: null, file: null };
let engineReady = false;

const setActions = (section: Section, enabled: boolean) => {
  for (const id of ACTION_BUTTONS[section]) $<HTMLButtonElement>(id).disabled = !enabled;
};
const hasResult = (section: Section) => (section === "text" ? lastText !== null : lastFile !== null);
const resultBox = (section: Section) => $(section === "text" ? "preview" : "file-result");

function showBusy(section: Section) {
  const b = busy[section];
  if (!b) return;
  const label = document.createTextNode("");
  const paint = () => {
    const seconds = Math.floor((Date.now() - b.start) / 1000);
    label.data = `${engineReady ? "Cleaning…" : "Waiting for the engine…"}${seconds >= 1 ? ` ${seconds} s` : ""}`;
  };
  paint();
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  const line = $(`${section}-status`);
  line.className = "status busy";
  line.replaceChildren(spinner, label);
  line.title = "";
  const box = resultBox(section);
  delete box.dataset.state;
  box.dataset.busy = "";
  setActions(section, false);
  $(`${section}-cancel`).hidden = false;
  b.tick = window.setInterval(paint, 1000);
}

/** `lockNow`: disable the buttons at once (a loaded file's old result must not be downloaded during a re-run). */
function startBusy(section: Section, lockNow: boolean) {
  stopBusy(section);
  busy[section] = { start: Date.now(), delay: window.setTimeout(() => showBusy(section), SPINNER_DELAY) };
  if (lockNow) setActions(section, false);
}

function stopBusy(section: Section) {
  const b = busy[section];
  if (!b) return;
  window.clearTimeout(b.delay);
  window.clearInterval(b.tick);
  busy[section] = null;
  delete resultBox(section).dataset.busy;
  $(`${section}-cancel`).hidden = true;
  setActions(section, hasResult(section));
}

function options(): Options {
  const o: Record<string, boolean> = {};
  for (const box of checkboxes) o[box.dataset.option as string] = box.checked;
  return o as Options;
}

function setLoadStatus(message: string, busy: boolean) {
  $("status-text").textContent = message;
  $<HTMLProgressElement>("progress").hidden = !busy;
}

const engine = new EngineClient((m) => setLoadStatus(m, true));
function watchEngine() {
  engineReady = false;
  engine.ready.then(
    () => {
      engineReady = true;
      setLoadStatus("Ready. Everything stays on this device.", false);
    },
    (e: Error) => {
      setLoadStatus("The cleaning engine could not start.", false);
      setError("text-error", e.message);
      setError("file-error", e.message);
    },
  );
}
watchEngine();

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
  const n = r.changes.length;
  setStatus("text", {
    state: n > 0 ? "found" : "ok",
    message: n === 0 ? "Clean — nothing to remove." : `Found — ${plural(n, "place")} changed, ${plural(r.removed, "character")} removed.`,
  });
  $<HTMLButtonElement>("copy").disabled = false;
  $<HTMLButtonElement>("download-text").disabled = false;
}

function clearText() {
  lastText = null;
  setStatus("text", null);
  const hint = document.createElement("span");
  hint.className = "placeholder";
  hint.textContent = "The cleaned text appears here.";
  preview.replaceChildren(hint);
  $<HTMLButtonElement>("copy").disabled = true;
  $<HTMLButtonElement>("download-text").disabled = true;
}

function renderFile(name: string, before: number, r: FileResult) {
  lastFile = { name, result: r };
  const summary = $("file-summary");
  summary.className = "hint";
  summary.textContent = `${name}: ${formatSize(before)} → ${formatSize(r.data.byteLength)}.`;
  $("notes").replaceChildren(
    ...r.notes.map((n) => {
      const li = document.createElement("li");
      li.textContent = n;
      return li;
    }),
  );
  setStatus("file", {
    state: r.notes.length > 0 ? "found" : "ok",
    message: r.notes.length === 0 ? "Clean — nothing to remove." : `Found — ${plural(r.notes.length, "change")} made to the file.`,
  });
  $<HTMLButtonElement>("download-file").disabled = false;
}

function clearFile() {
  lastFile = null;
  setStatus("file", null);
  const summary = $("file-summary");
  summary.className = "placeholder";
  summary.textContent = "The report for the cleaned file appears here.";
  $("notes").replaceChildren();
  $<HTMLButtonElement>("download-file").disabled = true;
}

async function processText() {
  const mine = ++textRun;
  setError("text-error", null);
  const text = input.value;
  if (text === "") return clearText();
  startBusy("text", false);
  try {
    const r = await engine.cleanText(text, options());
    if (mine !== textRun) return;
    stopBusy("text");
    renderText(text, r);
  } catch (e) {
    if (mine !== textRun) return; // superseded or cancelled
    lastText = null;
    setError("text-error", (e as Error).message);
  }
}

async function processFile() {
  const mine = ++fileRun;
  if (!officeFile) return;
  setError("file-error", null);
  startBusy("file", true);
  const { name, bytes } = officeFile;
  try {
    const r = await engine.cleanFile(name, bytes.slice(0), options());
    if (mine !== fileRun) return;
    stopBusy("file");
    renderFile(name, bytes.byteLength, r);
  } catch (e) {
    if (mine !== fileRun) return; // superseded or cancelled
    clearFile();
    setStatus("file", { state: "error", message: "Failed — see the message on the left." });
    setError("file-error", (e as Error).message);
  }
}

/** Ends whatever runs: the engine restarts and every section that was busy drops its run. */
function cancel() {
  const running = (["text", "file"] as const).filter((s) => busy[s]);
  textRun++;
  fileRun++;
  engine.cancel();
  watchEngine();
  setLoadStatus("Restarting the engine…", true);
  for (const section of running) {
    if (section === "file") removeFile();
    else clearText();
    setStatus(section, { state: "error", message: CANCELLED });
  }
}

// Typing and quick option clicks are merged into one run; a long file is never queued behind a pile of stale runs.
let textTimer: number | undefined;
let fileTimer: number | undefined;
const scheduleText = () => {
  window.clearTimeout(textTimer);
  textTimer = window.setTimeout(processText, 250);
};
const scheduleFile = () => {
  window.clearTimeout(fileTimer);
  fileTimer = window.setTimeout(processFile, 300);
};

async function loadFile(file: File) {
  setError("file-error", null);
  const e = ext(file.name);
  if (file.size > MAX_BYTES) return setError("file-error", `${file.name} is ${formatSize(file.size)}; the limit is 50 MB.`);
  if (LEGACY.includes(e)) {
    return setError("file-error", `${e} is the old binary Office format. Save the file as ${e}x in Office and try again.`);
  }
  if (UNSUPPORTED_OFFICE.includes(e)) return setError("file-error", `${e} (macro and template files) is not supported.`);

  const office = OFFICE.includes(e);
  const mine = office ? ++fileRun : fileRun; // a text file must not drop an Office run in flight
  if (office) startBusy("file", true);
  const bytes = await file.arrayBuffer();
  if (mine !== fileRun) return; // cancelled while reading
  if (OFFICE.includes(e)) {
    officeFile = { name: file.name, bytes };
    $("file-name").textContent = file.name;
    $("file-size").textContent = formatSize(file.size);
    $("file-card").hidden = false;
    return processFile();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return setError("file-error", `${file.name} is not a UTF-8 text file or a DOCX / XLSX / PPTX file.`);
  }
  if (text.includes("\u0000")) return setError("file-error", `${file.name} is not a text file.`);
  input.value = text;
  textFileName = file.name;
  return processText();
}

function removeFile() {
  officeFile = null;
  fileRun++; // drops a run still in flight
  window.clearTimeout(fileTimer);
  setError("file-error", null);
  $("file-card").hidden = true;
  clearFile();
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

input.addEventListener("input", scheduleText);
for (const box of checkboxes) {
  box.addEventListener("change", () => {
    scheduleText();
    scheduleFile();
  });
}
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const picker = e.target as HTMLInputElement;
  const file = picker.files?.[0];
  picker.value = ""; // picking the same file again must fire "change" again
  if (file) void loadFile(file);
});
$("file-remove").addEventListener("click", removeFile);
$("file-cancel").addEventListener("click", cancel);
$("text-cancel").addEventListener("click", cancel);

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
    setError("text-error", "The browser blocked copying. Select the text in the input and copy it by hand, or use Download.");
  }
});
$("download-text").addEventListener("click", () => {
  if (!lastText) return;
  download(lastText.text, textFileName ? cleanedName(textFileName) : "cleaned.txt", "text/plain;charset=utf-8");
});
$("download-file").addEventListener("click", () => {
  if (!lastFile) return;
  download(lastFile.result.data, cleanedName(lastFile.name), "application/octet-stream");
});

if (import.meta.env.PROD) registerSW({ immediate: true });
