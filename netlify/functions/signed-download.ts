import type { Config, Context } from "@netlify/functions";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bearerToken, json, readJson } from "./_shared/http";
import { authenticatedSupabase, adminSupabase } from "./_shared/supabase";
import { downloadDisposition, r2Client } from "./_shared/r2";

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authentication = await authenticatedSupabase(bearerToken(request));
  if (!authentication) return json({ error: "Unauthorized" }, 401);

  const body = await readJson<{ itemId?: number }>(request);
  if (!Number.isSafeInteger(body?.itemId)) {
    return json({ error: "A valid itemId is required" }, 400);
  }

  const { data: item, error: itemError } = await authentication.client
    .from("drive_items")
    .select("name, storage_path, storage_provider, kind")
    .eq("id", body?.itemId)
    .eq("kind", "file")
    .single();
  if (itemError || !item?.storage_path) return json({ error: "Not found" }, 404);

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
    return json({ url, expiresIn: 60 });
  }

  const admin = adminSupabase();
  if (!admin) return json({ error: "Server download signing is not configured" }, 503);
  const { data, error } = await admin.storage
    .from("drive")
    .createSignedUrl(item.storage_path, 60, { download: item.name });
  if (error) return json({ error: "Unable to sign download" }, 500);
  return json({ url: data.signedUrl, expiresIn: 60 });
};

export const config: Config = {
  path: "/api/signed-download",
  method: "POST",
};
