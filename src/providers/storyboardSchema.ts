import { z } from "zod";

/**
 * AI가 반환하는 원시(raw) storyboard 구조. AI는 실제 DB UUID를 모르므로
 * 캐릭터를 "display_name 문자열"로 지칭한다 — 검증 통과 후
 * storyboardMapper.ts가 이 이름을 실제 character_id로 치환한다.
 */
export const StoryIdeaSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
});
export const StoryIdeasResponseSchema = z.object({
  ideas: z.array(StoryIdeaSchema).min(3).max(5),
});
export type StoryIdea = z.infer<typeof StoryIdeaSchema>;

export const StoryboardDialogueLineRawSchema = z.object({
  character: z.string().trim().min(1).max(50),
  text: z.string().trim().min(1).max(200),
});

export const StoryboardPanelRawSchema = z.object({
  panel_number: z.number().int().min(1),
  scene_description: z.string().trim().min(1).max(300),
  characters: z.array(z.string().trim().min(1).max(50)).min(1).max(5),
  expressions: z.array(z.string().trim().min(1).max(100)).max(5),
  actions: z.array(z.string().trim().min(1).max(100)).max(5),
  dialogue: z.array(StoryboardDialogueLineRawSchema).max(5),
  narration: z.string().trim().max(200).nullable(),
  image_prompt: z.string().trim().min(1).max(500),
});

export const StoryboardRawSchema = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(300),
  panels: z.array(StoryboardPanelRawSchema).min(6).max(10),
});
export type StoryboardRaw = z.infer<typeof StoryboardRawSchema>;
export type StoryboardPanelRaw = z.infer<typeof StoryboardPanelRawSchema>;

export type StoryboardValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * zod 스키마만으로 표현할 수 없는 교차 검증(정확한 panel 개수,
 * panel_number 연속성, 허용된 캐릭터 이름만 사용했는지)을 담당한다.
 */
export function validateStoryboardAgainstProject(
  raw: StoryboardRaw,
  opts: { expectedPanelCount: number; allowedCharacterNames: string[] }
): StoryboardValidationResult {
  const errors: string[] = [];
  const allowed = new Set(opts.allowedCharacterNames.map((n) => n.trim().toLowerCase()));

  if (raw.panels.length !== opts.expectedPanelCount) {
    errors.push(`panels 개수(${raw.panels.length})가 요청한 컷 수(${opts.expectedPanelCount})와 다릅니다.`);
  }

  raw.panels.forEach((panel, index) => {
    const expectedNumber = index + 1;
    if (panel.panel_number !== expectedNumber) {
      errors.push(`panel_number가 1부터 연속되지 않습니다 (index ${index}: ${panel.panel_number}).`);
    }

    for (const name of panel.characters) {
      if (!allowed.has(name.trim().toLowerCase())) {
        errors.push(`panel ${panel.panel_number}: 알 수 없는 캐릭터 "${name}"가 사용됐습니다.`);
      }
    }

    const panelCharacterSet = new Set(panel.characters.map((n) => n.trim().toLowerCase()));
    for (const line of panel.dialogue) {
      if (!panelCharacterSet.has(line.character.trim().toLowerCase())) {
        errors.push(
          `panel ${panel.panel_number}: 대사 화자 "${line.character}"가 이 컷의 등장인물 목록에 없습니다.`
        );
      }
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
