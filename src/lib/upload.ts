import * as tus from "tus-js-client";
import {
  projectRef,
  supabase,
  supabasePublishableKey,
} from "./supabase";

const SIX_MIB = 6 * 1024 * 1024;

function sanitizeObjectName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[\/\\\u0000-\u001f\u007f]/g, "_")
    .slice(0, 180);
}

async function stableToken(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

export async function createResumableUpload(
  options: ResumableUploadOptions,
) {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw error ?? new Error("登录状态已失效");
  if (!projectRef) throw new Error("Supabase 项目地址配置不正确");

  const token = await stableToken(
    `${options.userId}:${options.parentId ?? "root"}:${options.displayName}:${options.file.size}:${options.file.lastModified}`,
  );
  const storagePath = `${options.userId}/${token}/${sanitizeObjectName(options.displayName)}`;

  const upload = new tus.Upload(options.file, {
    endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
    retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
    headers: {
      authorization: `Bearer ${session.access_token}`,
      apikey: supabasePublishableKey,
    },
    metadata: {
      bucketName: "drive",
      objectName: storagePath,
      contentType: options.file.type || "application/octet-stream",
      cacheControl: "3600",
      metadata: JSON.stringify({
        originalName: options.displayName,
        ownerId: options.userId,
      }),
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: SIX_MIB,
    onProgress: options.onProgress,
    onSuccess: () => options.onSuccess(storagePath),
    onError: (uploadError) =>
      options.onError(
        uploadError instanceof Error
          ? uploadError
          : new Error(String(uploadError)),
      ),
  });

  const previous = await upload.findPreviousUploads();
  if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
  return upload;
}
