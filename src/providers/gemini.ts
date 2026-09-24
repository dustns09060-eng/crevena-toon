import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import type { CharacterBible, SceneDefinition } from "../types";
import { buildScenePrompt, NO_KOREAN_TEXT_RULE } from "./promptBuilder";

// 2026-09 기준 Stable 이미지 모델. 2.5 Flash Image는 신규 사용자에게
// 더 이상 제공되지 않으므로 기본값으로 사용하면 첫 생성부터 404가 난다.
export const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
const MODEL = GEMINI_MODEL;

export async function generateWithGemini(
  characters: CharacterBible[],
  scene: SceneDefinition
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const ai = new GoogleGenAI({ apiKey });

  const referencePaths = [...new Set(characters.flatMap((c) => c.reference_images))];
  const imageParts = referencePaths.map((p) => {
    const buf = fs.readFileSync(p);
    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    };
  });

  const prompt = buildScenePrompt(characters, scene);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, ...imageParts],
      },
    ],
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error(
      `Gemini 응답에 이미지 데이터가 없습니다: ${JSON.stringify(response).slice(0, 500)}`
    );
  }
  return Buffer.from(imagePart.inlineData.data, "base64");
}

export { NO_KOREAN_TEXT_RULE };

export interface ReferenceImageBytes {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * STEP 4 — 이미 완성된 프롬프트 문자열 + 메모리상의 참조 이미지
 * 바이트로 이미지를 생성하는 범용 진입점. generateWithGemini()는
 * STEP 0의 CharacterBible/SceneDefinition(로컬 파일 경로 기반)에
 * 묶여 있어 STEP 3~4의 DB/Storage 기반 흐름과 맞지 않아 새로 추가했다.
 */
export async function generateImageFromPrompt(
  prompt: string,
  referenceImages: ReferenceImageBytes[]
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const ai = new GoogleGenAI({ apiKey });

  const imageParts = referenceImages.map((img) => ({
    inlineData: {
      mimeType: img.mimeType,
      data: Buffer.from(img.bytes).toString("base64"),
    },
  }));

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, ...imageParts],
      },
    ],
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error(
      `Gemini 응답에 이미지 데이터가 없습니다: ${JSON.stringify(response).slice(0, 500)}`
    );
  }
  return Buffer.from(imagePart.inlineData.data, "base64");
}
