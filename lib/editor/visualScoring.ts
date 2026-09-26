import type { VisualRegion } from "../../src/providers/visualAnalysisSchema";
import type { SmartPanel, SmartResult } from "./smartLayout";
import { SMART_LAYOUT_SLOTS, smartLayoutPanel } from "./smartLayout";
import { canArrangeV2, panelLayoutSource, type ReadLayoutSource } from "./layoutProvenance";
import { computeBubbleTailTriangle, shouldRenderBubbleTail } from "./bubbleLayout";
import { wrapText } from "./bubbleLayout";
import type { ToonBubble, ToonBubbleTailDirection } from "../../src/db/types";

export type Rect = { x: number; y: number; width: number; height: number };
export type ReviewReason = "NO_SAFE_SLOT" | "FACE_OVERLAP_UNAVOIDABLE" | "TEXT_COLLISION_UNAVOIDABLE" | "ANALYSIS_FAILED";
export type VisualWarning = "LOW_IMPORTANCE_BODY_OVERLAP" | "HAIR_EDGE_OVERLAP" | "LOW_IMPORTANCE_OBJECT_OVERLAP" | "ACTION_EDGE_OVERLAP" | "HAND_EDGE_OVERLAP";
export interface VisualResult extends SmartResult {
  reasonCode?: ReviewReason;
  source: ReadLayoutSource;
  avoided: string[];
  warnings?: VisualWarning[];
}
export const VISUAL_WEIGHTS = Object.freeze({ faceMargin: 0.035, objectMargin: 0.02, tailMargin: 0.012,
  highImportance: 0.75, highObjectMultiplier: 3, highObjectContact: 0.8, textGap: 0.015, hair: 3.2, hand: 2.2,
  body: 0.5, important_object: 4, action: 4, text_or_logo: 2.5, safeLimit: 0.7, warningLimit: 2.1,
  stability: 0.14, objectAreaLimit: 0.015, textAreaLimit: 0.02, offset: 0.03,
  candidateLimit: 600, tailHairFactor: 0.22, tailBodyFactor: 0.25 });

