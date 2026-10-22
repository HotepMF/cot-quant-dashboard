import { defaultSignalSettings } from "@workspace/cot-engine";
import { getCotScreener, type CotScreenerResponse, type GetCotScreenerParams } from "@workspace/api-client-react";

type Pending = { resolve: (value: CotScreenerResponse) => void; reject: (error: Error) => void; progress: (done: number, total: number) => void; cleanup: () => void };
const pending = new Map<string, Pending>();
let worker: Worker | undefined;
const matchesDefaults = (params: GetCotScreenerParams) => Object.entries(defaultSignalSettings).every(([k, v]) => params[k as keyof GetCotScreenerParams] === undefined || params[k as keyof GetCotScreenerParams] === v);

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      if (data.progress) return entry.progress(data.progress.done, data.progress.total);
      entry.cleanup();
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    worker.onerror = () => {
      for (const entry of pending.values()) { entry.cleanup(); entry.reject(new Error("The background scanner could not start. Reload the page and try again.")); }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

export async function loadScreener(params: GetCotScreenerParams, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<CotScreenerResponse> {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  const url = new URL("api/cot/screener", base);
  url.searchParams.set("report", params.report);
  const response = await fetch(url, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "The prepared CFTC scan is unavailable.");
  const data = payload as CotScreenerResponse;
  // The prepared scan is used only when it was built with the current defaults (a deploy that changes them leaves the
  // old scan in place until the next collection; the browser worker covers that gap).
  const preparedIsCurrent = Object.entries(defaultSignalSettings).every(([k, v]) => (data.settings as unknown as Record<string, unknown> | undefined)?.[k] === v);
  if (matchesDefaults(params) && preparedIsCurrent) return data;
  // The Node/Replit preview retains its existing API contract and server calculation.
  const snapshot = response.headers.get("X-COT-Snapshot");
  if (!snapshot) return getCotScreener(params, { signal });
  const id = crypto.randomUUID();
  const scanner = getWorker();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      scanner.postMessage({ cancel: id });
      pending.delete(id);
      reject(new DOMException("Scan cancelled", "AbortError"));
    };
    pending.set(id, { resolve, reject, progress, cleanup: () => signal.removeEventListener("abort", cancel) });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) return cancel();
    scanner.postMessage({ id, data, snapshot, params, serverNow: Number(response.headers.get("X-COT-Server-Time") ?? Date.now()), marketUrl: new URL("api/cot/market", base).toString() });
  });
}
