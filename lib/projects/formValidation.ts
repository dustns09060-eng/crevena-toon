import { z } from "zod";
import { PROJECT_TOTAL_PANEL_COUNT_MAX, PROJECT_TOTAL_PANEL_COUNT_MIN } from "../../src/providers/projectPanelCountConfig";

export const ProjectFormSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(80, "제목은 80자 이내로 입력해주세요."),
  topic: z.string().trim().min(1, "소재를 입력하거나 추천받아 선택해주세요.").max(1000, "소재는 1000자 이내로 입력해주세요."),
  // 표지 포함 TOTAL 컷 수. 실제 허용 범위는 projectPanelCountConfig.ts의
  // 상수 하나로 DB CHECK/UI와 항상 같은 값을 쓴다.
  panel_count: z
    .number()
    .int()
    .min(PROJECT_TOTAL_PANEL_COUNT_MIN, `컷 수는 최소 ${PROJECT_TOTAL_PANEL_COUNT_MIN}장(표지 포함)이어야 합니다.`)
    .max(PROJECT_TOTAL_PANEL_COUNT_MAX, `컷 수는 최대 ${PROJECT_TOTAL_PANEL_COUNT_MAX}장(표지 포함)까지 가능합니다.`),
  character_ids: z.array(z.string().uuid()).min(1, "캐릭터를 최소 1명 선택해주세요."),
  series_id: z.string().uuid().nullable().optional(),
});

export type ProjectFormInput = z.infer<typeof ProjectFormSchema>;

export type ProjectFormValidationResult =
  | { valid: true; data: ProjectFormInput }
  | { valid: false; errors: Record<string, string> };

export function validateProjectForm(input: unknown): ProjectFormValidationResult {
  const result = ProjectFormSchema.safeParse(input);
  if (result.success) return { valid: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { valid: false, errors };
}

/**
 * 프로젝트 생성 이후("설정 수정") 소재/컷수/등장인물을 바꿀 때 쓰는
 * 스키마. title/series_id는 생성 시점에만 정하고 이후에는 바꾸지
 * 않으므로 포함하지 않는다 — panel_count 범위는 ProjectFormSchema와
 * 완전히 같은 상수를 참조한다(다른 값으로 갈라지는 것을 방지).
 */
export const ProjectSettingsFormSchema = z.object({
  topic: z.string().trim().min(1, "소재를 입력해주세요.").max(1000, "소재는 1000자 이내로 입력해주세요."),
  panel_count: z
    .number()
    .int()
    .min(PROJECT_TOTAL_PANEL_COUNT_MIN, `컷 수는 최소 ${PROJECT_TOTAL_PANEL_COUNT_MIN}장(표지 포함)이어야 합니다.`)
    .max(PROJECT_TOTAL_PANEL_COUNT_MAX, `컷 수는 최대 ${PROJECT_TOTAL_PANEL_COUNT_MAX}장(표지 포함)까지 가능합니다.`),
  character_ids: z.array(z.string().uuid()).min(1, "캐릭터를 최소 1명 선택해주세요."),
});

export type ProjectSettingsFormInput = z.infer<typeof ProjectSettingsFormSchema>;
