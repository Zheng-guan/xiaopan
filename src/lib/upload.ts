import { supabase } from "./supabase";

const LEGACY_PART_SIZE = 10 * 1024 * 1024;
const BASE_PART_SIZE = 16 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PART_SIZE = 5 * 1024 ** 3;
const MAX_PARTS = 10_000;
const SIGN_BATCH_SIZE = 16;
const INITIAL_CONCURRENCY = 2;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 6;
const SCALE_UP_GAIN = 1.08;
const SCALE_DOWN_LOSS = 0.85;
const RETRY_DELAYS = [0, 2_000, 5_000, 10_000, 20_000];
const SESSION_PREFIX = "xiaopan:r2-upload:";

interface StoredSession {
  key: string;
  uploadId: string;
  partSize?: number;
}

interface UploadedPart {
  ETag: string;
  PartNumber: number;
  Size?: number;
}

interface MultipartResponse {
  key?: string;
  uploadId?: string;
  url?: string;
  urls?: Array<{ PartNumber: number; url: string }>;
  parts?: UploadedPart[];
  error?: string;
}

interface UploadTuning {
  concurrency: number;
  previousThroughput?: number;
}

export interface ResumableUpload {
  start: () => void;
  abort: () => Promise<void>;
  cancel: () => Promise<void>;
}

export interface ResumableUploadOptions {
  file: File;
  displayName: string;
  userId: string;
  parentId: number | null;
  onProgress: (uploaded: number, total: number) => void;
  onSuccess: (storagePath: string) => void;
  onError: (error: Error) => void;
}

function sessionKey(options: ResumableUploadOptions) {
  return `${SESSION_PREFIX}${options.userId}:${options.parentId ?? "root"}:${encodeURIComponent(options.displayName)}:${options.file.size}:${options.file.lastModified}`;
}

async function accessToken() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw error ?? new Error("登录状态已失效");
  return session.access_token;
}

