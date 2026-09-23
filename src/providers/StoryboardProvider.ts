import type { StoryIdea, StoryboardRaw } from "./storyboardSchema";

export interface StoryboardCharacterContext {
  display_name: string;
  role: string;
  personality: string | null;
  speaking_style: string | null;
}

/**
 * generateStoryboard()에 전달하는 캐릭터는 display_name 문자열 매칭이
 * 아니라 CHARACTER_A/B/C... 식별자로 지칭된다(characterIdentifier.ts
 * 참조) — AI 응답의 characters/dialogue.character/cover.characters는
 * 전부 이 identifier 문자열이어야 한다.
 */
export interface StoryboardIdentifiedCharacter extends StoryboardCharacterContext {
  identifier: string;
}

export interface GenerateIdeasInput {
  characters: StoryboardCharacterContext[];
}

export interface GenerateStoryboardInput {
  topic: string;
  /** 표지 포함 TOTAL 컷 수(6/8/10 고정이 아니라 2~20 범위 — projectPanelCountConfig.ts 참조). */
  panelCount: number;
  characters: StoryboardIdentifiedCharacter[];
}

/**
 * 소재 추천 / 스토리보드 생성 프로바이더 추상화. 이미지 생성
 * 프로바이더(ImageProvider/CharacterSheetProvider)와 완전히
 * 분리했다 — 텍스트 생성은 다른 모델/제공사를 쓸 수도 있기 때문이다.
 */
export interface StoryboardProvider {
  readonly id: string;
  generateIdeas(input: GenerateIdeasInput): Promise<StoryIdea[]>;
  generateStoryboard(input: GenerateStoryboardInput): Promise<StoryboardRaw>;
}
