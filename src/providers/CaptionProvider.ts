import type { CaptionResult } from "./captionSchema";

export interface CaptionPanelContext {
  panel_number: number;
  scene: string | null;
  dialogue_texts: string[];
  narration: string | null;
}

export interface GenerateCaptionInput {
  title: string;
  storySummary: string | null;
  panels: CaptionPanelContext[];
}

/**
 * 인스타그램 캡션/해시태그 생성 프로바이더 추상화. 이미지 생성
 * Provider(ImageProvider/CharacterSheetProvider)와 완전히 분리한다 —
 * 이미지를 다시 분석하지 않고, 이미 저장된 스토리 텍스트(제목/요약/
 * 대사/내레이션)만 입력으로 받는다. 원본 사진, Character Sheet,
 * 완성된 이미지는 절대 이 Provider에 전달하지 않는다.
 */
export interface CaptionProvider {
  readonly id: string;
  generateCaption(input: GenerateCaptionInput): Promise<CaptionResult>;
}
