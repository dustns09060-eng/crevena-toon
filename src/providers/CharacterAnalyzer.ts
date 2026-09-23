/**
 * 참조 사진 → Character Bible 구조화 분석 프로바이더 추상화.
 *
 * ImageProvider(이미지 생성)와는 별도의 능력이다 — 이 인터페이스는
 * "사진을 보고 시각적 특징을 구조화된 텍스트로 뽑아내는" 역할만
 * 담당하며, 이미지를 생성하지 않는다. 서비스 로직은 이 인터페이스에만
 * 의존하고 "gemini" 같은 구체 프로바이더를 하드코딩하지 않는다.
 */

export interface AnalyzeCharacterReferenceImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface AnalyzeCharacterInput {
  referenceImages: AnalyzeCharacterReferenceImage[];
  existingCharacterData: {
    display_name: string;
    role: string;
    /** 사용자가 이미 입력한 나이대가 있으면 사진으로 나이를 추정하지 않고 이 값을 우선한다. */
    age_group?: string | null;
    personality?: string | null;
    representative_outfit?: string | null;
  };
}

export interface CharacterBibleAnalysis {
  hairstyle: string;
  hair_color: string;
  face_features: string;
  body_type: string;
  representative_outfit: string;
  distinctive_features: string | null;
  visual_prompt: string;
  negative_constraints: string[];
}

export interface CharacterAnalyzer {
  readonly id: string;
  analyzeCharacter(input: AnalyzeCharacterInput): Promise<CharacterBibleAnalysis>;
}
