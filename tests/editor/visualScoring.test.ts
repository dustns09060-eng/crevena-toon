import { describe, expect, test } from "vitest";
import { objectOverlapRatios, scoreCandidate, scoreTail, smartLayoutV2, VISUAL_WEIGHTS, type Rect } from "../../lib/editor/visualScoring";
import type { VisualRegion } from "../../src/providers/visualAnalysisSchema";
import type { SmartPanel } from "../../lib/editor/smartLayout";
import { getDefaultBubbleForIndex } from "../../lib/editor/bubbleLayout";

const region = (type: VisualRegion["type"], box: Rect, importance = 1, label?: string): VisualRegion => ({ type, ...box, importance, ...(label ? { label } : {}) });
const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
const scene = (narration = "오늘의 이야기"): SmartPanel => ({ id: "panel", panelType: "scene", dialogue: [], narration,
  narrationBubble: null, coverTitle: null, coverSubtitle: null, coverTitleBubble: null, hasStoredLayout: false });

describe("visual candidate scoring", () => {
  test.each(["face", "hair", "hand", "body", "important_object", "action", "text_or_logo"] as VisualRegion["type"][])("%s region affects score", (type) => {
    const score = scoreCandidate(rect, [region(type, rect)], [], rect);
    expect(type === "face" ? !Number.isFinite(score) : score > -VISUAL_WEIGHTS.stability).toBe(true);
  });
  test("face safety margin, boundary and text collision are hard rejects", () => {
    expect(scoreCandidate(rect, [region("face", { x: 0.31, y: 0.1, width: 0.08, height: 0.1 })], [], rect)).toBe(Infinity);
    expect(scoreCandidate({ ...rect, x: 0.9 }, [], [], rect)).toBe(Infinity);
    expect(scoreCandidate(rect, [], [{ x: 0.3, y: 0.1, width: 0.1, height: 0.1 }], rect)).toBe(Infinity);
  });
  test("importance weights and stability are deterministic", () => {
    const low = scoreCandidate(rect, [region("important_object", rect, 0.2)], [], rect);
    const high = scoreCandidate(rect, [region("important_object", rect, 1)], [], rect);
    expect(high).toBeGreaterThan(low);
    expect(scoreCandidate(rect, [], [], rect)).toBe(-VISUAL_WEIGHTS.stability);
    expect(scoreCandidate(rect, [], [], rect)).toBe(scoreCandidate(rect, [], [], rect));
  });
  test("pencil case safety margin and high importance beat preferred slot stability", () => {
    const preferred = { x: 0.3, y: 0.82, width: 0.35, height: 0.1 };
    const caseBox = region("important_object", { x: 0.66, y: 0.83, width: 0.12, height: 0.1 }, 0.95, "pencil case");
    expect(scoreCandidate(preferred, [caseBox], [], preferred)).toBeGreaterThan(VISUAL_WEIGHTS.safeLimit);
    expect(scoreCandidate({ ...preferred, x: 0.05 }, [caseBox], [], preferred)).toBe(0);
    expect(scoreCandidate(preferred, [caseBox], [], preferred)).toBeGreaterThan(scoreCandidate({ ...preferred, x: 0.05 }, [caseBox], [], preferred));
  });
  test("tail triangle is scored even when bubble body is safe", () => {
    const bubble = { x: 0.05, y: 0.05, width: 0.25, height: 0.12 };
    const hair = region("hair", { x: 0.26, y: 0.177, width: 0.04, height: 0.05 });
    expect(scoreCandidate(bubble, [hair], [], bubble)).toBe(-VISUAL_WEIGHTS.stability);
    expect(scoreTail(bubble, "bottom-right", [hair], [])).toBeGreaterThan(0);
    expect(scoreTail(bubble, "right", [hair], [])).toBe(0);
    expect(scoreTail(bubble, "bottom-right", [region("face", { x: hair.x, y: hair.y, width: hair.width, height: hair.height })], [])).toBe(Infinity);
  });
  test("partial pencil-case overlap is measured against both object and narration", () => {
    const narration = { x: 0.6, y: 0.8, width: 0.25, height: 0.08 };
    const pencil = region("important_object", { x: 0.5, y: 0.74, width: 0.2, height: 0.12 }, 0.95, "pencil case");
    expect(objectOverlapRatios(narration, pencil).object).toBeGreaterThan(0.1);
    expect(objectOverlapRatios(narration, pencil).text).toBeGreaterThan(0.2);
    expect(scoreCandidate(narration, [pencil], [], narration)).toBeGreaterThan(VISUAL_WEIGHTS.warningLimit);
  });
  test("pre-existing image text and face stay hard constraints", () => {
    expect(scoreCandidate(rect, [region("text_or_logo", rect)], [], rect)).toBe(Infinity);
    expect(scoreCandidate(rect, [region("face", rect)], [], rect)).toBe(Infinity);
  });
});

