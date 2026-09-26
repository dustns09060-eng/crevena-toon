import type { VisualRegion } from "../../src/providers/visualAnalysisSchema";
import type { SmartPanel, SmartResult } from "./smartLayout";
import { SMART_LAYOUT_SLOTS, smartLayoutPanel } from "./smartLayout";
import { canArrangeV2, panelLayoutSource, type ReadLayoutSource } from "./layoutProvenance";

export type Rect = { x: number; y: number; width: number; height: number };
export type ReviewReason = "NO_SAFE_SLOT" | "FACE_OVERLAP_UNAVOIDABLE" | "TEXT_COLLISION_UNAVOIDABLE" | "ANALYSIS_FAILED";
export interface VisualResult extends SmartResult {
  reasonCode?: ReviewReason;
  source: ReadLayoutSource;
  avoided: string[];
}
export const VISUAL_WEIGHTS = Object.freeze({ faceMargin: 0.035, textGap: 0.015, hair: 3.2, hand: 2.2,
  body: 0.5, important_object: 3, action: 3.2, text_or_logo: 2.5, safeLimit: 0.7, stability: 0.14 });

function area(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
const expand = (r: Rect, margin: number): Rect => ({ x: r.x - margin, y: r.y - margin, width: r.width + 2 * margin, height: r.height + 2 * margin });
export function scoreCandidate(rect: Rect, regions: VisualRegion[], occupied: Rect[], preferred: Rect): number {
  if (rect.x < 0.025 || rect.y < 0.025 || rect.x + rect.width > 0.975 || rect.y + rect.height > 0.975) return Infinity;
  if (occupied.some((o) => area(expand(rect, VISUAL_WEIGHTS.textGap), o) > 0)) return Infinity;
  let penalty = 0;
  for (const r of regions) {
    if (r.type === "face") {
      if (area(rect, expand(r, VISUAL_WEIGHTS.faceMargin))) return Infinity;
      continue;
    }
    penalty += area(rect, r) / (rect.width * rect.height) * VISUAL_WEIGHTS[r.type] * r.importance;
  }
  if (Math.abs(rect.x - preferred.x) < 0.001 && Math.abs(rect.y - preferred.y) < 0.001) penalty -= VISUAL_WEIGHTS.stability;
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
function choose(rect: Rect, type: "cover" | "narration" | "dialogue", regions: VisualRegion[], occupied: Rect[]) {
  const ordered = candidates(rect, type, rect).map((candidate) => ({ candidate, score: scoreCandidate(candidate, regions, occupied, rect) }));
  const safe = ordered.filter((entry) => entry.score <= VISUAL_WEIGHTS.safeLimit).sort((a, b) => a.score - b.score);
  if (safe.length) return { rect: safe[0].candidate, reasonCode: undefined };
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
  const move = (rect: Rect, type: "cover" | "dialogue" | "narration") => {
    const selected = choose(rect, type, regions, occupied);
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
      const placed = move(bubble, "dialogue");
      if (!placed.rect) return { status: "REVIEW_REQUIRED", panel, reason: `대사 ${i + 1}에 안전한 영역이 없습니다.`, reasonCode: placed.reasonCode, source, avoided: [] };
      const left = placed.rect.x + placed.rect.width / 2 <= 0.5;
      result.dialogue[i] = { ...result.dialogue[i], bubble: { ...bubble, ...placed.rect,
        tail_direction: bubble.tail_enabled ? left ? "bottom-right" : "bottom-left" : "none", layout_source: "SMART_V2", ...(imageKey ? { analysis_identity: imageKey } : {}) } };
    }
  }
  return { status: "PASS", panel: result, source, avoided: [...avoided] };
}
