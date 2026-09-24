import "server-only";

import { getRuntimeReadiness, type RuntimeReadiness } from "../../src/config/runtimeConfig";

export function getServerRuntimeReadiness(): RuntimeReadiness {
  return getRuntimeReadiness({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    IMAGE_PROVIDER_ID: process.env.IMAGE_PROVIDER_ID,
  });
}

export function requireSupabasePublicConfig(): { url: string; anonKey: string } {
  const readiness = getServerRuntimeReadiness();
  if (!readiness.loginReady) {
    throw new Error(`서비스 설정이 필요합니다: ${readiness.missingForLogin.join(", ")}`);
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
}
