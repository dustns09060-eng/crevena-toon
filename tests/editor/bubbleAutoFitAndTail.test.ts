import { describe, expect, test } from "vitest";
import {
  computeAutoFitBubbleSize,
  computeBubbleTailTriangle,
  shouldRenderBubbleTail,
} from "../../lib/editor/bubbleLayout";
import type { ToonBubble } from "../../src/db/types";

// 실제 canvas 없이 결정적으로 검증하기 위한 근사 measureWidth: 문자 1개 = fontSizePx*0.6
function makeMeasure(fontSizePx: number) {
  return (text: string) => text.length * fontSizePx * 0.6;
}

const BASE_BUBBLE: ToonBubble = {
  x: 0.1,
  y: 0.1,
  width: 0.4,
  height: 0.15,
  tail_direction: "bottom-left",
  style: "round",
};

describe("computeAutoFitBubbleSize — Auto Fit 크기 계산", () => {
  test("짧은 한 줄 문장은 작은 bubble이 된다", () => {
    const fontSizePx = 28;
    const result = computeAutoFitBubbleSize({
      text: "어?",
      fontSizePx,
      measureWidth: makeMeasure(fontSizePx),
      wrapWidthPx: 700,
      minWidthPx: 50,
      minHeightPx: 30,
      maxWidthPx: 900,
      maxHeightPx: 400,
    });
    expect(result.lineCount).toBe(1);
    // 최소값보다는 크거나 같고, wrapWidthPx보다는 훨씬 작아야 한다.
    expect(result.widthPx).toBeGreaterThanOrEqual(50);
    expect(result.widthPx).toBeLessThan(200);
  });

  test("긴 문장은 wrapWidthPx 한도 내에서 여러 줄로 줄바꿈되고, 짧은 문장보다 더 크다", () => {
    const fontSizePx = 28;
    const measure = makeMeasure(fontSizePx);
    const shortResult = computeAutoFitBubbleSize({
      text: "안녕",
      fontSizePx,
      measureWidth: measure,
      wrapWidthPx: 400,
      minWidthPx: 30,
      minHeightPx: 20,
      maxWidthPx: 900,
      maxHeightPx: 400,
    });
    const longResult = computeAutoFitBubbleSize({
      text: "오늘 밤 12시까지인데 큰일 났다 정말로 큰일 났다 진짜로 큰일 났다",
      fontSizePx,
      measureWidth: measure,
      wrapWidthPx: 400,
      minWidthPx: 30,
      minHeightPx: 20,
      maxWidthPx: 900,
      maxHeightPx: 400,
    });
    expect(longResult.lineCount).toBeGreaterThan(1);
    expect(longResult.widthPx).toBeLessThanOrEqual(400 + 1e-6);
    expect(longResult.heightPx).toBeGreaterThan(shortResult.heightPx);
  });

  test("min 값보다 작아지지 않는다(너무 작은 말풍선 방지)", () => {
    const fontSizePx = 10;
    const result = computeAutoFitBubbleSize({
      text: "아",
      fontSizePx,
      measureWidth: makeMeasure(fontSizePx),
      wrapWidthPx: 700,
      minWidthPx: 120,
      minHeightPx: 60,
      maxWidthPx: 900,
      maxHeightPx: 400,
    });
    expect(result.widthPx).toBeGreaterThanOrEqual(120);
    expect(result.heightPx).toBeGreaterThanOrEqual(60);
  });

  test("max 값을 넘지 않는다(화면을 뒤덮는 것 방지)", () => {
    const fontSizePx = 40;
    const veryLongText = "가".repeat(500);
    const result = computeAutoFitBubbleSize({
      text: veryLongText,
      fontSizePx,
      measureWidth: makeMeasure(fontSizePx),
      wrapWidthPx: 700,
      minWidthPx: 30,
      minHeightPx: 20,
      maxWidthPx: 700,
      maxHeightPx: 300,
    });
    expect(result.widthPx).toBeLessThanOrEqual(700);
    expect(result.heightPx).toBeLessThanOrEqual(300);
  });
});

describe("shouldRenderBubbleTail — Legacy Tail Protection", () => {
  test("tail_enabled가 undefined인 기존(레거시) bubble은 tail_direction이 있어도 그리지 않는다", () => {
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: undefined })).toBe(false);
  });

  test("tail_enabled === false면 그리지 않는다", () => {
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: false })).toBe(false);
  });

  test("tail_enabled === true 이고 방향이 있으면(round) 그린다", () => {
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: true, tail_direction: "bottom-left" })).toBe(true);
  });

  test("tail_enabled === true 여도 방향이 none이면 그리지 않는다", () => {
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: true, tail_direction: "none" })).toBe(false);
  });

  test("tail_enabled === true 여도 style이 thought/emphasis면 그리지 않는다(round 전용)", () => {
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: true, style: "thought" })).toBe(false);
    expect(shouldRenderBubbleTail({ ...BASE_BUBBLE, tail_enabled: true, style: "emphasis" })).toBe(false);
  });

  test("style이 없으면(undefined) round로 취급해 그린다", () => {
    const { style: _style, ...withoutStyle } = BASE_BUBBLE;
    expect(shouldRenderBubbleTail({ ...withoutStyle, tail_enabled: true, tail_direction: "right" })).toBe(true);
  });
});

describe("computeBubbleTailTriangle — Tail geometry", () => {
  const px = { x: 100, y: 100, width: 200, height: 80 };

  test("none이면 삼각형이 없다", () => {
    expect(computeBubbleTailTriangle(px, "none")).toBeNull();
  });

  test("bottom-left는 bubble 아래쪽, 왼쪽에 삼각형을 만든다(y가 bubble 하단보다 크다)", () => {
    const tri = computeBubbleTailTriangle(px, "bottom-left");
    expect(tri).not.toBeNull();
    const ys = tri!.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(px.y + px.height);
    const xs = tri!.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(px.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(px.x + px.width * 0.5);
  });

  test("right는 bubble 오른쪽 바깥으로 뻗는다(x가 bubble 우측보다 크다)", () => {
    const tri = computeBubbleTailTriangle(px, "right");
    expect(tri).not.toBeNull();
    const xs = tri!.map((p) => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(px.x + px.width);
  });

  test("top-right는 bubble 위쪽으로 뻗는다(y가 bubble 상단보다 작다)", () => {
    const tri = computeBubbleTailTriangle(px, "top-right");
    expect(tri).not.toBeNull();
    const ys = tri!.map((p) => p[1]);
    expect(Math.min(...ys)).toBeLessThan(px.y);
  });

  test("작은 bubble이라도 삼각형 크기가 음수/0이 되지 않는다", () => {
    const tinyPx = { x: 0, y: 0, width: 20, height: 15 };
    const tri = computeBubbleTailTriangle(tinyPx, "bottom-left");
    expect(tri).not.toBeNull();
    // 세 꼭짓점이 서로 달라야(퇴화하지 않은 삼각형) 한다.
    const unique = new Set(tri!.map((p) => p.join(",")));
    expect(unique.size).toBe(3);
  });
});
