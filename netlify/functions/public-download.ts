import type { Config, Context } from "@netlify/functions";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json, readJson } from "./_shared/http";
import { adminSupabase } from "./_shared/supabase";
import { downloadDisposition, r2Client } from "./_shared/r2";

export default async (request: Request, _context: Context) => {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson<{ token?: string }>(request);
  if (!body?.token || !uuidPattern.test(body.token)) {
    return json({ error: "分享链接无效" }, 400);
  }

  const admin = adminSupabase();
  if (!admin) return json({ error: "Server download signing is not configured" }, 503);
  const { data: share, error: shareError } = await admin
    .from("shares")
    .select("file_id, expires_at")
    .eq("public_id", body.token)
    .eq("share_type", "file")
    .maybeSingle();
  if (shareError) return json({ error: "读取分享失败" }, 500);
  if (!share) return json({ error: "分享不存在或已取消" }, 404);
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return json({ error: "该分享已过期" }, 410);
  }

  const { data: item, error: itemError } = await admin
    .from("drive_items")
    .select("name, storage_path, storage_provider")
    .eq("id", share.file_id)
    .eq("kind", "file")
    .maybeSingle();
  if (itemError || !item?.storage_path) {
    return json({ error: "共享文件已不存在" }, 404);
  }

  if (item.storage_provider === "r2") {
    const r2 = r2Client();
    if (!r2) return json({ error: "R2 server configuration is incomplete" }, 503);
    const url = await getSignedUrl(
      r2.client,
      new GetObjectCommand({
        Bucket: r2.environment.bucket,
        Key: item.storage_path,
        ResponseContentDisposition: downloadDisposition(item.name),
      }),
      { expiresIn: 60 },
    );
    return json({ url });
  }

  const { data, error } = await admin.storage
    .from("drive")
    .createSignedUrl(item.storage_path, 60, { download: item.name });
  if (error) return json({ error: "生成下载链接失败" }, 500);
  return json({ url: data.signedUrl });
};

export const config: Config = {
  path: "/api/public-download",
  method: "POST",
};
