import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { VISUAL_ANALYSIS_MAX_SIDE, VISUAL_ANALYSIS_MODEL, VisualRegionsSchema, type VisualRegions } from "./visualAnalysisSchema";

export interface VisualAnalyzer { analyze(bytes: Uint8Array, mimeType: string): Promise<VisualRegions> }
export const MAX_VISUAL_ATTEMPTS = 3;
export type VisualFailureCode = "PROVIDER_503" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "IMAGE_DOWNLOAD_FAILED" | "IMAGE_PREPROCESS_FAILED" | "INVALID_STRUCTURED_RESPONSE" | "VALIDATION_FAILED" | "CACHE_LOCK_TIMEOUT" | "CACHE_WRITE_FAILED" | "UNKNOWN";
export class VisualAnalysisError extends Error {
  constructor(public readonly failureCode: VisualFailureCode, public readonly attempts = 0, public readonly httpStatus?: number, public readonly providerStatus?: string) {
    super(failureCode);
    this.name = "VisualAnalysisError";
  }
}
export type VisualAttempt = { attempt: number; failureCode?: VisualFailureCode; httpStatus?: number; providerStatus?: string; retry: boolean; latencyMs: number };
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

function providerFailure(error: unknown, attempt: number): VisualAnalysisError {
  if (error instanceof VisualAnalysisError) return error;
  const e = error && typeof error === "object" ? error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown } : {};
  const values = [e.statusCode, e.status, e.code];
  const httpStatus = values.map((value) => Number(value)).find((value) => Number.isInteger(value) && value >= 400 && value < 600);
  const providerStatus = values.find((value): value is string => typeof value === "string" && /^[A-Z_]+$/.test(value));
  // A numeric client/quota/auth status takes precedence over any conflicting SDK status text.
  const unavailable = httpStatus === 503 || (!httpStatus && (providerStatus === "UNAVAILABLE" || e.name === "ServerError" && typeof e.message === "string" && /^got status: 503\b/.test(e.message)));
  const timeout = !httpStatus && (providerStatus === "DEADLINE_EXCEEDED" || e.name === "AbortError" || e.name === "TimeoutError");
  return new VisualAnalysisError(unavailable ? "PROVIDER_503" : timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR", attempt, httpStatus, providerStatus);
}

export function createGeminiVisualAnalyzer(dependencies: {
  generate?: (bytes: Uint8Array, mimeType: string) => Promise<string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (event: VisualAttempt) => void;
} = {}): VisualAnalyzer {
  const generate = dependencies.generate ?? (async (bytes: Uint8Array, mimeType: string) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw Error("Vision API 설정이 없습니다.");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: VISUAL_ANALYSIS_MODEL,
      contents: [{ role: "user", parts: [
        { text: "Return only bounding boxes for face, hair, hand, body, important_object, action, text_or_logo. Detect objects whose occlusion would change the scene meaning, especially laptop/computer, notebook/book being used, pencil case, phone, clock, cup being held, school bag, and study material. Include the entire visible object in its box; do not list every background object. Coordinates and importance must be normalized 0..1. Short object/action labels only. Do not identify people or infer private traits. Do not choose text positions." },
        { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
      ] }],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    return response.text;
  });
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return { async analyze(bytes, mimeType) {
    for (let attempt = 1; attempt <= MAX_VISUAL_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const text = await generate(bytes, mimeType);
        let value: unknown;
        try { value = JSON.parse(text ?? ""); }
        catch { throw new VisualAnalysisError("INVALID_STRUCTURED_RESPONSE", attempt); }
        const parsed = VisualRegionsSchema.safeParse(value);
        if (!parsed.success) throw new VisualAnalysisError("VALIDATION_FAILED", attempt);
        dependencies.onAttempt?.({ attempt, retry: false, latencyMs: Date.now() - started });
        return parsed.data;
      } catch (error) {
        const failure = providerFailure(error, attempt);
        const retry = failure.failureCode === "PROVIDER_503" && attempt < MAX_VISUAL_ATTEMPTS;
        dependencies.onAttempt?.({ attempt, failureCode: failure.failureCode, httpStatus: failure.httpStatus, providerStatus: failure.providerStatus, retry, latencyMs: Date.now() - started });
        if (!retry) throw failure;
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw Error("Vision 분석에 실패했습니다.");
  } };
}
