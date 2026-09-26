import type { VisualRegion } from "../../src/providers/visualAnalysisSchema";
import type { SmartPanel, SmartResult } from "./smartLayout";
import { SMART_LAYOUT_SLOTS, smartLayoutPanel } from "./smartLayout";
import { canArrangeV2, panelLayoutSource, type ReadLayoutSource } from "./layoutProvenance";
import { computeBubbleTailTriangle, shouldRenderBubbleTail } from "./bubbleLayout";
import type { ToonBubble, ToonBubbleTailDirection } from "../../src/db/types";

export type Rect = { x: number; y: number; width: number; height: number };
export type ReviewReason = "NO_SAFE_SLOT" | "FACE_OVERLAP_UNAVOIDABLE" | "TEXT_COLLISION_UNAVOIDABLE" | "ANALYSIS_FAILED";
export interface VisualResult extends SmartResult {
  reasonCode?: ReviewReason;
  source: ReadLayoutSource;
  avoided: string[];
}
export const VISUAL_WEIGHTS = Object.freeze({ faceMargin: 0.035, objectMargin: 0.02, tailMargin: 0.012,
  highImportance: 0.75, highObjectMultiplier: 3, highObjectContact: 0.8, textGap: 0.015, hair: 3.2, hand: 2.2,
  body: 0.5, important_object: 4, action: 4, text_or_logo: 2.5, safeLimit: 0.7, stability: 0.14 });

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
    visualPenalty += overlap / (rect.width * rect.height) * VISUAL_WEIGHTS[r.type] * r.importance
      * (r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance ? VISUAL_WEIGHTS.highObjectMultiplier : 1);
    if (overlap > 0 && r.type === "important_object" && r.importance >= VISUAL_WEIGHTS.highImportance) visualPenalty += VISUAL_WEIGHTS.highObjectContact;
  }
  penalty += visualPenalty;
  if (visualPenalty === 0 && Math.abs(rect.x - preferred.x) < 0.001 && Math.abs(rect.y - preferred.y) < 0.001) penalty -= VISUAL_WEIGHTS.stability;
  return penalty;
}

function candidates(size: Rect, type: "cover" | "narration" | "dialogue", preferred: Rect): Rect[] {
  const x = [0.05, 0.5 - size.width / 2, 0.95 - size.width];
  const top = 0.05, bottom = 0.95 - size.height;
  const slots = type === "cover" ? [
    { x: x[0], y: 0.045 }, { x: x[1], y: 0.045 }, { x: x[2], y: 0.045 },
    { x: x[0], y: 0.30 }, { x: x[2], y: 0.30 },
  ] : type === "narration" ? [
    { x: x[1], y: bottom }, { x: x[0], y: bottom }, { x: x[2], y: bottom },
    { x: x[1], y: top }, { x: x[0], y: top }, { x: x[2], y: top },
  ] : SMART_LAYOUT_SLOTS.map((slot) => ({
    x: slot.side === "left" ? slot.x : slot.side === "right" ? slot.x - size.width : slot.x - size.width / 2,
    y: slot.y,
  }));
  return [preferred, ...slots].map((s) => ({ ...size, x: s.x, y: s.y }))
    .filter((r, i, all) => all.findIndex((a) => Math.abs(a.x - r.x) < 0.001 && Math.abs(a.y - r.y) < 0.001) === i);
}
function tailDirections(rect: Rect): ToonBubbleTailDirection[] {
  return rect.x + rect.width / 2 <= 0.5 ? ["bottom-right", "right", "bottom-left"] : ["bottom-left", "left", "bottom-right"];
}
function choose(rect: Rect, type: "cover" | "narration" | "dialogue", regions: VisualRegion[], occupied: Rect[], bubble?: ToonBubble) {
  const ordered = candidates(rect, type, rect).flatMap<{ candidate: Rect; score: number; tailDirection?: ToonBubbleTailDirection }>((candidate) => {
    const body = scoreCandidate(candidate, regions, occupied, rect);
    if (type !== "dialogue" || !bubble || !shouldRenderBubbleTail(bubble)) return [{ candidate, score: body, tailDirection: undefined }];
    return tailDirections(candidate).map((tailDirection, index) => ({ candidate, tailDirection,
      score: body + scoreTail(candidate, tailDirection, regions, occupied) + index * 0.02 }));
  });
  const safe = ordered.filter((entry) => entry.score <= VISUAL_WEIGHTS.safeLimit).sort((a, b) => a.score - b.score);
  if (safe.length) return { rect: safe[0].candidate, tailDirection: safe[0].tailDirection, reasonCode: undefined };
  return { rect: null, reasonCode: (ordered.every((e) => !Number.isFinite(e.score)) && regions.some((r) => r.type === "face")
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
  const move = (rect: Rect, type: "cover" | "dialogue" | "narration", bubble?: ToonBubble) => {
    const selected = choose(rect, type, regions, occupied, bubble);
    if (selected.rect) {
      for (const region of regions) if (area(rect, region) && !area(selected.rect, region)) avoided.add(region.label ?? region.type);
      occupied.push(selected.rect);
    }
    return selected;
  };
  if (result.panelType === "cover") {
    const bubble = result.coverTitleBubble!;
    // Use a wider block before shrinking subtitle text. Legacy render remains unchanged.
    const width = result.coverSubtitle ? Math.max(0.6, Math.min(0.8, 0.48 + [...result.coverSubtitle].length * 0.01)) : bubble.width;
    const size = { ...bubble, width, height: Math.max(bubble.height, result.coverSubtitle ? 0.16 : bubble.height) };
    const positioned = move(size, "cover");
    if (!positioned.rect) return { status: "REVIEW_REQUIRED", panel, reason: "표지에 안전한 제목 영역이 없습니다.", reasonCode: positioned.reasonCode, source, avoided: [] };
    result.coverTitleBubble = { ...bubble, ...positioned.rect, subtitle_font_size: 24, layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) };
  } else {
    if (result.narrationBubble) {
      const placed = move(result.narrationBubble, "narration");
      if (!placed.rect) return { status: "REVIEW_REQUIRED", panel, reason: "내레이션에 안전한 영역이 없습니다.", reasonCode: placed.reasonCode, source, avoided: [] };
      result.narrationBubble = { ...result.narrationBubble, ...placed.rect, layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) };
    }
    for (let i = 0; i < result.dialogue.length; i++) {
      const bubble = result.dialogue[i].bubble!;
      const placed = move(bubble, "dialogue", bubble);
      if (!placed.rect) return { status: "REVIEW_REQUIRED", panel, reason: `대사 ${i + 1}에 안전한 영역이 없습니다.`, reasonCode: placed.reasonCode, source, avoided: [] };
      result.dialogue[i] = { ...result.dialogue[i], bubble: { ...bubble, ...placed.rect,
        tail_direction: bubble.tail_enabled ? placed.tailDirection ?? "none" : "none", layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) } };
    }
  }
  return { status: "PASS", panel: result, source, avoided: [...avoided] };
}
