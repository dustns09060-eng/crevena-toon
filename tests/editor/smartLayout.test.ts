import { describe, expect, test } from "vitest";
import { SMART_MIN_DIALOGUE_FONT_SIZE, smartLayoutAll, smartLayoutPanel, type SmartPanel } from "../../lib/editor/smartLayout";
import { getDefaultBubbleForIndex } from "../../lib/editor/bubbleLayout";
import { validateCoverTitleBubble, validateNarrationBubble, validateToonDialogue } from "../../src/db/validation";
import type { ToonBubbleStyle, ToonDialogueItem } from "../../src/db/types";

const dialogue = (text: string, index: number, style: ToonBubbleStyle = "normal"): ToonDialogueItem => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  character_id: "22222222-2222-4222-8222-222222222222", text, bubble_type: "speech", bubble: { ...getDefaultBubbleForIndex(index), style },
});
function scene(lines: ToonDialogueItem[] = [], narration: string | null = null, stored = false): SmartPanel {
  return { id: "p1", panelType: "scene", dialogue: lines, narration, narrationBubble: null, coverTitle: null, coverSubtitle: null, coverTitleBubble: null, hasStoredLayout: stored };
}
function intersection(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("Smart Layout v1", () => {
  test("deterministic layouts and short text are compact; long text wraps at safe font sizes", () => {
    const input = scene([dialogue("응!", 0), dialogue("오늘도 어린이집에 다녀온 뒤에 우리 모두 함께 책을 읽고 이야기를 나눴어요.", 1)], "오늘의 기록");
    const result = smartLayoutPanel(input);
    expect(result).toEqual(smartLayoutPanel(input));
    expect(result.status).toBe("PASS");
    expect(result.panel.dialogue[0].bubble!.width).toBeLessThan(0.3);
    expect(result.panel.dialogue[0].bubble!.font_size).toBeGreaterThanOrEqual(SMART_MIN_DIALOGUE_FONT_SIZE);
    expect(result.panel.narrationBubble!.height).toBeLessThan(0.1);
    expect(validateNarrationBubble(result.panel.narrationBubble).valid).toBe(true);
    expect(validateToonDialogue(result.panel.dialogue).valid).toBe(true);
  });

  test.each(["normal", "thought", "shout", "whisper", "soft", "text_only", "round", "emphasis"] as ToonBubbleStyle[])("%s style keeps its shape and tail policy", (style) => {
    const result = smartLayoutPanel(scene([dialogue("한마디", 0, style)]));
    expect(result.status).toBe("PASS");
    expect(result.panel.dialogue[0].bubble?.style).toBe(style);
    expect(result.panel.dialogue[0].bubble?.tail_enabled).toBe(!["thought", "text_only", "whisper", "emphasis"].includes(style));
  });

  test("multiple dialogues avoid narration and each other; excess dialogue requires review rather than collision", () => {
    const result = smartLayoutPanel(scene([dialogue("첫 번째", 0), dialogue("두 번째", 1), dialogue("세 번째", 2)], "짧은 내레이션"));
    expect(result.status).toBe("PASS");
    const rects = [...result.panel.dialogue.map((d) => d.bubble!), result.panel.narrationBubble!];
    rects.forEach((rect, i) => {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1);
      rects.slice(i + 1).forEach((other) => expect(intersection(rect, other)).toBe(false));
    });
    expect(smartLayoutPanel(scene(Array.from({ length: 24 }, (_, i) => dialogue("길고 많은 대사입니다", i)))).status).toBe("REVIEW_REQUIRED");
  });

  test("manual layout is skipped unless explicitly overwritten", () => {
    const input = scene([dialogue("대사", 0)], "내레이션", true);
    expect(smartLayoutPanel(input).status).toBe("SKIPPED_MANUAL");
    expect(smartLayoutPanel(input).panel).toBe(input);
    expect(smartLayoutPanel(input, true).status).toBe("PASS");
    expect(input.dialogue[0].bubble).toEqual({ ...getDefaultBubbleForIndex(0), style: "normal" });
  });

  test("short and long narration sizes, preset and opacity survive; too long requires review", () => {
    const short = scene([], "안녕");
    const long = scene([], "긴 내레이션으로 읽을 수 있게 여러 줄로 배치해요. ".repeat(5));
    short.narrationBubble = { x: 0.1, y: 0.1, width: 0.9, height: 0.5, preset: "soft", opacity: 0.35 };
    const a = smartLayoutPanel(short), b = smartLayoutPanel(long);
    expect(a.status).toBe("PASS");
    expect(b.status).toBe("PASS");
    expect(b.panel.narrationBubble!.height).toBeGreaterThan(a.panel.narrationBubble!.height);
    expect(a.panel.narrationBubble).toMatchObject({ preset: "soft", opacity: 0.35 });
    expect(smartLayoutPanel(scene([], "긴 글 ".repeat(1000))).status).toBe("REVIEW_REQUIRED");
  });

  test("cover title/subtitle fits upper left; projects of any length use their actual panels", () => {
    const cover: SmartPanel = { ...scene(), id: "cover", panelType: "cover", coverTitle: "육아맘, 간호조무사 도전기", coverSubtitle: "EP.01 엄마도 공부하러 갑니다" };
    const panels = [cover, ...Array.from({ length: 19 }, (_, i) => ({ ...scene(), id: `s${i}` }))];
    const results = smartLayoutAll(panels);
    expect(results).toHaveLength(20);
    expect(results[0].status).toBe("PASS");
    expect(results[0].panel.coverTitleBubble).toMatchObject({ x: 0.06, width: 0.44, font_size: 40 });
    expect(validateCoverTitleBubble(results[0].panel.coverTitleBubble).valid).toBe(true);
  });
});
