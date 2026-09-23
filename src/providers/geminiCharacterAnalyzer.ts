import { GoogleGenAI } from "@google/genai";
import type { AnalyzeCharacterInput, CharacterAnalyzer, CharacterBibleAnalysis } from "./CharacterAnalyzer";
import { parseCharacterBibleAnalysis } from "./characterAnalysisSchema";

export const GEMINI_ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-3.6-flash";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    hairstyle: { type: "STRING" },
    hair_color: { type: "STRING" },
    face_features: { type: "STRING" },
    body_type: { type: "STRING" },
    representative_outfit: { type: "STRING" },
    distinctive_features: { type: "STRING", nullable: true },
    visual_prompt: { type: "STRING" },
    negative_constraints: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "hairstyle",
    "hair_color",
    "face_features",
    "body_type",
    "representative_outfit",
    "visual_prompt",
    "negative_constraints",
  ],
} as const;

/**
 * 분석 목적과 금지 사항을 명시하는 시스템 지시문.
 *
 * 원칙(STEP 3 §2): 사진 속 실제 인물의 신원을 추론/식별하지 않는다.
 * 실명, 정확한 나이, 인종/민족, 건강 상태, 장애 여부, 종교, 성적
 * 지향, 정치 성향 등 민감한 개인 특성은 절대 추론하지 않고, 사진에서
 * 직접 확인 가능한 비민감 시각 특징(머리 길이/모양/색, 얼굴형에 대한
 * 단순 묘사, 안경 여부, 대표 의상 등)만 사용한다.
 *
 * 원칙(STEP 3 §4): visual_prompt는 배경/소품을 포함하지 않는
 * "지속적인 캐릭터 특징"만 담아야 한다 — STEP 0에서 발견한
 * reference background/prop anchoring 문제를 다시 방지한다.
 */
const SYSTEM_INSTRUCTION = `당신은 인스타그램 만화(웹툰) 캐릭터 디자인을 돕는 어시스턴트입니다.
사용자가 제공한 사진 속 인물을 바탕으로, 향후 여러 컷에서 동일하게 재현할 수 있는
만화 캐릭터의 "시각적 특징"만 구조화된 JSON으로 추출하세요.

절대 하지 말 것:
- 사진 속 인물의 실명, 정확한 나이, 인종/민족, 건강 상태, 장애 여부, 종교,
  성적 지향, 정치 성향 등 민감하거나 신원을 특정할 수 있는 정보를 추론하지 마세요.
- 신원을 식별하려는 시도를 하지 마세요. 목적은 오직 "일관된 만화 캐릭터"를
  만들기 위한 비민감 시각 정보 추출입니다.
- 사진의 배경(가구, 벽, 카페, 실내외 장소 등)이나 우연히 함께 찍힌 소품
  (장난감, 유모차, 액세서리 등 캐릭터 본인이 착용하지 않은 물건)을
  캐릭터의 고정 특징에 포함하지 마세요.

visual_prompt 작성 규칙:
- 헤어스타일, 머리색, 얼굴형에 대한 단순 시각적 설명, 기본 체형,
  대표 의상처럼 "지속적으로 유지돼야 하는 특징"만 담으세요.
- 배경, 소품, 그 순간의 표정/포즈 같은 일시적 요소는 넣지 마세요.

negative_constraints는 향후 이미지 생성 시 지켜야 할 규칙을
1개 이상, 짧은 문장 여러 개의 배열로 작성하세요.
예: "머리색을 바꾸지 않는다", "머리 스타일을 크게 바꾸지 않는다",
"지정되지 않은 안경을 추가하지 않는다", "참조 사진의 배경을 복제하지 않는다",
"관련 없는 소품을 그리지 않는다", "글자나 워터마크를 추가하지 않는다".

age_group(나이대)에 대한 직접적인 질문은 이 스키마에 없습니다 — 나이를
추론하려 하지 말고, 순수하게 시각적 특징만 기술하세요.

반드시 주어진 JSON 스키마에 맞는 JSON만 출력하세요.`;

function buildUserPrompt(input: AnalyzeCharacterInput): string {
  const { display_name, role, age_group, personality, representative_outfit } = input.existingCharacterData;
  const lines = [
    `캐릭터 이름: ${display_name}`,
    `역할: ${role}`,
  ];
  if (age_group) {
    lines.push(`사용자가 입력한 나이대(이 값을 그대로 신뢰하고 사진으로 나이를 재추정하지 마세요): ${age_group}`);
  }
  if (personality) lines.push(`성격(참고용, 시각 묘사에 직접 영향 주지 않음): ${personality}`);
  if (representative_outfit) {
    lines.push(`사용자가 메모한 대표 의상(참고용, 사진과 다르면 사진을 우선): ${representative_outfit}`);
  }
  lines.push("첨부된 사진들을 보고 위 지시사항에 따라 JSON을 생성하세요.");
  return lines.join("\n");
}

export const geminiCharacterAnalyzer: CharacterAnalyzer = {
  id: "gemini",

  async analyzeCharacter(input: AnalyzeCharacterInput): Promise<CharacterBibleAnalysis> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");
    if (input.referenceImages.length === 0) {
      throw new Error("분석할 참조 사진이 없습니다.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const imageParts = input.referenceImages.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: Buffer.from(img.bytes).toString("base64") },
    }));

    const response = await ai.models.generateContent({
      model: GEMINI_ANALYSIS_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt(input) }, ...imageParts],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("AI 분석 응답이 비어 있습니다.");
    }

    const parsed = parseCharacterBibleAnalysis(text);
    if (!parsed.valid) {
      throw new Error("AI 분석 결과가 유효하지 않습니다: " + parsed.errors.join("; "));
    }

    return { ...parsed.data, distinctive_features: parsed.data.distinctive_features ?? null };
  },
};
