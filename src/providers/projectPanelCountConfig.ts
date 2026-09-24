/**
 * 표지 포함 TOTAL 컷 수의 단일 기준값.
 *
 * DB CHECK(toon_projects_panel_count_check), zod(formValidation.ts),
 * AI storyboard 스키마(storyboardSchema.ts), UI(NewProjectForm.tsx,
 * StoryboardEditor.tsx)가 전부 이 상수를 참조해야 한다 — 한쪽만
 * 20장을 허용하고 다른 쪽이 예전 값(10)에 머무는 불일치를 막기 위함.
 */
export const PROJECT_TOTAL_PANEL_COUNT_MIN = 2;
export const PROJECT_TOTAL_PANEL_COUNT_MAX = 20;
/** New projects only; saved projects always retain their own panel_count. */
export const PROJECT_DEFAULT_PANEL_COUNT = 11;

/** 한 프로젝트(에피소드)에 표지가 있을 때, 본문 컷 수의 허용 범위. */
export const PROJECT_SCENE_COUNT_MIN_WITH_COVER = PROJECT_TOTAL_PANEL_COUNT_MIN - 1;
export const PROJECT_SCENE_COUNT_MAX_WITH_COVER = PROJECT_TOTAL_PANEL_COUNT_MAX - 1;

/** 한 컷/표지에 동시에 등장할 수 있는 캐릭터(Character Sheet reference) 최대 인원. */
export const MAX_CHARACTERS_PER_PANEL = 4;
