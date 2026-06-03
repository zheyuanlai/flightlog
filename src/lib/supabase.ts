import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseRuntimeConfig {
  url?: string
  anonKey?: string
}

export function supabaseConfigFromEnv(): SupabaseRuntimeConfig {
  return {
    url: import.meta.env.VITE_SUPABASE_URL?.trim(),
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim(),
  }
}

export function hasSupabaseConfig(config: SupabaseRuntimeConfig = supabaseConfigFromEnv()): boolean {
  return Boolean(config.url && config.anonKey)
}

export function createFlightLogSupabaseClient(config: SupabaseRuntimeConfig = supabaseConfigFromEnv()): SupabaseClient | null {
  if (!hasSupabaseConfig(config)) return null
  return createClient(config.url as string, config.anonKey as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export function authRedirectUrl(): string {
  if (typeof window === 'undefined') return '/'
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString()
}

export const isSupabaseConfigured = hasSupabaseConfig()
export const supabase = createFlightLogSupabaseClient()
