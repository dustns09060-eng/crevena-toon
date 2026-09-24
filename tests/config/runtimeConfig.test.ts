import { describe, expect, it } from "vitest";
import { getRuntimeReadiness } from "../../src/config/runtimeConfig";

const completeGeminiEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  GEMINI_API_KEY: "gemini-key",
};

describe("getRuntimeReadiness", () => {
  it("필수 Supabase/Gemini 값이 있으면 실사용 준비 완료로 판정한다", () => {
    expect(getRuntimeReadiness(completeGeminiEnv)).toEqual({
      loginReady: true,
      generationReady: true,
      ready: true,
      missingForLogin: [],
      missingForGeneration: [],
    });
  });

  it("로그인용 공개 Supabase 값과 생성용 서버 값을 구분한다", () => {
    const result = getRuntimeReadiness({});
    expect(result.loginReady).toBe(false);
    expect(result.generationReady).toBe(false);
    expect(result.missingForLogin).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
    expect(result.missingForGeneration).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "GEMINI_API_KEY",
    ]);
  });

  it("OpenAI 이미지 프로바이더를 선택했을 때만 OpenAI 키를 요구한다", () => {
    const missing = getRuntimeReadiness({ ...completeGeminiEnv, IMAGE_PROVIDER_ID: "openai" });
    expect(missing.missingForGeneration).toContain("OPENAI_API_KEY");
    expect(missing.ready).toBe(false);

    const complete = getRuntimeReadiness({
      ...completeGeminiEnv,
      IMAGE_PROVIDER_ID: "openai",
      OPENAI_API_KEY: "openai-key",
    });
    expect(complete.ready).toBe(true);
  });
});
