import type { CharacterSheetProvider } from "./CharacterSheetProvider";
import { geminiCharacterSheetProvider } from "./geminiCharacterSheetProvider";
import { openaiCharacterSheetProvider } from "./openaiCharacterSheetProvider";

/** STEP 0 PoC 결과에 따라 Gemini를 기본으로 사용한다. */
export const DEFAULT_CHARACTER_SHEET_PROVIDER_ID = process.env.IMAGE_PROVIDER_ID ?? "gemini";

export const CHARACTER_SHEET_PROVIDERS: Record<string, CharacterSheetProvider> = {
  gemini: geminiCharacterSheetProvider,
  openai: openaiCharacterSheetProvider,
};

export function getCharacterSheetProvider(
  id: string = DEFAULT_CHARACTER_SHEET_PROVIDER_ID
): CharacterSheetProvider {
  const provider = CHARACTER_SHEET_PROVIDERS[id];
  if (!provider) throw new Error(`알 수 없는 이미지 생성 프로바이더: ${id}`);
  return provider;
}
