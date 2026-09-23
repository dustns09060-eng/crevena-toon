import { describe, expect, test } from "vitest";
import {
  computeContainRect,
  computeCoverRect,
  normalizedRectToCanvasPx,
  scaleFontSizeToForeground,
} from "../../lib/editor/containFit";

const CANVAS_W = 1080;
const CANVAS_H = 1350; // Instagram Feed 4:5

describe("computeContainRect — Final canvas(1080x1350) 안에 원본을 stretch/crop 없이 배치", () => {
  test("864x1184 세로 원본(1화 실제 규격) → 세로 방향이 꽉 차고 가로에 여백이 생긴다", () => {
    const rect = computeContainRect(CANVAS_W, CANVAS_H, 864, 1184);
    expect(rect.drawHeight).toBeCloseTo(CANVAS_H, 5);
    expect(rect.drawWidth).toBeLessThan(CANVAS_W);
    // 원본 비율이 유지되는지 (stretch 없음)
    expect(rect.drawWidth / rect.drawHeight).toBeCloseTo(864 / 1184, 5);
    // 중앙 정렬
    expect(rect.offsetX).toBeCloseTo((CANVAS_W - rect.drawWidth) / 2, 5);
    expect(rect.offsetY).toBe(0);
  });

  test("4:3 가로 원본 → 가로가 꽉 차고 위아래에 여백이 생긴다", () => {
    const rect = computeContainRect(CANVAS_W, CANVAS_H, 800, 600);
    expect(rect.drawWidth).toBeCloseTo(CANVAS_W, 5);
    expect(rect.drawHeight).toBeLessThan(CANVAS_H);
    expect(rect.drawWidth / rect.drawHeight).toBeCloseTo(800 / 600, 5);
    expect(rect.offsetX).toBe(0);
    expect(rect.offsetY).toBeCloseTo((CANVAS_H - rect.drawHeight) / 2, 5);
  });

  test("정사각형 원본 → 가로폭 기준으로 맞춰지고 위아래 여백이 생긴다(4:5 canvas가 더 김)", () => {
    const rect = computeContainRect(CANVAS_W, CANVAS_H, 1000, 1000);
    expect(rect.drawWidth).toBeCloseTo(CANVAS_W, 5);
    expect(rect.drawHeight).toBeCloseTo(CANVAS_W, 5); // 정사각형이므로 drawWidth와 동일
    expect(rect.drawHeight).toBeLessThan(CANVAS_H);
  });

  test("원본이 canvas와 완전히 같은 비율(4:5)이면 여백이 전혀 생기지 않는다", () => {
    const rect = computeContainRect(CANVAS_W, CANVAS_H, 864, 1080); // 864:1080 = 4:5
    expect(rect.drawWidth).toBeCloseTo(CANVAS_W, 5);
    expect(rect.drawHeight).toBeCloseTo(CANVAS_H, 5);
    expect(rect.offsetX).toBeCloseTo(0, 5);
    expect(rect.offsetY).toBeCloseTo(0, 5);
  });

  test("어떤 원본 비율이든 draw 크기가 canvas를 벗어나지 않는다(= crop이 필요 없다)", () => {
    for (const [w, h] of [
      [864, 1184],
      [800, 600],
      [1000, 1000],
      [300, 2000],
      [2000, 300],
    ]) {
      const rect = computeContainRect(CANVAS_W, CANVAS_H, w, h);
      expect(rect.drawWidth).toBeLessThanOrEqual(CANVAS_W + 1e-6);
      expect(rect.drawHeight).toBeLessThanOrEqual(CANVAS_H + 1e-6);
      expect(rect.offsetX).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.offsetY).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe("computeCoverRect — 배경 레이어는 canvas 전체를 여백 없이 채운다", () => {
  test("864x1184 원본 → canvas 전체를 채우도록 확대되어 가로가 canvas보다 커진다(잘림 발생, 배경 전용이라 허용)", () => {
    const rect = computeCoverRect(CANVAS_W, CANVAS_H, 864, 1184);
    expect(rect.drawHeight).toBeGreaterThanOrEqual(CANVAS_H - 1e-6);
    expect(rect.drawWidth).toBeGreaterThanOrEqual(CANVAS_W - 1e-6);
    expect(rect.drawWidth / rect.drawHeight).toBeCloseTo(864 / 1184, 5);
  });
});

describe("normalizedRectToCanvasPx — bubble 좌표는 foreground(원본 이미지) 기준으로 변환된다", () => {
  test("foreground가 canvas 전체를 채우면(여백 없음) canvas 기준 좌표와 동일하다", () => {
    const fg = { offsetX: 0, offsetY: 0, drawWidth: CANVAS_W, drawHeight: CANVAS_H };
    const px = normalizedRectToCanvasPx({ x: 0.1, y: 0.2, width: 0.5, height: 0.3 }, fg);
    expect(px).toEqual({ x: 108, y: 270, width: 540, height: 405 });
  });

  test("letterbox(여백)가 있으면 offset만큼 밀려서 계산된다 — 이게 없으면 위치가 어긋난다", () => {
    // 864x1184 원본을 1080x1350에 contain하면 offsetX가 생긴다.
    const fg = computeContainRect(CANVAS_W, CANVAS_H, 864, 1184);
    expect(fg.offsetX).toBeGreaterThan(0);

    const px = normalizedRectToCanvasPx({ x: 0, y: 0, width: 1, height: 1 }, fg);
    // 정규화 좌표 (0,0)~(1,1) 전체는 정확히 foreground의 draw 영역과 일치해야 한다.
    expect(px.x).toBeCloseTo(fg.offsetX, 5);
    expect(px.y).toBeCloseTo(fg.offsetY, 5);
    expect(px.width).toBeCloseTo(fg.drawWidth, 5);
    expect(px.height).toBeCloseTo(fg.drawHeight, 5);
  });

  test("동일한 상대 위치(0.5, 0.5 중심)는 foreground가 좁아져도 여전히 foreground의 중심을 가리킨다", () => {
    const fg = computeContainRect(CANVAS_W, CANVAS_H, 864, 1184);
    const px = normalizedRectToCanvasPx({ x: 0.5, y: 0.5, width: 0, height: 0 }, fg);
    expect(px.x).toBeCloseTo(fg.offsetX + fg.drawWidth / 2, 5);
    expect(px.y).toBeCloseTo(fg.offsetY + fg.drawHeight / 2, 5);
  });
});

describe("scaleFontSizeToForeground — 기존 1080 기준 font_size를 foreground 실제 렌더 폭에 맞게 축소한다", () => {
  test("foreground 폭이 정확히 1080이면 font_size가 그대로 유지된다(레거시 정사각형 케이스와 동일)", () => {
    expect(scaleFontSizeToForeground(28, 1080)).toBeCloseTo(28, 5);
  });

  test("foreground 폭이 1080보다 좁으면(letterbox 발생) 그 비율만큼 font_size도 작아진다", () => {
    const fg = computeContainRect(CANVAS_W, CANVAS_H, 864, 1184);
    const scaled = scaleFontSizeToForeground(28, fg.drawWidth);
    expect(scaled).toBeCloseTo((28 / 1080) * fg.drawWidth, 5);
    expect(scaled).toBeLessThan(28); // drawWidth < 1080이므로 반드시 축소되어야 함
  });

  test("DB의 font_size 값 자체는 이 함수가 절대 변경하지 않는다(순수 계산, 부수효과 없음)", () => {
    const fontSize = 28;
    scaleFontSizeToForeground(fontSize, 800);
    expect(fontSize).toBe(28);
  });
});
