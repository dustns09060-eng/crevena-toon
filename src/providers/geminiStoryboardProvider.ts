import { GoogleGenAI } from "@google/genai";
import type {
  GenerateIdeasInput,
  GenerateStoryboardInput,
  StoryboardProvider,
} from "./StoryboardProvider";
import { StoryIdeasResponseSchema, StoryboardRawSchema, type StoryIdea, type StoryboardRaw } from "./storyboardSchema";

export const GEMINI_STORY_MODEL = process.env.GEMINI_STORY_MODEL ?? "gemini-3.6-flash";

const IDEAS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ideas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["title", "description"],
      },
    },
  },
  required: ["ideas"],
} as const;

const STORYBOARD_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    summary: { type: "STRING" },
    panels: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          panel_number: { type: "INTEGER" },
          scene_description: { type: "STRING" },
          characters: { type: "ARRAY", items: { type: "STRING" } },
          expressions: { type: "ARRAY", items: { type: "STRING" } },
          actions: { type: "ARRAY", items: { type: "STRING" } },
          dialogue: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { character: { type: "STRING" }, text: { type: "STRING" } },
              required: ["character", "text"],
            },
          },
          narration: { type: "STRING", nullable: true },
          image_prompt: { type: "STRING" },
        },
        required: [
          "panel_number",
          "scene_description",
          "characters",
          "expressions",
          "actions",
          "dialogue",
          "image_prompt",
        ],
      },
    },
  },
  required: ["title", "summary", "panels"],
} as const;

const IDEAS_SYSTEM_INSTRUCTION = `당신은 육아/가족 일상 인스타툰의 소재를 제안하는 어시스턴트입니다.

절대 하지 말 것:
- 사용자의 실제 과거 경험을 사실인 것처럼 지어내지 마세요. 당신은 그 가족의
  실제 있었던 일을 알지 못합니다.
- 각 제안은 반드시 "이런 소재로 만들어볼까요?" 하는 하나의 아이디어 제안으로
  제시하세요. 실제 있었던 일처럼 서술하지 마세요.

주어진 캐릭터(이름/역할/성격)를 참고해, 육아/가족/일상에서 흔히 있을 법한
공감되는 소재를 3~5개 제안하세요. 각 제안은 제목과 1~2문장 설명으로 구성합니다.`;

const STORYBOARD_SYSTEM_INSTRUCTION = `당신은 인스타그램 육아 일상툰의 스토리보드 작가입니다.

이야기 구조 원칙:
도입(빠른 상황 이해) → 상황 전개 → 작은 문제/반전 → 감정 상승 → 핵심 장면 →
결말(공감/반전/웃음 또는 따뜻한 마무리). 요청받은 컷 수에 맞게 이 흐름을
자연스럽게 압축하거나 늘리세요. 같은 상황을 단순 반복해서 컷 수만 채우지 마세요.

매우 중요 — 반드시 지킬 것:
- panels 배열의 길이는 요청받은 컷 수와 정확히 같아야 합니다.
- panel_number는 1부터 시작해 빠짐없이 연속해야 합니다.
- characters와 dialogue의 character 필드에는 아래 주어진 캐릭터 이름만
  정확히 그대로 사용하세요(새 이름을 만들지 마세요).
- dialogue.character는 반드시 그 컷의 characters 목록 안에 있는 이름이어야 합니다.
- dialogue.text와 narration은 자연스러운 한국어로 작성하세요.
- image_prompt는 오직 "장면, 포즈, 행동, 표정, 카메라 구도, 필요한 배경"만
  담당합니다. 캐릭터의 고정 외형(헤어스타일, 머리색, 옷 등 — Character Bible이
  담당)을 다시 서술하지 마세요. 그리고 image_prompt에 한국어 대사나 텍스트를
  그림에 그리라는 지시를 절대 넣지 마세요 — 이미지에는 어떤 글자도 그리지
  않을 것이기 때문입니다.`;

function buildCharacterContextText(characters: { display_name: string; role: string; personality: string | null; speaking_style: string | null }[]): string {
  return characters
    .map((c) => {
      const parts = [`이름: ${c.display_name}`, `역할: ${c.role}`];
      if (c.personality) parts.push(`성격: ${c.personality}`);
      if (c.speaking_style) parts.push(`말투: ${c.speaking_style}`);
      return "- " + parts.join(", ");
    })
    .join("\n");
}

export const geminiStoryboardProvider: StoryboardProvider = {
  id: "gemini",

  async generateIdeas(input: GenerateIdeasInput): Promise<StoryIdea[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `등장 캐릭터:\n${buildCharacterContextText(input.characters)}\n\n위 캐릭터들이 등장할 육아/가족 일상 소재를 3~5개 제안해주세요.`;

    const response = await ai.models.generateContent({
      model: GEMINI_STORY_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: IDEAS_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: IDEAS_RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI 소재 추천 응답이 비어 있습니다.");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("AI 소재 추천 응답이 올바른 JSON이 아닙니다.");
    }
    const parsed = StoryIdeasResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("AI 소재 추천 응답이 유효하지 않습니다: " + parsed.error.issues.map((i) => i.message).join("; "));
    }
    return parsed.data.ideas;
  },

  async generateStoryboard(input: GenerateStoryboardInput): Promise<StoryboardRaw> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `요청 컷 수: ${input.panelCount}컷 (panels 배열은 반드시 정확히 ${input.panelCount}개)

등장 캐릭터 (이 이름만 정확히 사용하세요):
${buildCharacterContextText(input.characters)}

소재:
${input.topic}

위 소재를 바탕으로 ${input.panelCount}컷짜리 인스타툰 스토리보드를 만들어주세요.`;

    const response = await ai.models.generateContent({
      model: GEMINI_STORY_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: STORYBOARD_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: STORYBOARD_RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI 스토리보드 응답이 비어 있습니다.");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("AI 스토리보드 응답이 올바른 JSON이 아닙니다.");
    }
    const parsed = StoryboardRawSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("AI 스토리보드 응답이 유효하지 않습니다: " + parsed.error.issues.map((i) => i.message).join("; "));
    }
    return parsed.data;
  },
};
