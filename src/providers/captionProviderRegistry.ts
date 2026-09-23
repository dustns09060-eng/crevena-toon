import type { CaptionProvider } from "./CaptionProvider";
import { geminiCaptionProvider } from "./geminiCaptionProvider";

export const DEFAULT_CAPTION_PROVIDER_ID = process.env.CAPTION_PROVIDER_ID ?? "gemini";

export const CAPTION_PROVIDERS: Record<string, CaptionProvider> = {
  gemini: geminiCaptionProvider,
};

export function getCaptionProvider(id: string = DEFAULT_CAPTION_PROVIDER_ID): CaptionProvider {
  const provider = CAPTION_PROVIDERS[id];
  if (!provider) throw new Error(`알 수 없는 Caption 프로바이더: ${id}`);
  return provider;
}
