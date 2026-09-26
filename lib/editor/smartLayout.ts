import type { ToonBubble, ToonCoverTitleBubble, ToonDialogueItem, ToonNarrationBubble, ToonPanelType, ToonBubbleStyle } from "../../src/db/types";
import { AUTO_FIT_MAX_HEIGHT, AUTO_FIT_MIN_HEIGHT, AUTO_FIT_MIN_WIDTH, clampBubbleRect, computeAutoFitBubbleSize, wrapText } from "./bubbleLayout";

export interface SmartPanel {
  id: string;
  panelType: ToonPanelType;
  dialogue: ToonDialogueItem[];
  narration: string | null;
  narrationBubble: ToonNarrationBubble | null;
  coverTitle: string | null;
  coverSubtitle: string | null;
  coverTitleBubble: ToonCoverTitleBubble | null;
  /** True only for layouts stored in the DB; synthetic Editor defaults do not count. */
  hasStoredLayout: boolean;
}
export type SmartStatus = "PASS" | "REVIEW_REQUIRED" | "SKIPPED_MANUAL" | "UNCHANGED";
export interface SmartResult { status: SmartStatus; panel: SmartPanel; reason?: string }

// Coordinates refer to the foreground image, exactly like the existing renderer.
export const SMART_LAYOUT_SLOTS = [
  { x: 0.05, y: 0.05, side: "left" }, { x: 0.95, y: 0.05, side: "right" },
  { x: 0.05, y: 0.30, side: "left" }, { x: 0.95, y: 0.30, side: "right" },
  { x: 0.05, y: 0.55, side: "left" }, { x: 0.95, y: 0.55, side: "right" },
  { x: 0.5, y: 0.06, side: "center" }, { x: 0.5, y: 0.36, side: "center" },
  { x: 0.05, y: 0.75, side: "left" }, { x: 0.95, y: 0.75, side: "right" },
] as const;
type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 0.015 && a.x + a.width + 0.015 > b.x && a.y < b.y + b.height + 0.015 && a.y + a.height + 0.015 > b.y;
const fits = (r: Rect, placed: Rect[]) => r.x >= 0.025 && r.y >= 0.025 && r.x + r.width <= 0.975 && r.y + r.height <= 0.975 && placed.every((p) => !overlaps(r, p));

/** Stable Unicode width approximation. Same measured rectangles are saved and read by Preview/Final. */
const measure = (text: string, font: number) => [...text].reduce((sum, ch) => sum + (/[\u1100-\u9fff\uff00-\uffef]/u.test(ch) ? 1 : /\s/u.test(ch) ? 0.34 : 0.56) * font, 0);
const dims = { width: 1080, height: 1350 };
/** At the 1080px reference foreground; renderer scales with the contained image. */
export const SMART_MIN_DIALOGUE_FONT_SIZE = 26;

function preferredStyle(item: ToonDialogueItem): ToonBubbleStyle {
  const style = item.bubble?.style;
  if (style) return style;
  if (item.emotion === "panic" || item.emotion === "surprised") return "shout";
  if (item.emotion === "warm") return "soft";
  return style ?? "normal";
}

function fitDialogue(text: string, font: number, maxWidth: number): { width: number; height: number } {
  const fitted = computeAutoFitBubbleSize({
    text, fontSizePx: font, measureWidth: (t) => measure(t, font),
    wrapWidthPx: maxWidth * dims.width, minWidthPx: AUTO_FIT_MIN_WIDTH * dims.width,
    minHeightPx: AUTO_FIT_MIN_HEIGHT * dims.height, maxWidthPx: maxWidth * dims.width,
    maxHeightPx: AUTO_FIT_MAX_HEIGHT * dims.height,
  });
  return { width: fitted.widthPx / dims.width, height: fitted.heightPx / dims.height };
}

function fitNarration(text: string, font: number) {
  const lines = wrapText((t) => measure(t, font), text, dims.width * 0.72);
  const width = Math.min(0.84, Math.max(0.22, Math.max(...lines.map((l) => measure(l, font))) / (dims.width * 0.86)));
  const height = Math.min(0.26, Math.max(0.055, (lines.length * font * 1.35 + font * 0.65) / dims.height));
  // Never claim success if the full text cannot fit within the height bound.
  return { width, height, fits: (lines.length * font * 1.35 + font * 0.65) / dims.height <= 0.26 };
}

function place(size: { width: number; height: number }, candidates: readonly { x: number; y: number; side: string }[], occupied: Rect[]): { rect: Rect; side: string } | null {
  for (const slot of candidates) {
    const rect = { x: slot.side === "left" ? slot.x : slot.side === "right" ? slot.x - size.width : slot.x - size.width / 2, y: slot.y, width: size.width, height: size.height };
    if (fits(rect, occupied)) return { rect, side: slot.side };
  }
  return null;
}

