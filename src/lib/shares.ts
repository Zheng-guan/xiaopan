import type { DriveItem, PublicShare, ShareRecord, ShareType } from "../types";
import { projectRef, supabase, supabasePublishableKey } from "./supabase";

function cleanTitle(title: string) {
  const value = title.trim();
  if (!value) throw new Error("请输入分享标题");
  return value.slice(0, 160);
}

export async function listShares(userId: string) {
  const { data, error } = await supabase
    .from("shares")
    .select(
      "*, file:drive_items!shares_file_owner_fk(name, size, mime_type)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as ShareRecord[];
}

export async function createShare(input: {
  userId: string;
  type: ShareType;
  title: string;
  textContent?: string;
  linkUrl?: string;
  file?: DriveItem;
  expiresAt: string | null;
}) {
  const payload: Record<string, unknown> = {
    user_id: input.userId,
    share_type: input.type,
    title: cleanTitle(input.title),
    expires_at: input.expiresAt,
  };

  if (input.type === "text") {
    const content = input.textContent?.trim() ?? "";
    if (!content) throw new Error("请输入要分享的文字");
    if (content.length > 100000) throw new Error("文字内容不能超过 100,000 字");
    payload.text_content = content;
  } else if (input.type === "link") {
    const value = input.linkUrl?.trim() ?? "";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("请输入完整的网址，例如 https://example.com");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("分享链接仅支持 http 或 https");
    }
    payload.link_url = url.toString();
  } else {
    if (!input.file || input.file.kind !== "file") throw new Error("请选择文件");
    payload.file_id = input.file.id;
  }

  const { data, error } = await supabase
    .from("shares")
    .insert(payload)
    .select("public_id")
    .single();
  if (error) throw error;
  return data as { public_id: string };
}

export async function deleteShare(id: number) {
  const { error } = await supabase.from("shares").delete().eq("id", id);
  if (error) throw error;
}

export function publicShareUrl(publicId: string) {
  return `${window.location.origin}/s/${publicId}`;
}

async function publicShareRequest<T>(
  token: string,
  action: "view" | "download",
) {
  const response = await fetch(
    `https://${projectRef}.supabase.co/functions/v1/public-share`,
    {
      method: "POST",
      headers: {
        apikey: supabasePublishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, action }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(payload.error || "分享暂时无法访问");
  return payload;
}

export async function getPublicShare(token: string) {
  const result = await publicShareRequest<{ share: PublicShare }>(token, "view");
  return result.share;
}

export async function getPublicFileDownload(token: string) {
  const response = await fetch("/api/public-download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !result.url) {
    throw new Error(result.error || "暂时无法下载共享文件");
  }
  return result.url;
}
