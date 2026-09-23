import { describe, expect, test } from "vitest";
import { CaptionResultSchema } from "../../src/providers/captionSchema";

function makeHashtags(count: number, prefix = "#태그") {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

describe("CaptionResultSchema", () => {
  test("정상적인 caption/hashtags는 통과한다", () => {
    const result = CaptionResultSchema.safeParse({
      caption: "아이 재우고 드디어 커피 한 잔 하려던 순간☕",
      hashtags: makeHashtags(10),
    });
    expect(result.success).toBe(true);
  });

  test("해시태그가 8개 미만이면 거부된다", () => {
    const result = CaptionResultSchema.safeParse({ caption: "짧은 캡션", hashtags: makeHashtags(5) });
    expect(result.success).toBe(false);
  });

  test("해시태그가 15개 초과면 거부된다", () => {
    const result = CaptionResultSchema.safeParse({ caption: "짧은 캡션", hashtags: makeHashtags(20) });
    expect(result.success).toBe(false);
  });

  test("#으로 시작하지 않는 해시태그는 자동으로 #이 붙는다", () => {
    const result = CaptionResultSchema.safeParse({ caption: "캡션", hashtags: makeHashtags(8).map((h) => h.slice(1)) });
    expect(result.success).toBe(true);
    if (result.success) {
      for (const tag of result.data.hashtags) expect(tag.startsWith("#")).toBe(true);
    }
  });

  test("공백이 포함된 해시태그는 거부된다", () => {
    const hashtags = makeHashtags(8);
    hashtags[0] = "#육아 일상";
    const result = CaptionResultSchema.safeParse({ caption: "캡션", hashtags });
    expect(result.success).toBe(false);
  });

  test("캡션이 비어있으면 거부된다", () => {
    const result = CaptionResultSchema.safeParse({ caption: "", hashtags: makeHashtags(8) });
    expect(result.success).toBe(false);
  });

  test("캡션이 600자를 넘으면 거부된다", () => {
    const result = CaptionResultSchema.safeParse({ caption: "가".repeat(601), hashtags: makeHashtags(8) });
    expect(result.success).toBe(false);
  });
});
