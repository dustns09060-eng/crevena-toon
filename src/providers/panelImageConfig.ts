/**
 * Instagram 인스타툰 게시를 고려한 기본 이미지 비율. 1:1을 기본으로
 * 하되, 향후 4:5 등을 추가할 수 있도록 설정값으로 분리했다.
 */
export const DEFAULT_PANEL_ASPECT_RATIO = process.env.PANEL_IMAGE_ASPECT_RATIO ?? "1:1";

/** 한 컷 생성에 사용할 참조 이미지(캐릭터 시트) 최대 개수. */
export const MAX_CHARACTER_SHEETS_PER_PANEL = 4;
