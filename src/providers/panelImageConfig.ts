/**
 * Instagram 인스타툰 게시를 고려한 기본 이미지 비율. 1:1을 기본으로
 * 하되, 향후 4:5 등을 추가할 수 있도록 설정값으로 분리했다.
 */
export const DEFAULT_PANEL_ASPECT_RATIO = process.env.PANEL_IMAGE_ASPECT_RATIO ?? "1:1";

// 한 컷/표지에 동시에 등장할 수 있는 캐릭터(Character Sheet reference) 최대
// 인원은 projectPanelCountConfig.ts의 MAX_CHARACTERS_PER_PANEL로 옮겼다
// (이전엔 여기 정의만 되고 실제로 어디서도 강제되지 않는 죽은 상수였다).
