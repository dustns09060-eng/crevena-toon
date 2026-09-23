import { z } from "zod";
import {
  MAX_CHARACTERS_PER_PANEL,
  PROJECT_SCENE_COUNT_MAX_WITH_COVER,
  PROJECT_SCENE_COUNT_MIN_WITH_COVER,
} from "./projectPanelCountConfig";

/**
 * AI가 반환하는 원시(raw) storyboard 구조.
 *
 * 캐릭터는 display_name 문자열이 아니라 CHARACTER_A/B/C... 식별자로
 * 지칭한다(characterIdentifier.ts). 예전에는 AI가 반환한 한글
 * display_name을 프로젝트 캐릭터의 display_name과 직접 문자열
 * 비교해서 매칭했는데, 이 방식은 실제 Production에서 실패했다 —
 * 겉보기엔 같은 "엄마"라는 문자열도 유니코드 정규화 형태(NFC/NFD)가
 * 다르면 바이트가 달라 매칭에 실패할 수 있고(모바일 브라우저/OS의
 * 한글 입력기가 흔히 NFD를 만든다), trim/lowercase로는 이 문제를
 * 해결할 수 없다. CHARACTER_A 같은 순수 ASCII 식별자는 이 문제가
 * 원천적으로 없다.
 *
 * 019 — 표지(cover)는 panels 배열과 별도 필드로 분리한다. AI 입장에서는
 * "표지 1개 + 본문 장면 N개"를 그대로 두 필드로 나눠 받는 게 더 단순하고,
 * 이 raw 스키마의 panels(본문 장면)는 여전히 panel_number 1부터
 * 연속이라고 스스로 매길 뿐 최종 DB panel_number(표지가 1을 차지해
 * 본문은 2부터 시작)는 storyboardMapper.ts가 매길 때만 신경 쓴다 —
 * 이 파일/AI 스키마 자체는 "표지가 몇 번인지" 같은 오프셋을 몰라도 된다.
 */
const CHARACTER_IDENTIFIER_REGEX = /^CHARACTER_[A-Z]$/;
const CharacterIdentifierSchema = z
  .string()
  .trim()
  .regex(CHARACTER_IDENTIFIER_REGEX, "캐릭터는 반드시 CHARACTER_A, CHARACTER_B 같은 식별자여야 합니다.");
export const StoryIdeaSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
});
export const StoryIdeasResponseSchema = z.object({
  ideas: z.array(StoryIdeaSchema).min(3).max(5),
});
export type StoryIdea = z.infer<typeof StoryIdeaSchema>;

export const StoryboardDialogueLineRawSchema = z.object({
  character: CharacterIdentifierSchema,
  text: z.string().trim().min(1).max(200),
});

export const StoryboardPanelRawSchema = z.object({
  panel_number: z.number().int().min(1),
  scene_description: z.string().trim().min(1).max(300),
  characters: z.array(CharacterIdentifierSchema).min(1).max(MAX_CHARACTERS_PER_PANEL),
  expressions: z.array(z.string().trim().min(1).max(100)).max(5),
  actions: z.array(z.string().trim().min(1).max(100)).max(5),
  dialogue: z.array(StoryboardDialogueLineRawSchema).max(5),
  narration: z.string().trim().max(200).nullable(),
  image_prompt: z.string().trim().min(1).max(500),
});

/**
 * 표지 전용 raw 구조. 본문 panel과 목적이 달라(전체 에피소드를
 * 대표하는 장면, 제목 여백 고려, Character Sheet는 본문과 동일하게
 * 사용) 별도 스키마로 둔다.
 */
export const StoryboardCoverRawSchema = z.object({
  cover_title: z.string().trim().min(1).max(60),
  cover_subtitle: z.string().trim().max(100).nullable(),
  scene_description: z.string().trim().min(1).max(300),
  characters: z.array(CharacterIdentifierSchema).min(1).max(MAX_CHARACTERS_PER_PANEL),
  image_prompt: z.string().trim().min(1).max(500),
});

export const StoryboardRawSchema = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(300),
  cover: StoryboardCoverRawSchema,
  panels: z.array(StoryboardPanelRawSchema).min(PROJECT_SCENE_COUNT_MIN_WITH_COVER).max(PROJECT_SCENE_COUNT_MAX_WITH_COVER),
});
export type StoryboardRaw = z.infer<typeof StoryboardRawSchema>;
export type StoryboardPanelRaw = z.infer<typeof StoryboardPanelRawSchema>;
export type StoryboardCoverRaw = z.infer<typeof StoryboardCoverRawSchema>;

export type StoryboardValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * zod 스키마만으로 표현할 수 없는 교차 검증(정확한 panel 개수,
 * panel_number 연속성, 허용된 캐릭터 identifier만 사용했는지)을
 * 담당한다.
 *
 * opts.expectedSceneCount는 "본문 장면 수"다(표지를 제외한 개수) —
 * 표지는 항상 정확히 1개이므로, 호출자가 project.panel_count(표지
 * 포함 TOTAL)에서 1을 뺀 값을 넘긴다. 이 함수 자체는 표지의 존재를
 * "panels 배열과 별도인 raw.cover 필드"로만 알고, 오프셋 계산(표지가
 * DB panel_number 1을 차지해 본문이 2부터 시작하는 것)은 관여하지
 * 않는다 — 그건 storyboardMapper.ts의 책임이다.
 *
 * opts.allowedIdentifiers는 서버가 미리 부여한 CHARACTER_A/B/C...
 * 식별자 목록이다(characterIdentifier.ts) — display_name 문자열과는
 * 절대 비교하지 않는다. 이 식별자는 ASCII 대문자+숫자 규칙 문자열이라
 * 유니코드 정규화/대소문자/공백 문제가 원천적으로 발생하지 않는다.
 */
export function validateStoryboardAgainstProject(
  raw: StoryboardRaw,
  opts: { expectedSceneCount: number; allowedIdentifiers: string[] }
): StoryboardValidationResult {
  const errors: string[] = [];
  const allowed = new Set(opts.allowedIdentifiers);

  if (raw.panels.length !== opts.expectedSceneCount) {
    errors.push(`panels 개수(${raw.panels.length})가 요청한 본문 장면 수(${opts.expectedSceneCount})와 다릅니다.`);
  }

  for (const identifier of raw.cover.characters) {
    if (!allowed.has(identifier)) {
      errors.push(`표지: 등록되지 않은 캐릭터 식별자 "${identifier}"가 사용됐습니다.`);
    }
  }

  raw.panels.forEach((panel, index) => {
    const expectedNumber = index + 1;
    if (panel.panel_number !== expectedNumber) {
      errors.push(`panel_number가 1부터 연속되지 않습니다 (index ${index}: ${panel.panel_number}).`);
    }

    for (const identifier of panel.characters) {
      if (!allowed.has(identifier)) {
        errors.push(`panel ${panel.panel_number}: 등록되지 않은 캐릭터 식별자 "${identifier}"가 사용됐습니다.`);
      }
    }

    const panelCharacterSet = new Set(panel.characters);
    for (const line of panel.dialogue) {
      if (!panelCharacterSet.has(line.character)) {
        errors.push(
          `panel ${panel.panel_number}: 대사 화자 "${line.character}"가 이 컷의 등장인물 목록에 없습니다.`
        );
      }
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
