import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Cookie writes are attempted but tolerated when called from a Server Component
 * (where cookies are read-only); middleware refreshes the session in that case.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component: safe to ignore, middleware handles refresh.
        }
      },
    },
  });
}
