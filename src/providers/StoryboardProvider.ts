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

/** 021 — Location Bible 컨텍스트. 사용자가 반드시 채우는 값은 display_name/visual_prompt뿐이라 나머지는 optional. */
export interface StoryboardLocationContext {
  display_name: string;
  visual_prompt: string;
  wall_and_floor: string | null;
  fixed_furniture: string | null;
  window_style: string | null;
  recurring_props: string | null;
  distinctive_features: string | null;
}

/**
 * characterIdentifier와 동일한 이유로 LOCATION_A/B/C... 식별자를 부여한
 * 장소. locations가 비어있는(이 시리즈에 등록된 장소가 없는) 경우,
 * 프롬프트에서 Location 섹션 자체를 생략한다 — AI에게 location 필드를
 * 채우라고 요구하지 않는다.
 */
export interface StoryboardIdentifiedLocation extends StoryboardLocationContext {
  identifier: string;
}

export interface GenerateStoryboardInput {
  topic: string;
  /** 표지 포함 TOTAL 컷 수(6/8/10 고정이 아니라 2~20 범위 — projectPanelCountConfig.ts 참조). */
  panelCount: number;
  characters: StoryboardIdentifiedCharacter[];
  /** 021 — 이 프로젝트가 속한 시리즈의 Location Set. 없으면 빈 배열. */
  locations: StoryboardIdentifiedLocation[];
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
