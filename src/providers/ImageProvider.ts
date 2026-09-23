import type { CharacterBible } from "../types.js";

export interface GeneratePanelInput {
  sceneId: string;
  scenePrompt: string;
  characters: CharacterBible[];
}

export interface GeneratePanelResult {
  imageBuffer: Buffer;
  provider: string;
  model: string;
}

export interface GenerateCharacterSheetInput {
  character: CharacterBible;
  /** 기준 시트에 포함할 포즈/표정 목록 (예: "정면", "3/4 방향", "웃음" 등). */
  poses: string[];
}

export interface GenerateCharacterSheetResult {
  imageBuffer: Buffer;
  provider: string;
  model: string;
}

/**
 * 이미지 생성 프로바이더 추상화.
 *
 * DB/서비스 로직은 이 인터페이스에만 의존하고 "gemini"/"openai" 같은
 * 구체 프로바이더를 하드코딩하지 않는다. 기본 프로바이더는 STEP 0
 * PoC 결과에 따라 Gemini로 설정하되(src/providers/registry.ts),
 * OpenAI 등 다른 구현으로 언제든 교체/추가할 수 있어야 한다.
 */
export interface ImageProvider {
  readonly id: string;
  generatePanel(input: GeneratePanelInput): Promise<GeneratePanelResult>;
  generateCharacterSheet(input: GenerateCharacterSheetInput): Promise<GenerateCharacterSheetResult>;
}
