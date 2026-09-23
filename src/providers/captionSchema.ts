import { z } from "zod";

/**
 * STEP 8 — CaptionProvider가 반환하는 원시(raw) 결과에 대한 검증.
 * 이미지 재분석이 필요 없는 순수 텍스트 생성이므로, storyboardSchema.ts와
 * 같은 패턴(zod로 형태 검증 + 필요 시 별도 교차 검증 함수)을 따른다.
 */
export const HASHTAG_MIN_COUNT = 8;
export const HASHTAG_MAX_COUNT = 15;

export const CaptionHashtagSchema = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .transform((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
  .refine((tag) => !/\s/.test(tag), { message: "해시태그에는 공백이 들어갈 수 없습니다." });

export const CaptionResultSchema = z.object({
  caption: z.string().trim().min(1).max(600),
  hashtags: z.array(CaptionHashtagSchema).min(HASHTAG_MIN_COUNT).max(HASHTAG_MAX_COUNT),
});

export type CaptionResult = z.infer<typeof CaptionResultSchema>;
