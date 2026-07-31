import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabasePublishableKey || "placeholder-publishable-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export async function registrationEmailAvailable(email: string) {
  const { data, error } = await supabase.functions.invoke<{
    available?: boolean;
    error?: string;
  }>("registration-availability", {
    body: { email: email.trim().toLowerCase() },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.available === true;
}

export const projectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
})();

export const maxFileSizeBytes = Number(
  import.meta.env.VITE_MAX_FILE_SIZE_BYTES || 10_000_000_000,
);
