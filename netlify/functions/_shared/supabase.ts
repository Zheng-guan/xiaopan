import { createClient } from "@supabase/supabase-js";

export function supabaseEnvironment() {
  const url = Netlify.env.get("SUPABASE_URL");
  const publishableKey = Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = Netlify.env.get("SUPABASE_SECRET_KEY");
  if (!url || !publishableKey || !secretKey) return null;
  return { url, publishableKey, secretKey };
}

export async function authenticatedSupabase(token: string) {
  const environment = supabaseEnvironment();
  if (!environment || !token) return null;

  const client = createClient(environment.url, environment.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) return null;
  return { client, user, environment };
}

export function adminSupabase() {
  const environment = supabaseEnvironment();
  if (!environment) return null;
  return createClient(environment.url, environment.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
