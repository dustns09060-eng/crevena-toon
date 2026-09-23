import { GoogleGenAI } from "@google/genai";
import type {
  GenerateIdeasInput,
  GenerateStoryboardInput,
  StoryboardIdentifiedCharacter,
  StoryboardProvider,
} from "./StoryboardProvider";
import {
  StoryIdeasResponseSchema,
  StoryboardRawSchema,
  describeStoryboardParseIssues,
  type StoryIdea,
  type StoryboardRaw,
} from "./storyboardSchema";

export const GEMINI_STORY_MODEL = process.env.GEMINI_STORY_MODEL ?? "gemini-3.6-flash";

/**
 * 응답이 비었을 때(response.text === undefined) 최초 시도를 포함해 최대
 * 몇 번까지 시도할지. 2 = 최초 1회 + 재시도 1회.
 */
const MAX_EMPTY_RESPONSE_ATTEMPTS = 2;

/**
 * finishReason이 이 목록에 있으면 "일시적 문제가 아니라 명확한 정책적
 * 이유로 응답이 비었다"는 뜻이므로 재시도해도 다시 실패할 게 거의
 * 확실하다 — 재시도하지 않고 즉시 안전하게 실패 처리한다.
 */
const NON_RETRYABLE_EMPTY_RESPONSE_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

function isRetryableEmptyResponseReason(finishReason: string | undefined): boolean {
  // finishReason이 없거나(FINISH_REASON_UNSPECIFIED 포함) STOP/MAX_TOKENS/OTHER처럼
  // 정책과 무관한 이유라면 일시적 provider 문제로 보고 재시도를 허용한다.
  if (!finishReason) return true;
  return !NON_RETRYABLE_EMPTY_RESPONSE_REASONS.has(finishReason);
}

/**
 * response.text가 비었을 때 원인 파악에 필요한 "비민감" 메타데이터만
 * 뽑아 서버 로그용 객체로 만든다. 프롬프트/소재/사용자 개인정보/API
 * key는 이 객체에 절대 포함하지 않는다 — content.parts의 실제 텍스트도
 * 길이만 기록하고 내용은 남기지 않는다.
 */
function describeEmptyStoryboardResponse(
  response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>,
  attempt: number
) {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return {
    attempt,
    candidatesExist: Boolean(response.candidates),
    candidatesLength: response.candidates?.length ?? 0,
    finishReason: candidate?.finishReason,
    finishMessage: candidate?.finishMessage,
    hasSafetyRatings: Boolean(candidate?.safetyRatings && candidate.safetyRatings.length > 0),
    contentPartsExist: parts.length > 0,
    contentPartsCount: parts.length,
    // 실제 텍스트/썸네일 내용은 남기지 않고, part의 "종류"와 길이만 기록한다.
    partSummaries: parts.map((p) => ({
      isThought: Boolean(p.thought),
      hasTextField: typeof p.text === "string",
      textLength: typeof p.text === "string" ? p.text.length : 0,
      otherFieldNames: Object.keys(p).filter(
        (k) => k !== "text" && k !== "thought" && (p as Record<string, unknown>)[k] != null
      ),
    })),
    usageMetadata: response.usageMetadata,
  };
}

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
    cover: {
      type: "OBJECT",
      properties: {
        cover_title: { type: "STRING" },
        cover_subtitle: { type: "STRING", nullable: true },
        scene_description: { type: "STRING" },
        characters: { type: "ARRAY", items: { type: "STRING" } },
        image_prompt: { type: "STRING" },
      },
      required: ["cover_title", "scene_description", "characters", "image_prompt"],
    },
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
  required: ["title", "summary", "cover", "panels"],
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

이 에피소드는 "표지(cover) 1장 + 본문 장면(panels) 여러 장"으로 구성됩니다.
표지와 본문은 목적이 다릅니다:
- 표지(cover): 이 에피소드 전체를 대표하는 한 장면. 주인공 캐릭터가 명확하게
  보이고, Instagram 피드에서 눈에 띄는 구도를 씁니다. 위쪽이나 여백에
  cover_title(제목)이 나중에 텍스트로 얹힐 것이므로, image_prompt에는
  "상단에 깔끔한 여백을 남긴다"처럼 구도 지시만 넣으세요 — 표지 이미지
  안에 실제 글자를 그리라는 지시는 절대 넣지 마세요.
- 본문(panels): 실제 이야기가 전개되는 장면들.

이야기 구조 원칙(본문 panels에 적용):
도입(빠른 상황 이해) → 상황 전개 → 작은 문제/반전 → 감정 상승 → 핵심 장면 →
결말(공감/반전/웃음 또는 따뜻한 마무리). 요청받은 본문 장면 수에 맞게 이
흐름을 자연스럽게 압축하거나 늘리세요. 같은 상황을 단순 반복해서 장면 수만
채우지 마세요.

매우 중요 — 반드시 지킬 것:
- panels 배열의 길이는 요청받은 "본문 장면 수"와 정확히 같아야 합니다
  (표지는 panels에 포함하지 않고 cover 필드에 따로 씁니다).
- panel_number는 panels 배열 안에서 1부터 시작해 빠짐없이 연속해야 합니다.
- cover.characters, panel.characters, dialogue.character 필드에는 반드시
  아래 "등장 캐릭터" 목록에 주어진 CHARACTER_A, CHARACTER_B, CHARACTER_C
  같은 식별자만 정확히 그대로 사용하세요. 캐릭터의 실제 이름(예: 엄마,
  별이)이나 소재 텍스트에 나온 다른 표현(예: 첫째, 둘째, 큰아이)을
  characters/dialogue.character 필드에 직접 쓰면 안 됩니다 — 그 표현이
  아래 목록의 누구를 가리키는지 문맥으로 판단해서 반드시 해당 식별자로
  변환해 쓰세요. 목록에 없는 새 인물을 만들어내지 마세요 — 필요하면
  이미 있는 캐릭터로 대체하거나 그 인물 없이 장면을 구성하세요.
