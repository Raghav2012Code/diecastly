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

/**
 * A client that is always `anon`, with no session cookies at all.
 *
 * The storefront is a public surface, so it must be built and tested against
 * what a stranger can see. Reusing `createClient()` there would send whatever
 * session happens to be on the request: an admin previewing the shop in the same
 * browser would get admin privileges, so any storefront page that renders
 * correctly for them can be broken for everyone else and nothing would fail.
 * That is the same reasoning as the RLS tests running as a non-admin, applied
 * to reads.
 *
 * Reads are unaffected in practice today — the public views filter on
 * `status = 'active'` regardless of caller — but the storefront's correctness
 * should not depend on that staying true. Reads through this client go via the
 * anon key with no Authorization header, so the database applies the anon role
 * exactly as it would for a first-time visitor.
 */
export function createAnonClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      // Deliberately empty rather than absent: an empty jar means no session is
      // ever attached, and nothing can be written back.
      getAll: () => [],
      setAll: () => {},
    },
  });
}
