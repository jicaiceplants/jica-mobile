import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://fskbdjedfhjxmxkgkstg.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZza2JkamVkZmhqeG14a2drc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNDg2MDgsImV4cCI6MjExMDkyNDYwOH0.UnntV5QWxFX-HidDXe7_yNVFac51RbSgmlmVRtDwFiM";

export function cleanSupabaseUrl(input?: string): string {
  if (!input) return DEFAULT_SUPABASE_URL;

  let url = input.trim();

  // Strip surrounding single or double quotes
  url = url.replace(/^["']+|["']+$/g, "").trim();

  // If Markdown link format: [text](url) -> extract url
  const markdownMatch = url.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  if (markdownMatch && markdownMatch[1]) {
    url = markdownMatch[1].trim();
  }

  // Handle parenthesized URL: (https://...)
  const parenMatch = url.match(/^\((https?:\/\/[^\s)]+)\)$/);
  if (parenMatch && parenMatch[1]) {
    url = parenMatch[1].trim();
  }

  // Strip trailing /rest/v1 or trailing slashes
  url = url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "").trim();

  // Validate standard HTTP/HTTPS URL
  const isValidUrl = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
  if (!isValidUrl) {
    return DEFAULT_SUPABASE_URL;
  }

  return url;
}

export function cleanSupabaseKey(input?: string): string {
  if (!input) return DEFAULT_SUPABASE_KEY;

  let key = input.trim();
  key = key.replace(/^["']+|["']+$/g, "").trim();

  return key || DEFAULT_SUPABASE_KEY;
}

const safeUrl = cleanSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
const safeKey = cleanSupabaseKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

function getSafeClient(): SupabaseClient {
  try {
    return createClient(safeUrl, safeKey, {
      auth: {
        persistSession: false, // Prevents unhandled storage access in standalone Android APK
        autoRefreshToken: true,
      },
    });
  } catch (err) {
    console.error("Failed to initialize primary Supabase client, falling back to defaults:", err);
    return createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
      },
    });
  }
}

export const supabase = getSafeClient();
