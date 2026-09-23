import { z } from "zod";

export const PROJECT_PANEL_COUNTS = [6, 8, 10] as const;

export const ProjectFormSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(80, "제목은 80자 이내로 입력해주세요."),
  topic: z.string().trim().min(1, "소재를 입력하거나 추천받아 선택해주세요.").max(1000, "소재는 1000자 이내로 입력해주세요."),
  panel_count: z.union([z.literal(6), z.literal(8), z.literal(10)]),
  character_ids: z.array(z.string().uuid()).min(1, "캐릭터를 최소 1명 선택해주세요."),
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
