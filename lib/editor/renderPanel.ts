"use client";

import type { ToonCoverTitleBubble, ToonDialogueItem, ToonNarrationBubble, ToonPanelType } from "../../src/db/types";
import { DIALOGUE_TEXT_PADDING_RATIO, computeBubbleTailTriangle, shouldRenderBubbleTail, wrapText } from "./bubbleLayout";
import { type ContainRect, computeContainRect, computeCoverRect, normalizedRectToCanvasPx, scaleFontSizeToForeground } from "./containFit";

/**
 * STEP 7 §8, STEP 7 §21 — 미리보기와 최종 이미지가 반드시 같은 결과를
 * 내야 하므로, "배경 + 원본 이미지 + 말풍선 + 내레이션 + 표지 텍스트"를
 * 그리는 로직을 이 함수 하나로 통일한다. 미리보기용 <canvas>와
 * "최종 이미지 만들기"용 <canvas>가 동일한 해상도(1080x1350, Instagram
 * Feed 4:5)로 이 함수를 호출하고, 화면에는 CSS로만 축소해서 보여준다 —
 * 그래야 두 계산이 절대 어긋나지 않는다.
 *
 * approved 원본 이미지는 실제 생성 비율(예: 864x1184)이 canvas 비율과
 * 다를 수 있으므로, stretch/crop 없이 CONTAIN 방식으로 배치하고 남는
 * 여백은 같은 이미지를 흐리게 확대한 배경으로 채운다.
 */

export interface RenderPanelInput {
  imageObjectUrl: string;
  panelType: ToonPanelType;
  dialogue: ToonDialogueItem[];
  narration: string | null;
  narrationBubble: ToonNarrationBubble | null;
  coverTitle: string | null;
  coverSubtitle: string | null;
  coverTitleBubble: ToonCoverTitleBubble | null;
  width: number;
  height: number;
}

export const FONT_FAMILY = "'Noto Sans KR', sans-serif";
/** 배경 blur 강도 — canvas 폭에 비례시켜 해상도가 달라져도 시각적으로 같은 강도를 유지한다. */
const BACKGROUND_BLUR_RATIO = 0.03;
/** blur 배경이 foreground보다 튀지 않도록 살짝 어둡게 덮는 정도. 특정 색조가 아닌 순수 검정 반투명이라 화풍(색감) 자체는 바꾸지 않는다. */
const BACKGROUND_DARKEN_ALPHA = 0.28;
/** 표지 부제 글자 크기 = 제목 글자 크기 * 이 비율. cover_title_bubble에는 font_size 필드가 하나뿐이라(스키마 변경 없이) 제목 크기에서 파생시킨다. */
const COVER_SUBTITLE_FONT_RATIO = 0.42;

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
  fontSizePx: number,
  paddingRatio = DIALOGUE_TEXT_PADDING_RATIO
) {
  ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const paddingX = box.width * paddingRatio;
  const maxWidth = box.width - paddingX * 2;
  const lines = wrapText((t) => ctx.measureText(t).width, text, maxWidth);

  const lineHeight = fontSizePx * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = box.y + box.height / 2 - totalHeight / 2 + lineHeight / 2;
  const centerX = box.x + box.width / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, startY + i * lineHeight);
  });

  return { lineCount: lines.length, lineHeight };
}

/**
 * 배경 레이어: 같은 원본 이미지를 canvas 전체를 채우도록(COVER) 확대해
 * 강하게 흐리고 살짝 어둡게 덮는다. foreground(선명한 CONTAIN 이미지)의
 * 시각적 보조 역할만 하도록, foreground보다 절대 선명하지 않게 한다.
 */
