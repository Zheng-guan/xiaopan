const DOWNLOAD_PREFIX = "/__xiaopan_download__/";
const SOURCE = "xiaopan-download";
const MIN_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_CONCURRENCY = 8;
const MAX_RETRIES = 3;
const configurations = new Map();
const runningDownloads = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "claim") {
    event.waitUntil(self.clients.claim());
    return;
  }

  if (message.type === "register-download") {
    const port = event.ports[0];
    try {
      const config = validateConfiguration(message.download);
      configurations.set(config.id, { ...config, registeredAt: Date.now() });
      port?.postMessage({ ok: true });
    } catch (error) {
      port?.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "下载参数无效",
      });
    }
    return;
  }

  if (message.type === "cancel-download" && typeof message.id === "string") {
    const hadPending = configurations.delete(message.id);
    const run = runningDownloads.get(message.id);
    run?.abort();
    if (hadPending && !run) void notify({ type: "cancelled", id: message.id });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(DOWNLOAD_PREFIX)) {
    return;
  }

  const id = decodeURIComponent(url.pathname.slice(DOWNLOAD_PREFIX.length));
  event.respondWith(handleDownload(id));
});

function validateConfiguration(value) {
  if (!value || typeof value !== "object") throw new Error("下载参数无效");
  if (typeof value.id !== "string" || !value.id) throw new Error("下载编号无效");
  if (typeof value.fileName !== "string" || !value.fileName) {
    throw new Error("文件名无效");
  }
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error("文件大小无效");
  }
  const signedUrl = new URL(value.url);
  if (signedUrl.protocol !== "https:") throw new Error("下载地址无效");
  return {
    id: value.id,
    url: signedUrl.toString(),
    fileName: value.fileName,
    size: value.size,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
  };
}

async function handleDownload(id) {
  discardExpiredConfigurations();
  const config = configurations.get(id);
  configurations.delete(id);
  if (!config) return new Response("Download session expired", { status: 404 });

  const abortController = new AbortController();
  runningDownloads.set(id, abortController);

  if (config.size === 0) {
    void notify({ type: "fallback", id });
    runningDownloads.delete(id);
    return Response.redirect(config.url, 302);
  }

  try {
    const rangeSupported = await probeRangeSupport(config.url, abortController.signal);
    if (!rangeSupported) {
      void notify({ type: "fallback", id });
      runningDownloads.delete(id);
      return Response.redirect(config.url, 302);
    }
  } catch (error) {
    runningDownloads.delete(id);
    if (abortController.signal.aborted) {
      void notify({ type: "cancelled", id });
      return new Response("Download cancelled", { status: 499 });
    }
    // A CORS or Range incompatibility must not prevent an ordinary browser download.
    void notify({ type: "fallback", id });
    return Response.redirect(config.url, 302);
  }

  const stream = new ReadableStream({
    start(controller) {
      void streamRanges(config, controller, abortController)
        .then(() => {
          controller.close();
          void notify({ type: "complete", id });
        })
        .catch((error) => {
          if (abortController.signal.aborted) {
            void notify({ type: "cancelled", id });
          } else {
            void notify({
              type: "error",
              id,
              error: error instanceof Error ? error.message : "分片下载失败",
            });
          }
          controller.error(error);
        })
        .finally(() => runningDownloads.delete(id));
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Disposition": contentDisposition(config.fileName),
      "Content-Length": String(config.size),
      "Content-Type": safeMimeType(config.mimeType),
    },
  });
}

async function probeRangeSupport(url, signal) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  const supported = response.status === 206;
  await response.body?.cancel();
  return supported;
}

