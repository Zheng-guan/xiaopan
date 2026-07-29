import type { Session } from "@supabase/supabase-js";
import type { AdminOverview } from "../types";
import { projectRef, supabasePublishableKey } from "./supabase";

async function adminRequest<T>(
  session: Session,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${projectRef}.supabase.co/functions/v1/admin-dashboard`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabasePublishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(payload.error || "管理员服务暂时不可用");
  return payload;
}

export async function checkAdmin(session: Session) {
  return adminRequest<{ isAdmin: true; email: string }>(session, {
    action: "status",
  });
}

export async function getAdminOverview(session: Session) {
  return adminRequest<AdminOverview>(session, { action: "overview" });
}

export async function deleteManagedUser(session: Session, userId: string) {
  const response = await fetch("/api/admin-delete-user", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    deleted?: true;
    removedObjects?: number;
    error?: string;
  };
  if (!response.ok || !payload.deleted) {
    throw new Error(payload.error || "删除用户失败");
  }
  return payload as { deleted: true; removedObjects: number };
}
