import { describe, expect, test } from "vitest";
import { getGenerationErrorMessage } from "../../lib/projects/generationError";

describe("getGenerationErrorMessage", () => {
  test.each(["Too many concurrent requests", "429 rate limit exceeded", "RESOURCE_EXHAUSTED"])(
    "동시 요청 제한 오류를 재시도 안내로 바꾼다: %s",
    (message) => {
      expect(getGenerationErrorMessage(new Error(message), "fallback")).toContain("30~60초 후");
    }
  );

  test.each(["503 Service Unavailable", "request timeout", "deadline exceeded"])(
    "일시적인 서비스 오류를 한국어 안내로 바꾼다: %s",
    (message) => {
      expect(getGenerationErrorMessage(new Error(message), "fallback")).toBe(
        "이미지 생성 서비스가 잠시 불안정해요. 잠시 후 다시 시도해주세요."
      );
    }
  );

  test("그 밖의 오류 메시지는 유지한다", () => {
    expect(getGenerationErrorMessage(new Error("사용자용 오류"), "fallback")).toBe("사용자용 오류");
  });

  test("메시지가 없으면 fallback을 사용한다", () => {
    expect(getGenerationErrorMessage(null, "fallback")).toBe("fallback");
  });
});
