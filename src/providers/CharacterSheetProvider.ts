/**
 * Character Sheet(및 STEP 4 §11 일관성 검증용 테스트 장면) 이미지
 * 생성 프로바이더 추상화.
 *
 * STEP 1의 ImageProvider(generatePanel/generateCharacterSheet)는
 * STEP 0의 CharacterBible(로컬 파일 경로 기반 reference_images)에
 * 묶여 있어, DB/Storage 기반인 STEP 3~4 흐름과 맞지 않는다. 대신
 * "완성된 프롬프트 문자열 + 메모리상의 참조 이미지 바이트"라는
 * 더 단순한 계약으로 같은 provider-abstraction 패턴(인터페이스 +
 * Gemini/OpenAI 구현 + 레지스트리, 기본값 교체 가능)을 재사용한다.
 */

export interface ReferenceImageBytes {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GenerateFromPromptResult {
  imageBytes: Buffer;
  provider: string;
  model: string;
}

export interface CharacterSheetProvider {
  readonly id: string;
  generate(prompt: string, referenceImages: ReferenceImageBytes[]): Promise<GenerateFromPromptResult>;
}
