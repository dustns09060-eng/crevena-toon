import { describe, expect, test } from "vitest";
import {
  CharacterBibleAnalysisSchema,
  parseCharacterBibleAnalysis,
} from "../../src/providers/characterAnalysisSchema";

const VALID = {
  hairstyle: "짧은 단발머리",
  hair_color: "검은색",
  face_features: "둥근 얼굴형, 큰 눈",
  body_type: "보통 체형",
  representative_outfit: "검은색 스트라이프 티셔츠",
  distinctive_features: "왼쪽 볼에 보조개",
  visual_prompt: "30대 여성, 어깨 길이 검은 생머리, 둥근 얼굴형, 검은 스트라이프 티셔츠",
  negative_constraints: ["머리색을 바꾸지 않는다", "배경을 복제하지 않는다"],
};

describe("parseCharacterBibleAnalysis", () => {
  test("정상 JSON은 통과한다", () => {
    const result = parseCharacterBibleAnalysis(JSON.stringify(VALID));
    expect(result.valid).toBe(true);
  });

  test("malformed JSON(파싱 자체가 안 되는 문자열)은 거부된다", () => {
    const result = parseCharacterBibleAnalysis("{ this is not json");
    expect(result.valid).toBe(false);
  });

  test("필수 필드가 누락되면 거부된다", () => {
    const { hairstyle: _omit, ...rest } = VALID;
    const result = parseCharacterBibleAnalysis(JSON.stringify(rest));
    expect(result.valid).toBe(false);
  });

  test("negative_constraints가 빈 배열이면 거부된다", () => {
    const result = parseCharacterBibleAnalysis(
      JSON.stringify({ ...VALID, negative_constraints: [] })
    );
    expect(result.valid).toBe(false);
  });

  test("distinctive_features가 없어도(optional) 통과한다", () => {
    const { distinctive_features: _omit, ...rest } = VALID;
    const result = parseCharacterBibleAnalysis(JSON.stringify(rest));
    expect(result.valid).toBe(true);
  });

  test("distinctive_features가 null이어도 통과한다", () => {
    const result = parseCharacterBibleAnalysis(
      JSON.stringify({ ...VALID, distinctive_features: null })
    );
    expect(result.valid).toBe(true);
  });
});

describe("CharacterBibleAnalysisSchema — 길이 제한", () => {
  test("visual_prompt가 800자를 초과하면 거부된다", () => {
    const result = CharacterBibleAnalysisSchema.safeParse({
      ...VALID,
      visual_prompt: "가".repeat(801),
    });
    expect(result.success).toBe(false);
  });

  test("face_features가 300자를 초과하면 거부된다", () => {
    const result = CharacterBibleAnalysisSchema.safeParse({
      ...VALID,
      face_features: "가".repeat(301),
    });
    expect(result.success).toBe(false);
  });

  test("negative_constraints 항목이 150자를 초과하면 거부된다", () => {
    const result = CharacterBibleAnalysisSchema.safeParse({
      ...VALID,
      negative_constraints: ["가".repeat(151)],
    });
    expect(result.success).toBe(false);
  });
});
