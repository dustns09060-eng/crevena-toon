import type { StoryIdea, StoryboardRaw } from "./storyboardSchema";

export interface StoryboardCharacterContext {
  display_name: string;
  role: string;
  personality: string | null;
  speaking_style: string | null;
}

export interface GenerateIdeasInput {
  characters: StoryboardCharacterContext[];
}

export interface GenerateStoryboardInput {
  topic: string;
  panelCount: 6 | 8 | 10;
  characters: StoryboardCharacterContext[];
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
