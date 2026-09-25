import type { ToonBubble, ToonBubbleTailDirection, ToonCoverTitleBubble, ToonNarrationBubble } from "../../src/db/types";

/**
 * STEP 7 §3 — 말풍선 기본 배치 규칙.
 *
 * 픽셀/얼굴 분석 없이 "몇 번째 대사인가"만으로 정하는 단순 규칙이다.
 * 1번째: 좌상단, 2번째: 우상단, 3번째부터는 중앙/여백으로 내려가며
 * 배치한다. 사용자는 이후 자유롭게 드래그로 재배치할 수 있으므로
 * 여기서는 "겹치지 않는 합리적인 초기값" 이상을 목표로 하지 않는다.
 */
const DEFAULT_BUBBLE_SLOTS: Array<{ x: number; y: number; width: number; height: number; tail: ToonBubbleTailDirection }> = [
  { x: 0.05, y: 0.05, width: 0.42, height: 0.16, tail: "bottom-left" },
  { x: 0.53, y: 0.05, width: 0.42, height: 0.16, tail: "bottom-right" },
  { x: 0.29, y: 0.38, width: 0.42, height: 0.16, tail: "bottom-left" },
  { x: 0.05, y: 0.6, width: 0.42, height: 0.16, tail: "bottom-left" },
  { x: 0.53, y: 0.6, width: 0.42, height: 0.16, tail: "bottom-right" },
];

export const DEFAULT_BUBBLE_FONT_SIZE = 28;
export const DEFAULT_NARRATION_FONT_SIZE = 24;
/** 표지 제목 폰트 크기(기준값). 부제는 렌더러에서 이 값의 일정 비율로 자동 축소해 그린다. */
export const DEFAULT_COVER_TITLE_FONT_SIZE = 44;

export function getDefaultBubbleForIndex(index: number): ToonBubble {
  const slot = DEFAULT_BUBBLE_SLOTS[index % DEFAULT_BUBBLE_SLOTS.length];
  return {
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    tail_direction: slot.tail,
    font_size: DEFAULT_BUBBLE_FONT_SIZE,
    style: "round",
  };
}

export function getDefaultNarrationBubble(): ToonNarrationBubble {
  return { x: 0.08, y: 0.82, width: 0.84, height: 0.13, font_size: DEFAULT_NARRATION_FONT_SIZE };
}

/**
 * STEP 7 §21 — 표지(cover) 이미지는 프롬프트 단계에서 상단에 제목용
 * 여백을 의도적으로 비워두도록 지시한다(COVER_COMPOSITION_NOTE 참조).
 * 그 여백 영역을 기본값으로 사용한다. 얼굴을 가리는지는 실제 이미지를
 * 보고 개별 컷마다 재조정해야 하므로 어디까지나 초기값이다.
 */
export function getDefaultCoverTitleBubble(): ToonCoverTitleBubble {
  return { x: 0.08, y: 0.04, width: 0.84, height: 0.18, font_size: DEFAULT_COVER_TITLE_FONT_SIZE };
}

interface ClampableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * STEP 7 §17 — 드래그/리사이즈 도중에도 즉시 적용해야 하는 경계 clamp.
 * 0<=x<=1, 0<=y<=1, 0<width<=1, 0<height<=1, x+width<=1, y+height<=1을
 * 항상 만족하도록 보정한다. width/height 자체는 줄이지 않고 위치만
 * 밀어 넣는 방식을 우선하되, width/height가 1을 넘는 극단적인 값은
 * 여기서 최종적으로 clamp한다.
 */
export function clampBubbleRect<T extends ClampableRect>(rect: T): T {
  const width = Math.min(Math.max(rect.width, 0.01), 1);
  const height = Math.min(Math.max(rect.height, 0.01), 1);
  const x = Math.min(Math.max(rect.x, 0), 1 - width);
  const y = Math.min(Math.max(rect.y, 0), 1 - height);
  return { ...rect, x, y, width, height };
}