function area(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
const expand = (r: Rect, margin: number): Rect => ({ x: r.x - margin, y: r.y - margin, width: r.width + 2 * margin, height: r.height + 2 * margin });
type Point = [number, number];
function triangleAreaInRect(triangle: Point[], rect: Rect): number {
  let points = triangle;
  const edges: { inside: (p: Point) => boolean; intersect: (a: Point, b: Point) => Point }[] = [
    { inside: (p) => p[0] >= rect.x, intersect: (a, b) => [rect.x, a[1] + (b[1] - a[1]) * (rect.x - a[0]) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= rect.x + rect.width, intersect: (a, b) => [rect.x + rect.width, a[1] + (b[1] - a[1]) * (rect.x + rect.width - a[0]) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= rect.y, intersect: (a, b) => [a[0] + (b[0] - a[0]) * (rect.y - a[1]) / (b[1] - a[1]), rect.y] },
    { inside: (p) => p[1] <= rect.y + rect.height, intersect: (a, b) => [a[0] + (b[0] - a[0]) * (rect.y + rect.height - a[1]) / (b[1] - a[1]), rect.y + rect.height] },
  ];
  for (const edge of edges) {
    const input = points; points = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], insideA = edge.inside(a), insideB = edge.inside(b);
      if (insideA && insideB) points.push(b);
      else if (insideA && !insideB) points.push(edge.intersect(a, b));
      else if (!insideA && insideB) points.push(edge.intersect(a, b), b);
    }
    if (!points.length) return 0;
  }
  return Math.abs(points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0)) / 2;
}
function tailTriangle(rect: Rect, direction: ToonBubbleTailDirection): Point[] {
  return (computeBubbleTailTriangle({ x: rect.x * 1080, y: rect.y * 1350, width: rect.width * 1080, height: rect.height * 1350 }, direction) ?? [])
    .map(([x, y]) => [x / 1080, y / 1350]);
}
export function scoreTail(rect: Rect, direction: ToonBubbleTailDirection, regions: VisualRegion[], occupied: Rect[]): number {
  const points = tailTriangle(rect, direction);
  if (!points.length) return 0;
  if (points.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)) return Infinity;
  if (occupied.some((o) => triangleAreaInRect(points, expand(o, VISUAL_WEIGHTS.textGap)) > 0)) return Infinity;
  const size = triangleAreaInRect(points, { x: 0, y: 0, width: 1, height: 1 });
  let penalty = 0;
  for (const r of regions) {
    const margin = r.type === "face" ? VISUAL_WEIGHTS.faceMargin : r.type === "important_object" || r.type === "action" ? VISUAL_WEIGHTS.objectMargin : VISUAL_WEIGHTS.tailMargin;
    const fraction = triangleAreaInRect(points, expand(r, margin)) / size;
    if (r.type === "face" && fraction > 0) return Infinity;
    if (r.type !== "face") penalty += fraction * VISUAL_WEIGHTS[r.type] * r.importance * (r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance ? VISUAL_WEIGHTS.highObjectMultiplier : 1)
      * (r.type === "hair" ? VISUAL_WEIGHTS.tailHairFactor : r.type === "body" ? VISUAL_WEIGHTS.tailBodyFactor : 1)
      + (fraction > 0 && r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance ? VISUAL_WEIGHTS.highObjectContact : 0);
  }
  return penalty;
}
export function scoreCandidate(rect: Rect, regions: VisualRegion[], occupied: Rect[], preferred: Rect): number {
  if (rect.x < 0.025 || rect.y < 0.025 || rect.x + rect.width > 0.975 || rect.y + rect.height > 0.975) return Infinity;
  if (occupied.some((o) => area(expand(rect, VISUAL_WEIGHTS.textGap), o) > 0)) return Infinity;
  let penalty = 0;
  let visualPenalty = 0;
  for (const r of regions) {
    if (r.type === "face") {
      if (area(rect, expand(r, VISUAL_WEIGHTS.faceMargin))) return Infinity;
      continue;
    }
    const protectedRect = r.type === "important_object" || r.type === "action" ? expand(r, VISUAL_WEIGHTS.objectMargin) : r;
    const overlap = area(rect, protectedRect);
    const actualOverlap = area(rect, r);
    const objectFraction = actualOverlap / (r.width * r.height);
    const textFraction = actualOverlap / (rect.width * rect.height);
    if (r.type === "text_or_logo" && textFraction >= VISUAL_WEIGHTS.textAreaLimit) return Infinity;
    // A high-importance object cannot pass merely because its overlap is a
    // small fraction of a large narration rectangle.
    if (r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance
      && (objectFraction >= VISUAL_WEIGHTS.objectAreaLimit || textFraction >= VISUAL_WEIGHTS.textAreaLimit)) {
      visualPenalty += VISUAL_WEIGHTS.warningLimit + objectFraction + textFraction;
    }
    visualPenalty += overlap / (rect.width * rect.height) * VISUAL_WEIGHTS[r.type] * r.importance
      * (r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance ? VISUAL_WEIGHTS.highObjectMultiplier : 1);
    if (overlap > 0 && r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance) visualPenalty += VISUAL_WEIGHTS.highObjectContact;
  }
  penalty += visualPenalty;
  if (visualPenalty === 0 && Math.abs(rect.x - preferred.x) < 0.001 && Math.abs(rect.y - preferred.y) < 0.001) penalty -= VISUAL_WEIGHTS.stability;
  return penalty;
}

export function objectOverlapRatios(rect: Rect, object: Rect): { object: number; text: number } {
  const intersection = area(rect, object);
  return { object: intersection / (object.width * object.height), text: intersection / (rect.width * rect.height) };
}

