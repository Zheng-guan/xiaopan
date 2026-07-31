export type AdaptiveDownloadEvent =
  | {
      type: "progress";
      id: string;
      downloaded: number;
      total: number;
      speed: number;
      concurrency: number;
    }
  | { type: "complete"; id: string }
  | { type: "cancelled"; id: string }
  | { type: "fallback"; id: string }
  | { type: "error"; id: string; error: string };

interface AdaptiveDownloadOptions {
  id: string;
  url: string;
  fileName: string;
  size: number;
  mimeType?: string | null;
}

const workerPath = "/download-worker.js";
const virtualDownloadPrefix = "/__xiaopan_download__/";
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function isAdaptiveDownloadEvent(value: unknown): value is AdaptiveDownloadEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { source?: unknown; type?: unknown; id?: unknown };
  return (
    candidate.source === "xiaopan-download" &&
    typeof candidate.type === "string" &&
    typeof candidate.id === "string"
  );
}

async function waitForController(registration: ServiceWorkerRegistration) {
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;

  registration.active?.postMessage({ type: "claim" });
  return new Promise<ServiceWorker | null>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", finish);
      resolve(navigator.serviceWorker.controller);
    };
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", finish);
      resolve(navigator.serviceWorker.controller);
    }, 2500);
    navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
  });
}

async function downloadWorker() {
  if (!("serviceWorker" in navigator) || !("ReadableStream" in window)) {
    return null;
  }
  registrationPromise ??= navigator.serviceWorker.register(workerPath, {
    scope: "/",
    updateViaCache: "none",
  });
  const registration = await registrationPromise;
  await navigator.serviceWorker.ready;
  const controller = await waitForController(registration);
  return controller ? { registration, controller } : null;
}

function postWithAcknowledgement(worker: ServiceWorker, message: unknown) {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("下载服务启动超时"));
    }, 5000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => {
      window.clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error || "下载服务启动失败"));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export function subscribeAdaptiveDownloads(
  listener: (event: AdaptiveDownloadEvent) => void,
) {
  if (!("serviceWorker" in navigator)) return () => {};
  const handleMessage = (event: MessageEvent) => {
    if (isAdaptiveDownloadEvent(event.data)) listener(event.data);
  };
  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
}

export async function startAdaptiveDownload(options: AdaptiveDownloadOptions) {
  const worker = await downloadWorker();
  if (!worker) return false;

  await postWithAcknowledgement(worker.controller, {
    type: "register-download",
    download: options,
  });

  const anchor = document.createElement("a");
  anchor.href = `${virtualDownloadPrefix}${encodeURIComponent(options.id)}`;
  anchor.download = options.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export function startDirectDownload(url: string, fileName: string) {
  const usesCoarsePointer =
    window.matchMedia?.("(pointer: coarse)").matches ||
    window.navigator.maxTouchPoints > 0;
  if (usesCoarsePointer) {
    window.location.assign(url);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function cancelAdaptiveDownload(id: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  worker?.postMessage({ type: "cancel-download", id });
}
