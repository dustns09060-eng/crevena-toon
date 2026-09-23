import { describe, expect, test } from "vitest";
import {
  StoryboardRawSchema,
  StoryIdeasResponseSchema,
  validateStoryboardAgainstProject,
  type StoryboardRaw,
} from "../../src/providers/storyboardSchema";

function makePanel(n: number, overrides: Partial<StoryboardRaw["panels"][number]> = {}) {
  return {
    panel_number: n,
    scene_description: `장면 ${n}`,
    characters: ["엄마"],
    expressions: ["웃음"],
    actions: ["커피를 든다"],
    dialogue: [{ character: "엄마", text: "안녕" }],
    narration: null,
    image_prompt: `scene ${n} image prompt`,
    ...overrides,
  };
}

function makeStoryboard(panelCount: number): StoryboardRaw {
  return {
    title: "제목",
    summary: "요약",
    panels: Array.from({ length: panelCount }, (_, i) => makePanel(i + 1)),
  };
}

describe("StoryIdeasResponseSchema", () => {
  test("3~5개의 아이디어는 통과한다", () => {
    const result = StoryIdeasResponseSchema.safeParse({
      ideas: [
        { title: "a", description: "d1" },
        { title: "b", description: "d2" },
        { title: "c", description: "d3" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("2개 이하는 거부된다", () => {
    const result = StoryIdeasResponseSchema.safeParse({ ideas: [{ title: "a", description: "d1" }] });
    expect(result.success).toBe(false);
  });
});

describe("StoryboardRawSchema", () => {
  test("6컷 storyboard는 스키마를 통과한다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(6)).success).toBe(true);
  });
  test("5컷(최소 미만)은 스키마 자체에서 거부된다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(5)).success).toBe(false);
  });
  test("11컷(최대 초과)은 스키마 자체에서 거부된다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(11)).success).toBe(false);
  });
});

describe("validateStoryboardAgainstProject", () => {
  const allowedCharacterNames = ["엄마", "첫째"];

  test("6컷 요청에 정확히 6개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(6), {
      expectedPanelCount: 6,
      allowedCharacterNames,
    });
    expect(result.valid).toBe(true);
  });

  test("8컷 요청에 정확히 8개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(8), {
      expectedPanelCount: 8,
      allowedCharacterNames,
    });
    expect(result.valid).toBe(true);
  });

  test("10컷 요청에 정확히 10개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(10), {
      expectedPanelCount: 10,
      allowedCharacterNames,
    });
    expect(result.valid).toBe(true);
  });

  test("요청한 컷 수와 panel 개수가 다르면 거부된다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(6), {
      expectedPanelCount: 8,
      allowedCharacterNames,
    });
    expect(result.valid).toBe(false);
  });

  test("panel_number가 1부터 연속되지 않으면 거부된다", () => {
    const board = makeStoryboard(6);
    board.panels[2].panel_number = 10; // 연속성 깨뜨림
    const result = validateStoryboardAgainstProject(board, { expectedPanelCount: 6, allowedCharacterNames });
    expect(result.valid).toBe(false);
  });

  test("허용되지 않은 캐릭터 이름이 있으면 거부된다", () => {
    const board = makeStoryboard(6);
    board.panels[0].characters = ["삼촌"];
    const result = validateStoryboardAgainstProject(board, { expectedPanelCount: 6, allowedCharacterNames });
    expect(result.valid).toBe(false);
  });

  test("대사 화자가 그 컷의 등장인물 목록에 없으면 거부된다", () => {
    const board = makeStoryboard(6);
    board.panels[0].characters = ["엄마"];
    board.panels[0].dialogue = [{ character: "첫째", text: "안녕" }]; // 이 컷엔 첫째가 등장하지 않음
    const result = validateStoryboardAgainstProject(board, { expectedPanelCount: 6, allowedCharacterNames });
    expect(result.valid).toBe(false);
  });
});
