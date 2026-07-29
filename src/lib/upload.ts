import { supabase } from "./supabase";

const BASE_PART_SIZE = 10 * 1024 * 1024;
const MAX_PARTS = 10_000;
const RETRY_DELAYS = [0, 2_000, 5_000, 10_000, 20_000];
const SESSION_PREFIX = "xiaopan:r2-upload:";

interface StoredSession {
  key: string;
  uploadId: string;
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
  parts?: UploadedPart[];
  error?: string;
}

export interface ResumableUpload {
  start: () => void;
  abort: () => Promise<void>;
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
): Promise<MultipartResponse> {
  const token = await accessToken();
  const response = await fetch("/api/r2-multipart", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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
    request.onload = () => {
      setRequest(null);
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

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function createResumableUpload(
  options: ResumableUploadOptions,
): Promise<ResumableUpload> {
  const partSize = Math.max(
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
    stored = { key: created.key, uploadId: created.uploadId };
    localStorage.setItem(key, JSON.stringify(stored));
  }

  const uploadSession = stored;
  let paused = false;
  let running = false;
  let request: XMLHttpRequest | null = null;

  const completedBytes = () =>
    parts.reduce((total, part) => {
      if (typeof part.Size === "number") return total + part.Size;
      const start = (part.PartNumber - 1) * partSize;
      return total + Math.min(partSize, Math.max(0, options.file.size - start));
    }, 0);

  async function run() {
    if (running) return;
    running = true;
    paused = false;
    try {
      options.onProgress(completedBytes(), options.file.size);
      const partCount = Math.max(1, Math.ceil(options.file.size / partSize));

      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        if (paused) return;
        if (parts.some((part) => part.PartNumber === partNumber)) continue;

        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, options.file.size);
        const blob = options.file.slice(start, end);
        let lastError: unknown;

        for (const retryDelay of RETRY_DELAYS) {
          if (paused) return;
          if (retryDelay) await delay(retryDelay);
          try {
            const signed = await multipartRequest({
              action: "sign-part",
              key: uploadSession.key,
              uploadId: uploadSession.uploadId,
              partNumber,
            });
            if (!signed.url) throw new Error("R2 未返回分片上传地址");
            const before = completedBytes();
            const ETag = await uploadPart(
              signed.url,
              blob,
              (loaded) =>
                options.onProgress(
                  Math.min(options.file.size, before + loaded),
                  options.file.size,
                ),
              (activeRequest) => {
                request = activeRequest;
              },
            );
            parts.push({ ETag, PartNumber: partNumber, Size: blob.size });
            parts.sort((left, right) => left.PartNumber - right.PartNumber);
            options.onProgress(completedBytes(), options.file.size);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (paused || (error instanceof DOMException && error.name === "AbortError")) {
              return;
            }
          }
        }
        if (lastError) throw lastError;
      }

      const completed = await multipartRequest({
        action: "complete",
        key: uploadSession.key,
        uploadId: uploadSession.uploadId,
        parts: parts.map(({ ETag, PartNumber }) => ({ ETag, PartNumber })),
        fileName: options.displayName,
        fileSize: options.file.size,
        contentType: options.file.type || "application/octet-stream",
        parentId: options.parentId,
      });
      localStorage.removeItem(key);
      options.onProgress(options.file.size, options.file.size);
      options.onSuccess(completed.key || uploadSession.key);
    } catch (error) {
      if (!paused) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      request = null;
      running = false;
    }
  }

  return {
    start() {
      void run();
    },
    async abort() {
      paused = true;
      request?.abort();
    },
  };
}

export async function deleteR2Object(storagePath: string) {
  await multipartRequest({
    action: "delete",
    key: storagePath,
  });
}
