import type { Config, Context } from "@netlify/functions";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { bearerToken, json, readJson } from "./_shared/http";
import {
  adminSupabase,
  authenticatedSupabase,
} from "./_shared/supabase";
import { r2Client } from "./_shared/r2";

export default async (request: Request, _context: Context) => {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authentication = await authenticatedSupabase(bearerToken(request));
  if (!authentication?.user.email) return json({ error: "Unauthorized" }, 401);

  const admin = adminSupabase();
  if (!admin) return json({ error: "Server administration is not configured" }, 503);
  const normalizedEmail = authentication.user.email.trim().toLowerCase();
  const { data: administrator, error: administratorError } = await admin
    .from("admin_users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (administratorError || !administrator) return json({ error: "Forbidden" }, 403);

  const body = await readJson<{ userId?: string }>(request);
  if (!body?.userId || !uuidPattern.test(body.userId)) {
    return json({ error: "有效的用户 ID 是必需的" }, 400);
  }
  if (body.userId === authentication.user.id) {
    return json({ error: "不能删除当前登录的管理员账户" }, 400);
  }

  const { data: target, error: targetError } =
    await admin.auth.admin.getUserById(body.userId);
  if (targetError || !target.user) return json({ error: "用户不存在" }, 404);
  if (target.user.email) {
    const { data: protectedAdmin, error } = await admin
      .from("admin_users")
      .select("id")
      .eq("email", target.user.email.trim().toLowerCase())
      .maybeSingle();
    if (error) return json({ error: "管理员校验失败" }, 500);
    if (protectedAdmin) return json({ error: "不能删除管理员账户" }, 400);
  }

  const { data: files, error: filesError } = await admin
    .from("drive_items")
    .select("storage_path, storage_provider")
    .eq("user_id", body.userId)
    .eq("kind", "file")
    .not("storage_path", "is", null);
  if (filesError) return json({ error: "读取用户文件失败" }, 500);

  const r2Paths = (files ?? [])
    .filter((file) => file.storage_provider === "r2")
    .map((file) => file.storage_path as string);
  const supabasePaths = (files ?? [])
    .filter((file) => file.storage_provider !== "r2")
    .map((file) => file.storage_path as string);

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
    for (let index = 0; index < supabasePaths.length; index += 100) {
      const { error } = await admin.storage
        .from("drive")
        .remove(supabasePaths.slice(index, index + 100));
      if (error) throw error;
    }
    const { error } = await admin.auth.admin.deleteUser(body.userId);
    if (error) throw error;
    return json({
      deleted: true,
      removedObjects: r2Paths.length + supabasePaths.length,
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
