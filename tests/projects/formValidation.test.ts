import { describe, expect, test } from "vitest";
import { ProjectFormSchema } from "../../lib/projects/formValidation";

const BASE = {
  title: "제목",
  topic: "소재",
  character_ids: ["11111111-1111-4111-8111-111111111111"],
};

describe("ProjectFormSchema — panel_count 범위(표지 포함 TOTAL)", () => {
  test("최소값 2장은 허용된다", () => {
    expect(ProjectFormSchema.safeParse({ ...BASE, panel_count: 2 }).success).toBe(true);
  });

  test("최대값 20장은 허용된다", () => {
    expect(ProjectFormSchema.safeParse({ ...BASE, panel_count: 20 }).success).toBe(true);
  });

  test("1장은 거부된다", () => {
    expect(ProjectFormSchema.safeParse({ ...BASE, panel_count: 1 }).success).toBe(false);
  });

  test("21장은 거부된다", () => {
    expect(ProjectFormSchema.safeParse({ ...BASE, panel_count: 21 }).success).toBe(false);
  });

  test("기존 6/8/10장도 여전히 허용된다(레거시 호환)", () => {
    for (const n of [6, 8, 10]) {
      expect(ProjectFormSchema.safeParse({ ...BASE, panel_count: n }).success).toBe(true);
    }
  });

  test("series_id는 선택 항목이며 없어도 통과한다", () => {
    const result = ProjectFormSchema.safeParse({ ...BASE, panel_count: 6 });
    expect(result.success).toBe(true);
  });

  test("series_id가 유효한 UUID면 통과한다", () => {
    const result = ProjectFormSchema.safeParse({
      ...BASE,
      panel_count: 6,
      series_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(true);
  });
});
