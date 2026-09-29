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

/*
 * Two functions used to live here and are deliberately not restored.
 *
 * `getServiceRoleKey` had zero references, because v1 has no service-role
 * client at all: every admin read goes through the session cookie, which RLS
 * governs, and the one future caller is the D14 gateway, which is not built.
 * `isSupabaseConfigured` had zero references too — nothing probes for
 * configuration, and `getPublicEnv` throws a message that names the fix, which
 * is better than a boolean that silently degrades a page.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` stays in `.env.example` as a documented,
 * intentionally unread variable, so the gateway phase has a documented place to
 * fill it in rather than discovering a missing entry.
 */
