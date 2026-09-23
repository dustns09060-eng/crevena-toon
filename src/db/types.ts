/**
 * Supabase toon_* 테이블에 대응하는 TypeScript 타입.
 *
 * STEP 0의 `CharacterBible`(src/types.ts)과는 목적이 다르다:
 * `CharacterBible`은 이미지 생성 프롬프트를 만들기 위한 순수 인메모리
 * 값 객체이고, 이 파일의 `ToonCharacter`는 그 데이터가 Supabase에
 * 영속화됐을 때의 DB row 형태(id, user_id, timestamps 포함)다.
 * 서비스 레이어에서 `ToonCharacter` -> `CharacterBible` 변환 함수를
 * 두는 방식을 권장하며, 두 타입을 하나로 합치지 않는다.
 */

export type Uuid = string;
export type IsoTimestamp = string;

export interface ToonCharacter {
  id: Uuid;
  user_id: Uuid;
  display_name: string;
  role: string | null;
  age_group: string | null;
  hairstyle: string | null;
  hair_color: string | null;
  face_features: string | null;
  body_type: string | null;
  representative_outfit: string | null;
  personality: string | null;
  speaking_style: string | null;
  visual_prompt: string;
  /** STEP 3부터 text[] — promptBuilder에서 항목별로 안정적으로 다루기 위함 (009 마이그레이션). */
  negative_constraints: string[] | null;
  /** STEP 3에서 추가 (009 마이그레이션) — 대표 의상/헤어 외의 그 캐릭터만의 특징. */
  distinctive_features: string | null;
  character_sheet_url: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type ToonCharacterReferenceVariant = "original" | "crop" | "background_removed";

export interface ToonCharacterReference {
  id: Uuid;
  character_id: Uuid;
  variant: ToonCharacterReferenceVariant;
  storage_path: string;
  is_primary: boolean;
  sort_order: number;
  created_at: IsoTimestamp;
}

/**
 * 표지 포함 TOTAL 컷 수. 019 마이그레이션부터 6/8/10 고정이 아니라
 * 2~20 범위로 확장됐다 — 실제 허용 범위(min/max)는
 * src/providers/projectPanelCountConfig.ts의 상수 + zod 스키마 +
 * DB CHECK(toon_projects_panel_count_check)가 강제하며, 이 타입은
 * 그 셋 중 하나만 느슨하게 바꿔서 서로 어긋나는 일이 없도록 의도적으로
 * 넓은 number로만 둔다(6~20을 리터럴 유니온으로 나열하는 것보다,
 * 실제 검증은 항상 zod/DB에서 하게 하는 편이 더 안전하다).
 */
export type ToonProjectPanelCount = number;

export type ToonProjectStatus = "draft" | "storyboard" | "confirmed" | "generating" | "completed" | "failed";

export interface ToonProject {
  id: Uuid;
  user_id: Uuid;
  title: string;
  topic: string | null;
  category: string | null;
  tone: string | null;
  /** 표지 포함 TOTAL 컷 수 (표지가 없는 레거시 프로젝트는 기존처럼 본문 컷 수와 동일). */
  panel_count: ToonProjectPanelCount;
  status: ToonProjectStatus;
  /** STEP 5에서 추가 (013 마이그레이션) — AI가 생성한 스토리 요약. */
  story_summary: string | null;
  /** 020 마이그레이션에서 추가 — null이면 특정 시리즈에 속하지 않는 독립 프로젝트(레거시 포함). */
  series_id: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ToonProjectCharacter {
  project_id: Uuid;
  character_id: Uuid;
  created_at: IsoTimestamp;
}

export type ToonBubbleType = "speech" | "thought" | "narration" | "shout";

export type ToonBubbleTailDirection =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right"
  | "none";

/** STEP 7 — 말풍선 렌더링 스타일. 데이터(style 문자열)와 렌더링 방식을 분리해
 * 두어 새 스타일 추가 시 렌더러만 확장하면 되게 한다. */
export type ToonBubbleStyle = "round" | "thought" | "emphasis";

/** 0~1 normalized 좌표. 해상도/디바이스가 달라져도 동일 상대 위치를 유지한다. */
export interface ToonBubble {
  x: number;
  y: number;
  width: number;
  height: number;
  tail_direction: ToonBubbleTailDirection;
  /** STEP 7에서 추가 — 없으면 렌더러의 기본값을 사용한다. */
  font_size?: number;
  style?: ToonBubbleStyle;
}

export interface ToonDialogueItem {
  id: Uuid;
  character_id: Uuid;
  text: string;
  bubble_type: ToonBubbleType;
  /** null이면 아직 사용자가 말풍선을 배치하지 않은 상태(자동 배치 전). */
  bubble: ToonBubble | null;
}

/** STEP 7 — 내레이션 박스는 대사 말풍선과 별개 도형(상단/하단 모서리 둥근 사각형)이라
 * dialogue와 다른 구조로 분리해서 관리한다. */
export interface ToonNarrationBubble {
  x: number;
  y: number;
  width: number;
  height: number;
  font_size?: number;
}

/** 019 마이그레이션 — 표지/본문 컷 구분. */
export type ToonPanelType = "cover" | "scene";

/** 표지 제목의 배치. narration_bubble과 동일한 형태(0~1 normalized). */
export interface ToonCoverTitleBubble {
  x: number;
  y: number;
  width: number;
  height: number;
  font_size?: number;
}

export interface ToonPanel {
  id: Uuid;
  project_id: Uuid;
  panel_number: number;
  /** 019 마이그레이션 — 'cover'는 프로젝트당 최대 1개, 항상 panel_number=1. 레거시 컷은 전부 'scene'. */
  panel_type: ToonPanelType;
  scene: string | null;
  narration: string | null;
  /** STEP 7에서 추가 (018 마이그레이션) — 내레이션 박스의 위치/크기/폰트 크기. */
  narration_bubble: ToonNarrationBubble | null;
  /** 019 마이그레이션 — panel_type='cover'일 때만 사용. 스토리 narration과 의미가 달라 별도 컬럼으로 분리. */
  cover_title: string | null;
  cover_subtitle: string | null;
  cover_title_bubble: ToonCoverTitleBubble | null;
  dialogue: ToonDialogueItem[];
  /** STEP 5에서 추가 (014 마이그레이션) — 이 컷/표지에 실제 등장하는 캐릭터 목록. */
  character_ids: Uuid[];
  expression: string | null;
  image_prompt: string | null;
  image_url: string | null;
  raw_image_url: string | null;
  generation_version: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ToonCaption {
  id: Uuid;
  project_id: Uuid;
  caption: string | null;
  hashtags: string[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type ToonGenerationType =
  | "topic"
  | "storyboard"
  | "character"
  | "character_sheet"
  | "panel_image"
  | "caption"
  | "regenerate";

export type ToonGenerationStatus = "pending" | "success" | "failed" | "refunded";

/** 020 마이그레이션 — 연재(여러 Episode/Project)를 묶는 단위. */
export interface ToonSeries {
  id: Uuid;
  user_id: Uuid;
  title: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Series <-> Character N:M. 한 캐릭터가 여러 시리즈에 속할 수 있다. */
export interface ToonSeriesCharacter {
  series_id: Uuid;
  character_id: Uuid;
  created_at: IsoTimestamp;
}

export interface ToonGeneration {
  id: Uuid;
  user_id: Uuid;
  project_id: Uuid | null;
  panel_id: Uuid | null;
  generation_type: ToonGenerationType;
  provider: string;
  model: string;
  status: ToonGenerationStatus;
  image_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  credits_used: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: IsoTimestamp;
}
