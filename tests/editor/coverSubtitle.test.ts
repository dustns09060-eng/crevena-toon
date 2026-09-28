import { describe, expect, test } from "vitest";
import { wrapCoverSubtitle } from "../../lib/editor/renderPanel";
import { ToonCoverTitleBubbleSchema } from "../../src/db/validation";

describe("cover subtitle layout", () => {
  const measure = (text: string, font: number) => text.length * font * 0.55;

  test("measures subtitle with its own font size before wrapping", () => {
    const subtitle = "EP.01 엄마도 공부하러 갑니다";
    const wide = wrapCoverSubtitle(measure, subtitle, 400, 48, 24, true);
    const narrow = wrapCoverSubtitle(measure, subtitle, 180, 48, 24, true);
    expect(wide).toEqual([subtitle]);
    expect(narrow.length).toBeGreaterThan(1);
    const legacy = wrapCoverSubtitle(measure, subtitle, 400, 48, 24, false);
    expect(legacy.length).toBeGreaterThan(1);
  });

  test("optional settings validate without changing legacy covers", () => {
    const legacy = { x: 0.05, y: 0.04, width: 0.4, height: 0.16, font_size: 44 };
    expect(ToonCoverTitleBubbleSchema.parse(legacy)).toEqual(legacy);
    expect(ToonCoverTitleBubbleSchema.parse({ ...legacy, subtitle_font_size: 26, subtitle_line_height: 1.4 })).toMatchObject({ subtitle_font_size: 26, subtitle_line_height: 1.4 });
    expect(ToonCoverTitleBubbleSchema.safeParse({ ...legacy, subtitle_line_height: 3 }).success).toBe(false);
  });

});
