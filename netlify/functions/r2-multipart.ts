import type { Config, Context } from "@netlify/functions";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
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
  | "complete"
  | "abort"
  | "delete";

interface MultipartBody {
  action?: MultipartAction;
  fileName?: string;
  contentType?: string;
  key?: string;
  uploadId?: string;
  partNumber?: number;
  parts?: Array<{ ETag: string; PartNumber: number }>;
}

export default async (request: Request, _context: Context) => {
  const maxParts = 10_000;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authentication = await authenticatedSupabase(bearerToken(request));
  if (!authentication) return json({ error: "Unauthorized" }, 401);

  const r2 = r2Client();
  if (!r2) return json({ error: "R2 server configuration is incomplete" }, 503);

  const body = await readJson<MultipartBody>(request);
  if (!body?.action) return json({ error: "A valid action is required" }, 400);

  try {
    if (body.action === "create") {
      const fileName = body.fileName?.trim() ?? "";
      if (!fileName || fileName.length > 255) {
        return json({ error: "A valid file name is required" }, 400);
      }
      const key = `${authentication.user.id}/${crypto.randomUUID()}/file${asciiExtension(fileName)}`;
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
      return json({ ok: true });
    }

    if (!body.uploadId) {
      return json({ error: "uploadId is required" }, 400);
    }

    if (body.action === "list") {
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
      await r2.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
          UploadId: body.uploadId,
          MultipartUpload: { Parts: body.parts },
        }),
      );
      return json({ key: body.key });
    }

    if (body.action === "abort") {
      await r2.client.send(
        new AbortMultipartUploadCommand({
          Bucket: r2.environment.bucket,
          Key: body.key,
          UploadId: body.uploadId,
        }),
      );
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
