import type { Config, Context } from "@netlify/functions";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bearerToken, json, readJson } from "./_shared/http";
import { authenticatedSupabase } from "./_shared/supabase";
import {
  asciiExtension,
  isOwnedR2Key,
  r2Client,
} from "./_shared/r2";

type MultipartAction =
  | "create"
  | "list"
  | "sign-part"
  | "sign-parts"
  | "complete"
  | "abort"
  | "delete";

interface MultipartBody {
  action?: MultipartAction;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  parentId?: number | null;
  key?: string;
  uploadId?: string;
  partNumber?: number;
  partNumbers?: number[];
  parts?: Array<{ ETag: string; PartNumber: number }>;
}

function isMissingMultipartUpload(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchUpload" ||
    candidate.Code === "NoSuchUpload" ||
    candidate.code === "NoSuchUpload" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export default async (request: Request, _context: Context) => {
  const maxParts = 10_000;
  const maxSignedPartsPerRequest = 16;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authentication = await authenticatedSupabase(bearerToken(request));
  if (!authentication) return json({ error: "Unauthorized" }, 401);

  const r2 = r2Client();
  if (!r2) return json({ error: "R2 server configuration is incomplete" }, 503);
  const database = authentication.client;

  const body = await readJson<MultipartBody>(request);
  if (!body?.action) return json({ error: "A valid action is required" }, 400);

  try {
    if (body.action === "create") {
      const fileName = body.fileName?.trim() ?? "";
      if (!fileName || fileName.length > 255) {
        return json({ error: "A valid file name is required" }, 400);
      }
      if (
        !Number.isSafeInteger(body.fileSize) ||
        Number(body.fileSize) < 0 ||
        Number(body.fileSize) > 5 * 1024 ** 4
      ) {
        return json({ error: "A valid file size is required" }, 400);
      }
      const key = `${authentication.user.id}/${crypto.randomUUID()}/file${asciiExtension(fileName)}`;
      const { error: reservationError } = await database.rpc(
        "reserve_drive_upload",
        {
          p_user_id: authentication.user.id,
          p_storage_path: key,
          p_size: body.fileSize,
        },
      );
      if (reservationError) {
        if (reservationError.message.includes("Storage quota exceeded")) {
          return json({ error: "存储空间不足，请先删除文件再上传" }, 413);
        }
        console.error("Unable to reserve upload quota", reservationError);
        return json({ error: "暂时无法预留上传空间" }, 500);
      }

      try {
        const result = await r2.client.send(
          new CreateMultipartUploadCommand({
            Bucket: r2.environment.bucket,
            Key: key,
            ContentType: body.contentType || "application/octet-stream",
            Metadata: {
              owner: authentication.user.id,
              "original-name": encodeURIComponent(fileName).slice(0, 1024),
            },
          }),
        );
        if (!result.UploadId) throw new Error("R2 did not return an upload ID");
        return json({ key, uploadId: result.UploadId });
      } catch (error) {
        await database.rpc("release_drive_upload", {
          p_user_id: authentication.user.id,
          p_storage_path: key,
        });
        throw error;
      }
    }

    if (!body.key || !isOwnedR2Key(body.key, authentication.user.id)) {
      return json({ error: "Forbidden object key" }, 403);
    }

    if (body.action === "delete") {
      await r2.client.send(
        new DeleteObjectCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
        }),
      );
      await database.rpc("release_drive_upload", {
        p_user_id: authentication.user.id,
        p_storage_path: body.key,
      });
      return json({ ok: true });
    }

    if (!body.uploadId) {
      return json({ error: "uploadId is required" }, 400);
    }

    if (body.action === "list") {
      try {
        const result = await r2.client.send(
          new ListPartsCommand({
            Bucket: r2.environment.bucket,
            Key: body.key,
            UploadId: body.uploadId,
            MaxParts: maxParts,
          }),
        );
        return json({
          parts: (result.Parts ?? []).map((part) => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
            Size: part.Size,
          })),
        });
      } catch (error) {
        if (!isMissingMultipartUpload(error)) throw error;
        await database.rpc("release_drive_upload", {
          p_user_id: authentication.user.id,
          p_storage_path: body.key,
        });
        return json(
          {
            code: "UPLOAD_SESSION_MISSING",
            error: "The previous multipart upload no longer exists",
          },
          404,
        );
      }
    }

    if (body.action === "sign-part") {
      if (
        !Number.isSafeInteger(body.partNumber) ||
        Number(body.partNumber) < 1 ||
        Number(body.partNumber) > maxParts
      ) {
        return json({ error: "Invalid part number" }, 400);
      }
      const url = await getSignedUrl(
        r2.client,
        new UploadPartCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
          UploadId: body.uploadId,
          PartNumber: body.partNumber,
        }),
        { expiresIn: 3600 },
      );
      return json({ url, expiresIn: 3600 });
    }

    if (body.action === "sign-parts") {
      if (
        !Array.isArray(body.partNumbers) ||
        body.partNumbers.length < 1 ||
        body.partNumbers.length > maxSignedPartsPerRequest ||
        body.partNumbers.some(
          (partNumber) =>
            !Number.isSafeInteger(partNumber) ||
            partNumber < 1 ||
            partNumber > maxParts,
        ) ||
        new Set(body.partNumbers).size !== body.partNumbers.length
      ) {
        return json(
          {
            error: `Provide 1-${maxSignedPartsPerRequest} unique valid part numbers`,
          },
          400,
        );
      }

      const urls = await Promise.all(
        body.partNumbers.map(async (partNumber) => ({
          PartNumber: partNumber,
          url: await getSignedUrl(
            r2.client,
            new UploadPartCommand({
              Bucket: r2.environment.bucket,
              Key: body.key,
              UploadId: body.uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: 3600 },
          ),
        })),
      );
      return json({ urls, expiresIn: 3600 });
    }

    if (body.action === "complete") {
      if (
        !Array.isArray(body.parts) ||
        !body.parts.length ||
        body.parts.length > maxParts ||
        body.parts.some(
          (part, index) =>
            typeof part.ETag !== "string" ||
            part.ETag.length > 256 ||
            part.PartNumber !== index + 1,
        )
      ) {
        return json({ error: "A complete ordered parts list is required" }, 400);
      }
      const fileName = body.fileName?.trim() ?? "";
      if (
        !fileName ||
        fileName.length > 255 ||
        !Number.isSafeInteger(body.fileSize) ||
        Number(body.fileSize) < 0 ||
        !(
          body.parentId === null ||
          body.parentId === undefined ||
          Number.isSafeInteger(body.parentId)
        )
      ) {
        return json({ error: "File metadata is invalid" }, 400);
      }
      await r2.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
          UploadId: body.uploadId,
          MultipartUpload: { Parts: body.parts },
        }),
      );
      const completedObject = await r2.client.send(
        new HeadObjectCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
        }),
      );
      if (Number(completedObject.ContentLength) !== Number(body.fileSize)) {
        console.error("Completed R2 object size does not match its reservation", {
          key: body.key,
          expected: body.fileSize,
          actual: completedObject.ContentLength,
        });
        await Promise.allSettled([
          r2.client.send(
            new DeleteObjectCommand({
              Bucket: r2.environment.bucket,
              Key: body.key,
            }),
          ),
          database.rpc("release_drive_upload", {
            p_user_id: authentication.user.id,
            p_storage_path: body.key,
          }),
        ]);
        return json({ error: "上传文件大小校验失败，已撤销本次上传" }, 409);
      }
      const { data: itemId, error: finalizeError } = await database.rpc(
        "finalize_drive_upload",
        {
          p_user_id: authentication.user.id,
          p_storage_path: body.key,
          p_parent_id: body.parentId ?? null,
          p_name: fileName,
          p_size: body.fileSize,
          p_mime_type: body.contentType || "application/octet-stream",
        },
      );
      if (finalizeError) {
        console.error("Unable to finalize upload metadata", finalizeError);
        await Promise.allSettled([
          r2.client.send(
            new DeleteObjectCommand({
              Bucket: r2.environment.bucket,
              Key: body.key,
            }),
          ),
          database.rpc("release_drive_upload", {
            p_user_id: authentication.user.id,
            p_storage_path: body.key,
          }),
        ]);
        return json({ error: "无法保存文件记录，已撤销本次上传" }, 409);
      }
      return json({ key: body.key, itemId });
    }

    if (body.action === "abort") {
      try {
        await r2.client.send(
          new AbortMultipartUploadCommand({
            Bucket: r2.environment.bucket,
            Key: body.key,
            UploadId: body.uploadId,
          }),
        );
      } catch (error) {
        if (!isMissingMultipartUpload(error)) throw error;
      }
      await database.rpc("release_drive_upload", {
        p_user_id: authentication.user.id,
        p_storage_path: body.key,
      });
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("R2 multipart operation failed", error);
    return json({ error: "R2 operation failed" }, 502);
  }
};

export const config: Config = {
  path: "/api/r2-multipart",
  method: "POST",
};
