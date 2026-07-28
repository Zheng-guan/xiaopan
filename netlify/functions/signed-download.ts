import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const publishableKey = Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = Netlify.env.get("SUPABASE_SECRET_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json({ error: "Server download signing is not configured" }, 503);
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  let body: { itemId?: number };
  try {
    body = (await request.json()) as { itemId?: number };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!Number.isSafeInteger(body.itemId)) {
    return json({ error: "A valid itemId is required" }, 400);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(token);
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: item, error: itemError } = await userClient
    .from("drive_items")
    .select("name, storage_path, kind")
    .eq("id", body.itemId)
    .eq("kind", "file")
    .single();
  if (itemError || !item?.storage_path) return json({ error: "Not found" }, 404);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
