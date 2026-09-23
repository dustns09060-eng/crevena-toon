import { describe, expect, test } from "vitest";
import {
  StoryboardRawSchema,
  StoryIdeasResponseSchema,
  validateStoryboardAgainstProject,
  type StoryboardCoverRaw,
  type StoryboardRaw,
} from "../../src/providers/storyboardSchema";

function makePanel(n: number, overrides: Partial<StoryboardRaw["panels"][number]> = {}) {
  return {
    panel_number: n,
    scene_description: `장면 ${n}`,
    characters: ["CHARACTER_A"],
    expressions: ["웃음"],
    actions: ["커피를 든다"],
    dialogue: [{ character: "CHARACTER_A", text: "안녕" }],
    narration: null,
    image_prompt: `scene ${n} image prompt`,
    ...overrides,
  };
}

function makeCover(overrides: Partial<StoryboardCoverRaw> = {}): StoryboardCoverRaw {
  return {
    cover_title: "표지 제목",
    cover_subtitle: "짧은 부제목",
    scene_description: "표지 장면",
    characters: ["CHARACTER_A"],
    image_prompt: "cover image prompt",
    ...overrides,
  };
}

function makeStoryboard(sceneCount: number, coverOverrides: Partial<StoryboardCoverRaw> = {}): StoryboardRaw {
  return {
    title: "제목",
    summary: "요약",
    cover: makeCover(coverOverrides),
    panels: Array.from({ length: sceneCount }, (_, i) => makePanel(i + 1)),
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
  test("표지 1 + 본문 5장(총 6장)은 스키마를 통과한다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(5)).success).toBe(true);
  });

  test("표지 1 + 본문 1장(총 2장, 최소)은 스키마를 통과한다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(1)).success).toBe(true);
  });

  test("표지 1 + 본문 19장(총 20장, 최대)은 스키마를 통과한다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(19)).success).toBe(true);
  });

  test("본문 0장(총 1장, 최소 미만)은 스키마 자체에서 거부된다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(0)).success).toBe(false);
  });

  test("본문 20장(총 21장, 최대 초과)은 스키마 자체에서 거부된다", () => {
    expect(StoryboardRawSchema.safeParse(makeStoryboard(20)).success).toBe(false);
  });

  test("cover 필드가 없으면 거부된다", () => {
    const board = makeStoryboard(5) as Record<string, unknown>;
    delete board.cover;
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });

  test("한 장면에 캐릭터가 4명 초과(5명)면 스키마에서 거부된다", () => {
    const board = makeStoryboard(5);
    board.panels[0].characters = ["CHARACTER_A", "CHARACTER_B", "CHARACTER_C", "CHARACTER_D", "CHARACTER_E"];
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });

  test("표지에 캐릭터가 4명 초과(5명)면 스키마에서 거부된다", () => {
    const board = makeStoryboard(5, {
      characters: ["CHARACTER_A", "CHARACTER_B", "CHARACTER_C", "CHARACTER_D", "CHARACTER_E"],
    });
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });

  test("한 장면에 캐릭터가 정확히 4명이면 통과한다", () => {
    const board = makeStoryboard(5);
    board.panels[0].characters = ["CHARACTER_A", "CHARACTER_B", "CHARACTER_C", "CHARACTER_D"];
    expect(StoryboardRawSchema.safeParse(board).success).toBe(true);
  });

  test("캐릭터 필드에 identifier 형식이 아닌 실제 이름(한글)을 쓰면 스키마에서 거부된다", () => {
    // 이번 라운드의 핵심 수정: display_name 문자열은 더 이상 유효한
    // characters 값이 아니다 — 반드시 CHARACTER_A 형식이어야 한다.
    const board = makeStoryboard(5);
    board.panels[0].characters = ["엄마"];
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });

  test("dialogue.character에 identifier가 아닌 이름을 쓰면 거부된다", () => {
    const board = makeStoryboard(5);
    board.panels[0].dialogue = [{ character: "엄마", text: "안녕" }];
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });

  test("소문자 character_a 같은 형식은 거부된다(대문자 identifier만 허용)", () => {
    const board = makeStoryboard(5);
    board.panels[0].characters = ["character_a"];
    expect(StoryboardRawSchema.safeParse(board).success).toBe(false);
  });
});

