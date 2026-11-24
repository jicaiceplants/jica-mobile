import { createClient } from "@supabase/supabase-js";

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://fskbdjedfhjxmxkgkstg.supabase.co";
// Sanitize URL if /rest/v1 or trailing slashes were provided
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