function drawBlurredBackground(ctx: CanvasRenderingContext2D, img: HTMLImageElement, canvasWidth: number, canvasHeight: number) {
  const cover = computeCoverRect(canvasWidth, canvasHeight, img.naturalWidth, img.naturalHeight);
  const blurPx = Math.max(16, Math.round(canvasWidth * BACKGROUND_BLUR_RATIO));

  ctx.save();
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(img, cover.offsetX, cover.offsetY, cover.drawWidth, cover.drawHeight);
  ctx.filter = "none";
  ctx.fillStyle = `rgba(0, 0, 0, ${BACKGROUND_DARKEN_ALPHA})`;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

function drawBubbleTail(
  ctx: CanvasRenderingContext2D,
  px: { x: number; y: number; width: number; height: number },
  item: ToonDialogueItem,
  canvasWidth: number,
  canvasHeight: number
) {
  const bubble = item.bubble;
  if (!bubble || !shouldRenderBubbleTail(bubble)) return;
  const triangle = computeBubbleTailTriangle(px, bubble.tail_direction);
  if (!triangle) return;

  // 캔버스 밖으로 나가지 않도록 각 꼭짓점을 클램프한다.
  const clamped = triangle.map(([x, y]) => [
    Math.min(Math.max(x, 0), canvasWidth),
    Math.min(Math.max(y, 0), canvasHeight),
  ]);

  ctx.save();
  ctx.globalAlpha = bubble.opacity ?? 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(clamped[0][0], clamped[0][1]);
  ctx.lineTo(clamped[1][0], clamped[1][1]);
  ctx.lineTo(clamped[2][0], clamped[2][1]);
  ctx.closePath();
  ctx.fill();
  // 말풍선 몸통과 자연스럽게 이어지도록, 베이스(bubble 테두리에 닿는) 변은
  // 제외하고 바깥쪽 두 변만 테두리와 같은 스타일로 다시 긋는다.
  ctx.lineWidth = ["emphasis", "shout"].includes(bubble.style ?? "round") ? 4 : 2;
  ctx.strokeStyle = "#111111";
  ctx.beginPath();
  ctx.moveTo(clamped[0][0], clamped[0][1]);
  ctx.lineTo(clamped[2][0], clamped[2][1]);
  ctx.lineTo(clamped[1][0], clamped[1][1]);
  ctx.stroke();
  ctx.restore();
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  item: ToonDialogueItem,
  foreground: ContainRect,
  canvasWidth: number,
  canvasHeight: number
) {
  const bubble = item.bubble;
  if (!bubble) return;

  const px = normalizedRectToCanvasPx(bubble, foreground);
  const fontSizePx = scaleFontSizeToForeground(bubble.font_size ?? 28, foreground.drawWidth);
  const style = bubble.style ?? "round";

  // round 스타일의 speech bubble tail은 몸통(둥근 사각형)보다 먼저 그려서,
  // 몸통이 tail의 베이스 쪽 이음매를 자연스럽게 덮게 한다.
  drawBubbleTail(ctx, px, item, canvasWidth, canvasHeight);

  ctx.save();
  if (style !== "text_only") {
    ctx.globalAlpha = bubble.opacity ?? 1;
    ctx.fillStyle = style === "soft" ? "#fff6ee" : "#ffffff";
    ctx.lineWidth = ["emphasis", "shout"].includes(style) ? 4 : style === "whisper" ? 1.5 : 2;
    ctx.strokeStyle = style === "soft" ? "#b99689" : style === "whisper" ? "#686868" : "#111111";
    ctx.setLineDash(style === "thought" || style === "whisper" ? [6, 6] : []);
    roundRectPath(ctx, px.x, px.y, px.width, px.height, style === "shout" ? 8 : Math.min(px.width, px.height) * 0.25);
    ctx.fill();
    ctx.stroke();
    if (style === "thought" && bubble.smart_layout_version === 1) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(Math.min(canvasWidth - 9, px.x + px.width * 0.18), Math.min(canvasHeight - 9, px.y + px.height + 9), 5, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#111111";
  if (style === "text_only") { ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 9; }
  drawWrappedText(ctx, item.text, px, fontSizePx);
  ctx.restore();
}

function drawNarration(ctx: CanvasRenderingContext2D, text: string, bubble: ToonNarrationBubble, foreground: ContainRect) {
  const px = normalizedRectToCanvasPx(bubble, foreground);
  const fontSizePx = scaleFontSizeToForeground(bubble.font_size ?? 24, foreground.drawWidth);

  ctx.save();
  const preset = bubble.preset ?? "dark";
  const palette = { dark: { bg: "0, 0, 0", fg: "#ffffff", border: "#ffffff" }, light: { bg: "255, 255, 255", fg: "#1a1a1a", border: "#777777" }, cream: { bg: "255, 243, 220", fg: "#2d2821", border: "#bba999" }, soft: { bg: "234, 224, 227", fg: "#302832", border: "#b6a6ad" } }[preset];
  ctx.fillStyle = `rgba(${palette.bg}, ${bubble.opacity ?? 0.72})`;
  roundRectPath(ctx, px.x, px.y, px.width, px.height, 10);
  ctx.fill();
  if (bubble.preset) { ctx.strokeStyle = palette.border; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = palette.fg;
  drawWrappedText(ctx, text, px, fontSizePx, 0.06);
  ctx.restore();
}

/**
 * 표지 텍스트: cover_title_bubble 영역 안에 제목(크게, 위)과 부제(작게,
 * 아래)를 순서대로 그린다. 배경 박스는 그리지 않는다 — 표지 이미지
 * 프롬프트가 애초에 제목이 들어갈 빈 여백을 남기도록 설계돼 있으므로,
 * 텍스트에 옅은 그림자만 줘 가독성을 확보한다(화풍을 바꾸는 고정 배경색
 * 없이도 밝은/어두운 배경 양쪽에서 읽히도록).
 */
function drawCoverText(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string | null,
  bubble: ToonCoverTitleBubble,
  foreground: ContainRect
) {
  const px = normalizedRectToCanvasPx(bubble, foreground);
  const titleFontPx = scaleFontSizeToForeground(bubble.font_size ?? 44, foreground.drawWidth);
  const subtitleFontPx = titleFontPx * COVER_SUBTITLE_FONT_RATIO;

  ctx.save();
  ctx.fillStyle = "#1a1a1a";
  ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
  ctx.shadowBlur = titleFontPx * 0.3;

  ctx.font = `700 ${titleFontPx}px ${FONT_FAMILY}`;
  const titleLines = wrapText((t) => ctx.measureText(t).width, title, px.width * 0.92);
  const titleLineHeight = titleFontPx * 1.25;
  const titleBlockHeight = titleLines.length * titleLineHeight;

  const spacing = subtitle ? titleFontPx * 0.35 : 0;
  const subtitleLineHeight = subtitleFontPx * 1.25;
  const subtitleLines = subtitle
    ? wrapText((t) => ctx.measureText(t).width, subtitle, px.width * 0.92)
    : [];
  const subtitleBlockHeight = subtitleLines.length * subtitleLineHeight;

  const totalHeight = titleBlockHeight + spacing + subtitleBlockHeight;
  let y = px.y + px.height / 2 - totalHeight / 2;
  const centerX = px.x + px.width / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `700 ${titleFontPx}px ${FONT_FAMILY}`;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, centerX, y + i * titleLineHeight);
  });
  y += titleBlockHeight + spacing;

  if (subtitle) {
    ctx.font = `400 ${subtitleFontPx}px ${FONT_FAMILY}`;
    subtitleLines.forEach((line, i) => {
      ctx.fillText(line, centerX, y + i * subtitleLineHeight);
    });
  }
  ctx.restore();
}

export type RenderedForeground = ContainRect;

export async function renderPanelToCanvas(canvas: HTMLCanvasElement, input: RenderPanelInput): Promise<RenderedForeground> {
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

  const foreground = computeContainRect(input.width, input.height, img.naturalWidth, img.naturalHeight);

  // 1) 여백을 채우는 흐린 배경 (COVER, blur) — foreground보다 항상 덜 선명해야 한다.
  drawBlurredBackground(ctx, img, input.width, input.height);

  // 2) 원본 이미지 본체 (CONTAIN, stretch/crop 없음, 선명)
  ctx.drawImage(img, foreground.offsetX, foreground.offsetY, foreground.drawWidth, foreground.drawHeight);

  // 3) 대사/내레이션은 항상 foreground 좌표계 기준.
  for (const item of input.dialogue) {
    drawBubble(ctx, item, foreground, input.width, input.height);
  }
  if (input.narration && input.narrationBubble) {
    drawNarration(ctx, input.narration, input.narrationBubble, foreground);
  }

  // 4) 표지 텍스트는 panel_type === 'cover'일 때만, scene 컷에는 절대 그리지 않는다.
  if (input.panelType === "cover" && input.coverTitle && input.coverTitleBubble) {
    drawCoverText(ctx, input.coverTitle, input.coverSubtitle, input.coverTitleBubble, foreground);
  }

  return foreground;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("최종 이미지 생성에 실패했습니다."));
      else resolve(blob);
    }, "image/png");
  });
}
