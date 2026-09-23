import { GoogleGenAI } from "@google/genai";
import type { CaptionProvider, GenerateCaptionInput } from "./CaptionProvider";
import { CaptionResultSchema, type CaptionResult } from "./captionSchema";

export const GEMINI_CAPTION_MODEL = process.env.GEMINI_CAPTION_MODEL ?? "gemini-3.6-flash";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    caption: { type: "STRING" },
    hashtags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["caption", "hashtags"],
} as const;

const SYSTEM_INSTRUCTION = `당신은 육아/가족 일상 인스타툰 계정의 캡션 작가입니다.

캡션 작성 원칙:
- 자연스러운 한국어, 인스타그램 피드에 어울리는 편안한 문체로 씁니다.
- 광고 문구나 홍보성 어투("지금 바로", "놓치지 마세요" 등)는 쓰지 않습니다.
- 주어진 이야기(장면/대사/내레이션)를 짧게 요약하듯 전달합니다.
- 마지막 줄에는 자연스러운 공감 유도 문장이나 질문을 하나 덧붙일 수 있습니다.
- 이모지는 과하지 않게 1~3개 정도만 자연스럽게 사용합니다.
- 캡션은 600자를 넘지 않습니다.

해시태그 작성 원칙:
- 이야기 내용과 직접 관련된 해시태그만 8~15개 제안합니다.
- 내용과 무관한 인기 해시태그를 억지로 넣지 않습니다.
- 각 해시태그는 "#"로 시작하는 한 단어(공백 없음)여야 합니다.

주어지는 정보는 제목, 스토리 요약, 각 컷의 장면 설명/대사/내레이션 텍스트뿐입니다.
이미지 자체는 주어지지 않으며, 텍스트만으로 판단합니다.`;

function buildPanelsText(panels: GenerateCaptionInput["panels"]): string {
  return panels
    .map((p) => {
      const lines = [`컷 ${p.panel_number}: ${p.scene ?? "(장면 설명 없음)"}`];
      if (p.dialogue_texts.length > 0) lines.push(`  대사: ${p.dialogue_texts.join(" / ")}`);
      if (p.narration) lines.push(`  내레이션: ${p.narration}`);
      return lines.join("\n");
    })
    .join("\n");
}

export const geminiCaptionProvider: CaptionProvider = {
  id: "gemini",

  async generateCaption(input: GenerateCaptionInput): Promise<CaptionResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `제목: ${input.title}
${input.storySummary ? `스토리 요약: ${input.storySummary}\n` : ""}
컷별 내용:
${buildPanelsText(input.panels)}

위 이야기에 어울리는 인스타그램 캡션과 해시태그를 만들어주세요.`;

    const response = await ai.models.generateContent({
      model: GEMINI_CAPTION_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI 캡션 응답이 비어 있습니다.");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("AI 캡션 응답이 올바른 JSON이 아닙니다.");
    }
    const parsed = CaptionResultSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("AI 캡션 응답이 유효하지 않습니다: " + parsed.error.issues.map((i) => i.message).join("; "));
    }
    return parsed.data;
  },
};