- 한 장면(표지 포함)에 등장하는 캐릭터는 최대 4명입니다.
- dialogue.character는 반드시 그 컷의 characters 목록 안에 있는 식별자여야 합니다.
- dialogue.text, narration, cover_subtitle은 자연스러운 한국어로 작성하세요
  (이 필드들은 자유 텍스트이므로 캐릭터를 이름/애칭으로 불러도 됩니다 —
  identifier 규칙은 characters/dialogue.character 필드에만 적용됩니다).
- image_prompt(표지 포함)는 오직 "장면, 포즈, 행동, 표정, 카메라 구도, 필요한
  배경"만 담당합니다. 캐릭터의 고정 외형(헤어스타일, 머리색, 옷 등 —
  Character Bible이 담당)을 다시 서술하지 마세요. 그리고 image_prompt에
  한국어 대사나 텍스트, 제목 글자를 그림에 그리라는 지시를 절대 넣지
  마세요 — 이미지에는 어떤 글자도 그리지 않을 것이기 때문입니다.`;

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

/**
 * 구조화된 출력(characters/dialogue.character)에서 쓸 identifier와
 * 그 identifier가 실제로 어떤 캐릭터인지(이름/역할/성격/말투)를 함께
 * 보여준다. 자유 텍스트(dialogue.text, narration 등)에서는 이름/애칭을
 * 써도 되지만, 구조화된 필드는 반드시 이 identifier만 쓰라고
 * STORYBOARD_SYSTEM_INSTRUCTION에서 별도로 강제한다.
 */
function buildIdentifiedCharacterContextText(characters: StoryboardIdentifiedCharacter[]): string {
  return characters
    .map((c) => {
      const parts = [`identifier: ${c.identifier}`, `이름: ${c.display_name}`, `역할: ${c.role}`];
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

    const sceneCount = input.panelCount - 1;
    const prompt = `요청 총 컷 수(표지 포함): ${input.panelCount}장
→ 표지(cover) 1장 + 본문 장면(panels) ${sceneCount}장으로 구성하세요.
panels 배열은 반드시 정확히 ${sceneCount}개여야 합니다.

등장 캐릭터 (characters/dialogue.character 필드에는 반드시 이 identifier만 사용하세요):
${buildIdentifiedCharacterContextText(input.characters)}

소재:
${input.topic}

위 소재를 바탕으로 표지 1장 + 본문 ${sceneCount}장짜리 인스타툰 에피소드 스토리보드를 만들어주세요.`;

    const requestConfig = {
      model: GEMINI_STORY_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: STORYBOARD_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: STORYBOARD_RESPONSE_SCHEMA,
      },
    };

    // response.text가 비어 있는 경우에만 최대 1회 재시도한다. 실제
    // 재현 결과 원인은 두 가지로 나뉜다:
    // (1) finishReason이 STOP처럼 일시적/불명확한데 content.parts가
    //     비어 있는 경우 — 재시도하면 성공하는 경우가 많았다.
    // (2) finishReason이 PROHIBITED_CONTENT/SAFETY 등 콘텐츠 정책
    //     판단으로 모델이 아예 응답을 만들지 않은 경우 — 재시도해도
    //     같은 입력이면 다시 실패할 가능성이 높으므로 재시도하지 않고
    //     즉시 안전하게 실패 처리한다(isRetryableEmptyResponseReason).
    // JSON 파싱 실패나 zod 검증 실패는 이 재시도 대상이 아니다 —
    // 아래에서 텍스트를 확보한 뒤 딱 한 번만 파싱/검증한다.
    let text: string | undefined;
    for (let attempt = 1; attempt <= MAX_EMPTY_RESPONSE_ATTEMPTS; attempt++) {
      const response = await ai.models.generateContent(requestConfig);
      if (response.text) {
        text = response.text;
        break;
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      console.error(
        "[storyboard] Gemini 응답이 비어 있습니다(response.text 없음)",
        describeEmptyStoryboardResponse(response, attempt)
      );

      if (!isRetryableEmptyResponseReason(finishReason)) {
        throw new Error(
          "AI가 안전 정책 등의 이유로 스토리보드를 생성하지 못했습니다. 소재를 조금 다르게 표현해 다시 시도해주세요."
        );
      }
      // 재시도 가능한 이유(STOP/MAX_TOKENS/OTHER/불명)면 루프를 이어간다.
      // 마지막 시도에서도 비어 있으면 루프 종료 후 아래에서 최종 실패 처리.
    }
    if (!text) throw new Error("AI 스토리보드 응답이 비어 있습니다. 잠시 후 다시 시도해주세요.");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("AI 스토리보드 응답이 올바른 JSON이 아닙니다.");
    }
    const parsed = StoryboardRawSchema.safeParse(json);
    if (!parsed.success) {
      // 원인 파악에 필요한 최소 정보(필드 위치/오류 코드/메시지)만 서버
      // 로그에 남긴다 — Gemini raw response 전체는 절대 로그에 남기지
      // 않는다(개인정보/원본 사진 프롬프트가 섞여 있을 수 있음).
      console.error(
        "[storyboard] Gemini 응답이 StoryboardRawSchema 검증에 실패했습니다",
        describeStoryboardParseIssues(parsed.error.issues)
      );
      throw new Error("AI가 만든 스토리보드 형식이 올바르지 않아 사용할 수 없습니다. 다시 시도해주세요.");
    }
    return parsed.data;
  },
};
