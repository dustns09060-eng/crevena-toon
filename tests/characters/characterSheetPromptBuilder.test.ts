import { describe, expect, test } from "vitest";
import { buildCharacterSheetPrompt } from "../../src/providers/characterSheetPromptBuilder";
import { getToonStyle } from "../../src/providers/characterSheetStyle";

const BASE_BIBLE = {
  hairstyle: "짧은 단발머리",
  hair_color: "검은색", // 사용자가 최종적으로 저장한 값 (AI가 처음 뽑았던 "짙은 갈색"과 다를 수 있음)
  face_features: "둥근 얼굴형",
  body_type: "보통 체형",
  representative_outfit: "검은색 스트라이프 티셔츠",
  distinctive_features: "왼쪽 볼 보조개" as string | null,
  visual_prompt: "30대 여성 캐릭터, 짧은 단발머리, 검은색 스트라이프 티셔츠",
  negative_constraints: ["머리색을 바꾸지 않는다", "배경을 복제하지 않는다"],
};

describe("buildCharacterSheetPrompt", () => {
  test("Character Bible의 사용자 저장값을 그대로 반영한다 (source of truth)", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: BASE_BIBLE,
      style: getToonStyle().prompt,
      referenceCount: 1,
    });
    // AI가 최초 분석했을 수 있는 값이 아니라, 사용자가 저장한 "검은색"이 그대로 들어가야 한다.
    expect(prompt).toContain("검은색");
    expect(prompt).not.toContain("짙은 갈색");
    expect(prompt).toContain(BASE_BIBLE.hairstyle);
    expect(prompt).toContain(BASE_BIBLE.representative_outfit);
  });

  test("negative_constraints가 프롬프트에 포함된다", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: BASE_BIBLE,
      style: getToonStyle().prompt,
      referenceCount: 1,
    });
    for (const rule of BASE_BIBLE.negative_constraints) {
      expect(prompt).toContain(rule);
    }
  });

  test("배경/소품을 넣지 말라는 규칙이 포함된다", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: BASE_BIBLE,
      style: getToonStyle().prompt,
      referenceCount: 2,
    });
    expect(prompt).toMatch(/no background scene/i);
    expect(prompt).toMatch(/no unrelated props/i);
    expect(prompt).toMatch(/do not copy their background/i);
  });

  test("텍스트/말풍선/워터마크 생성 금지 규칙이 포함된다", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: BASE_BIBLE,
      style: getToonStyle().prompt,
      referenceCount: 1,
    });
    expect(prompt).toMatch(/no speech bubbles/i);
    expect(prompt).toMatch(/no korean text/i);
    expect(prompt).toMatch(/no text labels/i);
    expect(prompt).toMatch(/no watermark/i);
  });

  test("distinctive_features가 없어도 정상 동작한다", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: { ...BASE_BIBLE, distinctive_features: null },
      style: getToonStyle().prompt,
      referenceCount: 0,
    });
    expect(prompt).toContain(BASE_BIBLE.hairstyle);
  });

  test("referenceCount가 0이면 참조 사진 관련 문구가 들어가지 않는다", () => {
    const prompt = buildCharacterSheetPrompt({
      characterBible: BASE_BIBLE,
      style: getToonStyle().prompt,
      referenceCount: 0,
    });
    expect(prompt).not.toMatch(/reference photo/i);
  });
});
