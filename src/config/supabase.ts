import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Singleton service-role client — safe for DB queries that don't involve auth mutations.
 * NOTE: Do NOT use this for signInWithPassword — it mutates the in-memory auth state.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Factory — fresh service-role client for database queries.
 * Isolated so signInWithPassword mutations in auth routes cannot contaminate it.
 */
export function createAdminClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

/**
 * Factory — fresh anon client for signInWithPassword / auth operations only.
 * Must be a new instance per request to prevent session-state bleed across requests.
 */
export function createAuthClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}
