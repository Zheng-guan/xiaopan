import { supabase } from "./supabase";
import type {
  CategoryFilter,
  DriveItem,
  DriveUsage,
  SortDirection,
  SortKey,
} from "../types";

const bucket = "drive";

function safeName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/")) {
    throw new Error("名称不能为空、不能包含 /，也不能使用 . 或 ..");
  }
  return trimmed.slice(0, 255);
}

export async function listDriveItems(options: {
  userId: string;
  parentId: number | null;
  search: string;
  category: CategoryFilter;
}) {
  let query = supabase
    .from("drive_items")
    .select("*")
    .eq("user_id", options.userId);

  if (options.search || options.category !== "all") {
    if (options.search) query = query.ilike("name", `%${options.search}%`);
    if (options.category === "recent") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("updated_at", since);
    } else if (options.category === "image") {
      query = query.eq("kind", "file").ilike("mime_type", "image/%");
    } else if (options.category === "video") {
      query = query.eq("kind", "file").ilike("mime_type", "video/%");
    } else if (options.category === "document") {
      query = query
        .eq("kind", "file")
        .or(
          "mime_type.ilike.application/%,mime_type.ilike.text/%,mime_type.ilike.%document%,mime_type.ilike.%sheet%,mime_type.ilike.%presentation%",
        );
    }
  } else if (options.parentId === null) {
    query = query.is("parent_id", null);
  } else {
    query = query.eq("parent_id", options.parentId);
  }

  const { data, error } = await query.limit(1000);
  if (error) throw error;
  return (data ?? []) as DriveItem[];
}

export function sortDriveItems(
  items: DriveItem[],
  key: SortKey,
  direction: SortDirection,
) {
  const factor = direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    if (key === "name") {
      return (
        left.name.localeCompare(right.name, "zh-CN", {
          numeric: true,
          sensitivity: "base",
        }) * factor
      );
    }
    if (key === "size") return (left.size - right.size) * factor;
    return (
      (new Date(left.updated_at).getTime() -
        new Date(right.updated_at).getTime()) *
      factor
    );
  });
}

export async function getDriveUsage(): Promise<DriveUsage> {
  const { data, error } = await supabase.rpc("drive_usage");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    used_bytes: Number(row?.used_bytes ?? 0),
    file_count: Number(row?.file_count ?? 0),
    folder_count: Number(row?.folder_count ?? 0),
  };
}

export async function createFolder(
  userId: string,
  parentId: number | null,
  name: string,
) {
  const { data, error } = await supabase
    .from("drive_items")
    .insert({
      user_id: userId,
      parent_id: parentId,
      kind: "folder",
      name: safeName(name),
      size: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DriveItem;
}

export async function createFileRecord(input: {
  userId: string;
  parentId: number | null;
  name: string;
  size: number;
  mimeType: string;
  storagePath: string;
}) {
  const { data, error } = await supabase
    .from("drive_items")
    .insert({
      user_id: input.userId,
      parent_id: input.parentId,
      kind: "file",
      name: safeName(input.name),
      size: input.size,
      mime_type: input.mimeType || "application/octet-stream",
      storage_path: input.storagePath,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DriveItem;
}

export async function renameDriveItem(id: number, name: string) {
  const { error } = await supabase
    .from("drive_items")
    .update({ name: safeName(name) })
    .eq("id", id);
  if (error) throw error;
}

export async function moveDriveItems(ids: number[], parentId: number | null) {
  const { error } = await supabase
    .from("drive_items")
    .update({ parent_id: parentId })
    .in("id", ids);
  if (error) throw error;
}

async function descendantsOf(items: DriveItem[]) {
  const collected = [...items];
  let folderIds = items.filter((item) => item.kind === "folder").map((item) => item.id);

  while (folderIds.length) {
    const { data, error } = await supabase
      .from("drive_items")
      .select("*")
      .in("parent_id", folderIds);
    if (error) throw error;
    const children = (data ?? []) as DriveItem[];
    collected.push(...children);
    folderIds = children
      .filter((item) => item.kind === "folder")
      .map((item) => item.id);
  }
  return collected;
}

export async function deleteDriveItems(items: DriveItem[]) {
  const allItems = await descendantsOf(items);
  const paths = allItems
    .filter((item) => item.kind === "file" && item.storage_path)
    .map((item) => item.storage_path as string);

  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(paths.slice(index, index + 100));
    if (error) throw error;
  }

  const { error } = await supabase
    .from("drive_items")
    .delete()
    .in(
      "id",
      items.map((item) => item.id),
    );
  if (error) throw error;
}

export async function listAllFolders(userId: string) {
  const { data, error } = await supabase
    .from("drive_items")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "folder")
    .order("name")
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as DriveItem[];
}

export async function listAllFiles(userId: string) {
  const { data, error } = await supabase
    .from("drive_items")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "file")
    .order("name")
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as DriveItem[];
}

export async function signedDownloadUrl(item: DriveItem, accessToken: string) {
  try {
    const response = await fetch("/api/signed-download", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ itemId: item.id }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { url: string };
      return payload.url;
    }
  } catch {
    // Local Vite without Netlify Functions: fall back to the RLS-protected client.
  }

  if (!item.storage_path) throw new Error("文件路径不存在");
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(item.storage_path, 60, { download: item.name });
  if (error) throw error;
  return data.signedUrl;
}

export async function removeUploadedObject(storagePath: string) {
  await supabase.storage.from(bucket).remove([storagePath]);
}
