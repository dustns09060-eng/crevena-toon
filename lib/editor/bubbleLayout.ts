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
