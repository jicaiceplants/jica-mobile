import { createClient } from "@supabase/supabase-js";

function cleanSupabaseUrl(input?: string): string {
  const fallback = "https://fskbdjedfhjxmxkgkstg.supabase.co";
  if (!input) return fallback;

  let url = input.trim();
  url = url.replace(/^["']+|["']+$/g, "").trim();

  const markdownMatch = url.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  if (markdownMatch && markdownMatch[1]) {
    url = markdownMatch[1].trim();
  }

  const parenMatch = url.match(/^\((https?:\/\/[^\s)]+)\)$/);
  if (parenMatch && parenMatch[1]) {
    url = parenMatch[1].trim();
  }

  url = url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "").trim();

  const isValidUrl = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
  return isValidUrl ? url : fallback;
}

function cleanSupabaseKey(input?: string): string {
  const fallback = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZza2JkamVkZmhqeG14a2drc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNDg2MDgsImV4cCI6MjExMDkyNDYwOH0.UnntV5QWxFX-HidDXe7_yNVFac51RbSgmlmVRtDwFiM";
  if (!input) return fallback;

  let key = input.trim();
  key = key.replace(/^["']+|["']+$/g, "").trim();

  return key || fallback;
}

const supabaseUrl = cleanSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = cleanSupabaseKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // Prevents unhandled storage access in standalone Android APK
    autoRefreshToken: true,
  },
});