describe("v2 layout fixtures", () => {
  test("Panel 8 pencil case, 9 laptop, 10 walking action move narration away", () => {
    for (const [type, label] of [["important_object", "pencil case"], ["important_object", "laptop"], ["action", "walking"]] as const) {
      const result = smartLayoutV2(scene(), [region(type, { x: 0.3, y: 0.82, width: 0.4, height: 0.16 }, 1, label)]);
      expect(result.status).toBe("PASS");
      const box = result.panel.narrationBubble!;
      expect(box.x + box.width <= 0.3 || box.x >= 0.7 || box.y + box.height <= 0.82 || box.y >= 0.98).toBe(true);
      expect(result.avoided).toContain(label);
      expect(result.panel.narrationBubble?.layout_source).toBe("SMART_V2");
    }
  });
  test("Panel 6 pencil case margin, and Panel 9 notebooks plus laptop remain clear", () => {
    const pencil = region("important_object", { x: 0.64, y: 0.82, width: 0.16, height: 0.14 }, 0.95, "pencil case");
    const sixth = smartLayoutV2(scene(), [pencil]);
    expect(sixth.status).toBe("PASS");
    expect(scoreCandidate(sixth.panel.narrationBubble!, [pencil], [], sixth.panel.narrationBubble!)).toBeLessThan(0);
    const laptop = region("important_object", { x: 0.33, y: 0.8, width: 0.32, height: 0.16 }, 1, "laptop");
    const notebooks = region("important_object", { x: 0.66, y: 0.8, width: 0.2, height: 0.16 }, 0.9, "notebooks");
    const ninth = smartLayoutV2(scene(), [laptop, notebooks]);
    expect(ninth.status).toBe("PASS");
    expect(scoreCandidate(ninth.panel.narrationBubble!, [laptop, notebooks], [], ninth.panel.narrationBubble!)).toBeLessThan(0);
  });
  test("Panel 7 prefers a safe tail direction when body is clear and hair touches only tail", () => {
    const p = scene(null as unknown as string);
    p.dialogue = [{ id: "1", character_id: "2", bubble_type: "speech", text: "안녕!", bubble: { ...getDefaultBubbleForIndex(0), style: "soft", layout_source: "IMPORT_DEFAULT" } }];
    const baseline = smartLayoutV2(p, []);
    expect(baseline.status).toBe("PASS");
    const bubble = baseline.panel.dialogue[0].bubble!;
    const hair = region("hair", { x: bubble.x + bubble.width * 0.8, y: bubble.y + bubble.height + 0.007, width: 0.06, height: 0.04 });
    const result = smartLayoutV2(p, [hair]);
    expect(result.status).toBe("PASS");
    const selected = result.panel.dialogue[0].bubble!;
    expect(scoreTail(selected, selected.tail_direction, [hair], [])).toBe(0);
  });
  test("safe v1 preferred position stays stable", () => {
    const result = smartLayoutV2(scene(), []);
    expect(result.status).toBe("PASS");
    expect(result.panel.narrationBubble?.y).toBeCloseTo(0.9 - result.panel.narrationBubble!.height);
    expect(result).toEqual(smartLayoutV2(scene(), []));
  });
  test("cover avoids hair/face, subtitle has readable explicit size", () => {
    const cover = { ...scene(null as unknown as string), panelType: "cover" as const,
      coverTitle: "육아맘, 간호조무사 도전기", coverSubtitle: "EP.01 엄마도 공부하러 갑니다" };
    const result = smartLayoutV2(cover, [region("hair", { x: 0.05, y: 0.04, width: 0.18, height: 0.28 }),
      region("face", { x: 0.05, y: 0.2, width: 0.12, height: 0.15 })]);
    expect(result.status).toBe("PASS");
    expect(result.panel.coverTitleBubble?.x).not.toBe(0.06);
    expect(result.panel.coverTitleBubble?.subtitle_font_size).toBeGreaterThanOrEqual(20);
  });
  test("cover evaluates top-right then middle when upper face boxes block all top slots", () => {
    const cover = { ...scene(null as unknown as string), panelType: "cover" as const,
      coverTitle: "육아맘, 간호조무사 도전기", coverSubtitle: "EP.01 엄마도 공부하러 갑니다" };
    const left = smartLayoutV2(cover, [region("face", { x: 0.01, y: 0.01, width: 0.25, height: 0.18 })]);
    expect(left.status).toBe("PASS");
    expect(left.panel.coverTitleBubble!.x).toBeGreaterThan(0.1);
    const upper = smartLayoutV2(cover, [region("face", { x: 0, y: 0, width: 1, height: 0.29 })]);
    expect(["PASS", "PASS_WITH_WARNING"]).toContain(upper.status);
    expect(upper.panel.coverTitleBubble!.y).toBeGreaterThanOrEqual(0.3);
    expect(upper.panel.coverTitleBubble!.subtitle_font_size).toBeGreaterThanOrEqual(20);
    expect(upper).toEqual(smartLayoutV2(cover, [region("face", { x: 0, y: 0, width: 1, height: 0.29 })]));
  });
  test("cover widens a long subtitle before shrinking below readable font", () => {
    const cover = { ...scene(null as unknown as string), panelType: "cover" as const,
      coverTitle: "육아맘 도전기", coverSubtitle: "가".repeat(28) };
    const result = smartLayoutV2(cover, []);
    expect(result.status).toBe("PASS");
    expect(result.panel.coverTitleBubble!.width).toBeGreaterThanOrEqual(0.72);
    expect(result.panel.coverTitleBubble!.subtitle_font_size).toBeGreaterThanOrEqual(20);
  });
  test("small body or walking edge overlap warns, while face never passes", () => {
    const body = region("body", { x: 0.1, y: 0.05, width: 0.24, height: 0.1 }, 0.2);
    const b = smartLayoutV2(scene(), [body]);
    expect(["PASS", "PASS_WITH_WARNING"]).toContain(b.status);
    const action = region("action", { x: 0.1, y: 0.9, width: 0.4, height: 0.07 }, 0.8, "walking");
    const walking = smartLayoutV2(scene(), [action]);
    expect(["PASS", "PASS_WITH_WARNING"]).toContain(walking.status);
    expect(scoreCandidate(rect, [region("face", rect)], [], rect)).toBe(Infinity);
  });
  test("warning threshold and bounded deterministic candidate search", () => {
    expect(VISUAL_WEIGHTS.candidateLimit).toBeLessThanOrEqual(600);
    const regions = [region("body", { x: 0.02, y: 0.02, width: 0.96, height: 0.94 }, 0.25)];
    const first = smartLayoutV2(scene("짧은 내레이션"), regions);
    expect(first.status).toBe("PASS_WITH_WARNING");
    expect(first.warnings).toContain("LOW_IMPORTANCE_BODY_OVERLAP");
    expect(first).toEqual(smartLayoutV2(scene("짧은 내레이션"), regions));
  });
  test("walking action occupying every candidate produces a warning rather than an unsafe PASS", () => {
    const walking = region("action", { x: 0.025, y: 0.025, width: 0.95, height: 0.95 }, 0.2, "walking");
    const result = smartLayoutV2(scene("길을 걷는 가족"), [walking]);
    expect(result.status).toBe("PASS_WITH_WARNING");
    expect(result.warnings).toContain("ACTION_EDGE_OVERLAP");
  });
  test("no safe slot requests review, never saves an overlap", () => {
    const result = smartLayoutV2(scene(), [region("face", { x: 0, y: 0, width: 1, height: 1 })]);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("FACE_OVERLAP_UNAVOIDABLE");
  });
  test("dialogue retains v1 font/style/tail while selecting a safe slot", () => {
    const p = scene(null as unknown as string);
    p.dialogue = [{ id: "1", character_id: "2", bubble_type: "speech", text: "안녕!",
      bubble: { ...getDefaultBubbleForIndex(0), style: "soft", layout_source: "IMPORT_DEFAULT" } }];
    const result = smartLayoutV2(p, [region("face", { x: 0.05, y: 0.05, width: 0.4, height: 0.2 })]);
    expect(result.status).toBe("PASS");
    expect(result.panel.dialogue[0].bubble).toMatchObject({ style: "soft", tail_enabled: true, layout_source: "SMART_V2" });
    expect(result.panel.dialogue[0].bubble?.x).toBeGreaterThan(0.4);
  });
});
