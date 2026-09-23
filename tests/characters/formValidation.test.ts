import { describe, expect, test } from "vitest";
import { validateCharacterForm } from "../../lib/characters/formValidation";

describe("validateCharacterForm", () => {
  test("이름과 역할만 있어도 통과한다", () => {
    const result = validateCharacterForm({ display_name: "엄마", role: "주인공 엄마" });
    expect(result.valid).toBe(true);
  });

  test("이름이 비어있으면 거부된다", () => {
    const result = validateCharacterForm({ display_name: "", role: "주인공" });
    expect(result.valid).toBe(false);
  });

  test("역할이 비어있으면 거부된다", () => {
    const result = validateCharacterForm({ display_name: "엄마", role: "" });
    expect(result.valid).toBe(false);
  });

  test("선택 필드는 비어있어도 통과한다", () => {
    const result = validateCharacterForm({
      display_name: "첫째",
      role: "첫째 아들",
      personality: "",
      speaking_style: "",
      representative_outfit: "",
    });
    expect(result.valid).toBe(true);
  });

  test("이름이 50자를 초과하면 거부된다", () => {
    const result = validateCharacterForm({ display_name: "가".repeat(51), role: "역할" });
    expect(result.valid).toBe(false);
  });
});
