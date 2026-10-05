import { describe, expect, it } from "vitest";
import { computeCaptionLayout } from "../../lib/editor/captionLayout";
import { ToonNarrationBubbleSchema } from "../../src/db/validation";
describe("outside-art captions", () => {
  it("preserves the whole canvas when captions are absent", () => {
    expect(computeCaptionLayout([], 1080, 1350, (s) => s.length * 28).artHeight).toBe(1350);
  });
  it("reserves space for every line without overlapping artwork", () => {
    const result = computeCaptionLayout(["안녕하세요".repeat(12), "육퇴 후 공부"], 1080, 1350, (s) => s.length * 28);
    expect(result.blocks[0].length).toBeGreaterThan(1);
    expect(result.artHeight + result.captionHeight).toBe(1350);
    expect(result.artHeight).toBeGreaterThan(1350 * 0.58);
  });
  it("rejects excessive text instead of silently clipping or shrinking", () => {
    expect(() => computeCaptionLayout(["가".repeat(900)], 1080, 1350, (s) => s.length * 28)).toThrow("대사가 너무 길어");
  });
  it("round trips the optional mode and accepts old saved layouts", () => {
    const old = { x: 0.1, y: 0.8, width: 0.8, height: 0.1 };
    expect(ToonNarrationBubbleSchema.parse(old)).toEqual(old);
    expect(ToonNarrationBubbleSchema.parse({ ...old, composition: "caption" }).composition).toBe("caption");
  });
});
