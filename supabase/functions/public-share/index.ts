import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { token, action = "view" } = (await req.json()) as {
      token?: string;
      action?: "view" | "download";
    };
    if (!token || !uuidPattern.test(token)) return json({ error: "分享链接无效" }, 400);
    if (!["view", "download"].includes(action)) return json({ error: "未知操作" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server environment is missing");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: share, error: shareError } = await admin
      .from("shares")
      .select(
        "id, share_type, title, text_content, link_url, file_id, expires_at, view_count, created_at",
      )
      .eq("public_id", token)
      .maybeSingle();

    if (shareError) throw shareError;
    if (!share) return json({ error: "分享不存在或已被取消" }, 404);
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      return json({ error: "该分享已过期" }, 410);
    }

    let file:
      | { name: string; size: number; mimeType: string | null; storagePath: string }
      | null = null;

    if (share.share_type === "file") {
      const { data: fileRow, error: fileError } = await admin
        .from("drive_items")
        .select("name, size, mime_type, storage_path")
        .eq("id", share.file_id)
        .eq("kind", "file")
        .maybeSingle();
      if (fileError) throw fileError;
      if (!fileRow?.storage_path) return json({ error: "共享文件已不存在" }, 404);
      file = {
        name: fileRow.name,
        size: Number(fileRow.size),
        mimeType: fileRow.mime_type,
        storagePath: fileRow.storage_path,
      };
    }

    if (action === "download") {
      if (!file) return json({ error: "该分享不是文件" }, 400);
      const { data, error } = await admin.storage
        .from("drive")
        .createSignedUrl(file.storagePath, 60, { download: file.name });
      if (error) throw error;
      return json({ url: data.signedUrl });
    }

    await admin.rpc("increment_share_view", { p_share_id: share.id });

    return json({
      share: {
        type: share.share_type,
        title: share.title,
        textContent: share.text_content,
        linkUrl: share.link_url,
        file: file
          ? { name: file.name, size: file.size, mimeType: file.mimeType }
          : null,
        expiresAt: share.expires_at,
        createdAt: share.created_at,
        viewCount: Number(share.view_count) + 1,
      },
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "读取分享失败" },
      500,
    );
  }
});
