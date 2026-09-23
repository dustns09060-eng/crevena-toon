import { z } from "zod";

/**
 * Location Bible 입력 검증. 사용자가 반드시 입력해야 하는 값은
 * display_name(장소 이름) + visual_prompt(설명) 딱 두 개뿐이다 —
 * 나머지는 전부 선택("고급 설정")이라 Character Bible처럼 여러 필드를
 * 영어 프롬프트처럼 채우게 만들지 않는다.
 */
export const LocationFormSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "장소 이름을 입력해주세요.")
    .max(50, "장소 이름은 50자 이내로 입력해주세요."),
  visual_prompt: z
    .string()
    .trim()
    .min(1, "장소 설명을 입력해주세요.")
    .max(500, "설명은 500자 이내로 입력해주세요."),
  wall_and_floor: z.string().trim().max(300, "300자 이내로 입력해주세요.").optional(),
  fixed_furniture: z.string().trim().max(300, "300자 이내로 입력해주세요.").optional(),
  window_style: z.string().trim().max(300, "300자 이내로 입력해주세요.").optional(),
  recurring_props: z.string().trim().max(300, "300자 이내로 입력해주세요.").optional(),
  distinctive_features: z.string().trim().max(300, "300자 이내로 입력해주세요.").optional(),
});

export type LocationFormInput = z.infer<typeof LocationFormSchema>;

export type LocationFormValidationResult =
  | { valid: true; data: LocationFormInput }
  | { valid: false; errors: Record<string, string> };

export function validateLocationForm(input: unknown): LocationFormValidationResult {
  const result = LocationFormSchema.safeParse(input);
  if (result.success) return { valid: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { valid: false, errors };
}
