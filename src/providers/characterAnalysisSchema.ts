import { z } from "zod";

/**
 * AI 분석 응답을 자유 텍스트로 신뢰하지 않고 이 스키마로 강제 검증한다.
 * 필드 길이를 제한해 과도하게 긴 응답(토큰 낭비, 저장 공간 남용,
 * 프롬프트 인젝션 방어)을 걸러낸다.
 */
export const CharacterBibleAnalysisSchema = z.object({
  hairstyle: z.string().trim().min(1).max(200),
  hair_color: z.string().trim().min(1).max(100),
  face_features: z.string().trim().min(1).max(300),
  body_type: z.string().trim().min(1).max(200),
  representative_outfit: z.string().trim().min(1).max(200),
  distinctive_features: z.string().trim().max(300).nullish(),
  visual_prompt: z.string().trim().min(1).max(800),
  negative_constraints: z.array(z.string().trim().min(1).max(150)).min(1).max(10),
});

export type CharacterBibleAnalysisParsed = z.infer<typeof CharacterBibleAnalysisSchema>;

export type CharacterBibleAnalysisValidationResult =
  | { valid: true; data: CharacterBibleAnalysisParsed }
  | { valid: false; errors: string[] };

/** AI가 반환한 raw JSON 문자열을 파싱 + 스키마 검증까지 한 번에 처리한다. */
export function parseCharacterBibleAnalysis(raw: string): CharacterBibleAnalysisValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["AI 응답이 올바른 JSON 형식이 아닙니다."] };
  }

  const result = CharacterBibleAnalysisSchema.safeParse(json);
  if (result.success) return { valid: true, data: result.data };

  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
  };
}
