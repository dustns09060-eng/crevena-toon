import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const generateContentMock = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { generateContent: generateContentMock };
  }
  return { GoogleGenAI };
});

// system instruction 문자열은 export되어 있지 않으므로(프로바이더 내부 상수),
// 소스 파일 텍스트에서 핵심 규칙 문구가 실제로 존재하는지 확인한다 —
// STEP 5 §8/§9(한국어 대사와 image_prompt 분리) 요구사항이 프롬프트에
// 반영돼 있는지에 대한 회귀 가드다.
const source = fs.readFileSync(
  path.resolve(__dirname, "../../src/providers/geminiStoryboardProvider.ts"),
  "utf-8"
);

const VALID_STORYBOARD_JSON = JSON.stringify({
  title: "제목",
  summary: "요약",
  cover: {
    cover_title: "표지 제목",
    scene_description: "표지 장면",
    characters: ["CHARACTER_A"],
    image_prompt: "cover prompt",
  },
  panels: [
    {
      panel_number: 1,
      scene_description: "장면 1",
      characters: ["CHARACTER_A"],
      expressions: ["웃음"],
      actions: ["행동"],
      dialogue: [{ character: "CHARACTER_A", text: "안녕" }],
      narration: null,
      image_prompt: "scene prompt",
    },
  ],
});