const dimensions = { width: 1080, height: 1350 };
const measure = (text: string, font: number) => [...text].reduce((sum, ch) => sum + (/[\u1100-\u9fff\uac00-\ud7a3\uff00-\uffef]/u.test(ch) ? 1 : /\s/u.test(ch) ? 0.34 : 0.56) * font, 0);
function resized(size: Rect, width: number, type: "cover" | "narration" | "dialogue", text: string, font: number): Rect | null {
  if (type === "cover") return { ...size, width };
  const lines = wrapText((s) => measure(s, font), text, width * dimensions.width * 0.8).length;
  const needed = (lines * font * 1.35 + font * 0.65) / dimensions.height;
  if (needed > (type === "narration" ? 0.26 : 0.32)) return null;
  return { ...size, width, height: Math.max(type === "narration" ? 0.055 : 0.05, needed) };
}
function candidates(size: Rect, type: "cover" | "narration" | "dialogue", text = "", font = 28): Rect[] {
  const widths = type === "cover" ? [size.width] : [size.width, Math.min(0.84, size.width * 1.15), Math.max(0.18, size.width * 0.85)];
  const offsets = [[0, 0], [-VISUAL_WEIGHTS.offset, 0], [VISUAL_WEIGHTS.offset, 0], [0, -VISUAL_WEIGHTS.offset], [0, VISUAL_WEIGHTS.offset]];
  const all: Rect[] = [];
  for (const width of widths) {
    const box = resized(size, width, type, text, font);
    if (!box) continue;
    const x = [0.05, 0.5 - box.width / 2, 0.95 - box.width];
    const bottom = 0.95 - box.height;
    const slots = type === "cover" ? [
      { x: x[0], y: 0.045 }, { x: x[1], y: 0.045 }, { x: x[2], y: 0.045 },
      { x: x[0], y: 0.34 }, { x: x[2], y: 0.34 }, { x: x[1], y: bottom },
    ] : type === "narration" ? [
      { x: x[1], y: bottom }, { x: x[0], y: bottom }, { x: x[2], y: bottom },
      { x: x[1], y: 0.05 }, { x: x[0], y: 0.05 }, { x: x[2], y: 0.05 },
      { x: x[0], y: 0.35 }, { x: x[2], y: 0.35 },
    ] : SMART_LAYOUT_SLOTS.map((slot) => ({
      x: slot.side === "left" ? slot.x : slot.side === "right" ? slot.x - box.width : slot.x - box.width / 2, y: slot.y,
    }));
    for (const slot of [{ x: size.x, y: size.y }, ...slots]) for (const [dx, dy] of offsets) {
      const rect = { ...box, x: slot.x + dx, y: slot.y + dy };
      if (!all.some((r) => Math.abs(r.x - rect.x) < 0.001 && Math.abs(r.y - rect.y) < 0.001 && Math.abs(r.width - rect.width) < 0.001)) all.push(rect);
    }
  }
  return all;
}
function tailDirections(rect: Rect): ToonBubbleTailDirection[] {
  return rect.x + rect.width / 2 <= 0.5 ? ["bottom-right", "right", "bottom-left"] : ["bottom-left", "left", "bottom-right"];
}
function warningsFor(rect: Rect, regions: VisualRegion[]): VisualWarning[] {
  const warnings = new Set<VisualWarning>();
  for (const r of regions) if (area(rect, r) / (rect.width * rect.height) >= 0.01) {
    if (r.type === "body") warnings.add("LOW_IMPORTANCE_BODY_OVERLAP");
    if (r.type === "hair") warnings.add("HAIR_EDGE_OVERLAP");
    if (r.type === "important_object") warnings.add("LOW_IMPORTANCE_OBJECT_OVERLAP");
    if (r.type === "action") warnings.add("ACTION_EDGE_OVERLAP");
    if (r.type === "hand") warnings.add("HAND_EDGE_OVERLAP");
  }
  return [...warnings];
}
function choose(rect: Rect, type: "cover" | "narration" | "dialogue", regions: VisualRegion[], occupied: Rect[], bubble?: ToonBubble, text = "", font = 28) {
  const ordered: { candidate: Rect; score: number; tailDirection?: ToonBubbleTailDirection }[] = [];
  for (const candidate of candidates(rect, type, text, font)) {
    const body = scoreCandidate(candidate, regions, occupied, rect);
    const tails = type === "dialogue" && bubble && shouldRenderBubbleTail(bubble) ? tailDirections(candidate) : [undefined];
    for (const [index, tailDirection] of tails.entries()) {
      if (ordered.length >= VISUAL_WEIGHTS.candidateLimit) break;
      ordered.push({ candidate, tailDirection, score: body + (tailDirection ? scoreTail(candidate, tailDirection, regions, occupied) : 0) + index * 0.02 });
    }
    if (ordered.length >= VISUAL_WEIGHTS.candidateLimit) break;
  }
  const safe = ordered.filter((entry) => entry.score <= VISUAL_WEIGHTS.warningLimit).sort((a, b) => a.score - b.score);
  if (safe.length) {
    const best = safe[0];
    const warnings = warningsFor(best.candidate, regions);
    if (best.tailDirection) {
      const triangle = tailTriangle(best.candidate, best.tailDirection);
      if (regions.some((r) => r.type === "hair" && triangleAreaInRect(triangle, r) > 0)) warnings.push("HAIR_EDGE_OVERLAP");
      if (regions.some((r) => r.type === "hand" && triangleAreaInRect(triangle, r) > 0)) warnings.push("HAND_EDGE_OVERLAP");
      if (regions.some((r) => r.type === "action" && triangleAreaInRect(triangle, r) > 0)) warnings.push("ACTION_EDGE_OVERLAP");
    }
    return { rect: best.candidate, tailDirection: best.tailDirection, score: best.score, reasonCode: undefined,
      warnings: [...new Set(warnings)] };
  }
  return { rect: null, score: Infinity, warnings: [] as VisualWarning[], reasonCode: (ordered.every((e) => !Number.isFinite(e.score)) && regions.some((r) => r.type === "face")
    ? "FACE_OVERLAP_UNAVOIDABLE" : occupied.length && ordered.every((e) => !Number.isFinite(e.score))
    ? "TEXT_COLLISION_UNAVOIDABLE" : "NO_SAFE_SLOT") as ReviewReason };
}

