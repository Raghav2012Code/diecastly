/**
 * Environment handling. Values are read lazily (via functions) so that importing
 * this module never throws during build when env vars are absent.
 */

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
};

export function getPublicEnv(): PublicEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in the values from `supabase start`.",
    );
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  };
}

/**
 * Server-only. The service-role key bypasses RLS and must never be exposed to
 * the browser. Only import this from server code when it is genuinely required.
 */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server-only).");
  }
  return key;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