function makeResponse(overrides: {
  text?: string;
  finishReason?: string;
  parts?: { thought?: boolean; text?: string }[];
} = {}) {
  return {
    text: overrides.text,
    candidates: [
      {
        finishReason: overrides.finishReason ?? "STOP",
        content: { parts: overrides.parts ?? [] },
        safetyRatings: [],
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  };
}

const baseCharacters = [
  { id: "11111111-1111-4111-8111-111111111111", identifier: "CHARACTER_A", display_name: "엄마", role: "주인공", personality: null, speaking_style: null },
];

describe("geminiStoryboardProvider.generateStoryboard — 빈 응답(response.text undefined) 처리", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
  });

  test("정상 response.text면 재시도 없이 1회만 호출한다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: VALID_STORYBOARD_JSON }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    const raw = await geminiStoryboardProvider.generateStoryboard({
      topic: "소재",
      panelCount: 2,
      characters: baseCharacters,
      locations: [],
    });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(raw.panels).toHaveLength(1);
  });

  test("첫 응답이 비어있고(STOP) 재시도에서 성공하면 최종적으로 성공한다", async () => {
    generateContentMock
      .mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "STOP", parts: [{ thought: true, text: "생각 중..." }] }))
      .mockResolvedValueOnce(makeResponse({ text: VALID_STORYBOARD_JSON }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    const raw = await geminiStoryboardProvider.generateStoryboard({
      topic: "소재",
      panelCount: 2,
      characters: baseCharacters,
      locations: [],
    });

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(raw.title).toBe("제목");
  });

  test("MAX_TOKENS로 비어있으면 재시도한다", async () => {
    generateContentMock
      .mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "MAX_TOKENS", parts: [{ thought: true }] }))
      .mockResolvedValueOnce(makeResponse({ text: VALID_STORYBOARD_JSON }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    const raw = await geminiStoryboardProvider.generateStoryboard({
      topic: "소재",
      panelCount: 2,
      characters: baseCharacters,
      locations: [],
    });

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(raw.panels).toHaveLength(1);
  });

  test("재시도까지 모두 비어있으면(최대 2회) 안전하게 실패한다", async () => {
    generateContentMock
      .mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "STOP" }))
      .mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "STOP" }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    await expect(
      geminiStoryboardProvider.generateStoryboard({ topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] })
    ).rejects.toThrow("비어");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  test("SAFETY로 비어있으면 재시도하지 않고 즉시 안전하게 실패한다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "SAFETY" }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    await expect(
      geminiStoryboardProvider.generateStoryboard({ topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] })
    ).rejects.toThrow(/안전 정책/);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  test("RECITATION으로 비어있으면 재시도하지 않는다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: undefined, finishReason: "RECITATION" }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    await expect(
      geminiStoryboardProvider.generateStoryboard({ topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] })
    ).rejects.toThrow();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  test("malformed JSON은 빈 응답으로 취급하지 않고 재시도 없이 즉시 실패한다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: "이건 JSON이 아님{{{" }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    await expect(
      geminiStoryboardProvider.generateStoryboard({ topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] })
    ).rejects.toThrow(/올바른 JSON/);
    // text 자체는 있었으므로 "비어있음" 재시도 루프를 아예 타지 않는다 — 1회만 호출.
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  test("zod 스키마 검증 실패는 빈 응답 재시도로 우회되지 않고 즉시 실패한다", async () => {
    const invalidJson = JSON.stringify({ title: "t", summary: "s" }); // cover/panels 누락(필수)
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: invalidJson }));
    const { geminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");

    await expect(
      geminiStoryboardProvider.generateStoryboard({ topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] })
    ).rejects.toThrow();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

describe("geminiStoryboardProvider.generateStoryboard — 503/UNAVAILABLE 재시도", () => {
  const input = { topic: "소재", panelCount: 2, characters: baseCharacters, locations: [] };
  const unavailable = () => Object.assign(new Error("private provider metadata"), { status: 503, code: "UNAVAILABLE" });
  const success = () => makeResponse({ text: VALID_STORYBOARD_JSON });
  let sleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
    sleep = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("첫 요청 성공: API 1회, backoff 없음", async () => {
    generateContentMock.mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    expect((await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).title).toBe("제목");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("503 → 성공: API 2회, 1초 backoff", async () => {
    generateContentMock.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
    expect(console.error).toHaveBeenCalledWith("[storyboard] Gemini 일시적 오류", expect.objectContaining({
      provider: "gemini", operation: "storyboard", attempt: 1,
      httpStatus: 503, retry: true, finalFailure: false,
    }));
  });

  test("503 → 503 → 성공: API 3회, 1초/2초 backoff", async () => {
    generateContentMock.mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input);
    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  test("503 3회: 안전한 사용자 오류, 마지막 호출 뒤 대기 없음", async () => {
    generateContentMock.mockRejectedValue(unavailable());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(
      "현재 AI 요청이 일시적으로 많아 스토리보드를 생성하지 못했습니다."
    );
    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(console.error).toHaveBeenLastCalledWith("[storyboard] Gemini 일시적 오류", expect.objectContaining({
      attempt: 3, httpStatus: 503, retry: false, finalFailure: true,
    }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private provider metadata");
  });

  test("SDK 0.15 ServerError 문자열 fallback으로 503을 판별한다", async () => {
    generateContentMock.mockRejectedValueOnce(Object.assign(
      new Error('got status: 503 Service Unavailable. {"error":{"code":503,"status":"UNAVAILABLE"}}'),
      { name: "ServerError" }
    )).mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  test("구조화된 UNAVAILABLE status만 있어도 재시도한다", async () => {
    generateContentMock.mockRejectedValueOnce(Object.assign(new Error("provider failure"), { status: "UNAVAILABLE" }))
      .mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  test("Retry-After를 우선하고 최대 5초로 제한한다", async () => {
    generateContentMock.mockRejectedValueOnce(Object.assign(unavailable(), { headers: { "Retry-After": "120" } }))
      .mockResolvedValueOnce(success());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await createGeminiStoryboardProvider({ sleep }).generateStoryboard(input);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5000);
  });

  test.each([400, 401, 403, 429])("HTTP %i는 재시도하지 않는다", async (status) => {
    generateContentMock.mockRejectedValueOnce(Object.assign(new Error("raw secret"), { status, code: "UNAVAILABLE" }));
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(
      "AI 서비스 요청에 실패했습니다."
    );
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("429 수치 코드가 있으면 UNAVAILABLE 문자열이 있어도 재시도하지 않는다", async () => {
    generateContentMock.mockRejectedValueOnce(Object.assign(new Error("provider failure"), {
      status: "UNAVAILABLE", code: 429,
    }));
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(/AI 서비스 요청/);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  test("PROHIBITED_CONTENT 응답은 503 재시도와 무관하게 1회에 중단한다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ finishReason: "PROHIBITED_CONTENT" }));
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(/안전 정책/);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("malformed JSON과 Zod 실패는 각각 재시도하지 않는다", async () => {
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: "{" }));
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(/JSON/);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    generateContentMock.mockResolvedValueOnce(makeResponse({ text: JSON.stringify({ title: "bad" }) }));
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(/형식/);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("empty response와 503이 섞여도 총 API 3회를 넘지 않는다", async () => {
    generateContentMock.mockResolvedValueOnce(makeResponse({ finishReason: "STOP" }))
      .mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable());
    const { createGeminiStoryboardProvider } = await import("../../src/providers/geminiStoryboardProvider");
    await expect(createGeminiStoryboardProvider({ sleep }).generateStoryboard(input)).rejects.toThrow(/현재 AI 요청/);
    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2000]]);
  });
});

describe("geminiStoryboardProvider 프롬프트 규칙", () => {
  test("image_prompt에 한국어 대사/제목 글자를 그리라는 지시를 넣지 말라는 규칙이 있다", () => {
    expect(source).toMatch(/한국어 대사나 텍스트, 제목 글자를 그림에 그리라는 지시를 절대\s*\n?\s*넣지\s*\n?\s*마세요/);
  });

  test("image_prompt는 장면/포즈/행동/표정/카메라 구도만 담당한다는 규칙이 있다", () => {
    expect(source).toMatch(/장면, 포즈, 행동, 표정, 카메라 구도/);
  });

  test("dialogue와 narration은 자연스러운 한국어로 작성하라는 규칙이 있다", () => {
    expect(source).toMatch(/자연스러운 한국어로 작성하세요/);
  });

  test("panels 배열 길이와 panel_number 연속성에 대한 필수 규칙이 있다", () => {
    expect(source).toMatch(/panels 배열의 길이는 요청받은 "본문 장면 수"와 정확히 같아야 합니다/);
    expect(source).toMatch(/panel_number는 panels 배열 안에서 1부터 시작해 빠짐없이 연속해야 합니다/);
  });

  test("표지는 panels와 분리된 별도 필드라는 규칙이 있다", () => {
    expect(source).toMatch(/표지는 panels에 포함하지 않고 cover 필드에 따로 씁니다/);
  });

  test("표지 이미지 안에 실제 글자(제목)를 그리지 말라는 규칙이 있다", () => {
    expect(source).toMatch(/표지 이미지\s*\n?\s*안에 실제 글자를 그리라는 지시는 절대 넣지 마세요/);
  });

  test("한 장면당 최대 4명이라는 규칙이 있다", () => {
    expect(source).toMatch(/한 장면\(표지 포함\)에 등장하는 캐릭터는 최대 4명입니다/);
  });

  test("실제 있었던 일처럼 소재를 지어내지 말라는 규칙이 있다(소재 추천)", () => {
    expect(source).toMatch(/사용자의 실제 과거 경험을 사실인 것처럼 지어내지 마세요/);
  });

  test("characters/dialogue.character 필드에는 CHARACTER_A/B/C identifier만 쓰라는 규칙이 있다", () => {
    expect(source).toMatch(/CHARACTER_A, CHARACTER_B, CHARACTER_C/);
    expect(source).toMatch(/목록에 없는 새 인물을 만들어내지 마세요/);
  });

  test("본문 텍스트(dialogue.text 등)에는 이름/애칭을 써도 된다는 예외가 명시돼 있다", () => {
    expect(source).toMatch(/identifier 규칙은 characters\/dialogue\.character 필드에만 적용됩니다/);
  });

  test("image_prompt가 scene_description의 장소/행동/소품/시간대와 모순되면 안 된다는 규칙이 있다", () => {
    // Production 실사용 결과 scene(한글)과 image_prompt(영문)가 서로
    // 다른 장소/시간대를 묘사해 이미지가 이를 억지로 절충하는 문제가
    // 발견되어 추가된 규칙.
    expect(source).toMatch(/image_prompt는 반드시 같은 컷의 scene_description.*시각적으로 구현해야 합니다/s);
    expect(source).toMatch(/서로 모순되면 안 됩니다/);
  });

  test("프롬프트에 캐릭터 identifier 목록을 전달한다(buildIdentifiedCharacterContextText 사용)", () => {
    expect(source).toMatch(/buildIdentifiedCharacterContextText\(input\.characters\)/);
  });

  test("image_prompt는 scene_description의 행동/최종 상태/인원수/장소/시간대를 바꿀 수 없고 카메라 앵글·프레이밍만 담당한다는 규칙이 있다", () => {
    expect(source).toMatch(
      /scene_description은 "무슨 일이 일어나는지 \/ 그 결과 최종적으로 어떤\s*\n\s*상태인지 \/ 몇 명이 등장하는지 \/ 어디서 \/ 언제"를 정하는 authoritative/
    );
    expect(source).toMatch(/image_prompt는 오직 카메라 앵글, 프레이밍, 인물 배치,\s*\n\s*시각적 강조만 추가할 수 있고/);
  });

  test("SCENE과 충돌하는 금지 문구 예시(점프/공중/달려가는 모습)가 명시돼 있다", () => {
    expect(source).toMatch(/엄마가 소파를 향해 점프하는 모습/);
    expect(source).toMatch(/공중에 떠 있는 엄마/);
    expect(source).toMatch(/소파를 향해 달려가는 엄마/);
  });

  test("여러 동작이 이어지는 scene_description은 마지막 완결 상태만 image_prompt로 표현하라는 규칙이 있다", () => {
    expect(source).toMatch(/마지막\s*\n?\s*완결된 상태\(눕다\)만 시각화하고/);
  });
});