/**
 * STEP 7 §8, §16 — 캔버스 미리보기와 최종 렌더링이 동일한 줄바꿈
 * 결과를 내야 하므로, 실제 텍스트 폭 측정 함수(canvas의 measureText 등)를
 * 주입받는 순수 함수로 만든다. 이렇게 하면:
 * - 브라우저: ctx.measureText(...).width를 넘겨 pixel-accurate 줄바꿈
 * - 테스트: 문자 수 기반의 결정적 근사 함수를 넘겨 canvas 없이 검증
 * 양쪽에서 동일한 알고리즘을 재사용할 수 있다.
 */
export function wrapText(measureWidth: (text: string) => number, text: string, maxWidth: number): string[] {
  if (text.length === 0) return [""];

  const lines: string[] = [];
  // 한국어는 공백 없이 길게 이어지는 경우가 많으므로, 우선 공백 기준으로
  // 나누고 그래도 한 "단어"가 maxWidth를 넘으면 글자 단위로 강제 줄바꿈한다.
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);

  let current = "";
  for (const word of words) {
    const candidate = current + word;
    if (measureWidth(candidate) <= maxWidth || current.length === 0) {
      if (measureWidth(word) > maxWidth && current.length === 0) {
        // 단어 하나가 이미 maxWidth를 넘는 경우 글자 단위로 쪼갠다.
        let chunk = "";
        for (const ch of word) {
          if (measureWidth(chunk + ch) > maxWidth && chunk.length > 0) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = candidate;
      }
    } else {
      lines.push(current.trimEnd());
      current = word.trimStart();
    }
  }
  if (current.trim().length > 0 || lines.length === 0) lines.push(current.trimEnd());

  return lines.length > 0 ? lines : [""];
}

/**
 * renderPanel.ts의 drawWrappedText가 실제로 쓰는 값과 반드시 같아야 한다 —
 * Auto Fit이 계산에 쓰는 padding/lineHeight 비율이 실제 렌더링과 어긋나면
 * "글자에 딱 맞춘 크기"가 실제로는 렌더러 안에서 다시 줄바꿈되며 어긋난다.
 */
export const DIALOGUE_TEXT_PADDING_RATIO = 0.1; // 좌우 각각 box.width의 10%
export const LINE_HEIGHT_RATIO = 1.3; // fontSizePx 기준

// Auto Fit 결과 bubble이 너무 작거나(글자가 안 보임) 화면을 거의 덮을 만큼
// 커지는 것을 막는 안전 범위. 0~1 정규화 좌표 기준.
export const AUTO_FIT_MIN_WIDTH = 0.14;
export const AUTO_FIT_MIN_HEIGHT = 0.06;
export const AUTO_FIT_MAX_WIDTH = 0.9;
export const AUTO_FIT_MAX_HEIGHT = 0.35;
/** 한 줄이 끝없이 길어지지 않도록 줄바꿈을 강제하는 기준 폭(foreground 폭 대비 비율). */
export const AUTO_FIT_WRAP_WIDTH_RATIO = 0.7;
/** 세로 방향은 텍스트 블록에 약간의 여유(숨 쉴 공간)를 더한다. */
export const AUTO_FIT_VERTICAL_BREATHING_ROOM = 1.15;

export interface AutoFitBubbleSizeInput {
  text: string;
  /** 실제 렌더링될 폰트 크기(px, foreground 기준으로 이미 스케일된 값). */
  fontSizePx: number;
  /** ctx.measureText(...).width 같은 실제 텍스트 폭 측정 함수. */
  measureWidth: (text: string) => number;
  /** 이 폭을 넘으면 줄바꿈한다(px). */
  wrapWidthPx: number;
  minWidthPx: number;
  minHeightPx: number;
  maxWidthPx: number;
  maxHeightPx: number;
}

export interface AutoFitBubbleSizeResult {
  widthPx: number;
  heightPx: number;
  lineCount: number;
}

/**
 * STEP — "내용에 맞게" Auto Fit 크기 계산.
 *
 * drawWrappedText와 동일한 규칙(좌우 10% padding, lineHeight=fontSize*1.3)을
 * 거꾸로 적용해 "이 텍스트가 이 폰트 크기로 자연스럽게 들어가는 최소 크기"를
 * 구한다. wrapWidthPx로 먼저 줄바꿈한 뒤 실제 가장 긴 줄의 폭만큼만
 * 최종 너비로 쓰므로, 짧은 문장은 작게, 긴 문장은 wrapWidthPx 한도 내에서
 * 여러 줄로 감싸진다. 최소/최대 안전 범위를 벗어나지 않게 clamp한다.
 */
