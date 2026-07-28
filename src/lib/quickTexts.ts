import type { RealtimeChannel } from "@supabase/supabase-js";
import type { QuickText } from "../types";
import { supabase } from "./supabase";

const maxQuickTextLength = 100000;

export async function listQuickTexts(userId: string) {
  const { data, error } = await supabase
    .from("quick_texts")
    .select("id, user_id, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as QuickText[];
}

export async function createQuickText(userId: string, content: string) {
  const value = content.trim();
  if (!value) throw new Error("请先粘贴或输入文字");
  if (value.length > maxQuickTextLength) {
    throw new Error("单条文字不能超过 100,000 字");
  }
  const { data, error } = await supabase
    .from("quick_texts")
    .insert({ user_id: userId, content: value })
    .select("id, user_id, content, created_at")
    .single();
  if (error) throw error;
  return data as QuickText;
}

export async function deleteQuickText(id: number) {
  const { error } = await supabase.from("quick_texts").delete().eq("id", id);
  if (error) throw error;
}

export function subscribeToQuickTexts(
  userId: string,
  onInsert: () => void,
): RealtimeChannel {
  return supabase
    .channel(`quick-texts:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "quick_texts",
        filter: `user_id=eq.${userId}`,
      },
      onInsert,
    )
    .subscribe();
}
