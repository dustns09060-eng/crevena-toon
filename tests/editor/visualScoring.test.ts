import { describe, expect, test } from "vitest";
import { scoreCandidate, smartLayoutV2, VISUAL_WEIGHTS, type Rect } from "../../lib/editor/visualScoring";
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
