import { z } from "zod";

/**
 * toon_panels.dialogue(JSONB) 검증.
 *
 * DB 레벨에서는 "dialogue가 JSON 배열이다"라는 형태만 CHECK 제약으로
 * 강제한다(supabase/005_toon_dialogue_shape_guard.sql). 각 원소의
 * bubble 좌표 범위, character_id 유효성 같은 세부 규칙은 여기 zod
 * 스키마로 검증한다 — PL/pgSQL로 JSONB 배열을 순회하며 검증하면
 * 유지보수가 어렵고 에러 메시지를 클라이언트에 넘기기도 불편하기
 * 때문에, 자주 바뀔 수 있는 비즈니스 규칙은 애플리케이션 레이어에
 * 두는 편이 낫다고 판단했다 (STEP 1.5 §6 결정).
 */

export const ToonBubbleTailDirectionSchema = z.enum([
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right",
  "left",
  "right",
  "none",
]);

export const ToonBubbleTypeSchema = z.enum(["speech", "thought", "narration", "shout"]);

/** STEP 7 — 말풍선 렌더링 스타일(데이터). 렌더러는 이 값을 보고 모양만 바꾼다. */
export const ToonBubbleStyleSchema = z.enum(["round", "thought", "emphasis", "normal", "shout", "whisper", "soft", "text_only"]);
export const ToonDialogueEmotionSchema = z.enum(["neutral", "happy", "warm", "sad", "panic", "surprised", "angry", "tired", "determined"]);
export const ToonNarrationPresetSchema = z.enum(["dark", "light", "cream", "soft"]);
export const ToonLayoutSourceSchema = z.enum(["IMPORT_DEFAULT", "SMART_V1", "SMART_V2", "MANUAL"]);

export const ToonBubbleSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    tail_direction: ToonBubbleTailDirectionSchema,
    font_size: z.number().min(8).max(96).optional(),
    style: ToonBubbleStyleSchema.optional(),
    tail_enabled: z.boolean().optional(),
    smart_layout_version: z.literal(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    layout_source: ToonLayoutSourceSchema.optional(),
    analysis_identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .refine((b) => b.x + b.width <= 1, {
    message: "x + width는 1을 초과할 수 없습니다 (말풍선이 이미지 오른쪽 밖으로 나감)",
    path: ["width"],
  })
  .refine((b) => b.y + b.height <= 1, {
    message: "y + height는 1을 초과할 수 없습니다 (말풍선이 이미지 아래쪽 밖으로 나감)",
    path: ["height"],
  });

/** STEP 7 — 내레이션 박스. dialogue 말풍선과 형태가 달라 별도 스키마로 둔다. */
export const ToonNarrationBubbleSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    font_size: z.number().min(8).max(96).optional(),
    layout_source: ToonLayoutSourceSchema.optional(),
    analysis_identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    preset: ToonNarrationPresetSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
  })
  .refine((b) => b.x + b.width <= 1, {
    message: "x + width는 1을 초과할 수 없습니다",
    path: ["width"],
  })
  .refine((b) => b.y + b.height <= 1, {
    message: "y + height는 1을 초과할 수 없습니다",
    path: ["height"],
  });

export function validateNarrationBubble(value: unknown): ToonDialogueValidationResult {
  const result = ToonNarrationBubbleSchema.nullable().safeParse(value);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

/** 019 마이그레이션 — 표지 제목 블록. narration bubble과 형태가 동일하다. */
export const ToonCoverTitleBubbleSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    font_size: z.number().min(8).max(96).optional(),
    subtitle_font_size: z.number().min(20).max(96).optional(),
    layout_source: ToonLayoutSourceSchema.optional(),
    analysis_identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .refine((b) => b.x + b.width <= 1, {
    message: "x + width는 1을 초과할 수 없습니다",
    path: ["width"],
  })
  .refine((b) => b.y + b.height <= 1, {
    message: "y + height는 1을 초과할 수 없습니다",
    path: ["height"],
  });

export function validateCoverTitleBubble(value: unknown): ToonDialogueValidationResult {
  const result = ToonCoverTitleBubbleSchema.nullable().safeParse(value);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

export const ToonDialogueItemSchema = z.object({
  id: z.string().uuid(),
  character_id: z.string().uuid(),
  text: z.string().min(1),
  bubble_type: ToonBubbleTypeSchema,
  bubble: ToonBubbleSchema.nullable(),
  emotion: ToonDialogueEmotionSchema.optional(),
});

export const ToonDialogueSchema = z.array(ToonDialogueItemSchema);

export type ToonDialogueValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validateToonDialogue(value: unknown): ToonDialogueValidationResult {
  const result = ToonDialogueSchema.safeParse(value);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

/**
 * dialogue 안의 모든 character_id가 실제로 해당 프로젝트에 연결된
 * 캐릭터 목록(project_character_ids) 안에 있는지 확인한다.
 * DB 트리거로 만들 수도 있지만, 이 검증은 project_id -> 연결된
 * character_id 목록 조회가 선행돼야 하므로 서비스 레이어(패널 저장
 * API)에서 프로젝트의 캐릭터 목록을 이미 들고 있는 시점에 순수 함수로
 * 검사하는 편이 트리거보다 단순하다.
 */
export function validateDialogueCharacterIds(
  dialogue: { character_id: string }[],
  projectCharacterIds: string[]
): ToonDialogueValidationResult {
  const allowed = new Set(projectCharacterIds);
  const errors = dialogue
    .filter((item) => !allowed.has(item.character_id))
    .map((item) => `character_id ${item.character_id}는 이 프로젝트에 연결되지 않은 캐릭터입니다`);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