export function smartLayoutPanel(original: SmartPanel, overwrite = false): SmartResult {
  if (original.hasStoredLayout && !overwrite) return { status: "SKIPPED_MANUAL", panel: original, reason: "기존 배치 있음" };
  const panel: SmartPanel = { ...original, dialogue: original.dialogue.map((d) => ({ ...d })) };
  if (panel.panelType === "cover") {
    if (!panel.coverTitle) return { status: "REVIEW_REQUIRED", panel: original, reason: "표지 제목 없음" };
    const font = panel.coverTitle.length > 32 ? 32 : panel.coverTitle.length > 20 ? 36 : 40;
    const width = 0.44;
    const titleLines = wrapText((t) => measure(t, font), panel.coverTitle, width * dims.width * 0.92).length;
    const subLines = panel.coverSubtitle ? wrapText((t) => measure(t, font * 0.42), panel.coverSubtitle, width * dims.width * 0.92).length : 0;
    const height = Math.max(0.12, (titleLines * font * 1.25 + subLines * font * 0.42 * 1.25 + (subLines ? font * 0.35 : 0)) / dims.height + 0.035);
    if (height > 0.31) return { status: "REVIEW_REQUIRED", panel: original, reason: "표지 제목이 너무 깁니다" };
    panel.coverTitleBubble = clampBubbleRect({ x: 0.06, y: 0.045, width, height, font_size: font, layout_source: "SMART_V1" as const });
    return { status: "PASS", panel };
  }

  if (!panel.dialogue.length && !panel.narration) return { status: "UNCHANGED", panel: original, reason: "배치할 텍스트 없음" };

  const occupied: Rect[] = [];
  if (panel.narration) {
    let placed: ReturnType<typeof place> = null;
    for (const font of [26, 23, 21]) {
      const size = fitNarration(panel.narration, font);
      if (!size.fits) continue;
      placed = place(size, [
        { x: 0.5, y: 0.9 - size.height, side: "center" },
        { x: 0.05, y: 0.9 - size.height, side: "left" },
        { x: 0.95, y: 0.9 - size.height, side: "right" },
        { x: 0.5, y: 0.05, side: "center" },
      ], occupied);
      if (placed) { panel.narrationBubble = { ...clampBubbleRect(placed.rect), font_size: font, preset: panel.narrationBubble?.preset ?? "dark", opacity: panel.narrationBubble?.opacity ?? 0.72, layout_source: "SMART_V1" }; break; }
    }
    if (!placed) return { status: "REVIEW_REQUIRED", panel: original, reason: "내레이션을 배치할 공간이 없습니다" };
    occupied.push(placed.rect);
  }
  for (let i = 0; i < panel.dialogue.length; i++) {
    const item = panel.dialogue[i];
    let placed: ReturnType<typeof place> = null;
    let chosenFont = 28;
    for (const font of [item.text.length < 18 ? 30 : 28, SMART_MIN_DIALOGUE_FONT_SIZE]) {
      const size = fitDialogue(item.text, font, 0.43);
      const lineCount = wrapText((t) => measure(t, font), item.text, size.width * dims.width * 0.8).length;
      if (lineCount * font * 1.3 > size.height * dims.height) continue;
      placed = place(size, SMART_LAYOUT_SLOTS, occupied);
      if (placed) { chosenFont = font; break; }
    }
    if (!placed) return { status: "REVIEW_REQUIRED", panel: original, reason: `대사 ${i + 1}을 겹치지 않게 배치할 수 없습니다` };
    const style = preferredStyle(item);
    const direction = placed.side === "left" ? "bottom-right" : placed.side === "right" ? "bottom-left" : "bottom-left";
    const hasTail = !["thought", "text_only", "whisper", "emphasis"].includes(style);
    const bubble: ToonBubble = { ...clampBubbleRect(placed.rect), font_size: chosenFont, style, tail_direction: hasTail ? direction : "none", tail_enabled: hasTail, smart_layout_version: 1, layout_source: "SMART_V1", opacity: style === "whisper" ? 0.85 : style === "soft" ? 0.94 : 1 };
    panel.dialogue[i] = { ...item, bubble };
    occupied.push(placed.rect);
  }
  return { status: "PASS", panel };
}

export function smartLayoutAll(panels: SmartPanel[], overwrite = false): SmartResult[] {
  return panels.map((panel) => smartLayoutPanel(panel, overwrite));
}