export function computeAutoFitBubbleSize(input: AutoFitBubbleSizeInput): AutoFitBubbleSizeResult {
  const usableWrapWidth = Math.max(1, input.wrapWidthPx * (1 - DIALOGUE_TEXT_PADDING_RATIO * 2));
  const lines = wrapText(input.measureWidth, input.text, usableWrapWidth);
  const longestLineWidth = Math.max(...lines.map((line) => input.measureWidth(line)));

  const naturalWidthPx = longestLineWidth / (1 - DIALOGUE_TEXT_PADDING_RATIO * 2);
  const widthPx = Math.min(Math.max(naturalWidthPx, input.minWidthPx), input.maxWidthPx);

  const lineHeightPx = input.fontSizePx * LINE_HEIGHT_RATIO;
  const naturalHeightPx = lines.length * lineHeightPx * AUTO_FIT_VERTICAL_BREATHING_ROOM;
  const heightPx = Math.min(Math.max(naturalHeightPx, input.minHeightPx), input.maxHeightPx);

  return { widthPx, heightPx, lineCount: lines.length };
}

/**
 * Legacy Tail Protection — 이 함수 하나만 통과해야 실제로 tail이 그려진다.
 * style이 round가 아니거나(생각/강조 말풍선), tail_enabled가 true가 아니거나
 * (기존 1화 데이터는 전부 undefined), 방향이 none이면 그리지 않는다.
 */
export function shouldRenderBubbleTail(bubble: Pick<ToonBubble, "style" | "tail_enabled" | "tail_direction">): boolean {
  const style = bubble.style ?? "round";
  return ["round", "normal", "soft", "shout"].includes(style) && bubble.tail_enabled === true && bubble.tail_direction !== "none";
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 말풍선 꼬리(tail) 삼각형의 세 꼭짓점을 계산한다. 순수 함수라 Editor의
 * 드래그 오버레이 미리보기와 최종 canvas 렌더링(renderPanel.ts)이 완전히
 * 같은 모양을 그리도록 공유한다.
 */
export function computeBubbleTailTriangle(
  px: PixelRect,
  direction: ToonBubbleTailDirection
): [[number, number], [number, number], [number, number]] | null {
  if (direction === "none") return null;

  const t = Math.max(10, Math.min(24, Math.min(px.width, px.height) * 0.22));

  switch (direction) {
    case "bottom-left":
      return [
        [px.x + px.width * 0.18, px.y + px.height],
        [px.x + px.width * 0.18 + t, px.y + px.height],
        [px.x + px.width * 0.1, px.y + px.height + t * 1.3],
      ];
    case "bottom-right":
      return [
        [px.x + px.width * 0.82 - t, px.y + px.height],
        [px.x + px.width * 0.82, px.y + px.height],
        [px.x + px.width * 0.9, px.y + px.height + t * 1.3],
      ];
    case "top-left":
      return [
        [px.x + px.width * 0.18, px.y],
        [px.x + px.width * 0.18 + t, px.y],
        [px.x + px.width * 0.1, px.y - t * 1.3],
      ];
    case "top-right":
      return [
        [px.x + px.width * 0.82 - t, px.y],
        [px.x + px.width * 0.82, px.y],
        [px.x + px.width * 0.9, px.y - t * 1.3],
      ];
    case "left":
      return [
        [px.x, px.y + px.height * 0.5 - t * 0.6],
        [px.x, px.y + px.height * 0.5 + t * 0.6],
        [px.x - t * 1.3, px.y + px.height * 0.5],
      ];
    case "right":
      return [
        [px.x + px.width, px.y + px.height * 0.5 - t * 0.6],
        [px.x + px.width, px.y + px.height * 0.5 + t * 0.6],
        [px.x + px.width + t * 1.3, px.y + px.height * 0.5],
      ];
    default:
      return null;
  }
}
