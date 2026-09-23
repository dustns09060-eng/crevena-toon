"use client";

import type { ToonDialogueItem, ToonNarrationBubble } from "../../src/db/types";
import { wrapText } from "./bubbleLayout";

/**
 * STEP 7 §8 — 미리보기와 최종 이미지가 반드시 같은 결과를 내야 하므로,
 * "이미지 + 말풍선 + 내레이션"을 그리는 로직을 이 함수 하나로 통일한다.
 * 미리보기용 <canvas>와 "최종 이미지 만들기"용 <canvas>가 동일한
 * 해상도(FINAL_IMAGE_SIZE)로 이 함수를 호출하고, 화면에는 CSS로만
 * 축소해서 보여준다 — 그래야 두 계산이 절대 어긋나지 않는다.
 */

export interface RenderPanelInput {
  imageObjectUrl: string;
  dialogue: ToonDialogueItem[];
  narration: string | null;
  narrationBubble: ToonNarrationBubble | null;
  width: number;
  height: number;
}

const FONT_FAMILY = "'Noto Sans KR', sans-serif";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

/**
 * STEP 7 §20 — Supabase Storage 서명 URL은 교차 출처(cross-origin)이므로
 * <img crossOrigin> 방식은 스토리지의 CORS 응답 헤더에 의존해 불안정할
 * 수 있다. 대신 fetch로 바이트를 직접 받아 blob URL(같은 출처)로
 * 변환해서 그리면, canvas가 "오염(tainted)"되지 않아 toBlob/toDataURL이
 * 어떤 환경에서도 안정적으로 동작한다.
 */
export async function fetchAsObjectUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("이미지를 다운로드하지 못했습니다.");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  fontSizePx: number
) {
  ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const paddingX = box.width * 0.1;
  const maxWidth = box.width - paddingX * 2;
  const lines = wrapText((t) => ctx.measureText(t).width, text, maxWidth);

  const lineHeight = fontSizePx * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = box.y + box.height / 2 - totalHeight / 2 + lineHeight / 2;
  const centerX = box.x + box.width / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, startY + i * lineHeight);
  });
}

function drawBubble(ctx: CanvasRenderingContext2D, item: ToonDialogueItem, canvasWidth: number, canvasHeight: number) {
  const bubble = item.bubble;
  if (!bubble) return;

  const px = {
    x: bubble.x * canvasWidth,
    y: bubble.y * canvasHeight,
    width: bubble.width * canvasWidth,
    height: bubble.height * canvasHeight,
  };
  const fontSizePx = ((bubble.font_size ?? 28) / 1080) * canvasWidth;
  const style = bubble.style ?? "round";

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = style === "emphasis" ? 4 : 2;
  ctx.strokeStyle = "#111111";
  ctx.setLineDash(style === "thought" ? [6, 6] : []);

  roundRectPath(ctx, px.x, px.y, px.width, px.height, Math.min(px.width, px.height) * 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawWrappedText(ctx, item.text, px, fontSizePx);
}

function drawNarration(
  ctx: CanvasRenderingContext2D,
  text: string,
  bubble: ToonNarrationBubble,
  canvasWidth: number,
  canvasHeight: number
) {
  const px = {
    x: bubble.x * canvasWidth,
    y: bubble.y * canvasHeight,
    width: bubble.width * canvasWidth,
    height: bubble.height * canvasHeight,
  };
  const fontSizePx = ((bubble.font_size ?? 24) / 1080) * canvasWidth;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  roundRectPath(ctx, px.x, px.y, px.width, px.height, 10);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const paddingX = px.width * 0.06;
  const maxWidth = px.width - paddingX * 2;
  const lines = wrapText((t) => ctx.measureText(t).width, text, maxWidth);
  const lineHeight = fontSizePx * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = px.y + px.height / 2 - totalHeight / 2 + lineHeight / 2;
  const centerX = px.x + px.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, centerX, startY + i * lineHeight));
  ctx.restore();
}

export async function renderPanelToCanvas(canvas: HTMLCanvasElement, input: RenderPanelInput): Promise<void> {
  canvas.width = input.width;
  canvas.height = input.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context를 사용할 수 없습니다.");

  if (document.fonts?.ready) {
    try {
      await document.fonts.load(`28px ${FONT_FAMILY}`);
      await document.fonts.ready;
    } catch {
      // 폰트 로딩 실패해도 시스템 폴백 폰트로 계속 렌더링한다.
    }
  }

  const img = await loadImage(input.imageObjectUrl);
  ctx.clearRect(0, 0, input.width, input.height);
  ctx.drawImage(img, 0, 0, input.width, input.height);

  for (const item of input.dialogue) {
    drawBubble(ctx, item, input.width, input.height);
  }

  if (input.narration && input.narrationBubble) {
    drawNarration(ctx, input.narration, input.narrationBubble, input.width, input.height);
  }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("최종 이미지 생성에 실패했습니다."));
      else resolve(blob);
    }, "image/png");
  });
}