async function multipartRequest(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<MultipartResponse> {
  const token = await accessToken();
  const response = await fetch("/api/r2-multipart", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as MultipartResponse;
  if (!response.ok) {
    throw new Error(payload.error || `R2 请求失败（${response.status}）`);
  }
  return payload;
}

function uploadPart(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  setRequest: (request: XMLHttpRequest | null) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    setRequest(request);
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onerror = () => reject(new Error("分片上传网络错误"));
    request.onabort = () => reject(new DOMException("上传已暂停", "AbortError"));
    request.onloadend = () => setRequest(null);
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`R2 分片上传失败（${request.status}）`));
        return;
      }
      const etag = request.getResponseHeader("ETag");
      if (!etag) {
        reject(new Error("R2 未返回 ETag，请检查存储桶 CORS 的 ExposeHeaders"));
        return;
      }
      resolve(etag);
    };
    request.send(body);
  });
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("上传已暂停", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function tuneConcurrency(
  tuning: UploadTuning,
  throughput: number,
  retried: boolean,
) {
  if (retried) {
    tuning.concurrency = Math.max(
      MIN_CONCURRENCY,
      Math.floor(tuning.concurrency / 2),
    );
  } else if (
    tuning.previousThroughput === undefined ||
    throughput >= tuning.previousThroughput * SCALE_UP_GAIN
  ) {
    tuning.concurrency = Math.min(
      MAX_CONCURRENCY,
      tuning.concurrency + 1,
    );
  } else if (throughput < tuning.previousThroughput * SCALE_DOWN_LOSS) {
    tuning.concurrency = Math.max(
      MIN_CONCURRENCY,
      tuning.concurrency - 1,
    );
  }
  tuning.previousThroughput = throughput;
}

export async function createResumableUpload(
  options: ResumableUploadOptions,
): Promise<ResumableUpload> {
  const preferredPartSize = Math.max(
    BASE_PART_SIZE,
    Math.ceil(options.file.size / MAX_PARTS / (1024 * 1024)) * 1024 * 1024,
  );
  const key = sessionKey(options);
  let stored: StoredSession | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(key) ?? "null") as StoredSession | null;
  } catch {
    localStorage.removeItem(key);
  }
  if (
    stored &&
    (typeof stored.key !== "string" ||
      !stored.key ||
      typeof stored.uploadId !== "string" ||
      !stored.uploadId ||
      (stored.partSize !== undefined &&
        (!Number.isSafeInteger(stored.partSize) ||
          stored.partSize < MIN_PART_SIZE ||
          stored.partSize > MAX_PART_SIZE)))
  ) {
    stored = null;
    localStorage.removeItem(key);
  }
  let parts: UploadedPart[] = [];
  if (stored?.key && stored.uploadId) {
    try {
      const listed = await multipartRequest({
        action: "list",
        key: stored.key,
        uploadId: stored.uploadId,
      });
      parts = (listed.parts ?? [])
        .filter(
          (part): part is UploadedPart =>
            typeof part.ETag === "string" &&
            Number.isSafeInteger(part.PartNumber) &&
            Number(part.PartNumber) > 0,
        )
        .sort((left, right) => left.PartNumber - right.PartNumber);
    } catch {
      stored = null;
      localStorage.removeItem(key);
    }
  }

  let partSize = stored?.partSize ?? (stored ? LEGACY_PART_SIZE : preferredPartSize);
  if (!stored) {
    const created = await multipartRequest({
      action: "create",
      fileName: options.displayName,
      fileSize: options.file.size,
      contentType: options.file.type || "application/octet-stream",
    });
    if (!created.key || !created.uploadId) {
      throw new Error("R2 未返回分片上传会话");
    }
    stored = {
      key: created.key,
      uploadId: created.uploadId,
      partSize: preferredPartSize,
    };
    partSize = preferredPartSize;
    localStorage.setItem(key, JSON.stringify(stored));
  } else if (!stored.partSize) {
    stored.partSize = LEGACY_PART_SIZE;
    localStorage.setItem(key, JSON.stringify(stored));
  }

  const uploadSession = stored;
  let paused = false;
  let cancelled = false;
  let running = false;
  let currentRun: Promise<void> | null = null;
  let runController: AbortController | null = null;
  const activeRequests = new Map<number, XMLHttpRequest>();
  const inFlightBytes = new Map<number, number>();

  const completedBytes = () =>
    parts.reduce((total, part) => {
      if (typeof part.Size === "number") return total + part.Size;
      const start = (part.PartNumber - 1) * partSize;
      return total + Math.min(partSize, Math.max(0, options.file.size - start));
    }, 0);

  const reportProgress = () => {
    const activeBytes = Array.from(inFlightBytes.values()).reduce(
      (total, loaded) => total + loaded,
      0,
    );
    options.onProgress(
      Math.min(options.file.size, completedBytes() + activeBytes),
      options.file.size,
    );
  };

  const abortActiveRequests = () => {
    for (const request of activeRequests.values()) request.abort();
    activeRequests.clear();
    inFlightBytes.clear();
    reportProgress();
  };

  async function signedUrls(
    partNumbers: number[],
    signal: AbortSignal,
  ): Promise<Map<number, string>> {
    const signed = await multipartRequest(
      {
        action: "sign-parts",
        key: uploadSession.key,
        uploadId: uploadSession.uploadId,
        partNumbers,
      },
      signal,
    );
    const urls = new Map(
      (signed.urls ?? []).map((item) => [item.PartNumber, item.url]),
    );
    if (
      partNumbers.some(
        (partNumber) => typeof urls.get(partNumber) !== "string",
      )
    ) {
      throw new Error("R2 未返回完整的分片上传地址");
    }
    return urls;
  }

  async function uploadOnePart(
    partNumber: number,
    initialUrl: string,
    signal: AbortSignal,
    shouldStop: () => boolean,
  ) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, options.file.size);
    const blob = options.file.slice(start, end);
    let lastError: unknown;
    let url: string | undefined = initialUrl;
    let attempts = 0;

    for (const retryDelay of RETRY_DELAYS) {
      if (paused || cancelled || shouldStop()) {
        return { uploaded: false, retried: attempts > 1 };
      }
      if (retryDelay) await delay(retryDelay, signal);
      if (paused || cancelled || shouldStop()) {
        return { uploaded: false, retried: attempts > 1 };
      }

      try {
        attempts += 1;
        if (!url) {
          url = (await signedUrls([partNumber], signal)).get(partNumber);
        }
        if (!url) throw new Error("R2 未返回分片上传地址");

        const ETag = await uploadPart(
          url,
          blob,
          (loaded) => {
            inFlightBytes.set(partNumber, loaded);
            reportProgress();
          },
          (activeRequest) => {
            if (activeRequest) activeRequests.set(partNumber, activeRequest);
            else activeRequests.delete(partNumber);
          },
        );
        inFlightBytes.delete(partNumber);
        parts.push({ ETag, PartNumber: partNumber, Size: blob.size });
        parts.sort((left, right) => left.PartNumber - right.PartNumber);
        reportProgress();
        return { uploaded: true, retried: attempts > 1 };
      } catch (error) {
        lastError = error;
        url = undefined;
        inFlightBytes.delete(partNumber);
        reportProgress();
        if (
          paused ||
          cancelled ||
          shouldStop() ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return { uploaded: false, retried: attempts > 1 };
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "分片上传失败"));
  }

  async function uploadBatch(
    partNumbers: number[],
    urls: Map<number, string>,
    signal: AbortSignal,
    tuning: UploadTuning,
  ) {
    let offset = 0;

    while (offset < partNumbers.length && !paused && !cancelled) {
      const wave = partNumbers.slice(
        offset,
        offset + Math.min(tuning.concurrency, partNumbers.length - offset),
      );
      let waveFailed = false;
      let fatalError: unknown;
      const startedAt = performance.now();
      const results = await Promise.allSettled(
        wave.map(async (partNumber) => {
          const url = urls.get(partNumber);
          if (!url) throw new Error("R2 未返回分片上传地址");
          try {
            return await uploadOnePart(
              partNumber,
              url,
              signal,
              () => waveFailed,
            );
          } catch (error) {
            if (!waveFailed) {
              waveFailed = true;
              fatalError = error;
              if (runController?.signal === signal) runController.abort();
              abortActiveRequests();
            }
            throw error;
          }
        }),
      );
      if (fatalError) throw fatalError;
      const rejection = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (rejection) throw rejection.reason;
      if (paused || cancelled) return;

      const completed = results
        .filter(
          (result): result is PromiseFulfilledResult<{
            uploaded: boolean;
            retried: boolean;
          }> => result.status === "fulfilled",
        )
        .map((result) => result.value)
        .filter((result) => result.uploaded);
      if (completed.length !== wave.length) return;

      const uploadedBytes = wave.reduce((total, partNumber) => {
        const start = (partNumber - 1) * partSize;
        return total + Math.min(partSize, options.file.size - start);
      }, 0);
      const elapsedSeconds = Math.max(
        (performance.now() - startedAt) / 1000,
        0.05,
      );
      tuneConcurrency(
        tuning,
        uploadedBytes / elapsedSeconds,
        completed.some((result) => result.retried),
      );
      offset += wave.length;
    }
  }

  async function run() {
    if (running || cancelled) return;
    running = true;
    paused = false;
    const controller = new AbortController();
    runController = controller;
    try {
      reportProgress();
      const partCount = Math.max(1, Math.ceil(options.file.size / partSize));
      const completedPartNumbers = new Set(
        parts.map((part) => part.PartNumber),
      );
      const pendingPartNumbers = Array.from(
        { length: partCount },
        (_, index) => index + 1,
      ).filter((partNumber) => !completedPartNumbers.has(partNumber));
      const tuning: UploadTuning = { concurrency: INITIAL_CONCURRENCY };

      for (
        let offset = 0;
        offset < pendingPartNumbers.length;
        offset += SIGN_BATCH_SIZE
      ) {
        if (paused || cancelled) return;
        const batch = pendingPartNumbers.slice(offset, offset + SIGN_BATCH_SIZE);
        const urls = await signedUrls(batch, controller.signal);
        await uploadBatch(batch, urls, controller.signal, tuning);
        if (paused || cancelled) return;
      }

      if (paused || cancelled) return;
      const completed = await multipartRequest(
        {
          action: "complete",
          key: uploadSession.key,
          uploadId: uploadSession.uploadId,
          parts: parts.map(({ ETag, PartNumber }) => ({ ETag, PartNumber })),
          fileName: options.displayName,
          fileSize: options.file.size,
          contentType: options.file.type || "application/octet-stream",
          parentId: options.parentId,
        },
        controller.signal,
      );
      localStorage.removeItem(key);
      options.onProgress(options.file.size, options.file.size);
      options.onSuccess(completed.key || uploadSession.key);
    } catch (error) {
      if (!paused) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (runController === controller) runController = null;
      activeRequests.clear();
      inFlightBytes.clear();
      running = false;
    }
  }

  return {
    start() {
      if (currentRun || cancelled) return;
      const promise = run();
      currentRun = promise;
      void promise.finally(() => {
        if (currentRun === promise) currentRun = null;
      });
    },
    async abort() {
      paused = true;
      runController?.abort();
      abortActiveRequests();
      await currentRun;
    },
    async cancel() {
      if (cancelled) return;
      cancelled = true;
      paused = true;
      runController?.abort();
      abortActiveRequests();
      const settlingRun = currentRun;
      try {
        await multipartRequest({
          action: "abort",
          key: uploadSession.key,
          uploadId: uploadSession.uploadId,
        });
        await settlingRun;
        localStorage.removeItem(key);
        parts = [];
      } catch (error) {
        // Keep the resumable session when cleanup fails, so the user can retry
        // cancellation or resume without orphaning uploaded R2 parts.
        await settlingRun;
        cancelled = false;
        throw error;
      }
    },
  };
}

export async function deleteR2Object(storagePath: string) {
  await multipartRequest({
    action: "delete",
    key: storagePath,
  });
}
