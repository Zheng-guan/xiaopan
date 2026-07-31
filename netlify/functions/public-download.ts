import type { Config, Context } from "@netlify/functions";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json, readJson } from "./_shared/http";
import { publicSupabase, supabaseEnvironment } from "./_shared/supabase";
import { downloadDisposition, r2Client } from "./_shared/r2";

const downloadUrlExpiresIn = 6 * 60 * 60;

export default async (request: Request, _context: Context) => {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson<{ token?: string }>(request);
  if (!body?.token || !uuidPattern.test(body.token)) {
    return json({ error: "分享链接无效" }, 400);
  }

  const database = publicSupabase();
  const environment = supabaseEnvironment();
  if (!database || !environment) {
    return json({ error: "Server download signing is not configured" }, 503);
  }
  const { data, error: itemError } = await database.rpc(
    "resolve_public_file_share",
    { p_public_id: body.token },
  );
  if (itemError) return json({ error: "读取分享失败" }, 500);
  const item = Array.isArray(data) ? data[0] : data;
  if (!item?.storage_path) return json({ error: "分享不存在、已取消或已过期" }, 404);

  if (item.storage_provider === "r2") {
    const r2 = r2Client();
    if (!r2) return json({ error: "R2 server configuration is incomplete" }, 503);
    const url = await getSignedUrl(
      r2.client,
      new GetObjectCommand({
        Bucket: r2.environment.bucket,
        Key: item.storage_path,
        ResponseContentDisposition: downloadDisposition(item.file_name),
      }),
      { expiresIn: downloadUrlExpiresIn },
    );
    return json({ url });
  }

  const legacyResponse = await fetch(
    `${environment.url}/functions/v1/public-share`,
    {
      method: "POST",
      headers: {
        apikey: environment.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: body.token, action: "download" }),
    },
  );
  const legacy = (await legacyResponse.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!legacyResponse.ok || !legacy.url) {
    return json({ error: legacy.error || "生成下载链接失败" }, legacyResponse.status);
  }
  return json({ url: legacy.url });
};

export const config: Config = {
  path: "/api/public-download",
  method: "POST",
};