/** Vision produces boxes only. This function chooses positions without network or randomness. */
export function smartLayoutV2(panel: SmartPanel, regions: VisualRegion[], overwrite = false, imageKey = ""): VisualResult {
  const source = panelLayoutSource(panel);
  if (!canArrangeV2(panel, imageKey, overwrite)) return { status: "SKIPPED_MANUAL", panel, reason: "기존 수동/레거시 배치 또는 동일 이미지의 v2 배치 보호", source, avoided: [] };
  const base = smartLayoutPanel({ ...panel, hasStoredLayout: false }, true);
  if (base.status !== "PASS") return { ...base, source, avoided: [], reasonCode: "NO_SAFE_SLOT" };
  const result = { ...base.panel, dialogue: base.panel.dialogue.map((d) => ({ ...d })) };
  const occupied: Rect[] = [];
  const avoided = new Set<string>();
  const warnings = new Set<VisualWarning>();
  const move = (rect: Rect, type: "cover" | "dialogue" | "narration", bubble?: ToonBubble, text = "", font = 28) => {
    const selected = choose(rect, type, regions, occupied, bubble, text, font);
    if (selected.rect) {
      for (const region of regions) if (area(rect, region) && !area(selected.rect, region)) avoided.add(region.label ?? region.type);
      occupied.push(selected.rect);
      selected.warnings.forEach((warning) => warnings.add(warning));
    }
    return selected;
  };
  if (result.panelType === "cover") {
    const bubble = result.coverTitleBubble!;
    // The renderer measures title and subtitle independently using this same
    // block and explicit font sizes. Try width before reducing font size.
    let best: { positioned: ReturnType<typeof choose>; font: number; subtitleFont: number; quality: number } | null = null;
    const subtitleWidth = result.coverSubtitle ? Math.min(0.84, Math.max(0.6, measure(result.coverSubtitle, 24) / (dimensions.width * 0.92) + 0.02)) : 0.6;
    for (const width of [0.6, 0.72, 0.84].filter((candidate) => candidate + 0.001 >= subtitleWidth)) for (const font of [bubble.font_size ?? 40, 36, 32]) for (const subtitleFont of [24, 22, 20]) {
      const titleLines = wrapText((s) => measure(s, font), result.coverTitle ?? "", width * dimensions.width * 0.92).length;
      const subtitleLines = result.coverSubtitle ? wrapText((s) => measure(s, subtitleFont), result.coverSubtitle, width * dimensions.width * 0.92).length : 0;
      const height = Math.max(0.12, (titleLines * font * 1.25 + (subtitleLines ? font * 0.35 + subtitleLines * subtitleFont * 1.25 : 0)) / dimensions.height + 0.035);
      if (height > 0.31 || subtitleLines > 2) continue;
      const positioned = choose({ ...bubble, width, height }, "cover", regions, occupied);
      if (!positioned.rect) continue;
      const quality = (font < (bubble.font_size ?? 40) ? 0.08 : 0) + (24 - subtitleFont) * 0.16 + (subtitleLines > 1 ? 0.22 : 0);
      if (!best || positioned.score + quality < best.positioned.score + best.quality) best = { positioned, font, subtitleFont, quality };
    }
    if (!best?.positioned.rect) return { status: "REVIEW_REQUIRED", panel, reason: "표지에 안전한 제목 영역이 없습니다.", reasonCode: "FACE_OVERLAP_UNAVOIDABLE", source, avoided: [] };
    best.positioned.warnings.forEach((warning) => warnings.add(warning));
    result.coverTitleBubble = { ...bubble, ...best.positioned.rect, font_size: best.font, subtitle_font_size: best.subtitleFont,
      layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) };
  } else {
    if (result.narrationBubble) {
      const placed = move(result.narrationBubble, "narration", undefined, result.narration ?? "", result.narrationBubble.font_size ?? 26);
      if (!placed.rect) return { status: "REVIEW_REQUIRED", panel, reason: "내레이션에 안전한 영역이 없습니다.", reasonCode: placed.reasonCode, source, avoided: [] };
      result.narrationBubble = { ...result.narrationBubble, ...placed.rect, layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) };
    }
    for (let i = 0; i < result.dialogue.length; i++) {
      const bubble = result.dialogue[i].bubble!;
      const placed = move(bubble, "dialogue", bubble, result.dialogue[i].text, bubble.font_size ?? 28);
      if (!placed.rect) return { status: "REVIEW_REQUIRED", panel, reason: `대사 ${i + 1}에 안전한 영역이 없습니다.`, reasonCode: placed.reasonCode, source, avoided: [] };
      result.dialogue[i] = { ...result.dialogue[i], bubble: { ...bubble, ...placed.rect,
        tail_direction: bubble.tail_enabled ? placed.tailDirection ?? "none" : "none", layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) } };
    }
  }
  return { status: warnings.size ? "PASS_WITH_WARNING" : "PASS", panel: result, source, avoided: [...avoided], warnings: [...warnings] };
}
