/**
 * Instagram Feed 4:5(1080x1350) Final canvas 안에 approved 원본 이미지를
 * stretch/crop 없이 배치하기 위한 순수 기하 계산.
 *
 * "CONTAIN" 정책: 원본 aspect ratio를 유지한 채, canvas 안에 완전히
 * 들어가는 최대 크기로 축소/확대한 뒤 중앙 정렬한다. 비율 차이로 생기는
 * 여백은 renderPanel.ts가 별도의 blur 배경으로 채운다(이 함수의 책임은
 * 아니다).
 *
 * DOM(HTMLCanvasElement/Image)에 의존하지 않는 순수 함수라서 vitest의
 * 기본 node 환경에서 바로 단위 테스트할 수 있다 — 이 프로젝트가
 * wrapText/clampBubbleRect 같은 렌더링 관련 계산을 항상 순수 함수로
 * 분리해 테스트해온 것과 같은 패턴이다.
 */
export interface ContainRect {
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
}

export function computeContainRect(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number
): ContainRect {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (canvasWidth - drawWidth) / 2;
  const offsetY = (canvasHeight - drawHeight) / 2;
  return { offsetX, offsetY, drawWidth, drawHeight };
}

/**
 * "COVER" 정책(배경 레이어 전용): canvas 전체를 빈틈없이 채우는 최소
 * 크기로 확대한 뒤 중앙 정렬한다 — 넘치는 부분은 canvas 경계에서
 * 자연스럽게 잘린다(ctx가 자체적으로 clip하므로 별도 처리 불필요).
 */
export function computeCoverRect(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number
): ContainRect {
  const scale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (canvasWidth - drawWidth) / 2;
  const offsetY = (canvasHeight - drawHeight) / 2;
  return { offsetX, offsetY, drawWidth, drawHeight };
}

/**
 * bubble/narration/cover 좌표는 "foreground(원본 이미지) 기준" 0~1
 * 정규화 값으로 저장되어 있다(DB 마이그레이션 주석 참조). 이를 실제
 * canvas 픽셀 좌표로 변환한다 — 반드시 contain rect의 offset/drawWidth/
 * drawHeight를 거쳐야 하며, canvas 전체 크기를 직접 곱하면 안 된다
 * (그러면 letterbox 여백만큼 위치가 어긋난다).
 */
export function normalizedRectToCanvasPx(
  rect: { x: number; y: number; width: number; height: number },
  foreground: ContainRect
): { x: number; y: number; width: number; height: number } {
  return {
    x: foreground.offsetX + rect.x * foreground.drawWidth,
    y: foreground.offsetY + rect.y * foreground.drawHeight,
    width: rect.width * foreground.drawWidth,
    height: rect.height * foreground.drawHeight,
  };
}

/**
 * font_size는 기존에 "canvas 폭 1080 = foreground 폭"이라는 전제로
 * 보정되어 있었다(renderPanel.ts의 (font_size/1080)*canvasWidth). 이제
 * foreground가 letterbox로 인해 canvas보다 좁아질 수 있으므로, canvas
 * 폭이 아니라 foreground의 실제 렌더 폭(drawWidth) 기준으로 같은 비율
 * 보정을 적용한다 — 이렇게 해야 Editor에서 설정한 "상대적 크기"가
 * 유지된다(§9).
 */
export function scaleFontSizeToForeground(fontSizePx: number, foregroundDrawWidth: number): number {
  return (fontSizePx / 1080) * foregroundDrawWidth;
}
