import type { ImageProvider } from "./ImageProvider.js";
import { geminiProvider } from "./geminiProvider.js";
import { openaiProvider } from "./openaiProvider.js";

/**
 * STEP 0 PoC 결과(속도/비용/일관성 모두 우위)에 따라 Gemini를 기본
 * 프로바이더로 설정한다. 다른 프로바이더로 바꾸려면 이 상수만
 * 변경하면 되고, 호출부(서비스 로직)는 수정할 필요가 없다.
 */
export const DEFAULT_PROVIDER_ID = "gemini";

export const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
};

export function getImageProvider(id: string = DEFAULT_PROVIDER_ID): ImageProvider {
  const provider = IMAGE_PROVIDERS[id];
  if (!provider) {
    throw new Error(`알 수 없는 이미지 프로바이더: ${id}`);
  }
  return provider;
}
