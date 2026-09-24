export interface RuntimeEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  IMAGE_PROVIDER_ID?: string;
}

export interface RuntimeReadiness {
  loginReady: boolean;
  generationReady: boolean;
  ready: boolean;
  missingForLogin: string[];
  missingForGeneration: string[];
}

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 실제 서비스에 필요한 환경값을 기능별로 나눠 검사한다.
 * 로그인에 필요한 공개 Supabase 값과, AI 생성에 필요한 서버 전용 값을
 * 구분해 사용자가 어디까지 사용할 수 있는지 정확히 안내한다.
 */
export function getRuntimeReadiness(env: RuntimeEnvironment): RuntimeReadiness {
  const missingForLogin: string[] = [];
  if (!isPresent(env.NEXT_PUBLIC_SUPABASE_URL)) missingForLogin.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!isPresent(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) missingForLogin.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const missingForGeneration: string[] = [];
  if (!isPresent(env.SUPABASE_SERVICE_ROLE_KEY)) missingForGeneration.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!isPresent(env.GEMINI_API_KEY)) missingForGeneration.push("GEMINI_API_KEY");

  const imageProvider = (env.IMAGE_PROVIDER_ID ?? "gemini").trim().toLowerCase();
  if (imageProvider === "openai" && !isPresent(env.OPENAI_API_KEY)) {
    missingForGeneration.push("OPENAI_API_KEY");
  }

  return {
    loginReady: missingForLogin.length === 0,
    generationReady: missingForGeneration.length === 0,
    ready: missingForLogin.length === 0 && missingForGeneration.length === 0,
    missingForLogin,
    missingForGeneration,
  };
}