describe("validateStoryboardAgainstProject", () => {
  const allowedIdentifiers = ["CHARACTER_A", "CHARACTER_B"];

  test("본문 5장 요청에 정확히 5개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(5), {
      expectedSceneCount: 5,
      allowedIdentifiers,
    });
    expect(result.valid).toBe(true);
  });

  test("본문 9장 요청(표지 포함 총 10장)에 정확히 9개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(9), {
      expectedSceneCount: 9,
      allowedIdentifiers,
    });
    expect(result.valid).toBe(true);
  });

  test("본문 19장 요청(표지 포함 총 20장)에 정확히 19개 panel이면 통과한다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(19), {
      expectedSceneCount: 19,
      allowedIdentifiers,
    });
    expect(result.valid).toBe(true);
  });

  test("요청한 본문 장면 수와 panel 개수가 다르면 거부된다", () => {
    const result = validateStoryboardAgainstProject(makeStoryboard(5), {
      expectedSceneCount: 8,
      allowedIdentifiers,
    });
    expect(result.valid).toBe(false);
  });

  test("panel_number가 1부터 연속되지 않으면 거부된다", () => {
    const board = makeStoryboard(5);
    board.panels[2].panel_number = 10; // 연속성 깨뜨림
    const result = validateStoryboardAgainstProject(board, { expectedSceneCount: 5, allowedIdentifiers });
    expect(result.valid).toBe(false);
  });

  test("허용되지 않은 identifier가 본문에 있으면 거부된다", () => {
    const board = makeStoryboard(5);
    board.panels[0].characters = ["CHARACTER_Z"];
    const result = validateStoryboardAgainstProject(board, { expectedSceneCount: 5, allowedIdentifiers });
    expect(result.valid).toBe(false);
  });

  test("허용되지 않은 identifier가 표지에 있으면 거부된다", () => {
    const board = makeStoryboard(5, { characters: ["CHARACTER_Z"] });
    const result = validateStoryboardAgainstProject(board, { expectedSceneCount: 5, allowedIdentifiers });
    expect(result.valid).toBe(false);
  });

  test("대사 화자가 그 컷의 등장인물 목록에 없으면 거부된다", () => {
    const board = makeStoryboard(5);
    board.panels[0].characters = ["CHARACTER_A"];
    board.panels[0].dialogue = [{ character: "CHARACTER_B", text: "안녕" }]; // 이 컷엔 B가 등장하지 않음
    const result = validateStoryboardAgainstProject(board, { expectedSceneCount: 5, allowedIdentifiers });
    expect(result.valid).toBe(false);
  });

  test("허용된 identifier는 유니코드 정규화(NFC/NFD)와 무관하게 항상 통과한다", () => {
    // 이번 버그의 근본 원인 재현 확인: 예전 방식(display_name 문자열
    // 비교)이었다면 "엄마"의 NFC/NFD 형태가 다르면 실패할 수 있었다.
    // CHARACTER_A는 순수 ASCII라 애초에 이 문제가 발생할 수 없다.
    const nfd = "CHARACTER_A".normalize("NFD");
    const nfc = "CHARACTER_A".normalize("NFC");
    expect(nfd).toBe(nfc); // ASCII이므로 정규화 형태가 항상 동일함을 전제로 확인
    const result = validateStoryboardAgainstProject(makeStoryboard(5), {
      expectedSceneCount: 5,
      allowedIdentifiers: [nfd],
    });
    expect(result.valid).toBe(true);
  });
});
