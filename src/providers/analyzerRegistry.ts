import type { CharacterAnalyzer } from "./CharacterAnalyzer";
import { geminiCharacterAnalyzer } from "./geminiCharacterAnalyzer";

/**
 * STEP 0 PoC 결과에 따라 Gemini를 기본 분석 프로바이더로 사용한다.
 * 이미지 생성(registry.ts)과는 별도의 레지스트리로 분리했다 —
 * "분석"과 "생성"은 서로 다른 모델/제공사를 쓸 수도 있기 때문이다.
 */
export const DEFAULT_ANALYZER_ID = process.env.CHARACTER_ANALYZER_ID ?? "gemini";

export const CHARACTER_ANALYZERS: Record<string, CharacterAnalyzer> = {
  gemini: geminiCharacterAnalyzer,
};

export function getCharacterAnalyzer(id: string = DEFAULT_ANALYZER_ID): CharacterAnalyzer {
  const analyzer = CHARACTER_ANALYZERS[id];
  if (!analyzer) {
    throw new Error(`알 수 없는 Character Analyzer: ${id}`);
  }
  return analyzer;
}
