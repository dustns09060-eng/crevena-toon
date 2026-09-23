import { z } from "zod";

export const CharacterFormSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "캐릭터 이름을 입력해주세요.")
    .max(50, "캐릭터 이름은 50자 이내로 입력해주세요."),
  role: z.string().trim().min(1, "역할을 입력해주세요.").max(50, "역할은 50자 이내로 입력해주세요."),
  personality: z.string().trim().max(500, "500자 이내로 입력해주세요.").optional(),
  speaking_style: z.string().trim().max(500, "500자 이내로 입력해주세요.").optional(),
  representative_outfit: z.string().trim().max(500, "500자 이내로 입력해주세요.").optional(),
});

export type CharacterFormInput = z.infer<typeof CharacterFormSchema>;

export type CharacterFormValidationResult =
  | { valid: true; data: CharacterFormInput }
  | { valid: false; errors: Record<string, string> };

export function validateCharacterForm(input: unknown): CharacterFormValidationResult {
  const result = CharacterFormSchema.safeParse(input);
  if (result.success) return { valid: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { valid: false, errors };
}
