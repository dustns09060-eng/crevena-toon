import { describe, expect, test } from "vitest";
import {
  clampBubbleRect,
  getDefaultBubbleForIndex,
  getDefaultNarrationBubble,
  wrapText,
} from "../../lib/editor/bubbleLayout";
import { ToonBubbleSchema, ToonNarrationBubbleSchema } from "../../src/db/validation";

describe("getDefaultBubbleForIndex", () => {
  test("1번째는 좌상단, 2번째는 우상단에 배치된다", () => {
    const first = getDefaultBubbleForIndex(0);
    const second = getDefaultBubbleForIndex(1);
    expect(first.x).toBeLessThan(0.5);
    expect(first.y).toBeLessThan(0.3);
    expect(second.x).toBeGreaterThan(0.5);
    expect(second.y).toBeLessThan(0.3);
  });

  test("모든 기본 배치는 정규화 좌표 유효성 검증을 통과한다", () => {
    for (let i = 0; i < 8; i++) {
      const bubble = getDefaultBubbleForIndex(i);
      expect(ToonBubbleSchema.safeParse(bubble).success).toBe(true);
    }
  });

  test("기본 스타일은 round이고 font_size가 채워져 있다", () => {
    const bubble = getDefaultBubbleForIndex(0);
    expect(bubble.style).toBe("round");
    expect(bubble.font_size).toBeGreaterThan(0);
  });
});

describe("ToonBubbleSchema — tail_enabled / left,right 방향 (additive, migration 없음)", () => {
  test("tail_enabled가 없어도(레거시 데이터) 유효하다", () => {
    const legacyBubble = getDefaultBubbleForIndex(0);
    expect(ToonBubbleSchema.safeParse(legacyBubble).success).toBe(true);
  });

  test("tail_enabled: true를 허용한다", () => {
    const bubble = { ...getDefaultBubbleForIndex(0), tail_enabled: true };
    expect(ToonBubbleSchema.safeParse(bubble).success).toBe(true);
  });

  test("tail_direction에 left/right를 허용한다", () => {
    const left = { ...getDefaultBubbleForIndex(0), tail_direction: "left" as const };
    const right = { ...getDefaultBubbleForIndex(0), tail_direction: "right" as const };
    expect(ToonBubbleSchema.safeParse(left).success).toBe(true);
    expect(ToonBubbleSchema.safeParse(right).success).toBe(true);
  });
});

describe("getDefaultNarrationBubble", () => {
  test("하단 영역에 배치되고 유효성 검증을 통과한다", () => {
    const narration = getDefaultNarrationBubble();
    expect(narration.y).toBeGreaterThan(0.5);
    expect(ToonNarrationBubbleSchema.safeParse(narration).success).toBe(true);
  });
});

describe("clampBubbleRect", () => {
  test("범위를 벗어난 좌표를 0~1 안으로 밀어 넣는다", () => {
    const clamped = clampBubbleRect({ x: -0.2, y: 1.5, width: 0.3, height: 0.2 });
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeLessThanOrEqual(1 - clamped.height);
  });

  test("x+width, y+height가 1을 넘지 않도록 보정한다", () => {
    const clamped = clampBubbleRect({ x: 0.9, y: 0.9, width: 0.4, height: 0.4 });
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(1);
  });

  test("width/height가 1을 초과하면 1로 clamp한다", () => {
    const clamped = clampBubbleRect({ x: 0, y: 0, width: 1.5, height: 1.5 });
    expect(clamped.width).toBeLessThanOrEqual(1);
    expect(clamped.height).toBeLessThanOrEqual(1);
  });

  test("이미 유효한 값은 그대로 유지한다", () => {
    const rect = { x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
    expect(clampBubbleRect(rect)).toEqual(rect);
  });
});

// 실제 canvas 없이 결정적으로 검증하기 위해 문자 수 * 상수 폭으로 근사한다.
const approxMeasure = (text: string) => text.length * 10;

describe("wrapText", () => {
  test("짧은 텍스트는 한 줄로 유지된다", () => {
    const lines = wrapText(approxMeasure, "안녕하세요", 1000);
    expect(lines).toEqual(["안녕하세요"]);
  });

  test("긴 한국어 문장은 maxWidth를 넘지 않도록 여러 줄로 나뉜다", () => {
    const text = "아니 잠깐만, 엄마가 커피 한 모금만 마시고 같이 놀아주면 안 될까?";
    const maxWidth = 150; // 15자 정도
    const lines = wrapText(approxMeasure, text, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(approxMeasure(line)).toBeLessThanOrEqual(maxWidth);
    }
    // 줄바꿈으로 글자가 유실되지 않아야 한다.
    expect(lines.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });

  test("공백 없이 매우 긴 단어는 글자 단위로 강제 줄바꿈한다", () => {
    const text = "가".repeat(50);
    const lines = wrapText(approxMeasure, text, 100); // 10자 단위
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(approxMeasure(line)).toBeLessThanOrEqual(100);
    }
  });

  test("빈 문자열은 빈 줄 하나를 반환한다", () => {
    expect(wrapText(approxMeasure, "", 100)).toEqual([""]);
  });
});