async function streamRanges(config, streamController, abortController) {
  const chunkSize = chooseChunkSize(config.size);
  const totalChunks = Math.ceil(config.size / chunkSize);
  const progressByChunk = new Map();
  const completed = new Map();
  let nextToSchedule = 0;
  let nextToWrite = 0;
  let active = 0;
  let targetConcurrency = Math.min(3, totalChunks);
  let downloaded = 0;
  let speed = 0;
  let bestSpeed = 0;
  let lastSpeedBytes = 0;
  let lastSpeedAt = performance.now();
  let lastReportAt = 0;
  let lastTuneAt = performance.now();
  let speedAtLastTune = 0;
  let settled = false;

  const setChunkProgress = (index, bytes) => {
    const previous = progressByChunk.get(index) || 0;
    progressByChunk.set(index, bytes);
    downloaded += bytes - previous;
    reportProgress(false);
  };

  const reportProgress = (force) => {
    const now = performance.now();
    if (!force && now - lastReportAt < 200) return;
    const elapsed = Math.max(0.001, (now - lastSpeedAt) / 1000);
    const instantSpeed = Math.max(0, downloaded - lastSpeedBytes) / elapsed;
    speed = speed > 0 ? speed * 0.72 + instantSpeed * 0.28 : instantSpeed;
    lastSpeedBytes = downloaded;
    lastSpeedAt = now;
    lastReportAt = now;
    void notify({
      type: "progress",
      id: config.id,
      downloaded: Math.min(config.size, Math.max(0, downloaded)),
      total: config.size,
      speed,
      concurrency: targetConcurrency,
    });
  };

  const reduceConcurrency = () => {
    targetConcurrency = Math.max(1, Math.ceil(targetConcurrency / 2));
    reportProgress(true);
  };

  const tuneConcurrency = () => {
    const now = performance.now();
    if (now - lastTuneAt < 2500) return;
    const concurrencyCeiling = Math.min(MAX_CONCURRENCY, totalChunks);
    bestSpeed = Math.max(bestSpeed, speed);
    if (
      targetConcurrency < concurrencyCeiling &&
      (speedAtLastTune === 0 ||
        speed >= speedAtLastTune * 1.04 ||
        speed >= bestSpeed * 0.88)
    ) {
      targetConcurrency += 1;
    } else if (speed < bestSpeed * 0.68 && targetConcurrency > 1) {
      targetConcurrency -= 1;
    }
    speedAtLastTune = speed;
    lastTuneAt = now;
    reportProgress(true);
  };

  const fetchChunk = async (index) => {
    const start = index * chunkSize;
    const end = Math.min(config.size - 1, start + chunkSize - 1);
    const expectedLength = end - start + 1;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (abortController.signal.aborted) throw abortError();
      if (attempt > 0) {
        setChunkProgress(index, 0);
        reduceConcurrency();
        await abortableDelay(500 * 2 ** (attempt - 1), abortController.signal);
      }
      try {
        const response = await fetch(config.url, {
          method: "GET",
          headers: { Range: `bytes=${start}-${end}` },
          cache: "no-store",
          credentials: "omit",
          signal: abortController.signal,
        });
        if (response.status !== 206) {
          throw new Error(`服务器未返回 HTTP 206（${response.status}）`);
        }

        const result = new Uint8Array(expectedLength);
        let offset = 0;
        if (!response.body) throw new Error("浏览器没有收到分片数据");
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.byteLength > expectedLength) {
            await reader.cancel();
            throw new Error("服务器返回的分片大于请求范围");
          }
          result.set(value, offset);
          offset += value.byteLength;
          setChunkProgress(index, offset);
        }
        if (offset !== expectedLength) {
          throw new Error(`分片不完整：${offset}/${expectedLength}`);
        }
        return result;
      } catch (error) {
        if (abortController.signal.aborted) throw abortError();
        if (attempt === MAX_RETRIES) throw error;
      }
    }
    throw new Error("分片下载失败");
  };

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      abortController.abort();
      reject(error);
    };

    const pump = () => {
      if (settled) return;

      while (completed.has(nextToWrite)) {
        streamController.enqueue(completed.get(nextToWrite));
        completed.delete(nextToWrite);
        nextToWrite += 1;
      }

      if (nextToWrite >= totalChunks && active === 0) {
        settled = true;
        reportProgress(true);
        resolve();
        return;
      }

      tuneConcurrency();
      const schedulingWindow = Math.max(2, targetConcurrency + 1);
      while (
        active < targetConcurrency &&
        nextToSchedule < totalChunks &&
        nextToSchedule < nextToWrite + schedulingWindow
      ) {
        const index = nextToSchedule;
        nextToSchedule += 1;
        active += 1;
        void fetchChunk(index)
          .then((data) => {
            active -= 1;
            completed.set(index, data);
            tuneConcurrency();
            pump();
          })
          .catch(fail);
      }
    };

    pump();
  });
}

function chooseChunkSize(size) {
  if (size <= 32 * 1024 * 1024) return 2 * 1024 * 1024;
  if (size >= 2 * 1024 * 1024 * 1024) return 8 * 1024 * 1024;
  return MIN_CHUNK_SIZE;
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError() {
  return new DOMException("Download cancelled", "AbortError");
}

async function notify(message) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) client.postMessage({ source: SOURCE, ...message });
}

function discardExpiredConfigurations() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, config] of configurations) {
    if (config.registeredAt < cutoff) configurations.delete(id);
  }
}

function contentDisposition(fileName) {
  const extension = fileName.match(/\.[a-z0-9]{1,12}$/i)?.[0] || "";
  const fallback = `download${extension}`;
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function safeMimeType(value) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value
    : "application/octet-stream";
}
