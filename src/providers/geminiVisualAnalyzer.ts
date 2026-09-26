import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { VISUAL_ANALYSIS_MAX_SIDE, VISUAL_ANALYSIS_MODEL, VisualRegionsSchema, type VisualRegions } from "./visualAnalysisSchema";

export interface VisualAnalyzer { analyze(bytes: Uint8Array, mimeType: string): Promise<VisualRegions> }
export const MAX_VISUAL_ATTEMPTS = 3;
const RESPONSE_SCHEMA = {
  type: "OBJECT", properties: { regions: { type: "ARRAY", items: { type: "OBJECT", properties: {
    type: { type: "STRING", enum: ["face", "hair", "hand", "body", "important_object", "action", "text_or_logo"] },
    x: { type: "NUMBER" }, y: { type: "NUMBER" }, width: { type: "NUMBER" }, height: { type: "NUMBER" },
    importance: { type: "NUMBER" }, label: { type: "STRING" },
  }, required: ["type", "x", "y", "width", "height", "importance"] } } }, required: ["regions"],
} as const;

export async function prepareVisualImage(bytes: Uint8Array): Promise<Uint8Array> {
  // An in-memory copy only; the approved Storage object is never changed.
  return new Uint8Array(await sharp(Buffer.from(bytes)).rotate().resize({ width: VISUAL_ANALYSIS_MAX_SIDE, height: VISUAL_ANALYSIS_MAX_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer());
}

function unavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
  if ([e.status, e.statusCode, e.code].some((v) => Number(v) === 503 || v === "UNAVAILABLE")) return true;
  return e.name === "ServerError" && typeof e.message === "string" && /^got status: 503\b/.test(e.message);
}

export function createGeminiVisualAnalyzer(dependencies: {
  generate?: (bytes: Uint8Array, mimeType: string) => Promise<string | undefined>;
  sleep?: (ms: number) => Promise<void>;
} = {}): VisualAnalyzer {
  const generate = dependencies.generate ?? (async (bytes: Uint8Array, mimeType: string) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw Error("Vision API 설정이 없습니다.");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: VISUAL_ANALYSIS_MODEL,
      contents: [{ role: "user", parts: [
        { text: "Return only bounding boxes for face, hair, hand, body, important_object, action, text_or_logo. Coordinates and importance must be normalized 0..1. Short object/action labels only. Do not identify people or infer private traits. Do not choose text positions." },
        { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
      ] }],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    return response.text;
  });
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return { async analyze(bytes, mimeType) {
    for (let attempt = 1; attempt <= MAX_VISUAL_ATTEMPTS; attempt++) {
      try {
        const text = await generate(bytes, mimeType);
        const parsed = VisualRegionsSchema.safeParse(JSON.parse(text ?? ""));
        if (!parsed.success) throw Error("Vision 응답 형식이 올바르지 않습니다.");
        return parsed.data;
      } catch (error) {
        if (!unavailable(error) || attempt === MAX_VISUAL_ATTEMPTS) throw error;
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw Error("Vision 분석에 실패했습니다.");
  } };
}
