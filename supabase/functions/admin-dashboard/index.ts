import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AdminAction =
  | { action: "status" }
  | { action: "overview" }
  | { action: "delete-user"; userId: string };

type UsageRow = {
  user_id: string;
  used_bytes: number;
  file_count: number;
  folder_count: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function requireAdmin(req: Request, admin: SupabaseClient) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
  }

  const token = authorization.slice("Bearer ".length);
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user?.email) {
    throw new Response(JSON.stringify({ error: "登录状态已失效" }), { status: 401 });
  }

  const { data: allowlisted, error: allowlistError } = await admin
    .from("admin_users")
    .select("id")
    .eq("email", user.email.trim().toLowerCase())
    .maybeSingle();

  if (allowlistError) throw allowlistError;
  if (!allowlisted) {
    throw new Response(JSON.stringify({ error: "没有管理员权限" }), { status: 403 });
  }

  return user;
}

async function listAllUsers(admin: SupabaseClient) {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}

async function collectStoragePaths(
  admin: SupabaseClient,
  prefix: string,
  output: string[],
  depth = 0,
) {
  if (depth > 20) throw new Error("Storage folder nesting is too deep");

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage
      .from("drive")
      .list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw error;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id || entry.metadata) output.push(path);
      else await collectStoragePaths(admin, path, output, depth + 1);
    }
    if (data.length < pageSize) break;
  }
}

async function removeStoragePaths(admin: SupabaseClient, paths: string[]) {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from("drive").remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server environment is missing");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const currentAdmin = await requireAdmin(req, admin);
    const body = (await req.json()) as AdminAction;

    if (body.action === "status") {
      return json({ isAdmin: true, email: currentAdmin.email });
    }

    if (body.action === "overview") {
      const [users, usageResult] = await Promise.all([
        listAllUsers(admin),
        admin.rpc("admin_drive_usage"),
      ]);
      if (usageResult.error) throw usageResult.error;

      const usageByUser = new Map(
        ((usageResult.data ?? []) as UsageRow[]).map((row) => [row.user_id, row]),
      );
      const rows = users
        .map((user) => {
          const usage = usageByUser.get(user.id);
          return {
            id: user.id,
            email: user.email ?? "未设置邮箱",
            createdAt: user.created_at,
            lastSignInAt: user.last_sign_in_at ?? null,
            usedBytes: Number(usage?.used_bytes ?? 0),
            fileCount: Number(usage?.file_count ?? 0),
            folderCount: Number(usage?.folder_count ?? 0),
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return json({
        currentAdminId: currentAdmin.id,
        totals: {
          users: rows.length,
          files: rows.reduce((sum, row) => sum + row.fileCount, 0),
          folders: rows.reduce((sum, row) => sum + row.folderCount, 0),
          usedBytes: rows.reduce((sum, row) => sum + row.usedBytes, 0),
        },
        users: rows,
      });
    }

    if (body.action === "delete-user") {
      if (!body.userId) return json({ error: "缺少用户 ID" }, 400);
      if (body.userId === currentAdmin.id) {
        return json({ error: "不能删除当前登录的管理员账户" }, 400);
      }

      const { data: targetData, error: targetError } =
        await admin.auth.admin.getUserById(body.userId);
      if (targetError || !targetData.user) return json({ error: "用户不存在" }, 404);

      if (targetData.user.email) {
        const { data: protectedAdmin, error: protectedError } = await admin
          .from("admin_users")
          .select("id")
          .eq("email", targetData.user.email.trim().toLowerCase())
          .maybeSingle();
        if (protectedError) throw protectedError;
        if (protectedAdmin) return json({ error: "不能删除管理员账户" }, 400);
      }

      const storagePaths: string[] = [];
      await collectStoragePaths(admin, body.userId, storagePaths);
      await removeStoragePaths(admin, storagePaths);

      const { error: deleteError } = await admin.auth.admin.deleteUser(body.userId);
      if (deleteError) throw deleteError;

      return json({ deleted: true, removedObjects: storagePaths.length });
    }

    return json({ error: "未知操作" }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return new Response(await error.text(), {
        status: error.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "服务器操作失败" },
      500,
    );
  }
});
