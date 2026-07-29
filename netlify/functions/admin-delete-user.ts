import type { Config, Context } from "@netlify/functions";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { bearerToken, json, readJson } from "./_shared/http";
import { authenticatedSupabase } from "./_shared/supabase";
import { r2Client } from "./_shared/r2";

export default async (request: Request, _context: Context) => {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authentication = await authenticatedSupabase(bearerToken(request));
  if (!authentication?.user.email) return json({ error: "Unauthorized" }, 401);

  const body = await readJson<{ userId?: string }>(request);
  if (!body?.userId || !uuidPattern.test(body.userId)) {
    return json({ error: "有效的用户 ID 是必需的" }, 400);
  }
  const adminEndpoint = `${authentication.environment.url}/functions/v1/admin-dashboard`;
  const adminHeaders = {
    Authorization: `Bearer ${bearerToken(request)}`,
    apikey: authentication.environment.publishableKey,
    "Content-Type": "application/json",
  };
  const prepareResponse = await fetch(adminEndpoint, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      action: "prepare-delete-user",
      userId: body.userId,
    }),
  });
  const prepared = (await prepareResponse.json().catch(() => ({}))) as {
    ready?: true;
    r2Paths?: string[];
    error?: string;
  };
  if (!prepareResponse.ok || !prepared.ready || !Array.isArray(prepared.r2Paths)) {
    return json({ error: prepared.error || "管理员校验失败" }, prepareResponse.status);
  }
  const r2Paths = prepared.r2Paths.filter(
    (path) => typeof path === "string" && path.startsWith(`${body.userId}/`),
  );
  if (r2Paths.length !== prepared.r2Paths.length) {
    return json({ error: "用户文件路径校验失败" }, 409);
  }

  const r2 = r2Client();
  if (r2Paths.length && !r2) {
    return json({ error: "R2 server configuration is incomplete" }, 503);
  }

  try {
    if (r2) {
      for (let index = 0; index < r2Paths.length; index += 1000) {
        await r2.client.send(
          new DeleteObjectsCommand({
            Bucket: r2.environment.bucket,
            Delete: {
              Objects: r2Paths.slice(index, index + 1000).map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
    }
    const deleteResponse = await fetch(adminEndpoint, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        action: "delete-user",
        userId: body.userId,
      }),
    });
    const deleted = (await deleteResponse.json().catch(() => ({}))) as {
      deleted?: true;
      removedObjects?: number;
      error?: string;
    };
    if (!deleteResponse.ok || !deleted.deleted) {
      throw new Error(deleted.error || "Supabase user deletion failed");
    }
    return json({
      deleted: true,
      removedObjects: Number(deleted.removedObjects ?? r2Paths.length),
    });
  } catch (error) {
    console.error("Administrator user deletion failed", error);
    return json({ error: "删除用户失败" }, 500);
  }
};

export const config: Config = {
  path: "/api/admin-delete-user",
  method: "POST",
};
